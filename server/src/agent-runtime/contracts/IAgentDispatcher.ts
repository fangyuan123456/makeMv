/**
 * agent-runtime/contracts/IAgentDispatcher.ts
 * 统一 Agent 调度处理中心抽象契约 (SSOT)
 *
 * 彻底解耦调用端与 Agent 的物理部署形式。
 * 支撑单机同进程执行、多智能体并发协同与未来分布式/微服务无缝平滑切换。
 */

import type { AgentRole } from './AgentRole.js';
import type { AgentResult } from '../BaseAgent.js';

export interface DispatchOptions {
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface DispatchRequest<TInput = unknown> {
  role: AgentRole;
  input?: TInput;
  projectId?: string;
  options?: DispatchOptions;
}

export interface ParallelDispatchOptions {
  concurrency?: number; // 最大并发路数限制，默认无限制
}

export interface IAgentDispatcher {
  /**
   * 统一派发单个 Agent 任务
   * @param role 目标 Agent 角色
   * @param input 强类型任务入参
   * @param options 派发配置参数
   * @param projectId 关联项目 ID (SSOT)
   */
  dispatch<TInput = unknown, TOutput = unknown>(
    role: AgentRole,
    input?: TInput,
    options?: DispatchOptions,
    projectId?: string,
  ): Promise<AgentResult<TOutput>>;

  /**
   * 批量并发派发多个 Agent 任务 (Multi-Agent Concurrency)
   * @param requests 批量派发请求数组
   * @param options 并发控制选项
   */
  dispatchParallel<TInput = unknown, TOutput = unknown>(
    requests: DispatchRequest<TInput>[],
    options?: ParallelDispatchOptions,
  ): Promise<AgentResult<TOutput>[]>;
}
