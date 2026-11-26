/**
 * tools/film-production/shot-motion-prompt-tool/modifier/step.ts
 * 单镜视频动态定向微调 Step
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../llm/index.js';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { generateStructured } from '../../../../utils/llm-diagnostics.js';
import {
  ShotMotionPromptOutputSchema,
  type ShotMotionPromptOutput,
} from '../steps/01-motion-prompt/schema.js';
import {
  ShotMotionPromptModifierInputSchema,
  type ShotMotionPromptModifierInput,
} from './schema.js';
import { buildShotMotionModifierPrompt } from './prompt.js';

export const shotMotionPromptModifierStep = createStep({
  id: 'shot-motion-prompt-modifier-step',
  description: '单镜视频时序动作与全员微动态定向微调 (Motion Modifier)',
  inputSchema: ShotMotionPromptModifierInputSchema,
  outputSchema: ShotMotionPromptOutputSchema,
  execute: async ({ context }) => {
    const ctx = (context as any) || {};
    const input = (ctx.triggerData || ctx.inputData || ctx || {}) as ShotMotionPromptModifierInput;
    const store = ProjectStore.getInstance();
    const abortSignal = (input as any)?.abortSignal || (input as any)?._context?.abortSignal;

    const filmSpec = store.getArtifact<any>(input.projectId, 'film_spec') || { clips: [] };
    const currentClip = (filmSpec.clips || []).find((c: any) => c.clipId === input.clipId);
    if (!currentClip) throw new Error(`未找到分幕 [${input.clipId}]`);

    const currentShot = (currentClip.shots || []).find((s: any) => s.shotId === input.shotId);
    if (!currentShot) throw new Error(`未找到镜头 [${input.shotId}]`);

    // 若创作者直接指定了 customVideoPrompt，直接对齐生效
    if (input.customVideoPrompt && input.customVideoPrompt.trim()) {
      currentShot.videoPrompt = input.customVideoPrompt.trim();
      store.setArtifact(input.projectId, 'film_spec', filmSpec);
      return {
        projectId: input.projectId,
        clipId: input.clipId,
        shotId: input.shotId,
        videoPrompt: currentShot.videoPrompt,
        motionDirective: currentShot.motionDirective,
        dynamicDirective: currentShot.dynamicDirective,
        focusDirective: currentShot.focusDirective,
      };
    }

    const promptText = buildShotMotionModifierPrompt({
      shot: {
        shotId: currentShot.shotId,
        title: currentShot.title || `镜头 ${currentShot.shotId}`,
        videoPrompt: currentShot.videoPrompt,
        firstFramePrompt: currentShot.firstFramePrompt,
      },
      instruction: input.instruction,
    });

    const agent = new Agent({
      name: 'shot-motion-prompt-modifier',
      instructions: '你是一名顶级电影视效指导，擅长对既有动态时序执行定向微调，保持首帧起幅一致性并丰富全员微动态。',
      model: LLMProvider.getModel(),
    });

    const result = (await generateStructured({
      agent,
      schema: ShotMotionPromptOutputSchema.omit({ projectId: true, clipId: true, shotId: true }),
      prompt: promptText,
      stage: 'film-tool',
      step: 'shot-motion-prompt-modify',
      label: `视频动态微调·${input.shotId}`,
      abortSignal,
    })) as Partial<ShotMotionPromptOutput>;

    currentShot.videoPrompt = result.videoPrompt || currentShot.videoPrompt;
    if (result.motionDirective) currentShot.motionDirective = result.motionDirective;
    if (result.dynamicDirective) currentShot.dynamicDirective = result.dynamicDirective;
    if (result.focusDirective) currentShot.focusDirective = result.focusDirective;

    store.setArtifact(input.projectId, 'film_spec', filmSpec);

    return {
      projectId: input.projectId,
      clipId: input.clipId,
      shotId: input.shotId,
      videoPrompt: currentShot.videoPrompt,
      motionDirective: currentShot.motionDirective,
      dynamicDirective: currentShot.dynamicDirective,
      focusDirective: currentShot.focusDirective,
    };
  },
});
