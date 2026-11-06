/**
 * agents/director/generator/steps/keyframe-reference/steps/render.step.ts
 * 关键帧首帧第 2 阶段原子 Step：批量生成提示词并渲染关键帧首帧
 */

import { createStep } from '@mastra/core/workflows';
import { WorkflowContextSchema, WorkflowContext } from '../../common.js';
import { LLMRegistry } from '../../../../../../llm/LLMRegistry.js';
import { asyncPoolSettled } from '../../../../../../utils/concurrency.js';
import { generateKeyframePromptsBatch, renderFreshKeyframe } from '../generator.js';
import type { KeyframeItem } from '../schema.js';

export const keyframeRenderStep = createStep({
  id: 'step-keyframe-render',
  description: '对待渲染分镜批量推演首帧视觉提示词并并发生成高保真基准图',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const context = inputData as WorkflowContext;
    const { projectId, payload } = context;
    const auditData = payload?.keyframeAudit;

    if (!auditData) {
      throw new Error('[keyframeRenderStep] 缺少前置核验上下文 (keyframeAudit)');
    }

    const {
      style,
      characterVisualSpecs,
      pendingShots,
      userFeedback,
      isMock,
    } = auditData;

    if (!pendingShots || pendingShots.length === 0) {
      return {
        ...context,
        payload: {
          ...payload,
          keyframeRendered: [],
        },
        lastSummary: '关键帧无需重新渲染，已直接复用现有资产。',
      };
    }

    const llm = LLMRegistry.get();
    const promptMetaMap = await generateKeyframePromptsBatch(llm, {
      style,
      characterVisualSpecs,
      shots: pendingShots,
      userFeedback,
      projectId,
    });

    const renderResults = await asyncPoolSettled<any, KeyframeItem>(
      3,
      pendingShots,
      async (shot: any) => {
        const meta = promptMetaMap.get(shot.shotId);
        let finalPrompt = meta?.prompt;
        if (!finalPrompt) {
          finalPrompt = `${shot.visualComposition || shot.actionDescription}，${style}`;
        }
        return await renderFreshKeyframe(projectId, shot, finalPrompt, meta, { isMock });
      }
    );

    const renderedKeyframes: KeyframeItem[] = [];
    for (const r of renderResults) {
      if (r.status === 'fulfilled' && r.value) {
        renderedKeyframes.push(r.value);
      } else {
        console.error('[keyframeRenderStep] 渲染分镜关键帧失败:', r.reason);
      }
    }

    return {
      ...context,
      payload: {
        ...payload,
        keyframeRendered: renderedKeyframes,
      },
      lastSummary: `关键帧首帧渲染完成：成功渲染 ${renderedKeyframes.length}/${pendingShots.length} 帧基准图。`,
    };
  },
});
