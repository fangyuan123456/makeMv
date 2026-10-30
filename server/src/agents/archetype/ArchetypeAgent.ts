/**
 * agents/archetype/ArchetypeAgent.ts
 * 通用智能体标准实现底座 (BaseAgent + StagePipeline + ProjectStore SSOT)
 */

import {
  BaseAgent,
  StagePipeline,
  type AgentResult,
} from '../../agent-runtime/index.js';
import { ProjectStore } from '../../project-store/index.js';
import { WorkflowStage } from '../../contracts/index.js';
import { AnalysisStage } from './stages/AnalysisStage.js';
import { GenerationStage } from './stages/GenerationStage.js';
import type { ArchetypeInput, ArchetypeArtifact } from './types.js';

export class ArchetypeAgent extends BaseAgent<ArchetypeInput, ArchetypeArtifact> {
  private readonly analysisStage = new AnalysisStage();
  private readonly generationStage = new GenerationStage();

  constructor(projectId?: string) {
    super('NARRATIVE_DESIGNER', projectId);
  }

  /**
   * 🌟 纯自治执行入口 (Uniform Agent Lifecycle SSOT)
   * 1. Base 原生持有 this.projectId，免去在 Pipeline 各 Stage 间透传；
   * 2. StagePipeline 自动将 this.projectId 绑定至各个子 Stage；
   * 3. 业务数据流动纯净，只传递纯业务对象；
   * 4. 交付物存入 ProjectStore 单例黑板。
   */
  public async run(input: ArchetypeInput): Promise<AgentResult<ArchetypeArtifact>> {
    const startMs = Date.now();
    this.projectId = input.projectId || this.projectId;
    if (!this.projectId) throw new Error('[ArchetypeAgent] 执行缺少必须的 projectId');

    const store = ProjectStore.getInstance();

    // 1. 组装微观声明式流水线 (自动将 this.projectId 绑定注入至各 Stage)
    const pipeline = new StagePipeline('ArchetypePipeline', this.projectId)
      .addStage(this.analysisStage)
      .addStage(this.generationStage);

    // 2. 执行纯数据流流水线 (无需在入参和返回里层层塞入 projectId)
    const artifact: ArchetypeArtifact = await pipeline.run(input);

    // 3. 状态黑板持久化同步 (直接消费 this.projectId)
    store.setArtifact(this.projectId, WorkflowStage.NARRATIVE_DESIGN, artifact);

    return this.finishResult(
      true,
      `成功生成资产：《${artifact.title}》`,
      artifact,
      startMs
    );
  }
}
