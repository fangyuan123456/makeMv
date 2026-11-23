/**
 * tools/film-production/storyboard-breakdown-tool/modifier/step.ts
 * 单幕分镜台本微调执行工序 (Storyboard Breakdown Modifier Step SSOT)
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../llm/index.js';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { generateStructured } from '../../../../utils/llm-diagnostics.js';
import { getProjectStorySections } from '../../../../project-store/story-sections.js';
import {
  StoryboardBreakdownModifierInputSchema,
  StoryboardBreakdownModifierOutputSchema,
  type StoryboardBreakdownModifierInput,
  type StoryboardBreakdownModifierOutput,
} from './schema.js';
import { buildStoryboardBreakdownModifyPrompt } from './prompt.js';

export const storyboardBreakdownModifierStep = createStep({
  id: 'storyboard-breakdown-modifier-step',
  description: '对已有分幕镜头台本执行定向微调（支持零 LLM 结构化增删改与大模型台本重排）',
  inputSchema: StoryboardBreakdownModifierInputSchema,
  outputSchema: StoryboardBreakdownModifierOutputSchema,
  execute: async ({ context }) => {
    const ctx = (context as any) || {};
    const input = (ctx.triggerData || ctx.inputData || ctx || {}) as StoryboardBreakdownModifierInput;
    const store = ProjectStore.getInstance();
    const abortSignal = (input as any)?.abortSignal || (input as any)?._context?.abortSignal;

    const filmSpec = store.getArtifact<any>(input.projectId, 'film_spec') || { clips: [] };
    const currentClip = (filmSpec.clips || []).find((c: any) => c.clipId === input.clipId);
    const existingShots = currentClip?.shots || [];

    const storySections = getProjectStorySections(input.projectId, input.storyMarkdown);
    const sectionMeta = storySections[input.clipId];
    const clipTitle = sectionMeta?.title || currentClip?.title || input.clipId;

    // 结构化极速操作通道：若传入显式 modifications 清单，直接执行 0 LLM 增删改
    if (Array.isArray(input.modifications) && input.modifications.length > 0) {
      let shots = [...existingShots];
      for (const mod of input.modifications) {
        if (mod.action === 'delete') {
          if (mod.shotId) {
            shots = shots.filter((s: any) => s.shotId !== mod.shotId);
          }
        } else if (mod.action === 'update') {
          if (mod.shotId && mod.shot) {
            const idx = shots.findIndex((s: any) => s.shotId === mod.shotId);
            if (idx >= 0) {
              shots[idx] = {
                ...shots[idx],
                ...mod.shot,
                shotId: shots[idx].shotId,
              };
            }
          }
        } else if (mod.action === 'add') {
          const newIndex = shots.length + 1;
          const newShotId = mod.shot?.shotId || `${input.clipId}-${String(newIndex).padStart(2, '0')}`;
          const newShot: any = {
            shotId: newShotId,
            title: mod.shot?.title || `镜${String(newIndex).padStart(2, '0')}`,
            sceneSubject: mod.shot?.sceneSubject || '',
            cameraDirective: mod.shot?.cameraDirective || { value: '中景', label: '中景' },
            colorDirective: mod.shot?.colorDirective,
            poseDirective: mod.shot?.poseDirective,
            dialogue: mod.shot?.dialogue,
            audioPrompt: mod.shot?.audioPrompt,
            durationSec: mod.shot?.durationSec || 3,
            characterIds: Array.isArray(mod.shot?.characterIds) ? mod.shot.characterIds : [],
            locationId: mod.shot?.locationId,
          };
          if (mod.shotId) {
            const targetIdx = shots.findIndex((s: any) => s.shotId === mod.shotId);
            if (targetIdx >= 0) {
              shots.splice(targetIdx + 1, 0, newShot);
            } else {
              shots.push(newShot);
            }
          } else {
            shots.push(newShot);
          }
        }
      }

      return {
        projectId: input.projectId,
        clipId: input.clipId,
        clipTitle,
        shots,
      };
    }

    // 自然语言指令微调通道
    const agent = new Agent({
      name: 'storyboard-breakdown-modifier',
      instructions: '你是专业电影分镜总导演。根据创作者指令优化现有分镜台本编排，输出标准结构。',
      model: LLMProvider.getModel(),
    });

    const prompt = buildStoryboardBreakdownModifyPrompt({
      clipId: input.clipId,
      existingShots: existingShots.map((s: any) => ({
        shotId: s.shotId,
        title: s.title,
        sceneSubject: s.sceneSubject || s.title,
        dialogue: s.dialogue,
      })),
      instruction: input.instruction || '优化本幕分镜节奏与景别',
      targetShotId: input.targetShotId,
    });

    const breakdownResult = (await generateStructured({
      agent,
      prompt,
      schema: StoryboardBreakdownModifierOutputSchema.omit({ projectId: true, clipId: true, clipTitle: true }),
      stage: 'film-tool',
      step: 'storyboard-breakdown-modify',
      label: `分镜台本修改·${input.clipId}`,
      abortSignal,
    })) as any;

    return {
      projectId: input.projectId,
      clipId: input.clipId,
      clipTitle,
      shots: (breakdownResult.shots || []).map((s: any, idx: number) => ({
        shotId: s.shotId || `${input.clipId}-${String(idx + 1).padStart(2, '0')}`,
        title: s.title || `镜${String(idx + 1).padStart(2, '0')}`,
        sceneSubject: s.sceneSubject || '',
        cameraDirective: s.cameraDirective || { value: '中景', label: '中景' },
        colorDirective: s.colorDirective,
        poseDirective: s.poseDirective,
        dialogue: s.dialogue,
        audioPrompt: s.audioPrompt,
        durationSec: s.durationSec || 3,
        characterIds: Array.isArray(s.characterIds) ? s.characterIds : [],
        locationId: s.locationId,
      })),
    };
  },
});
