/**
 * agents/director/generator/steps/character-portrait/steps/render.step.ts
 * 角色定妆第 2 阶段原子 Step：批量视觉提示词生成与定妆照渲染
 */

import { createStep } from '@mastra/core/workflows';
import { WorkflowContextSchema, WorkflowContext } from '../../common.js';
import { LLMRegistry } from '../../../../../../llm/LLMRegistry.js';
import { asyncPoolSettled } from '../../../../../../utils/concurrency.js';
import { generateBatchVisualSpecs, renderFreshCharacter } from '../generator.js';
import type { CharacterSheetItem } from '../schema.js';

export const portraitRenderStep = createStep({
  id: 'step-portrait-render',
  description: '对待渲染角色批量推演视觉规范提示词并并发生成高清定妆照',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const context = inputData as WorkflowContext;
    const { projectId, payload } = context;
    const auditData = payload?.portraitAudit;

    if (!auditData) {
      throw new Error('[portraitRenderStep] 缺少前置核验上下文 (portraitAudit)');
    }

    const {
      style,
      userFeedback,
      isMock,
      effectiveConstraints,
      pendingCharacters,
    } = auditData;

    if (!pendingCharacters || pendingCharacters.length === 0) {
      return {
        ...context,
        payload: {
          ...payload,
          portraitRendered: [],
        },
        lastSummary: '角色定妆无需重新渲染，已直接复用现有资产。',
      };
    }

    const llm = LLMRegistry.get();
    const specsMap = await generateBatchVisualSpecs(llm, {
      style,
      characters: pendingCharacters,
      userFeedback,
      effectiveConstraints,
      projectId,
    });

    const renderResults = await asyncPoolSettled<any, CharacterSheetItem>(
      3,
      pendingCharacters,
      async (char: any) => {
        let visualPrompt = specsMap.get(char.name);
        if (!visualPrompt) {
          visualPrompt = `${char.appearance || char.name}，电影级高精度人物定妆照，${style}`;
        }
        return await renderFreshCharacter(projectId, char, visualPrompt, { isMock });
      }
    );

    const renderedCharacters: CharacterSheetItem[] = [];
    for (const r of renderResults) {
      if (r.status === 'fulfilled' && r.value) {
        renderedCharacters.push(r.value);
      } else {
        console.error('[portraitRenderStep] 渲染角色定妆失败:', r.reason);
      }
    }

    return {
      ...context,
      payload: {
        ...payload,
        portraitRendered: renderedCharacters,
      },
      lastSummary: `角色定妆渲染完成：成功渲染 ${renderedCharacters.length}/${pendingCharacters.length} 位角色。`,
    };
  },
});
