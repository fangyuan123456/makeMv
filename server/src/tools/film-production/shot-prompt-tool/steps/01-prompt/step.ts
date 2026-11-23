/**
 * tools/film-production/shot-prompt-tool/steps/01-prompt/step.ts
 * 单镜首帧画面生图词推演工序 (Shot Prompt Step)
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../../llm/index.js';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { generateStructured } from '../../../../../utils/llm-diagnostics.js';
import { getProjectStorySections } from '../../../../../project-store/story-sections.js';
import {
  ShotPromptInputSchema,
  ShotPromptOutputSchema,
  type ShotPromptInput,
  type ShotPromptOutput,
} from './schema.js';
import { buildShotPromptPrompt } from './prompt.js';

export const shotPromptStep = createStep({
  id: 'shot-prompt-step',
  description: '单镜视听一体化推演五层摄影公理首帧生图词与同相动态运镜词 (Direction-First)',
  inputSchema: ShotPromptInputSchema,
  outputSchema: ShotPromptOutputSchema,
  execute: async ({ context }) => {
    const ctx = (context as any) || {};
    const input = (ctx.triggerData || ctx.inputData || ctx || {}) as ShotPromptInput;
    const store = ProjectStore.getInstance();
    const abortSignal = (input as any)?.abortSignal || (input as any)?._context?.abortSignal;

    const filmSpec = store.getArtifact<any>(input.projectId, 'film_spec') || { clips: [] };
    const currentClip = (filmSpec.clips || []).find((c: any) => c.clipId === input.clipId);
    if (!currentClip) {
      throw new Error(`[ShotPromptTool] 未在项目 [${input.projectId}] 中找到分幕 [${input.clipId}]`);
    }

    const shotList: any[] = currentClip.shots || [];
    const shotIdx = shotList.findIndex((s: any) => s.shotId === input.shotId);
    if (shotIdx < 0) {
      throw new Error(`[ShotPromptTool] 未在分幕 [${input.clipId}] 中找到镜头 [${input.shotId}]`);
    }
    const targetShot = shotList[shotIdx];

    // 自动自愈提取宏观全剧背景
    const prd = store.getArtifact<any>(input.projectId, 'universal_prd') || store.getArtifact<any>(input.projectId, 'prd') || {};
    const storyOverview = input.storyOverview || prd?.oneSentenceSummary || prd?.logline || prd?.premise || prd?.title;

    // 自动自愈提取上一镜接戏基准
    const prevShotFromStore = shotIdx > 0 ? shotList[shotIdx - 1] : undefined;
    const effectivePreviousShot = input.previousShot || (prevShotFromStore ? {
      shotId: prevShotFromStore.shotId,
      title: prevShotFromStore.title,
      sceneSubject: prevShotFromStore.sceneSubject,
      firstFramePrompt: prevShotFromStore.firstFramePrompt || prevShotFromStore.prompt,
      videoPrompt: prevShotFromStore.videoPrompt,
    } : undefined);

    const storySections = getProjectStorySections(input.projectId);
    const sectionMeta = storySections[input.clipId];
    const clipTitle = sectionMeta?.title || currentClip.title || input.clipId;
    const narrativeText = sectionMeta?.narrativeText || '';

    const effectiveEntities =
      input.entities ||
      store.getArtifact<any>(input.projectId, 'lookdev_entities') ||
      { characters: [], locations: [] };

    const agent = new Agent({
      name: 'shot-prompt-cinematographer',
      instructions: '你是顶级电影导演与摄影指导。负责将单个镜头的剧情、机位与角色外观升华转化为工业级首帧生图词与同相动态运镜词。严格保证首帧t=0与动态时序完全同相，彻底消灭克隆分身与时序割裂。',
      model: LLMProvider.getModel(),
    });

    const effectiveShot = {
      ...targetShot,
      weatherDirective: targetShot.weatherDirective || currentClip.shootingScript?.environmentLock?.weatherDirective,
    };

    const prompt = buildShotPromptPrompt({
      shot: effectiveShot,
      clipTitle,
      narrativeText,
      instruction: input.instruction,
      characters: effectiveEntities.characters || [],
      locations: effectiveEntities.locations || [],
      items: effectiveEntities.items || [],
      storyOverview,
      previousShot: effectivePreviousShot,
    });

    const result = (await generateStructured({
      agent,
      prompt,
      schema: ShotPromptOutputSchema.omit({ projectId: true, clipId: true, shotId: true }),
      stage: 'film-tool',
      step: 'shot-prompt-generate',
      label: `视听一体化推演·${input.shotId}`,
      abortSignal,
    })) as Partial<ShotPromptOutput>;

    const output: ShotPromptOutput = {
      projectId: input.projectId,
      clipId: input.clipId,
      shotId: input.shotId,
      videoPrompt: result.videoPrompt || targetShot.videoPrompt || targetShot.sceneSubject,
      firstFramePrompt: result.firstFramePrompt || targetShot.sceneSubject,
      cameraDirective: result.cameraDirective || targetShot.cameraDirective,
      colorDirective: result.colorDirective || targetShot.colorDirective,
      poseDirective: result.poseDirective || targetShot.poseDirective,
      motionDirective: result.motionDirective || targetShot.motionDirective,
      dynamicDirective: result.dynamicDirective || targetShot.dynamicDirective,
      focusDirective: result.focusDirective || targetShot.focusDirective,
    };

    return output;
  },
});
