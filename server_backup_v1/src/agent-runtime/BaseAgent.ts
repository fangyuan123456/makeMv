/**
 * agent-runtime/BaseAgent.ts
 * 统一轻量通用 Agent 抽象基类 (Uniform Agent Lifecycle SSOT)
 *
 * 核心机制：
 * 1. Base 原生持有 projectId，消除跨 Stage / Pipeline 的层层传递与污染；
 * 2. 具备通用切面执行包裹 execute()，自动度量耗时与捕获异常；
 * 3. 开放支持任意通用 AgentRole 角色注册与派发。
 */

import { randomUUID } from 'crypto';

export type AgentRole = string;

export interface AgentResult<T = unknown> {
  success: boolean;
  data: T;
  summary: string;
  durationMs?: number;
  error?: string;
}

export abstract class BaseAgent<TInput = any, TOutput = any> {
  readonly agentId: string;
  readonly role: AgentRole;
  /** 🌟 核心工程唯一标识：实例不可变，专职服务当前工程 (SSOT) */
  readonly projectId: string;

  constructor(role: AgentRole, projectId: string) {
    if (!projectId) {
      throw new Error(`[BaseAgent] 实例化智能体 [${role}] 必须指定有效 projectId`);
    }
    this.role = role;
    this.projectId = projectId;
    this.agentId = `${String(this.role).toLowerCase()}-${randomUUID().slice(0, 8)}`;
  }

  public getProjectId(): string {
    return this.projectId;
  }

  /**
   * 执行生命周期的前置切面钩子 (子类可按需重写)
   */
  protected async onBeforeRun?(input: TInput): Promise<void>;

  /**
   * 执行生命周期的后置切面钩子 (子类可按需重写)
   */
  protected async onAfterRun?(result: AgentResult<TOutput>): Promise<void>;

  /**
   * 执行异常处理切面钩子 (子类可按需重写)
   */
  protected async onError?(err: any, input: TInput): Promise<void>;

  /**
   * 所有 Agent 核心逻辑执行入口
   */
  abstract run(input: TInput): Promise<AgentResult<TOutput>>;

  /**
   * 统一受控切面执行入口（包含耗时度量与生命周期钩子）
   */
  public async execute(input: TInput): Promise<AgentResult<TOutput>> {
    const startMs = Date.now();
    try {
      if (typeof this.onBeforeRun === 'function') {
        await this.onBeforeRun(input);
      }

      const result = await this.run(input);

      if (typeof this.onAfterRun === 'function') {
        await this.onAfterRun(result);
      }

      if (result.durationMs === undefined) {
        result.durationMs = Date.now() - startMs;
      }
      return result;
    } catch (err: any) {
      if (typeof this.onError === 'function') {
        await this.onError(err, input);
      }
      return {
        success: false,
        data: undefined as unknown as TOutput,
        summary: `Agent [${this.role}] 执行异常: ${err.message || String(err)}`,
        durationMs: Date.now() - startMs,
        error: err.message || String(err),
      };
    }
  }

  /**
   * 构造标准化交付物
   */
  protected finishResult(
    success: boolean,
    summary: string,
    data: TOutput,
    startMs?: number,
  ): AgentResult<TOutput> {
    return {
      success,
      data,
      summary,
      durationMs: startMs ? Date.now() - startMs : undefined,
    };
  }
}
