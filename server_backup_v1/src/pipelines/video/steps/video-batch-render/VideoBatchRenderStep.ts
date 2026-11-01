import fs from 'fs';
import path from 'path';
import { BaseStep } from '../../../../agent-runtime/index.js';
import { ProjectStore } from '../../../../project-store/index.js';
import type {
  VideoProductionClip,
  VideoProductionArtifact,
  VideoBatchRenderInput,
} from '../../types.js';

export class VideoBatchRenderStep extends BaseStep<VideoBatchRenderInput, VideoProductionArtifact> {
  public readonly name = 'video-batch-render';
  public readonly stepIndex = 'video_batch_render';

  constructor(projectId?: string) {
    super('VIDEO_PRODUCTION', projectId);
  }

  public async run(input: VideoBatchRenderInput): Promise<VideoProductionArtifact> {
    const projectId = input.projectId || this.projectId;
    if (!projectId) {
      throw new Error('[VideoBatchRenderStep] 运行缺少必须的 projectId');
    }
    const store = ProjectStore.getInstance();
    const shots = input.shots || [];
    const motionPromptMap: Map<string, string> = input.motionPromptMap || new Map();

    const projectDir = store.getProjectDir(projectId);
    const videosDir = path.join(projectDir, 'videos');
    fs.mkdirSync(videosDir, { recursive: true });

    const clips: VideoProductionClip[] = [];

    for (const shot of shots) {
      if (input.abortSignal?.aborted) {
        throw new Error('[VideoBatchRenderStep] 视频分片渲染已被外部中断');
      }
      const prompt = motionPromptMap.get(shot.shotId) || shot.videoPrompt || '';
      const fileName = `clip_${shot.shotId}.mp4`;
      const filePath = path.join(videosDir, fileName);

      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, Buffer.from('FAKE_MP4_VIDEO_HEADER_CONTENT_DATA'), 'utf-8');
      }

      const permanentLocalUrl = `/media/${projectId}/videos/${fileName}`;
      shot.videoClipUrl = permanentLocalUrl;

      clips.push({
        id: `clip_${shot.shotId}`,
        shotId: shot.shotId,
        videoUrl: permanentLocalUrl,
        localPath: filePath,
        duration: shot.duration || 4,
        prompt,
      });
    }

    const artifact: VideoProductionArtifact = {
      clips,
      totalClips: clips.length,
    };

    return artifact;
  }
}
