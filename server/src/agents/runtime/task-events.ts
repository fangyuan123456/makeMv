import { taskDispatcher, taskStore, partitionPlanWaves, type PlanOperationItem } from '../../task-engine/index.js';
import type { TaskRecord } from '../../task-engine/types.js';
import { AgentFactory } from '../registry.js';
import type { AgentRunner } from './runner.js';
import type { ParsedIntentResult, PlanStepRecord, SessionActionIntent } from './types.js';
import { computePlanAggregate } from './task-message-sync.js';
import { summaryEvents } from './summary-events.js';

export { partitionPlanWaves, type PlanOperationItem } from '../../task-engine/index.js';

const summariesInFlight = new Set<string>();

function isTerminalStatus(status?: string, taskId?: string): boolean {
  if (status !== 'completed' && status !== 'failed' && status !== 'cancelled') {
    return false;
  }
  if (!taskId) return true;
  const live = taskStore.getLatestTask(taskId) || taskStore.getTask(taskId);
  if (!live) return true;
  // 若任务带有服务重启待恢复标识，坚决不视为终态，严禁提前复盘抢跑！
  if (live.recovery === 'restart') return false;
  // 若已被替换重试为活跃新任务，以新任务实际状态判定
  if (live.taskId !== taskId) {
    return live.status === 'completed' || live.status === 'failed' || live.status === 'cancelled';
  }
  return true;
}

function hydratePlanSteps(planSteps: PlanStepRecord[]): PlanStepRecord[] {
  return planSteps.map((step) => {
    // 顺藤摸瓜：追踪是否有重试或服务重启恢复后的最新替代任务
    const live = taskStore.getLatestTask(step.taskId) || taskStore.getTask(step.taskId);
    if (!live) return step;
    // 若原任务正在等待自动重启恢复，避免过早判定为 failed 触发复盘抢跑
    const effectiveStatus = live.recovery === 'restart' ? 'pending' : live.status;
    return {
      ...step,
      taskId: live.taskId,
      status: effectiveStatus,
      progress: live.progress ?? step.progress,
      durationMs: live.durationMs ?? step.durationMs,
      error: live.error ?? step.error,
    };
  });
}

export async function dispatchApprovedIntent(
  session: AgentRunner,
  result: ParsedIntentResult,
): Promise<void> {
  const intent = result.intent as SessionActionIntent | null;
  if (intent?.action !== 'approve' || !result.messageId) return;

  try {
    const operations = intent.operations?.length
      ? intent.operations
      : intent.tool ? [{ tool: intent.tool, title: intent.title, params: intent.params }] : [];
    if (!operations.length) throw new Error('批准意图缺少目标工具');

    const parentMessage = session.getMessages().find((m) => m.id === result.messageId);
    if (!parentMessage) throw new Error(`未找到批准目标消息: ${result.messageId}`);

    // 单步原子任务：保持轻量单卡结构
    if (operations.length === 1) {
      const operation = operations[0];
      const task = await taskDispatcher.dispatch({
        projectId: session.projectId,
        toolName: operation.tool,
        input: {
          ...(operation.params || {}),
          projectId: session.projectId,
          __chatContext: { sessionId: session.sessionId, messageId: parentMessage.id },
        },
        idempotencyKey: `chat:${session.sessionId}:${result.messageId}`,
      });
      const currentTask = taskStore.getTask(task.taskId) || task;
      if (parentMessage.taskId !== task.taskId) {
        session.updateMessage(parentMessage.id, {
          taskId: task.taskId,
          taskTool: task.toolName,
          taskTitle: operation.title || task.toolName,
          taskStatus: currentTask.status,
          taskProgress: currentTask.progress,
          metadata: {
            ...parentMessage.metadata,
            summaryStatus: currentTask.status === 'failed' || currentTask.status === 'cancelled' ? 'skipped' : 'pending',
          },
        });
      }
      result.task = currentTask;
      if (currentTask.status === 'completed') void ensureSingleTaskSummary(currentTask);
      return;
    }

    // 多步 Plan 容器：按 Wave 波次切分派发（同波次独立实体受控并发，跨波次通过 dependsOnTaskIds 严格串行接力）
    // 所有原子子 Task 统一收敛至同一条父消息的 planSteps[]，零刷屏且终态只做 1 次汇总复盘
    const waves = partitionPlanWaves(session.projectId, operations);
    const planSteps: PlanStepRecord[] = [];
    let previousWaveTaskIds: string[] = [];

    for (const wave of waves) {
      const currentWaveTaskIds: string[] = [];
      for (const { index, operation } of wave) {
        const task = await taskDispatcher.dispatch({
          projectId: session.projectId,
          toolName: operation.tool,
          input: {
            ...(operation.params || {}),
            projectId: session.projectId,
            __chatContext: {
              sessionId: session.sessionId,
              messageId: parentMessage.id,
              planStepIndex: index,
            },
          },
          idempotencyKey: `chat:${session.sessionId}:${result.messageId}:${index}`,
          ...(previousWaveTaskIds.length > 0 ? { dependsOnTaskIds: [...previousWaveTaskIds] } : {}),
        });
        const currentTask = taskStore.getTask(task.taskId) || task;
        currentWaveTaskIds.push(currentTask.taskId);
        if (index === 0) result.task = currentTask;
        planSteps.push({
          stepIndex: index,
          taskId: currentTask.taskId,
          tool: currentTask.toolName,
          title: operation.title || currentTask.toolName,
          status: currentTask.status,
          ...(currentTask.progress ? { progress: currentTask.progress } : {}),
          ...(currentTask.durationMs !== undefined ? { durationMs: currentTask.durationMs } : {}),
          ...(currentTask.error ? { error: currentTask.error } : {}),
        });
      }
      previousWaveTaskIds = currentWaveTaskIds;
    }

    const hydratedPlanSteps = hydratePlanSteps(planSteps);
    const aggregate = computePlanAggregate(hydratedPlanSteps);
    session.updateMessage(parentMessage.id, {
      taskTool: 'plan',
      taskTitle: intent.title || `执行计划（共 ${hydratedPlanSteps.length} 步）`,
      taskStatus: aggregate.taskStatus,
      taskProgress: aggregate.taskProgress,
      ...(aggregate.taskDurationMs !== undefined ? { taskDurationMs: aggregate.taskDurationMs } : {}),
      ...(aggregate.taskError ? { taskError: aggregate.taskError } : {}),
      planSteps: hydratedPlanSteps,
      metadata: {
        ...parentMessage.metadata,
        summaryStatus: 'pending',
      },
    });

    // 若派发循环期间已有前置步骤迅速失败，立刻执行下游依赖止损
    for (const step of hydratedPlanSteps) {
      if (step.status === 'failed') {
        const failedTask = taskStore.getTask(step.taskId);
        if (failedTask) {
          for (const candidate of hydratedPlanSteps) {
            if (shouldCancelDownstreamStep(failedTask, step, candidate)) {
              taskDispatcher.cancel(candidate.taskId);
            }
          }
        }
      }
    }

    const finalPlanSteps = hydratePlanSteps(hydratedPlanSteps);
    if (finalPlanSteps.every((step) => isTerminalStatus(step.status, step.taskId))) {
      void ensurePlanSummary(session.projectId, session.sessionId, parentMessage.id);
    }
  } catch (err: any) {
    result.dispatchError = err?.message || String(err);
    result.cleanText = `${result.cleanText}\n\n任务启动失败：${result.dispatchError}`;
    session.updateMessage(result.messageId, { content: result.cleanText, taskError: result.dispatchError });
  }
}

async function ensureSingleTaskSummary(task: TaskRecord): Promise<void> {
  const context = (task.input as any)?.__chatContext;
  if (task.status !== 'completed' || !context?.sessionId || !context?.messageId) return;
  const inflightKey = `${task.projectId}:${context.sessionId}:${context.messageId}`;
  if (summariesInFlight.has(inflightKey)) return;

  const session = AgentFactory.create(context.sessionId, {
    projectId: task.projectId,
    sessionId: context.sessionId,
  });
  const message = session.getMessages().find((item) => item.id === context.messageId && item.taskId === task.taskId);
  if (!message || message.metadata?.summaryStatus === 'completed' || !message.metadata?.summaryStatus) return;
  if (message.postSummarySpeech) {
    session.updateMessage(message.id, { metadata: { ...message.metadata, summaryStatus: 'completed' } });
    return;
  }

  summariesInFlight.add(inflightKey);
  session.updateMessage(message.id, {
    metadata: { ...message.metadata, summaryStatus: 'running' },
  });
  summaryEvents.begin(task.projectId, context.sessionId, message.id);

  try {
    const taskInput = (task.input as any) || {};
    const targetShotId = taskInput.shotId || (taskInput.targetKind === 'shot_keyframe' ? taskInput.targetId : undefined);
    const targetEntityId = taskInput.targetId;
    const focusTarget = targetShotId
      ? { kind: 'shot', id: targetShotId, label: `镜头 ${targetShotId}` }
      : targetEntityId
      ? { kind: taskInput.targetKind || 'entity', id: targetEntityId, label: taskInput.name || String(targetEntityId) }
      : undefined;

    await session.stream({
      message: session.getPostTaskPrompt(task, message.taskTitle || task.toolName),
      isSystemTrigger: true,
      targetMessageId: message.id,
      focus: focusTarget ? { location: context.sessionId, target: focusTarget } : undefined,
      onTextChunk: (chunk) => summaryEvents.append(task.projectId, context.sessionId, message.id, chunk),
    });
    const current = session.getMessages().find((item) => item.id === message.id);
    const hasSummaryContent = Boolean(current && current.postSummarySpeech);
    if (hasSummaryContent) {
      session.updateMessage(message.id, {
        metadata: { ...current?.metadata, summaryStatus: 'completed' },
      });
      summaryEvents.finish(task.projectId, context.sessionId, message.id);
    } else {
      const fallbackSummary = `工序【${message.taskTitle || task.toolName}】已物理落盘并水合至项目资产黑板。`;
      session.updateMessage(message.id, {
        postSummarySpeech: fallbackSummary,
        metadata: { ...current?.metadata, summaryStatus: 'completed' },
      });
      summaryEvents.append(task.projectId, context.sessionId, message.id, fallbackSummary);
      summaryEvents.finish(task.projectId, context.sessionId, message.id);
    }
  } catch (err: any) {
    const current = session.getMessages().find((item) => item.id === message.id);
    session.updateMessage(message.id, {
      metadata: { ...current?.metadata, summaryStatus: 'failed', summaryError: err?.message || String(err) },
    });
    summaryEvents.fail(task.projectId, context.sessionId, message.id, err?.message || String(err));
    console.error(`[ChatWorkflow] 任务 ${task.taskId} 复盘失败:`, err);
  } finally {
    summariesInFlight.delete(inflightKey);
  }
}

async function ensurePlanSummary(projectId: string, sessionId: string, messageId: string): Promise<void> {
  const inflightKey = `${projectId}:${sessionId}:${messageId}`;
  if (summariesInFlight.has(inflightKey)) return;

  const session = AgentFactory.create(sessionId, { projectId, sessionId });
  const message = session.getMessages().find((item) => item.id === messageId);
  if (!message || !Array.isArray(message.planSteps) || message.planSteps.length === 0) return;
  if (message.metadata?.summaryStatus === 'completed' || message.metadata?.summaryStatus === 'skipped' || !message.metadata?.summaryStatus) return;

  const hydratedSteps = hydratePlanSteps(message.planSteps);
  if (!hydratedSteps.every((step) => isTerminalStatus(step.status, step.taskId))) {
    return;
  }

  // 若全部被取消且无任何成功步骤，则无需消耗大模型复盘
  const completedCount = hydratedSteps.filter((s) => s.status === 'completed').length;
  const failedCount = hydratedSteps.filter((s) => s.status === 'failed').length;
  if (completedCount === 0 && failedCount === 0) {
    session.updateMessage(message.id, {
      planSteps: hydratedSteps,
      ...computePlanAggregate(hydratedSteps),
      metadata: { ...message.metadata, summaryStatus: 'skipped' },
    });
    return;
  }

  summariesInFlight.add(inflightKey);
  session.updateMessage(message.id, {
    planSteps: hydratedSteps,
    ...computePlanAggregate(hydratedSteps),
    metadata: { ...message.metadata, summaryStatus: 'running' },
  });
  summaryEvents.begin(projectId, sessionId, message.id);

  try {
    await session.stream({
      message: session.getPostPlanPrompt(message.taskTitle || '制片执行计划', hydratedSteps),
      isSystemTrigger: true,
      targetMessageId: message.id,
      onTextChunk: (chunk) => summaryEvents.append(projectId, sessionId, message.id, chunk),
    });
    const current = session.getMessages().find((item) => item.id === message.id);
    const hasSummaryContent = Boolean(current && current.postSummarySpeech);
    if (hasSummaryContent) {
      session.updateMessage(message.id, {
        metadata: { ...current?.metadata, summaryStatus: 'completed' },
      });
      summaryEvents.finish(projectId, sessionId, message.id);
    } else {
      const fallbackSummary = session.buildPlanSummaryFallback(message.taskTitle || '制片执行计划', hydratedSteps);
      session.updateMessage(message.id, {
        postSummarySpeech: fallbackSummary,
        metadata: { ...current?.metadata, summaryStatus: 'completed' },
      });
      summaryEvents.append(projectId, sessionId, message.id, fallbackSummary);
      summaryEvents.finish(projectId, sessionId, message.id);
    }
  } catch (err: any) {
    const current = session.getMessages().find((item) => item.id === message.id);
    session.updateMessage(message.id, {
      metadata: { ...current?.metadata, summaryStatus: 'failed', summaryError: err?.message || String(err) },
    });
    summaryEvents.fail(projectId, sessionId, message.id, err?.message || String(err));
    console.error(`[ChatWorkflow] Plan 消息 ${messageId} 汇总复盘失败:`, err);
  } finally {
    summariesInFlight.delete(inflightKey);
  }
}

function shouldCancelDownstreamStep(
  failedTask: TaskRecord,
  failedStep: PlanStepRecord,
  candidateStep: PlanStepRecord
): boolean {
  if (candidateStep.stepIndex <= failedStep.stepIndex) return false;
  if (candidateStep.tool === failedStep.tool) return false;
  const candidateTask = taskStore.getTask(candidateStep.taskId);
  if (!candidateTask || candidateTask.status !== 'pending') return false;

  const failedTarget = failedTask.input?.targetId || failedTask.input?.shotId;
  const candidateTarget = candidateTask.input?.targetId || candidateTask.input?.shotId;
  if (failedTarget && candidateTarget) {
    return failedTarget === candidateTarget;
  }
  return true;
}

taskStore.onTaskEvent((event) => {
  if (!isTerminalStatus(event.status, event.taskId)) return;
  const task = taskStore.getTask(event.taskId);
  if (!task) return;
  const context = (task.input as any)?.__chatContext;
  if (!context?.sessionId || !context?.messageId) return;

  const session = AgentFactory.create(context.sessionId, {
    projectId: task.projectId,
    sessionId: context.sessionId,
  });
  const message = session.getMessages().find((item) => item.id === context.messageId);
  if (!message) return;

  // 多步 Plan 容器：跨工具依赖步骤前序失败时自动止损取消下游排队步，等全部子步骤终态后统一触发 1 次汇总复盘
  if (Array.isArray(message.planSteps) && message.planSteps.length > 0) {
    if (event.status === 'failed') {
      const live = taskStore.getLatestTask(task.taskId) || task;
      if (live.recovery !== 'restart' && live.status === 'failed') {
        const failedStep = message.planSteps.find((step) => step.taskId === task.taskId);
        if (failedStep) {
          for (const candidate of message.planSteps) {
            if (shouldCancelDownstreamStep(task, failedStep, candidate)) {
              taskDispatcher.cancel(candidate.taskId);
            }
          }
        }
      }
    }
    void ensurePlanSummary(task.projectId, context.sessionId, message.id);
    return;
  }

  // 单步任务：保持原有行为
  if (event.status === 'completed') {
    void ensureSingleTaskSummary(task);
    return;
  }
  if (message.taskId === task.taskId) {
    session.updateMessage(message.id, { metadata: { ...message.metadata, summaryStatus: 'skipped' } });
  }
});

export function recoverPendingSummaries(session: AgentRunner): void {
  for (const message of session.getMessages()) {
    const isPlan = Array.isArray(message.planSteps) && message.planSteps.length > 0;
    const isPendingOrRunning = ['pending', 'running'].includes(message.metadata?.summaryStatus);
    const isCompletedWithoutText = message.metadata?.summaryStatus === 'completed' && !message.postSummarySpeech;

    if (!isPendingOrRunning && !isCompletedWithoutText) continue;

    if (isPlan) {
      const hydrated = hydratePlanSteps(message.planSteps!);
      if (hydrated.every((step) => isTerminalStatus(step.status))) {
        if (isCompletedWithoutText) {
          session.updateMessage(message.id, {
            metadata: { ...message.metadata, summaryStatus: 'pending' },
          });
        }
        void ensurePlanSummary(session.projectId, session.sessionId, message.id);
      }
      continue;
    }
    if (!message.taskId) continue;
    const task = taskStore.getTask(message.taskId);
    if (task?.status === 'completed') {
      if (isCompletedWithoutText) {
        session.updateMessage(message.id, {
          metadata: { ...message.metadata, summaryStatus: 'pending' },
        });
      }
      void ensureSingleTaskSummary(task);
    }
  }
}
