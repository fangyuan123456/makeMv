/**
 * pipelines/reference/ReferencePipeline.ts
 * 互动影游分镜首帧关键帧参考图生成流水线 (Reference Pipeline SSOT)
 */

import { StagePipeline } from '../../agent-runtime/index.js';
import { ProjectStore } from '../../project-store/index.js';
import { WorkflowStage } from '../../types/index.js';
import { PromptEnhancementStep } from './steps/prompt-enhancement/PromptEnhancementStep.js';
import { ImageBatchRenderStep } from './steps/image-batch-render/ImageBatchRenderStep.js';
import type { ReferenceGenerationArtifact } from './types.js';
import type { PipelineResult } from '../narrative/NarrativePipeline.js';

export interface ReferenceInput {
  projectId?: string;
  userFeedback?: any;
  abortSignal?: AbortSignal;
}

export class ReferencePipeline extends StagePipeline {
  private readonly promptEnhancementStep = new PromptEnhancementStep();
  private readonly imageBatchRenderStep = new ImageBatchRenderStep();

  constructor(projectId?: string) {
    super('ReferenceGeneratorPipeline', projectId);
    this.addContextStep('PromptEnhancementStep', 'promptMap', async (ctx) => {
      return this.promptEnhancementStep.execute({
        shots: ctx.shots,
        characters: ctx.characters,
        style: ctx.style,
        userFeedback: ctx.userFeedback,
        abortSignal: ctx.abortSignal,
      });
    });
    this.addContextStep('ImageBatchRenderStep', 'artifact', async (ctx) => {
      return this.imageBatchRenderStep.execute({
        projectId: ctx.projectId,
        shots: ctx.shots,
        promptMap: ctx.promptMap,
        abortSignal: ctx.abortSignal,
      });
    });
  }

  public async execute(input: ReferenceInput): Promise<PipelineResult<ReferenceGenerationArtifact>> {
    const startMs = Date.now();
    const activeProjectId = input.projectId || this.projectId;
    if (!activeProjectId) {
      throw new Error('[ReferencePipeline] 执行缺少必须的 projectId');
    }
    this.setProjectId(activeProjectId);

    const store = ProjectStore.getInstance();
    const storyboardArtifact = store.getArtifact<any>(
      activeProjectId,
      WorkflowStage.STORYBOARD
    );

    if (!storyboardArtifact || !storyboardArtifact.shots) {
      throw new Error(
        '[ReferencePipeline] 缺少前序分镜数据 (Storyboard Artifact)，请先执行 STORYBOARD 阶段'
      );
    }

    const charArtifact = store.getArtifact<any>(activeProjectId, WorkflowStage.CHARACTER_DESIGN) || {};
    const characters = (charArtifact.characters || []).map((c: any) => ({
      name: c.name,
      role: c.role,
      appearancePrompt: c.visualAnchor?.appearancePrompt || c.appearance || '',
      clothingPrompt: c.visualAnchor?.clothingPrompt || '',
    }));
    const session = store.getProject(activeProjectId);
    const style = session?.meta?.style || '电影质感';

    const ctx = await this.run({
      ...input,
      projectId: activeProjectId,
      shots: storyboardArtifact.shots,
      characters,
      style,
      userFeedback: typeof input.userFeedback === 'string' ? input.userFeedback : undefined,
    });

    const artifact: ReferenceGenerationArtifact = ctx.artifact;

    store.setArtifact(activeProjectId, WorkflowStage.KEYFRAME_REFERENCE, artifact);
    store.setArtifact(activeProjectId, WorkflowStage.STORYBOARD, storyboardArtifact);

    return {
      success: true,
      data: artifact,
      summary: `关键帧生图完成：共渲染 ${artifact.shots.length} 个分镜首帧参考图，已落地本地离线永久存储`,
      durationMs: Date.now() - startMs,
    };
  }
}
