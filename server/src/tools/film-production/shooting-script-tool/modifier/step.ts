/**
 * tools/film-production/shooting-script-tool/modifier/step.ts
 * 导演视听演绎剧本微调执行工序 (Shooting Script Modifier Step SSOT)
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../llm/index.js';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { generateStructured } from '../../../../utils/llm-diagnostics.js';
import { getProjectStorySections } from '../../../../project-store/story-sections.js';
import {
  ShootingScriptModifierInputSchema,
  ShootingScriptModifierOutputSchema,
  type ShootingScriptModifierInput,
  type ShootingScriptModifierOutput,
} from './schema.js';
import { buildShootingScriptModifyPrompt } from './prompt.js';

export const shootingScriptModifierStep = createStep({
  id: 'shooting-script-modifier-step',
  description: '对已有分幕视听演绎剧本执行定向微调（支持时空环境锁定向更新与物理动作流增删改）',
  inputSchema: ShootingScriptModifierInputSchema,
  outputSchema: ShootingScriptModifierOutputSchema,
  execute: async ({ context }) => {
    const ctx = (context as any) || {};
    const input = (ctx.triggerData || ctx.inputData || ctx || {}) as ShootingScriptModifierInput;
    const store = ProjectStore.getInstance();
    const abortSignal = (input as any)?.abortSignal || (input as any)?._context?.abortSignal;

    const filmSpec = store.getArtifact<any>(input.projectId, 'film_spec') || { clips: [] };
    const currentClip = (filmSpec.clips || []).find((c: any) => c.clipId === input.clipId);
    const existingScript = currentClip?.shootingScript;

    const storySections = getProjectStorySections(input.projectId, input.storyMarkdown);
    const sectionMeta = storySections[input.clipId];
    const clipTitle = sectionMeta?.title || currentClip?.title || input.clipId;

    // 默认回退基准
    const baseEnvLock = existingScript?.environmentLock || {
      timeOfDay: '日间',
      weatherDirective: { label: '自然光照', instruction: '自然漫反射光影' },
      lightingDirective: { label: '主光柔和', instruction: '写实柔和照明' },
    };
    const baseActionBeats = existingScript?.actionBeats || [];

    // 1. 结构化极速通道：直接覆盖环境锁或执行显式增删改清单
    if (
      input.environmentLock ||
      (Array.isArray(input.modifications) && input.modifications.length > 0)
    ) {
      let envLock = { ...baseEnvLock };
      if (input.environmentLock) {
        envLock = {
          ...envLock,
          ...input.environmentLock,
        };
      }

      let beats = [...baseActionBeats];
      if (Array.isArray(input.modifications)) {
        for (const mod of input.modifications) {
          if (mod.action === 'delete') {
            if (mod.beatId) {
              beats = beats.filter((b: any) => b.beatId !== mod.beatId);
            }
          } else if (mod.action === 'update') {
            if (mod.beatId && mod.beat) {
              const idx = beats.findIndex((b: any) => b.beatId === mod.beatId);
              if (idx >= 0) {
                beats[idx] = {
                  ...beats[idx],
                  ...mod.beat,
                  beatId: beats[idx].beatId,
                };
              }
            }
          } else if (mod.action === 'add') {
            const newIndex = beats.length + 1;
            const newBeatId = mod.beat?.beatId || `b${newIndex}`;
            beats.push({
              beatId: newBeatId,
              beatTitle: mod.beat?.beatTitle || `新动作节拍 ${newIndex}`,
              actionDescription: mod.beat?.actionDescription || '',
              cinematicIntent: mod.beat?.cinematicIntent || '中景定场',
              characterIds: mod.beat?.characterIds || [],
              itemIds: mod.beat?.itemIds || [],
              estimatedSeconds: mod.beat?.estimatedSeconds || 3,
            });
          }
        }
      }

      const output: ShootingScriptModifierOutput = {
        projectId: input.projectId,
        clipId: input.clipId,
        clipTitle,
        environmentLock: envLock,
        actionBeats: beats,
      };

      // 持久化
      saveShootingScript(store, input.projectId, filmSpec, input.clipId, clipTitle, output);
      return output;
    }

    // 2. 自然语言定向微调通道
    const agent = new Agent({
      name: 'shooting-script-modifier-director',
      instructions:
        '你是专业电影摄影指导兼执行导演。负责根据创作者指令对已有演绎剧本进行精准定向手术微调，未受影响的环境与动作必须100%锁死保留，严禁擅自推倒重来。',
      model: LLMProvider.getModel(),
    });

    const prompt = buildShootingScriptModifyPrompt({
      clipId: input.clipId,
      clipTitle,
      existingEnvironmentLock: baseEnvLock,
      existingActionBeats: baseActionBeats,
      instruction: input.instruction || '优化当前动作流的细节与光影连续性',
      targetBeatId: input.targetBeatId,
    });

    const result = (await generateStructured({
      agent,
      prompt,
      schema: ShootingScriptModifierOutputSchema.omit({ projectId: true, clipId: true, clipTitle: true }),
      stage: 'film-tool',
      step: 'shooting-script-modify',
      label: `演绎剧本微调·${input.clipId}`,
      abortSignal,
    })) as {
      environmentLock: any;
      actionBeats: any[];
    };

    const output: ShootingScriptModifierOutput = {
      projectId: input.projectId,
      clipId: input.clipId,
      clipTitle,
      environmentLock: result.environmentLock || baseEnvLock,
      actionBeats: Array.isArray(result.actionBeats) && result.actionBeats.length > 0 ? result.actionBeats : baseActionBeats,
    };

    saveShootingScript(store, input.projectId, filmSpec, input.clipId, clipTitle, output);
    return output;
  },
});

function saveShootingScript(
  store: ProjectStore,
  projectId: string,
  filmSpec: any,
  clipId: string,
  clipTitle: string,
  output: ShootingScriptModifierOutput
) {
  const updatedClips = [...(filmSpec.clips || [])];
  const clipIndex = updatedClips.findIndex((c: any) => c.clipId === clipId);
  const payload = {
    clipId,
    clipTitle,
    environmentLock: output.environmentLock,
    actionBeats: output.actionBeats,
    generatedAt: new Date().toISOString(),
  };

  if (clipIndex >= 0) {
    updatedClips[clipIndex] = {
      ...updatedClips[clipIndex],
      shootingScript: payload,
    };
  } else {
    updatedClips.push({
      clipId,
      sourceNodeId: clipId,
      targetDurationSec: 5.0,
      shots: [],
      shootingScript: payload,
    });
  }

  store.setArtifact(projectId, 'film_spec', {
    ...filmSpec,
    clips: updatedClips,
  });
}
