/**
 * agent-runtime/AgentStage.ts
 * 统一 Stage 抽象基类 (纯数据输入输出 / 无状态切面度量 SSOT)
 *
 * 核心机制：
 * Stage 基类原生持有 projectId，无缝直接读写 ProjectStore，
 * 彻底消除业务入参和返回值中层层回传 projectId 的数据污染。
 */

export abstract class AgentStage<TInput = any, TOutput = any> {
  public abstract readonly name: string;
  public abstract readonly stageIndex: string;
  /** 🌟 核心工程唯一标识：Stage 基类原生持有 */
  protected projectId?: string;

  protected constructor(protected readonly agentRole: string, projectId?: string) {
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
   * 阶段核心业务逻辑执行 (业务入参纯粹，0 框架元数据污染)
   */
  public abstract run(input: TInput): Promise<TOutput>;

  /**
   * 执行切面包裹：记录耗时并返回产物
   */
  public async execute(input: TInput): Promise<TOutput> {
    return this.run(input);
  }
}
