/**
 * tools/film-production/shot-prompt-tool/modifier/step.ts
 * 单镜首帧生图词增量微调执行工序 (Shot Prompt Modifier Step SSOT)
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../llm/index.js';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { generateStructured } from '../../../../utils/llm-diagnostics.js';
import { getProjectStorySections } from '../../../../project-store/story-sections.js';
import {
  ShotPromptModifierInputSchema,
  ShotPromptModifierOutputSchema,
  type ShotPromptModifierInput,
  type ShotPromptModifierOutput,
} from './schema.js';
import { buildShotPromptModifyPrompt } from './prompt.js';

export const shotPromptModifierStep = createStep({
  id: 'shot-prompt-modifier-step',
  description: '单镜视听一体化微调（支持自定义词直接覆盖与五层公理及动态运镜增量优化）',
  inputSchema: ShotPromptModifierInputSchema,
  outputSchema: ShotPromptModifierOutputSchema,
  execute: async ({ context }) => {
    const ctx = (context as any) || {};
    const input = (ctx.triggerData || ctx.inputData || ctx || {}) as ShotPromptModifierInput;
    const store = ProjectStore.getInstance();
    const abortSignal = (input as any)?.abortSignal || (input as any)?._context?.abortSignal;

    const filmSpec = store.getArtifact<any>(input.projectId, 'film_spec') || { clips: [] };
    const currentClip = (filmSpec.clips || []).find((c: any) => c.clipId === input.clipId);
    if (!currentClip) {
      throw new Error(`[ShotPromptModifier] 未在项目 [${input.projectId}] 中找到分幕 [${input.clipId}]`);
    }

    const targetShot = (currentClip.shots || []).find((s: any) => s.shotId === input.shotId);
    if (!targetShot) {
      throw new Error(`[ShotPromptModifier] 未在分幕 [${input.clipId}] 中找到镜头 [${input.shotId}]`);
    }

    // 快捷通道：若创作者直接提供自定义首帧生图词 (customPrompt) 或自定义视频词 (customVideoPrompt)
    if ((input.customPrompt && input.customPrompt.trim()) || (input.customVideoPrompt && input.customVideoPrompt.trim())) {
      let custom = (input.customPrompt || targetShot.firstFramePrompt || '').trim();
      custom = custom
        .replace(/[，、；。\s]*(?:无多余人物|无多余角色|无其他人物|无其他角色)[，、；。\s]*/g, '，')
        .replace(/[，、；。\s]*(?:严禁|禁止)[^，；。]+[，、；。\s]*/g, '，')
        .replace(/，{2,}/g, '，')
        .replace(/^，|，$/g, '')
        .trim();

      let customVideo = (input.customVideoPrompt || targetShot.videoPrompt || '').trim();
      customVideo = customVideo
        .replace(/[，、；。\s]*(?:无多余人物|无多余角色|无其他人物|无其他角色)[，、；。\s]*/g, '，')
        .replace(/[，、；。\s]*(?:严禁|禁止)[^，；。]+[，、；。\s]*/g, '，')
        .replace(/，{2,}/g, '，')
        .replace(/^，|，$/g, '')
        .trim();

      return {
        projectId: input.projectId,
        clipId: input.clipId,
        shotId: input.shotId,
        firstFramePrompt: custom,
        videoPrompt: customVideo,
        cameraDirective: targetShot.cameraDirective,
        colorDirective: targetShot.colorDirective,
        poseDirective: targetShot.poseDirective,
        motionDirective: targetShot.motionDirective,
        dynamicDirective: targetShot.dynamicDirective,
        focusDirective: targetShot.focusDirective,
      };
    }

    const storySections = getProjectStorySections(input.projectId);
    const sectionMeta = storySections[input.clipId];
    const clipTitle = sectionMeta?.title || currentClip.title || input.clipId;

    const effectiveEntities =
      input.entities ||
      store.getArtifact<any>(input.projectId, 'lookdev_entities') ||
      { characters: [], locations: [] };

    const agent = new Agent({
      name: 'shot-prompt-modifier-cinematographer',
      instructions: '你是顶级电影导演与摄影指导。负责根据创作者指令优化单个镜头的首帧生图词与同相动态运镜词，严格保持两者同相，绝不输出否定词。',
      model: LLMProvider.getModel(),
    });

    const prompt = buildShotPromptModifyPrompt({
      shot: targetShot,
      clipTitle,
      instruction: input.instruction || '优化该镜头的摄影光学与光影细节',
      characters: effectiveEntities.characters || [],
      locations: effectiveEntities.locations || [],
    });

    const result = (await generateStructured({
      agent,
      prompt,
      schema: ShotPromptModifierOutputSchema.omit({ projectId: true, clipId: true, shotId: true }),
      stage: 'film-tool',
      step: 'shot-prompt-modify',
      label: `视听词修改·${input.shotId}`,
      abortSignal,
    })) as any;

    let cleanPrompt = (result.firstFramePrompt || targetShot.firstFramePrompt || '').trim();
    cleanPrompt = cleanPrompt
      .replace(/[，、；。\s]*(?:无多余人物|无多余角色|无其他人物|无其他角色)[，、；。\s]*/g, '，')
      .replace(/[，、；。\s]*(?:严禁|禁止)[^，；。]+[，、；。\s]*/g, '，')
      .replace(/，{2,}/g, '，')
      .replace(/^，|，$/g, '')
      .trim();

    let cleanVideoPrompt = (result.videoPrompt || targetShot.videoPrompt || '').trim();
    cleanVideoPrompt = cleanVideoPrompt
      .replace(/[，、；。\s]*(?:无多余人物|无多余角色|无其他人物|无其他角色)[，、；。\s]*/g, '，')
      .replace(/[，、；。\s]*(?:严禁|禁止)[^，；。]+[，、；。\s]*/g, '，')
      .replace(/，{2,}/g, '，')
      .replace(/^，|，$/g, '')
      .trim();

    return {
      projectId: input.projectId,
      clipId: input.clipId,
      shotId: input.shotId,
      videoPrompt: cleanVideoPrompt,
      firstFramePrompt: cleanPrompt,
      cameraDirective: result.cameraDirective || targetShot.cameraDirective,
      colorDirective: result.colorDirective || targetShot.colorDirective,
      poseDirective: result.poseDirective || targetShot.poseDirective,
      motionDirective: result.motionDirective || targetShot.motionDirective,
      dynamicDirective: result.dynamicDirective || targetShot.dynamicDirective,
      focusDirective: result.focusDirective || targetShot.focusDirective,
    };
  },
});
