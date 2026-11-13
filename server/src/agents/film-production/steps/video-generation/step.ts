import { createStep } from '@mastra/core/workflows';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { videoGenerateTool } from '../../../../tools/video-generate/video-generate.tool.js';
import { writeArtifactFile, STAGE, FILM_STEP } from '../../../../project-store/artifact-fs.js';
import { VideoGenerationStepInputSchema, VideoGenerationStepOutputSchema, type VideoGenerationStepInput, type VideoGenerationStepOutput } from './schema.js';

export async function executeVideoGenerationStep(input: VideoGenerationStepInput): Promise<VideoGenerationStepOutput> {
  const store = ProjectStore.getInstance();
  const spec: any = store.getArtifact(input.projectId, 'film_spec');
  if (!spec?.clips?.length) throw new Error(`[VideoGenerationStep] 项目 [${input.projectId}] 缺少 film_spec`);
  let generated = 0, failed = 0;
  for (const clip of spec.clips) for (const shot of clip.shots || []) {
    if (!shot.firstFrameImageUrl || (!input.force && shot.videoUrl)) continue;
    try {
      const res: any = await (videoGenerateTool.execute as any)({ context: {
        projectId: input.projectId,
        prompt: shot.videoPrompt,
        audioPrompt: shot.audioPrompt,
        referenceImageUrl: shot.firstFrameEnhancedUrl || shot.firstFrameImageUrl,
        lastFrameImageUrl: shot.generationMode === 'first_last_frame' ? (shot.lastFrameEnhancedUrl || shot.lastFrameImageUrl) : undefined,
        duration: shot.durationSec,
        subfolder: 'video',
        customFilename: shot.shotId,
      }});
      if (res?.videoUrl) { shot.videoUrl = res.videoUrl; generated++; } else failed++;
    } catch { failed++; }
  }
  for (const clip of spec.clips) {
    const renderedShots = (clip.shots || []).map((shot: any) => shot.videoUrl).filter(Boolean);
    if (renderedShots.length === 1) clip.videoUrl = renderedShots[0];
    else if (renderedShots.length > 1) {
      // 当前阶段保留镜头级视频地址；合成器接入后由它写回 clip.videoUrl。
      delete clip.videoUrl;
    }
  }
  store.setArtifact(input.projectId, 'film_spec', spec);
  writeArtifactFile(input.projectId, 'delivery', STAGE.filmAdapter, FILM_STEP.compile, 'film_spec.json', JSON.stringify(spec, null, 2));
  return { projectId: input.projectId, force: input.force, generated, failed };
}

export const videoGenerationStep = createStep({ id: 'film-video-generation', description: '根据关键帧生成带声音的镜头视频', inputSchema: VideoGenerationStepInputSchema, outputSchema: VideoGenerationStepOutputSchema, execute: async ({ context }) => executeVideoGenerationStep(context) });

