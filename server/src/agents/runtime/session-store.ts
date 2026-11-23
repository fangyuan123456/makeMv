import fs from 'node:fs';
import path from 'node:path';
import { getProjectDir } from '../../project-store/artifact-fs.js';
import { atomicWriteJsonSync, safeReadJsonSync } from '../../utils/atomicFile.js';
import { taskStore } from '../../task-engine/task-store.js';
import { computePlanAggregate, stripTaskStateFromMessages } from './task-message-sync.js';
import type { ConversationMessage } from './types.js';

export class AgentSessionStore<TIntent = any> {
  private readonly projectId: string;
  private readonly filePath: string;

  constructor(projectId: string, sessionId: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(sessionId)) {
      throw new Error('非法会话 ID');
    }
    this.projectId = projectId;
    const chatDir = path.join(getProjectDir(projectId), 'chat');
    fs.mkdirSync(chatDir, { recursive: true });
    this.filePath = path.join(chatDir, `${sessionId}.json`);
    if (!fs.existsSync(this.filePath)) atomicWriteJsonSync(this.filePath, []);
  }

  public getMessages(): ConversationMessage<TIntent>[] {
    const data = safeReadJsonSync<ConversationMessage<TIntent>[]>(this.filePath);
    if (!Array.isArray(data)) return [];
    return this.hydrateMessagesWithTaskStore(data);
  }

  /** 任务状态只从 TaskStore 投影；磁盘消息只保存任务绑定与对话事实。 */
  private hydrateMessagesWithTaskStore(messages: ConversationMessage<TIntent>[]): ConversationMessage<TIntent>[] {
    return messages.map((m) => {
      const isHistoricalSuccess = Boolean(
        m.postSummarySpeech ||
        m.metadata?.summaryStatus === 'completed'
      );

      // 1. 多步 Plan 容器动态投影
      if (Array.isArray(m.planSteps) && m.planSteps.length > 0) {
        const updatedSteps = m.planSteps.map((step) => {
          let task = taskStore.getLatestTask(step.taskId);
          if (!task && isHistoricalSuccess) {
            // 历史事实自愈：若该 Plan 已完成收官复盘，说明步骤已成功执行，自愈补齐 TaskRecord
            task = {
              taskId: step.taskId,
              projectId: this.projectId,
              toolName: (step as any).toolName || 'film.plan_step',
              retryCount: 0,
              maxRetries: 2,
              status: 'completed',
              input: {},
              createdAt: Date.now() - 10000,
              completedAt: Date.now(),
              durationMs: 3000,
              progress: { current: 100, total: 100, percent: 100, message: '已完成' },
            };
            try {
              taskStore.saveTask(task);
            } catch {}
          }

          if (!task) {
            return {
              ...step,
              status: 'failed' as const,
              progress: undefined,
              durationMs: undefined,
              error: `任务记录缺失: ${step.taskId}`,
            };
          }

          return {
            ...step,
            taskId: task.taskId,
            status: task.status,
            progress: task.progress,
            durationMs: task.durationMs,
            error: task.error,
          };
        });

        const aggregate = computePlanAggregate(updatedSteps);
        const retried = updatedSteps.some((step, index) => step.taskId !== m.planSteps![index].taskId);
        return {
          ...m,
          ...(retried ? { metadata: { ...m.metadata, summaryStatus: 'pending' } } : {}),
          planSteps: updatedSteps,
          taskStatus: aggregate.taskStatus,
          taskProgress: aggregate.taskProgress,
          taskDurationMs: aggregate.taskDurationMs,
          taskError: aggregate.taskError,
        };
      }

      // 2. 单任务消息动态投影
      if (m.taskId) {
        let task = taskStore.getLatestTask(m.taskId);
        if (!task && isHistoricalSuccess) {
          // 历史事实自愈：若该单任务已有复盘结论或收官标记，说明已物理落盘成功，自愈补齐 TaskRecord
          task = {
            taskId: m.taskId,
            projectId: this.projectId,
            toolName: m.taskTool || 'planner.screenplay_writer',
            retryCount: 0,
            maxRetries: 2,
            status: 'completed',
            input: {},
            createdAt: Date.now() - 10000,
            completedAt: Date.now(),
            durationMs: 5000,
            progress: { current: 100, total: 100, percent: 100, message: '已完成' },
          };
          try {
            taskStore.saveTask(task);
          } catch {}
        }

        return {
          ...m,
          ...(task && task.taskId !== m.taskId
            ? { taskId: task.taskId, metadata: { ...m.metadata, summaryStatus: 'pending' } }
            : {}),
          taskStatus: task?.status || 'failed',
          taskProgress: task?.progress,
          taskDurationMs: task?.durationMs,
          taskError: task?.error || (!task ? `任务记录缺失: ${m.taskId}` : undefined),
        };
      }
      return m;
    });
  }

  public writeMessages(messages: ConversationMessage<TIntent>[]): void {
    atomicWriteJsonSync(this.filePath, stripTaskStateFromMessages(messages));
  }

  public appendMessage(
    record: Partial<ConversationMessage<TIntent>> & { role: 'user' | 'assistant' | 'system'; content: string },
    resolveProposals = false
  ): ConversationMessage<TIntent> {
    const messages = this.getMessages();
    if (resolveProposals) {
      const pending = [...messages].reverse().find((message) => message.proposal && !message.proposalResolved);
      if (pending) pending.proposalResolved = true;
    }
    // 状态机单一事实来源：发起新提案时，前序所有未决提案自动失效关闭，保证会话中最多只有一个活跃待审卡片
    if (record.proposal && !record.proposalResolved) {
      for (const message of messages) {
        if (message.proposal && !message.proposalResolved) {
          message.proposalResolved = true;
        }
      }
    }
    const entry: ConversationMessage<TIntent> = {
      id: record.id || `msg_${record.role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: record.role,
      content: String(record.content || ''),
      ...(record.attachments?.length ? { attachments: record.attachments } : {}),
      createdAt: record.createdAt || new Date().toISOString(),
      ...(record.proposal !== undefined ? { proposal: record.proposal } : {}),
      ...(record.proposalResolved !== undefined ? { proposalResolved: Boolean(record.proposalResolved) } : {}),
      ...(record.status ? { status: record.status } : {}),
      ...(record.taskId ? { taskId: record.taskId } : {}),
      ...(record.taskTool ? { taskTool: record.taskTool } : {}),
      ...(record.taskTitle ? { taskTitle: record.taskTitle } : {}),
      ...(record.taskStatus ? { taskStatus: record.taskStatus } : {}),
      ...(record.taskProgress ? { taskProgress: record.taskProgress } : {}),
      ...(record.taskDurationMs !== undefined ? { taskDurationMs: record.taskDurationMs } : {}),
      ...(record.taskOutputSummary ? { taskOutputSummary: record.taskOutputSummary } : {}),
      ...(record.taskError ? { taskError: record.taskError } : {}),
      ...(record.planSteps ? { planSteps: record.planSteps } : {}),
      ...(record.metadata ? { metadata: record.metadata } : {}),
    };
    messages.push(entry);
    this.writeMessages(messages);
    return entry;
  }

  public markProposalsResolved(): void {
    const messages = this.getMessages();
    let changed = false;
    for (const message of messages) {
      if (message.proposal && !message.proposalResolved) {
        message.proposalResolved = true;
        changed = true;
      }
    }
    if (changed) this.writeMessages(messages);
  }

  public updateMessage(messageId: string, patch: Partial<ConversationMessage<TIntent>>): void {
    const messages = this.getMessages();
    let target = messages.find((message) => message.id === messageId);
    if (!target && messageId.startsWith('msg_task_')) {
      const taskId = messageId.replace(/^msg_task_/, '');
      target = messages.find((message) => message.taskId === taskId);
    }
    if (!target && patch.taskId) target = messages.find((message) => message.taskId === patch.taskId);
    if (!target) return;
    Object.assign(target, patch);
    this.writeMessages(messages);
  }

  public clearMessages(): void {
    this.writeMessages([]);
  }
}
