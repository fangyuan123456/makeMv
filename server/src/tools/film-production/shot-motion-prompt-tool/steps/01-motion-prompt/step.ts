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
  description: '以首帧为物理起幅基准，推演符合景别动能分级（LOD）的图生视频动作流',
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

    // 优先读取传入的首帧信息，其次读取契约中已有的首帧
    const firstFramePrompt = input.firstFramePrompt || currentShot.firstFramePrompt || '';
    const firstFrameImageUrl = input.firstFrameImageUrl || currentShot.firstFrameImageUrl || '';

    const allCharacters = store.getArtifact<any[]>(input.projectId, 'characters') || [];
    const shotCharIds = currentShot.characters || [];
    const characters = allCharacters.filter((c: any) =>
      shotCharIds.includes(c.id || c.characterId)
    );

    const storySections = getProjectStorySections(input.projectId);
    const sectionMeta = storySections[input.clipId];
    const clipTitle = sectionMeta?.title || currentClip.title || input.clipId;
    const narrativeText = sectionMeta?.narrativeText || currentClip.screenplay || currentClip.summary || '';

    const promptText = buildShotMotionPromptPrompt({
      shot: {
        shotId: currentShot.shotId,
        title: currentShot.title || `镜头 ${currentShot.shotId}`,
        shotType: currentShot.shotType || currentShot.sliceSummary || '',
        sceneSubject: currentShot.sceneSubject || currentShot.description || '',
        firstFramePrompt,
        firstFrameImageUrl,
        cameraDirective: currentShot.cameraDirective,
        motionDirective: currentShot.motionDirective,
        dynamicDirective: currentShot.dynamicDirective,
        focusDirective: currentShot.focusDirective,
        durationSec: input.durationSec || currentShot.durationSec || currentShot.estimatedSeconds || 3,
        dialogue: currentShot.dialogue,
      },
      clipTitle,
      narrativeText,
      instruction: input.instruction,
      characters,
      storyOverview,
    });

    const agent = new Agent({
      name: 'shot-motion-prompt-director',
      instructions: '你是一名顶级电影导演兼视效指导，擅长严格遵循景别动能分级（LOD）与首帧物理连续性，描摹克制专业的图生视频动作流。',
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
