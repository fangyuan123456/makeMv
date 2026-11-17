import path from 'node:path';
import { getProjectDir } from '../project-store/artifact-fs.js';
import { atomicWriteJsonSync, safeReadJsonSync } from '../utils/atomicFile.js';
import { taskStore } from '../task-engine/task-store.js';

export interface ChatTaskContext {
  sessionId: string;
  messageId: string;
}

/** 将任务账本事件投影到聊天消息，聊天文件不再由各个执行分支分别维护。 */
export function projectTaskEventToChat(event: {
  taskId: string;
  projectId: string;
  status: string;
  input?: any;
  progress?: any;
  error?: string;
  durationMs?: number;
}): void {
  const context = event.input?.__chatContext as ChatTaskContext | undefined;
  if (!context) return;

  syncTaskCompletionToChat(event.projectId, context, {
    taskStatus: event.status,
    ...(event.progress ? { taskProgress: event.progress } : {}),
    ...(event.durationMs !== undefined ? { taskDurationMs: event.durationMs } : {}),
    ...(event.error ? { taskError: event.error } : {}),
  }, event.taskId);
}

let projectionRegistered = false;
if (!projectionRegistered) {
  projectionRegistered = true;
  taskStore.onTaskEvent(projectTaskEventToChat);
}

export function syncTaskCompletionToChat(
  projectId: string,
  context: ChatTaskContext | undefined,
  patch: Record<string, any>,
  expectedTaskId?: string
): void {
  if (!context?.sessionId || !context.messageId) return;
  const filePath = path.join(getProjectDir(projectId), 'chat', `${context.sessionId}.json`);
  const messages = safeReadJsonSync<any[]>(filePath);
  if (!Array.isArray(messages)) return;
  const target = messages.find((message) => message.id === context.messageId);
  if (!target) return;
  if (expectedTaskId && target.taskId !== expectedTaskId) return;
  Object.assign(target, patch);
  atomicWriteJsonSync(filePath, messages);
}
