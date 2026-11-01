/**
 * agent-runtime/BaseStep.ts
 * 统一微观工步抽象基类 (Uniform Pipeline Step Lifecycle SSOT)
 *
 * 核心机制：
 * 1. BaseStep 原生持有 projectId，无缝直接读写 ProjectStore；
 * 2. 纯数据输入输出 (Data In ➔ Data Out)，0 框架冗余元数据污染；
 * 3. 内置受控切面执行入口 execute()，自动响应中断信号与统一度量；
 * 4. 作为流水线内部单一职责的原子工步执行单元。
 */

import { JobAbortRegistry } from './bus/index.js';

export abstract class BaseStep<TInput = any, TOutput = any> {
  public abstract readonly name: string;
  public abstract readonly stepIndex: string;
  /** 🌟 核心工程唯一标识：Step 基类原生持有 */
  protected projectId?: string;

  protected constructor(protected readonly role?: string, projectId?: string) {
    this.projectId = projectId;
  }

  public setProjectId(projectId: string): this {
    this.projectId = projectId;
    return this;
  }

  public getProjectId(): string | undefined {
    return this.projectId;
  }

  /**
   * 工步核心业务逻辑执行 (业务入参纯粹，0 框架元数据污染)
   */
  public abstract run(input: TInput): Promise<TOutput>;

  /**
   * 执行切面包裹：统一响应 Abort 中断信号并度量耗时
   */
  public async execute(input: TInput): Promise<TOutput> {
    const activePid = this.projectId || (input && typeof input === 'object' ? (input as any).projectId : undefined);
    if (activePid && JobAbortRegistry.get(activePid)?.signal.aborted) {
      throw new Error(`[${this.name}] 步骤已被外部中断信号取消`);
    }

    const customAbort = input && typeof input === 'object' ? (input as any).abortSignal : undefined;
    if (customAbort?.aborted) {
      throw new Error(`[${this.name}] 步骤已被外部中断信号取消`);
    }

    return this.run(input);
  }
}
