/**
 * agent-runtime/AgentDispatcher.ts
 * 统一 Agent 调度处理中心 (Agent Dispatcher SSOT)
 *
 * 核心设计：
 * 1. 负责 Agent 的统一解耦调度与生命周期管理；
 * 2. 避免调用方直接耦合 `new XxxAgent()`，为未来平滑迁移至分布式、RPC 与 Worker 提供唯一收口；
 * 3. 遵从瞬态隔离原则：每次派发生成独立的 Agent 实例并绑定 projectId，彻底杜绝多智能体并发竞态；
 * 4. 原生支持 dispatchParallel，提供工业级受控并发协同调度。
 */

import type { AgentRole } from './contracts/AgentRole.js';
import type {
  IAgentDispatcher,
  DispatchOptions,
  DispatchRequest,
  ParallelDispatchOptions,
} from './contracts/IAgentDispatcher.js';
import type { BaseAgent, AgentResult } from './BaseAgent.js';
import { asyncPool } from '../utils/concurrency.js';

export type AgentFactory = () => BaseAgent;

export class LocalAgentDispatcher implements IAgentDispatcher {
  private readonly factories = new Map<AgentRole, AgentFactory>();

  constructor() {}

  /**
   * 注册指定角色的 Agent 构造工厂
   */
  public register(role: AgentRole, factory: AgentFactory): this {
    this.factories.set(role, factory);
    return this;
  }

  /**
   * 检查指定角色是否已注册工厂
   */
  public has(role: AgentRole): boolean {
    return this.factories.has(role);
  }

  /**
   * 统一派发单个 Agent 任务 (瞬态安全隔离)
   */
  public async dispatch<TInput = unknown, TOutput = unknown>(
    role: AgentRole,
    input?: TInput,
    options?: DispatchOptions,
    projectId?: string,
  ): Promise<AgentResult<TOutput>> {
    const factory = this.factories.get(role);
    if (!factory) {
      throw new Error(`[AgentDispatcher] 未注册角色 "${role}" 的 Agent 处理工厂`);
    }

    // 瞬态生成独立 Agent 实例，杜绝并发状态污染
    const agent = factory();

    // 原生注入 projectId (SSOT)
    if (projectId && typeof agent.setProjectId === 'function') {
      agent.setProjectId(projectId);
    }

    return (await agent.run(input)) as AgentResult<TOutput>;
  }

  /**
   * 批量并发派发多个 Agent 协同任务 (Multi-Agent 并发中枢)
   */
  public async dispatchParallel<TInput = unknown, TOutput = unknown>(
    requests: DispatchRequest<TInput>[],
    options?: ParallelDispatchOptions,
  ): Promise<AgentResult<TOutput>[]> {
    if (!requests || requests.length === 0) return [];

    const concurrency = options?.concurrency;

    if (concurrency && concurrency > 0) {
      return asyncPool(
        concurrency,
        requests,
        async (req) => this.dispatch<TInput, TOutput>(req.role, req.input, req.options, req.projectId),
      );
    }

    return Promise.all(
      requests.map((req) => this.dispatch<TInput, TOutput>(req.role, req.input, req.options, req.projectId)),
    );
  }
}
