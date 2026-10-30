/**
 * agent-runtime/contracts/AgentInput.ts
 * 全系统智能体基础输入规范契约 (BaseAgentInput SSOT)
 */

export interface BaseAgentInput {
  /** 所属项目工程唯一标识 (SSOT) */
  projectId: string;
  /** 创作者单步干预/打回重跑时的修改指示 */
  userFeedback?: string;
  /** 异步任务取消与 Token 熔断中止信号 */
  abortSignal?: AbortSignal;
  /** 扩展控制参数 */
  options?: Record<string, unknown>;
}
