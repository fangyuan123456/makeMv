import { BaseAgent, AgentContext, AgentResult } from '../base/index.js';
import { WorkflowStage } from '../../types/workflow.js';
import { StoryboardArtifact } from '../storyboard/types.js';
import { VideoProductionArtifact, VideoProductionClip } from './types.js';
import { clipStitcherService } from './clip-stitcher.service.js';
import { asyncPool } from '../../utils/concurrency.js';

export class VideoProductionAgent extends BaseAgent<VideoProductionArtifact> {
  readonly stage = WorkflowStage.VIDEO_PRODUCTION;

  async execute(context: AgentContext): Promise<AgentResult<VideoProductionArtifact>> {
    const { session, projectDir, userFeedback } = context;

    let parsedFeedback: any = null;
    if (userFeedback) {
      try {
        parsedFeedback = typeof userFeedback === 'string' ? JSON.parse(userFeedback) : userFeedback;
      } catch {
        parsedFeedback = { instruction: userFeedback };
      }
    }

    const storyboardArtifact = session.stageArtifacts[
      WorkflowStage.STORYBOARD
    ] as StoryboardArtifact | undefined;

    if (!storyboardArtifact || !storyboardArtifact.shots || storyboardArtifact.shots.length === 0) {
      throw new Error('分镜数据缺失，请先在分镜设计阶段生成分镜镜头。');
    }

    const existingArtifact = session.stageArtifacts[
      WorkflowStage.VIDEO_PRODUCTION
    ] as VideoProductionArtifact | undefined;

    const targetShotId = parsedFeedback?.shotId || parsedFeedback?.shot_id;
    const shotsToProcess = targetShotId
      ? storyboardArtifact.shots.filter((s) => s.shotId === targetShotId)
      : storyboardArtifact.shots;

    const clips: VideoProductionClip[] = existingArtifact?.clips ? [...existingArtifact.clips] : [];

    const concurrency = session.meta.concurrencyLimit || 2;
    console.log(`[VideoProduction] Generating ${shotsToProcess.length} video clips with concurrency=${concurrency}...`);

    const renderedClips = await asyncPool(concurrency, shotsToProcess, async (shot, i) => {
      const prevClip = i > 0 ? clips[i - 1] : undefined;
      return await clipStitcherService.renderAndMuxShot({
        shot,
        prevClip,
        projectDir,
        sessionId: session.id,
        style: session.meta.style,
        videoRatio: session.meta.videoRatio || '16:9',
        videoResolution: session.meta.videoResolution || '720P',
      });
    });

    for (const clipData of renderedClips) {
      const existingClipIndex = clips.findIndex((c) => c.shotId === clipData.shotId);
      if (existingClipIndex >= 0) {
        clips[existingClipIndex] = clipData;
      } else {
        clips.push(clipData);
      }
    }

    const artifact: VideoProductionArtifact = {
      clips,
      totalClips: clips.length,
    };

    return {
      stage: this.stage,
      artifact,
      requiresIntervention: true,
      stopPointTitle: '分镜头视频生成就绪',
      stopPointDescription: `已成功生成 ${clips.length} 个分镜头动态视频片段。请预览分镜动态效果，确认后将进入影游装配与导出。`,
    };
  }
}
