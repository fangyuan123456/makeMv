/**
 * pipelines/video/VideoProductionPipeline.ts
 * 互动影游各分支节点动态视频渲染切片流水线 (Video Production Pipeline SSOT)
 */

import { StagePipeline } from '../../agent-runtime/index.js';
import { ProjectStore } from '../../project-store/index.js';
import { WorkflowStage } from '../../types/index.js';
import { MotionPromptEnhancementStep } from './steps/motion-prompt-enhancement/MotionPromptEnhancementStep.js';
import { VideoBatchRenderStep } from './steps/video-batch-render/VideoBatchRenderStep.js';
import type { VideoProductionArtifact } from './types.js';
import type { PipelineResult } from '../narrative/NarrativePipeline.js';

export interface VideoProductionInput {
  projectId?: string;
  userFeedback?: any;
  abortSignal?: AbortSignal;
}

export class VideoProductionPipeline extends StagePipeline {
  private readonly promptStep = new MotionPromptEnhancementStep();
  private readonly renderStep = new VideoBatchRenderStep();

  constructor(projectId?: string) {
    super('VideoProductionPipeline', projectId);
    this.addContextStep('MotionPromptEnhancementStep', 'motionPromptMap', async (ctx) => {
      return this.promptStep.execute({
        shots: ctx.shots,
        style: ctx.style,
        userFeedback: ctx.userFeedback,
        abortSignal: ctx.abortSignal,
      });
    });
    this.addContextStep('VideoBatchRenderStep', 'artifact', async (ctx) => {
      return this.renderStep.execute({
        projectId: ctx.projectId,
        shots: ctx.shots,
        motionPromptMap: ctx.motionPromptMap,
        abortSignal: ctx.abortSignal,
      });
    });
  }

  public async execute(
    input: VideoProductionInput
  ): Promise<PipelineResult<VideoProductionArtifact>> {
    const startMs = Date.now();
    const activeProjectId = input.projectId || this.projectId;
    if (!activeProjectId) {
      throw new Error('[VideoProductionPipeline] 执行缺少必须的 projectId');
    }
    this.setProjectId(activeProjectId);

    const store = ProjectStore.getInstance();
    const storyboardArtifact = store.getArtifact<any>(activeProjectId, WorkflowStage.STORYBOARD);
    if (!storyboardArtifact || !storyboardArtifact.shots) {
      throw new Error('[VideoProductionPipeline] 缺少前序分镜数据 (Storyboard Artifact)，请先执行 STORYBOARD 阶段');
    }

    const session = store.getProject(activeProjectId);
    const style = session?.meta?.style || '电影质感';

    const ctx = await this.run({
      ...input,
      projectId: activeProjectId,
      shots: storyboardArtifact.shots,
      style,
      userFeedback: typeof input.userFeedback === 'string' ? input.userFeedback : undefined,
    });

    const artifact: VideoProductionArtifact = ctx.artifact;
    store.setArtifact(activeProjectId, WorkflowStage.VIDEO_PRODUCTION, artifact);

    const updatedStoryboard = store.getArtifact<any>(activeProjectId, WorkflowStage.STORYBOARD);
    if (updatedStoryboard && updatedStoryboard.shots) {
      for (const shot of updatedStoryboard.shots) {
        const clip = artifact.clips.find((c) => c.shotId === shot.shotId);
        if (clip) {
          shot.videoClipUrl = clip.videoUrl;
        }
      }
      store.setArtifact(activeProjectId, WorkflowStage.STORYBOARD, updatedStoryboard);
    }

    return {
      success: true,
      data: artifact,
      summary: `视频渲染完成：共生成 ${artifact.clips.length} 个分镜头视频片段，已落地本地离线永久存储`,
      durationMs: Date.now() - startMs,
    };
  }
}
