import { createStep } from '@mastra/core/workflows';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { imageGenerateTool } from '../../../../tools/image-generate/image-generate.tool.js';
import { writeArtifactFile, STAGE, FILM_STEP } from '../../../../project-store/artifact-fs.js';
import { KeyframeStepInputSchema, KeyframeStepOutputSchema, type KeyframeStepInput, type KeyframeStepOutput } from './schema.js';

export async function executeKeyframeStep(input: KeyframeStepInput): Promise<KeyframeStepOutput> {
  const store = ProjectStore.getInstance();
  const spec: any = store.getArtifact(input.projectId, 'film_spec');
  if (!spec?.clips?.length) throw new Error(`[KeyframeStep] 项目 [${input.projectId}] 缺少分镜规划 film_spec`);
  let generated = 0, reused = 0, failed = 0;
  for (const clip of spec.clips) for (const shot of clip.shots || []) {
    const refs = [shot.backgroundImageUrl, ...(shot.characterReferenceImageUrls || [])].filter(Boolean);
    for (const [kind, prompt] of [['first', shot.firstFramePrompt], ['last', shot.generationMode === 'first_last_frame' ? shot.lastFramePrompt : undefined] ] as const) {
      if (!prompt) continue;
      try {
        const res: any = await (imageGenerateTool.execute as any)({ context: { projectId: input.projectId, prompt, referenceImageUrls: refs, subfolder: 'keyframes', customFilename: `${shot.shotId}-${kind}` } });
        if (res?.mediaUrl) { shot[`${kind}FrameImageUrl`] = res.mediaUrl; generated++; } else failed++;
      } catch { failed++; }
    }
  }
  store.setArtifact(input.projectId, 'film_spec', spec);
  const projectDir = store.getProjectDir(input.projectId);
  for (const clip of spec.clips) {
    const scenePath = path.join(projectDir, 'scenes', `${clip.clipId}.json`);
    if (!fs.existsSync(scenePath)) continue;
    try {
      const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
      scene.keyframes = (clip.shots || []).flatMap((shot: any) => {
        const imageUrl = shot.firstFrameImageUrl;
        return imageUrl ? [{ shotId: shot.shotId, imageUrl, durationSec: shot.durationSec }] : [];
      });
      fs.writeFileSync(scenePath, JSON.stringify(scene, null, 2));
    } catch (err) {
      console.warn(`[KeyframeStep] 同步分幕 ${clip.clipId} 失败:`, err);
    }
  }
  writeArtifactFile(input.projectId, 'delivery', STAGE.filmAdapter, FILM_STEP.compile, 'film_spec.json', JSON.stringify(spec, null, 2));
  return { projectId: input.projectId, force: input.force, generated, reused, failed };
}

export const keyframeStep = createStep({ id: 'film-keyframe', description: '为分镜生成首帧与尾帧图片', inputSchema: KeyframeStepInputSchema, outputSchema: KeyframeStepOutputSchema, execute: async ({ context }) => executeKeyframeStep(context) });

