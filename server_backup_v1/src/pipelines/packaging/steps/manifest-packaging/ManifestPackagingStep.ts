import fs from 'fs';
import path from 'path';
import { BaseStep } from '../../../../agent-runtime/index.js';
import { ProjectStore } from '../../../../project-store/index.js';
import type {
  FMVManifest,
  FMVNodeAsset,
  FmvPackagerArtifact,
  ManifestPackagingInput,
} from '../../types.js';

export class ManifestPackagingStep extends BaseStep<ManifestPackagingInput, FmvPackagerArtifact> {
  public readonly name = 'manifest-packaging';
  public readonly stepIndex = 'manifest_packaging';

  constructor(projectId?: string) {
    super('FMV_PACKAGER', projectId);
  }

  public async run(input: ManifestPackagingInput): Promise<FmvPackagerArtifact> {
    const projectId = input.projectId || this.projectId;
    if (!projectId) {
      throw new Error('[ManifestPackagingStep] 运行缺少必须的 projectId');
    }
    const store = ProjectStore.getInstance();
    const projectDir = store.getProjectDir(projectId);

    const shots = input.shots || [];
    const masterCut = input.masterCut;
    const sceneChoicesMap = input.sceneChoicesMap || new Map();

    const nodes: Record<string, FMVNodeAsset> = {};

    let startNodeId = 'scene_001';
    let totalDurationSec = 0;

    shots.forEach((shot: any, idx: number) => {
      const nodeId = shot.unitId || shot.sceneId || `node_${idx + 1}`;
      if (idx === 0) startNodeId = nodeId;

      const dur = shot.duration || 4;
      totalDurationSec += dur;

      const choices = sceneChoicesMap.get(shot.sceneId) || [];
      const isDecisionPoint = choices.length > 0;

      nodes[nodeId] = {
        nodeId,
        title: shot.visualContent?.slice(0, 30) || `节点 ${nodeId}`,
        videoUrl: shot.videoClipUrl || `/media/${projectId}/videos/clip_${shot.shotId}.mp4`,
        localPath: path.join(projectDir, 'videos', `clip_${shot.shotId}.mp4`),
        durationSec: dur,
        decisionTimeSec: isDecisionPoint ? Math.max(dur - 1, 0) : undefined,
        holdImageUrl: shot.firstFrameImageUrl,
        isDecisionPoint,
        choices,
      };
    });

    const fmvManifest: FMVManifest = {
      gameTitle: input.gameTitle || '互动影游',
      startNodeId,
      totalDurationSec,
      nodes,
    };

    try {
      const exportDir = path.join(projectDir, 'export');
      fs.mkdirSync(exportDir, { recursive: true });
      fs.writeFileSync(path.join(exportDir, 'manifest.json'), JSON.stringify(fmvManifest, null, 2), 'utf-8');
      fs.writeFileSync(path.join(projectDir, 'manifest.json'), JSON.stringify(fmvManifest, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[ManifestPackagingStep] Failed to write manifest.json:', err);
    }

    const artifact: FmvPackagerArtifact = {
      final_video: masterCut.outputVideoUrl || `/media/${projectId}/export/master_cut.mp4`,
      outputVideoPath: masterCut.outputVideoPath || path.join(projectDir, 'export', 'master_cut.mp4'),
      outputVideoUrl: masterCut.outputVideoUrl || `/media/${projectId}/export/master_cut.mp4`,
      final_videos: masterCut.finalVideos || [],
      totalDuration: totalDurationSec,
      resolution: input.resolution || '720P',
      fmvManifest,
    };

    return artifact;
  }
}
