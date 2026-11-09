/**
 * workflow-engine/confirmation-gate.ts
 * 人在回路确认门禁与裁决切面 (Confirmation Gate SSOT)
 *
 * 核心法则：
 * 1. 凡是标记为 requireConfirmation = true 的任务，初始状态为 proposed；
 * 2. 必须由创作者在外部调用 confirmTask，方可推进为 running 执行落地；
 * 3. 杜绝大模型在后台私自烧钱调度高昂物理算力。
 */

import { TaskStore } from './TaskStore.js';
import type { Task } from './types.js';

export class ConfirmationGate {
  /**
   * 确认并放行任务进入 running
   */
  public static confirmTask(projectId: string, taskId: string): Task {
    const store = TaskStore.getInstance();
    const task = store.getTask(projectId, taskId);
    if (!task) {
      throw new Error(`[ConfirmationGate] 待确认任务不存在: ${taskId}`);
    }

    if (task.status !== 'proposed') {
      throw new Error(`[ConfirmationGate] 任务当前状态不是 proposed (当前状态: ${task.status})，无法执行确认审批`);
    }

    console.log(`[ConfirmationGate] 创作者已审批放行任务: [${taskId}] ${task.title}`);
    return store.setStatus(projectId, taskId, 'running');
  }

  /**
   * 拒绝或取消任务
   */
  public static rejectTask(projectId: string, taskId: string, reason: string = '创作者取消'): Task {
    const store = TaskStore.getInstance();
    const task = store.getTask(projectId, taskId);
    if (!task) {
      throw new Error(`[ConfirmationGate] 待拒绝任务不存在: ${taskId}`);
    }

    console.log(`[ConfirmationGate] 创作者已拒绝任务: [${taskId}] 原因: ${reason}`);
    return store.setStatus(projectId, taskId, 'cancelled', { error: reason });
  }
}
