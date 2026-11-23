/**
 * agents/runtime/task-health.ts
 * AI 导演全局任务健康感知中枢 (Task Health Snapshot SSOT)
 */

import { taskStore } from '../../task-engine/task-store.js';
import type { TaskRecord } from '../../task-engine/types.js';

export interface TaskHealthSnapshot {
  runningCount: number;
  failedCount: number;
  completedCount: number;
  activeTasks: Array<{
    taskId: string;
    toolName: string;
    targetName?: string;
    targetKind?: string;
    progressPercent?: number;
    startedAt?: number;
  }>;
  failedTasks: Array<{
    taskId: string;
    toolName: string;
    targetName?: string;
    targetKind?: string;
    failureType?: string;
    error: string;
    attemptCount: number;
    failedAt?: number;
  }>;
  promptSummary: string;
}

function extractTargetInfo(task: TaskRecord): { targetName?: string; targetKind?: string } {
  const input = task.input || {};
  const targetKind = input.targetKind || (input.characterId ? 'character' : input.locationId ? 'location' : input.itemId ? 'item' : undefined);
  const targetName = input.name || input.characterName || input.shotId || input.targetId;
  return { targetName, targetKind };
}

/**
 * 为指定项目与工序提取任务健康状态快照
 */
export function getTaskHealthSnapshot(projectId: string, filterToolPrefix?: string): TaskHealthSnapshot {
  const allTasks = taskStore.getTasksByProject(projectId);

  // 过滤目标工具范围（可选）
  const tasks = filterToolPrefix
    ? allTasks.filter((t) => t.toolName.startsWith(filterToolPrefix))
    : allTasks;

  const activeList: TaskRecord[] = [];
  const failedMap = new Map<string, TaskRecord>(); // 实体/工具维度去重，取最新
  let completedCount = 0;

  for (const t of tasks) {
    if (t.status === 'running' || t.status === 'pending') {
      activeList.push(t);
    } else if (t.status === 'completed') {
      completedCount++;
    } else if (t.status === 'failed') {
      // 若该失败任务已被后续成功的重试任务替代，则不计入当前待自愈失败项
      const latest = taskStore.getLatestTask(t.taskId);
      if (latest && latest.status === 'completed') {
        continue;
      }
      const { targetName } = extractTargetInfo(t);
      const dedupKey = targetName ? `${t.toolName}:${targetName}` : t.taskId;
      if (!failedMap.has(dedupKey)) {
        failedMap.set(dedupKey, t);
      }
    }
  }

  const failedList = Array.from(failedMap.values());

  const activeTasks = activeList.map((t) => {
    const { targetName, targetKind } = extractTargetInfo(t);
    return {
      taskId: t.taskId,
      toolName: t.toolName,
      targetName,
      targetKind,
      progressPercent: t.progress?.percent,
      startedAt: t.startedAt || t.createdAt,
    };
  });

  const failedTasks = failedList.map((t) => {
    const { targetName, targetKind } = extractTargetInfo(t);
    return {
      taskId: t.taskId,
      toolName: t.toolName,
      targetName,
      targetKind,
      failureType: t.failureType || 'system_fault',
      error: t.error || '未知错误',
      attemptCount: (t.retryCount || 0) + 1,
      failedAt: t.completedAt || t.createdAt,
    };
  });

  // 组装注入 LLM Prompt 的直观结构化自然语言摘要
  let promptSummary = '';
  if (failedTasks.length > 0) {
    promptSummary += `\n【🚨 关键告警：当前项目存在 ${failedTasks.length} 项失败任务，需重点关注或向创作者提议重试】：\n`;
    for (const f of failedTasks) {
      const targetDesc = f.targetName ? `[${f.targetKind || '目标'}: ${f.targetName}] ` : '';
      promptSummary += `- ❌ ${targetDesc}工具: ${f.toolName} | 失败类型: ${f.failureType} | 原因: ${f.error} | (任务ID: ${f.taskId})\n`;
    }
    promptSummary += `【导演行动指引】：当创作者询问“有哪些失败”、“为什么卡住”或“帮我重试”时，必须准确列出上述失败实体与原因，并通过 emit_director_intent 主动发起包含失败目标的重新执行/重试提案！\n`;
  } else if (activeTasks.length > 0) {
    promptSummary += `\n【⚙️ 当前正在运行中的任务 (${activeTasks.length}项)】：\n`;
    for (const a of activeTasks) {
      const targetDesc = a.targetName ? `[${a.targetKind || '目标'}: ${a.targetName}] ` : '';
      promptSummary += `- ⏳ ${targetDesc}工具: ${a.toolName} (进度: ${a.progressPercent ?? 0}%)\n`;
    }
  } else {
    promptSummary += `\n【✅ 任务流水运行健康：当前无失败或阻塞中的任务】\n`;
  }

  return {
    runningCount: activeTasks.length,
    failedCount: failedTasks.length,
    completedCount,
    activeTasks,
    failedTasks,
    promptSummary,
  };
}
