/**
 * tools/film-production/shot-motion-prompt-tool/steps/01-motion-prompt/step.ts
 * 单镜视频动态与运镜提示词推演工序 (Shot Motion Prompt Step)
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../../llm/index.js';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { generateStructured } from '../../../../../utils/llm-diagnostics.js';
import { getProjectStorySections } from '../../../../../project-store/story-sections.js';
import {
  ShotMotionPromptInputSchema,
  ShotMotionPromptOutputSchema,
  type ShotMotionPromptInput,
  type ShotMotionPromptOutput,
} from './schema.js';
import { buildShotMotionPromptPrompt } from './prompt.js';

export const shotMotionPromptStep = createStep({
  id: 'shot-motion-prompt-step',
  description: '基于段落剧情与时空站位，推演适配 H3 Ref2V 的段落多机位视频提示词',
  inputSchema: ShotMotionPromptInputSchema,
  outputSchema: ShotMotionPromptOutputSchema,
  execute: async ({ context }) => {
    const ctx = (context as any) || {};
    const input = (ctx.triggerData || ctx.inputData || ctx || {}) as ShotMotionPromptInput;
    const store = ProjectStore.getInstance();
    const abortSignal = (input as any)?.abortSignal || (input as any)?._context?.abortSignal;

    const filmSpec = store.getArtifact<any>(input.projectId, 'film_spec') || { clips: [] };
    const currentClip = (filmSpec.clips || []).find((c: any) => c.clipId === input.clipId);
    if (!currentClip) {
      throw new Error(`[ShotMotionPromptTool] 未在项目 [${input.projectId}] 中找到分幕 [${input.clipId}]`);
    }

    const shotList: any[] = currentClip.shots || [];
    const shotIdx = shotList.findIndex((s: any) => s.shotId === input.shotId);
    if (shotIdx < 0) {
      throw new Error(`[ShotMotionPromptTool] 未在分幕 [${input.clipId}] 中找到镜头 [${input.shotId}]`);
    }
    const currentShot = shotList[shotIdx];

    const prd = store.getArtifact<any>(input.projectId, 'universal_prd') || store.getArtifact<any>(input.projectId, 'prd') || {};
    const storyOverview = input.storyOverview || prd?.oneSentenceSummary || prd?.logline || prd?.premise || prd?.title || '';

    const lookdevEntities = store.getArtifact<any>(input.projectId, 'lookdev_entities') || {};
    const allCharacters = Array.isArray(lookdevEntities.characters) && lookdevEntities.characters.length > 0
      ? lookdevEntities.characters
      : store.getArtifact<any[]>(input.projectId, 'characters') || [];
    const shotCharIds = currentShot.characters || [];
    const characters = shotCharIds.length > 0
      ? allCharacters.filter((c: any) => shotCharIds.includes(c.id || c.characterId || c.name))
      : allCharacters;

    const allItems = Array.isArray(lookdevEntities.items) ? lookdevEntities.items : [];
    const shotItemIds = currentShot.items || [];
    const items = shotItemIds.length > 0
      ? allItems.filter((it: any) => shotItemIds.includes(it.id || it.itemId || it.name))
      : [];

    const storySections = getProjectStorySections(input.projectId);
    const sectionMeta = storySections[input.clipId];
    const clipTitle = sectionMeta?.title || currentClip.title || input.clipId;
    const rawNarrative = sectionMeta?.narrativeText || currentClip.screenplay || currentClip.summary || '';
    const sceneSubject = currentShot.sceneSubject || currentShot.description || '';
    // 仅当片段本身缺失核心事件描述时才回退分幕全文，避免把其他片段的台词带入当前片段
    const narrativeText = sceneSubject.trim() ? '' : rawNarrative;

    const prevShot = shotIdx > 0 ? shotList[shotIdx - 1] : undefined;
    const isSameSceneAsPrev = Boolean(
      prevShot &&
        (!currentShot.locationId ||
          !prevShot.locationId ||
          currentShot.locationId === prevShot.locationId)
    );

    const promptText = buildShotMotionPromptPrompt({
      shot: {
        shotId: currentShot.shotId,
        title: currentShot.title || `片段 ${currentShot.shotId}`,
        shotType: currentShot.shotType || currentShot.sliceSummary || '',
        location: currentShot.location || currentClip.location || '',
        sceneSubject: currentShot.sceneSubject || currentShot.description || '',
        cameraDirective: currentShot.cameraDirective,
        motionDirective: currentShot.motionDirective,
        dynamicDirective: currentShot.dynamicDirective,
        focusDirective: currentShot.focusDirective,
        durationSec: input.durationSec || currentShot.durationSec || currentShot.estimatedSeconds || 8,
        continuityMode: currentShot.continuityMode,
      },
      previousShot: prevShot
        ? {
            shotId: prevShot.shotId,
            title: prevShot.title || `片段 ${prevShot.shotId}`,
            sceneSubject: prevShot.sceneSubject || prevShot.description || '',
            videoPrompt: prevShot.videoPrompt || '',
            isSameScene: isSameSceneAsPrev,
          }
        : undefined,
      clipTitle,
      narrativeText,
      instruction: input.instruction,
      characters,
      items,
      storyOverview,
    });

    const agent = new Agent({
      name: 'shot-motion-prompt-director',
      instructions: '你是一名顶级电影导演兼摄影指导，擅长用「站位光影 + 时间戳多机位」编写高信噪比的 H3 Ref2V 视频提示词。',
      model: LLMProvider.getModel(),
    });

    const result = (await generateStructured({
      agent,
      schema: ShotMotionPromptOutputSchema.omit({ projectId: true, clipId: true, shotId: true }),
      prompt: promptText,
      stage: 'film-tool',
      step: 'shot-motion-prompt-generate',
      label: `视频动态推演·${input.shotId}`,
      abortSignal,
    })) as Partial<ShotMotionPromptOutput>;

    // 将推演产物写入当前镜头契约并持久化落盘
    currentShot.videoPrompt = result.videoPrompt || currentShot.videoPrompt || currentShot.sceneSubject;
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
