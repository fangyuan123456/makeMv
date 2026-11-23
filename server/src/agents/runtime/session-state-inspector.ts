/**
 * agents/runtime/session-state-inspector.ts
 * 会话挂起提案与物理任务态势巡检深模块 (Deep Module)
 *
 * 核心架构职责：
 * 1. 扫描当前会话挂起的待审提案快照；
 * 2. 关联 TaskStore 态势黑板，捕获当前会话活跃中与最近失败的任务根因；
 * 3. 组装为统一的提示词引导区块，为专职 Agent 决策提供即时事实支撑。
 */

import { TaskStore } from '../../task-engine/task-store.js';
import type { ConversationMessage } from './types.js';

export interface InspectSessionStateOptions {
  projectId: string;
  sessionId: string;
  messages: ConversationMessage[];
}

/**
 * 统一巡检当前会话提案与关联任务态势
 */
export function inspectSessionState(options: InspectSessionStateOptions): string {
  const { projectId, sessionId, messages } = options;

  const lastPending = [...messages].reverse().find((m) => m.proposal && !m.proposalResolved);
  const pendingProposal = lastPending?.proposal as any;
  const pendingLine = pendingProposal
    ? (() => {
        const title = pendingProposal.title || pendingProposal.tool || '待审方案';
        const summaryObj =
          Array.isArray(pendingProposal.operations) && pendingProposal.operations.length > 0
            ? {
                operations: pendingProposal.operations.map((op: any) => ({
                  tool: op.tool,
                  title: op.title,
                  params: op.params,
                })),
              }
            : { tool: pendingProposal.tool, params: pendingProposal.params };
        const serialized = JSON.stringify(summaryObj);
        const snippet = serialized.length > 500 ? `${serialized.slice(0, 500)}...` : serialized;
        return `挂起待审【${title}】（创作者若发“同意/确认/开跑/好的”等纯肯定口令，必须且唯一调用 action: "approve" 授权开跑，严禁重复出卡） | 参数快照: ${snippet}`;
      })()
    : '无';

  const sessionTasks = TaskStore.getInstance()
    .getTasksByProject(projectId)
    .filter((task) => (task.input as any)?.__chatContext?.sessionId === sessionId);
  const activeTask = sessionTasks.find((t) => t.status === 'running' || t.status === 'pending');
  const failedTask = sessionTasks.find((t) => t.status === 'failed');

  const activeLine = activeTask
    ? `运行中 [${activeTask.toolName}] (进度: ${activeTask.progress?.percent || 0}%)`
    : '无';
  const failedLine = failedTask
    ? (() => {
        const { __chatContext: _c, __idempotencyKey: _k, ...cleanInput } = (failedTask.input || {}) as any;
        const serialized = JSON.stringify(cleanInput);
        const snippet = serialized.length > 300 ? `${serialized.slice(0, 300)}...` : serialized;
        return `失败 [${failedTask.toolName}] (错误: "${failedTask.error || '未知'}" | 入参: ${snippet})`;
      })()
    : '无';

  return `### 【当前会话提案与任务状态】
- 待审提案：${pendingLine}
- 活跃任务：${activeLine}
- 最近失败任务：${failedLine}`;
}
