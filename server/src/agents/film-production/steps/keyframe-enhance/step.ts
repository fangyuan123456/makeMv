import { createStep } from '@mastra/core/workflows';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { imageGenerateTool } from '../../../../tools/image-generate/image-generate.tool.js';
import { KeyframeEnhanceStepInputSchema, KeyframeEnhanceStepOutputSchema, type KeyframeEnhanceStepInput, type KeyframeEnhanceStepOutput } from './schema.js';
export async function executeKeyframeEnhanceStep(input: KeyframeEnhanceStepInput): Promise<KeyframeEnhanceStepOutput> {
  const store = ProjectStore.getInstance(); const spec: any = store.getArtifact(input.projectId, 'film_spec');
  if (!spec?.clips?.length) throw new Error(`[KeyframeEnhanceStep] 项目 [${input.projectId}] 缺少 film_spec`);
  let enhanced=0, failed=0;
  for (const clip of spec.clips) for (const shot of clip.shots || []) {
    for (const kind of ['first','last']) {
      const source = shot[`${kind}FrameImageUrl`]; if (!source || (shot[`${kind}FrameEnhancedUrl`] && !input.force)) continue;
      try { const res: any = await (imageGenerateTool.execute as any)({ context: { projectId: input.projectId, prompt: `高清电影剧照，保持原图构图、人物身份、服装、场景和动作完全一致，细节清晰，真实光影。${kind === 'last' ? shot.lastFramePrompt : shot.firstFramePrompt}`, referenceImageUrls: [source], mode: 'general_t2i', size: '1280*720', subfolder: 'keyframes-enhanced', customFilename: `${shot.shotId}-${kind}` } }); if (res?.mediaUrl) { shot[`${kind}FrameEnhancedUrl`] = res.mediaUrl; enhanced++; } else failed++; } catch { failed++; }
    }
  }
  store.setArtifact(input.projectId, 'film_spec', spec); return { projectId: input.projectId, force: input.force, enhanced, failed };
}
export const keyframeEnhanceStep = createStep({ id: 'film-keyframe-enhance', description: '将分镜关键帧增强到视频输入清晰度', inputSchema: KeyframeEnhanceStepInputSchema, outputSchema: KeyframeEnhanceStepOutputSchema, execute: async ({ context }) => executeKeyframeEnhanceStep(context) });

