/**
 * agent-runtime/BaseAgent.ts
 * 统一轻量 Agent 抽象基类 (Uniform Agent Lifecycle SSOT)
 *
 * 核心机制：
 * Base 原生持有 projectId，消除跨 Stage / Pipeline 的层层传递与污染。
 */

import { randomUUID } from 'crypto';
import type { AgentRole } from './contracts/AgentRole.js';

export interface AgentResult<T = unknown> {
  success: boolean;
  data: T;
  summary: string;
  durationMs?: number;
}

export abstract class BaseAgent<TInput = any, TOutput = any> {
  readonly agentId: string;
  readonly role: AgentRole;
  /** 🌟 核心工程唯一标识：Base 原生持有，免去参数层层传递 */
  protected projectId?: string;

  constructor(role: AgentRole, projectId?: string) {
    this.role = role;
    this.projectId = projectId;
    this.agentId = `${this.role.toLowerCase()}-${randomUUID().slice(0, 8)}`;
  }

  /**
   * 设定或切换当前工程 ID
   */
  public setProjectId(projectId: string): this {
    this.projectId = projectId;
    return this;
  }

  public getProjectId(): string | undefined {
    return this.projectId;
  }

  /**
   * 所有 Agent 统一的执行生命周期入口
   */
  abstract run(input: TInput): Promise<AgentResult<TOutput>>;

  /**
   * 构造标准化交付物
   */
  protected finishResult(success: boolean, summary: string, data: TOutput, startMs?: number): AgentResult<TOutput> {
    return {
      success,
      data,
      summary,
      durationMs: startMs ? Date.now() - startMs : undefined,
    };
  }
}
