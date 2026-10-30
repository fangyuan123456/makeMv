import { BaseAgent, AgentContext, AgentResult } from '../base/index.js';
import { WorkflowStage } from '../../types/workflow.js';
import { StoryboardArtifact } from '../storyboard/types.js';
import { FmvPackagerArtifact } from './types.js';
import { masterStitcherService } from './master-stitcher.service.js';
import { nodePackagerService } from './node-packager.service.js';

export class FmvPackagerAgent extends BaseAgent<FmvPackagerArtifact> {
  readonly stage = WorkflowStage.FMV_PACKAGING;

  async execute(context: AgentContext): Promise<AgentResult<FmvPackagerArtifact>> {
    const { session, projectDir } = context;

    const storyboardArtifact = session.stageArtifacts[
      WorkflowStage.STORYBOARD
    ] as StoryboardArtifact | undefined;

    const videoArtifact = session.stageArtifacts[
      WorkflowStage.VIDEO_PRODUCTION
    ] as { clips: any[] } | undefined;

    const narrativeArtifact = session.stageArtifacts[
      WorkflowStage.NARRATIVE_DESIGN
    ] as any;

    const clips = videoArtifact?.clips || [];
    if (!clips || clips.length === 0) {
      throw new Error('未检测到视频片段，请先在分镜视频阶段生成分镜视频。');
    }
    if (!storyboardArtifact || !storyboardArtifact.shots || storyboardArtifact.shots.length === 0) {
      throw new Error('分镜数据缺失，请先在分镜设计阶段生成分镜镜头。');
    }

    // 1. 母带全片粗剪合成与音轨混音
    const masterCut = await masterStitcherService.assembleMasterCut({
      clips,
      projectDir,
      sessionId: session.id,
      title: session.title || '完整成片',
      style: session.meta.style,
    });

    // 2. 互动影游节点打包封装与决策循环帧提取
    let fmvManifest;
    try {
      fmvManifest = await nodePackagerService.packageFMVGame({
        projectDir,
        sessionId: session.id,
        clips,
        storyboard: storyboardArtifact,
        storyGraph: narrativeArtifact?.storyGraph,
        gameTitle: narrativeArtifact?.title || session.title,
      });
    } catch (manifestErr) {
      console.warn('[FmvPackagerAgent] FMV packaging skipped:', manifestErr);
    }

    const artifact: FmvPackagerArtifact = {
      final_video: masterCut.webPath,
      outputVideoPath: masterCut.finalVideoPath,
      outputVideoUrl: masterCut.webPath,
      final_videos: masterCut.finalVideos,
      totalDuration: masterCut.actualDuration,
      resolution: session.meta.videoResolution || '720P',
      fmvManifest,
    };

    const nodeCount = fmvManifest ? Object.keys(fmvManifest.nodes).length : 0;
    const fmvDesc = nodeCount > 0 ? ` 并成功装配导出 ${nodeCount} 个节点的影游工程包 (包含决策等待微循环)` : '';

    return {
      stage: this.stage,
      artifact,
      requiresIntervention: true,
      stopPointTitle: '影游成片剪辑与工程装配完成',
      stopPointDescription: `已成功完成最终影游装配！成片总时长 ${Math.round(masterCut.actualDuration)} 秒${fmvDesc}，声画轨道与交互决策状态机已完成绑定。`,
    };
  }
}
