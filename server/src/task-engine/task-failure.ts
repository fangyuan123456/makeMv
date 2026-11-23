/**
 * task-engine/task-failure.ts
 * 通用任务失败追踪底座 (Universal Failure Tracker SSOT)
 * 遵循极简与单一事实来源准则：新错误直接覆盖替换老错误，保持轻量与高信噪比
 */

import type { TaskFailureRecord, TaskRecord } from './types.js';

/**
 * 记录失败至任务实体（最新错误直接替换老错误）
 */
export function recordTaskFailure(
  task: TaskRecord,
  errorMessage: string,
  failureType?: string,
  details?: Record<string, any>
): void {
  const effectiveType = failureType || task.failureType || (task.input as any)?._expectedFailureType || 'general_error';
  const trimmedError = String(errorMessage || '未知异常').trim();
  const attempt = (task.retryCount || 0) + 1;

  task.failureType = effectiveType as any;
  task.error = trimmedError;
  task.lastFailure = {
    timestamp: Date.now(),
    type: effectiveType as any,
    error: trimmedError,
    attempt,
    ...(details ? { details } : {}),
  };
}

/**
 * 为 LLM 提取上一次失败的反思自愈上下文（直接提取最新失败记录）
 */
export function buildLLMReflectionPrompt(task: TaskRecord): string | null {
  const failure = task.lastFailure;
  const error = failure?.error || task.error;
  if (!error) return null;

  const type = failure?.type || task.failureType || 'general_error';
  const attempt = failure?.attempt || (task.retryCount || 0) + 1;

  return `\n\n【⚠️ 上一次执行失败警示（自愈反思指导）】：
本任务上一次执行未成功，源头系统报告原因如下：
- 失败类型: ${type}
- 报错信息: ${error}
- 尝试轮次: 第 ${attempt} 次
【核心指令】：请在本次推演与结构化输出中，深度自检并规避上述错误，务必严格遵循输出契约！`;
}
