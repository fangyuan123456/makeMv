/**
 * agents/director/generator/steps/scene-script/steps/expand-scenes.step.ts
 * 分场剧本第 2 阶段原子 Step：分场文学剧本分块批量推演与互动抉择生成
 */

import { createStep } from '@mastra/core/workflows';
import { WorkflowContextSchema, WorkflowContext } from '../../common.js';
import { LLMRegistry } from '../../../../../../llm/LLMRegistry.js';
import { expandSceneScriptBatch } from '../generator.js';
import type { ScriptSceneNode } from '../schema.js';

export const sceneScriptExpandStep = createStep({
  id: 'step-scene-script-expand',
  description: '调用大模型按拓扑分块扩写场景文学剧本、动作潜台词与互动抉择',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const context = inputData as WorkflowContext;
    const { projectId, payload } = context;
    const plan = payload?.sceneScriptPlan;

    if (!plan) {
      throw new Error('[sceneScriptExpandStep] 缺少前置剧本规划上下文 (sceneScriptPlan)');
    }

    const llm = LLMRegistry.get();
    const scenes: ScriptSceneNode[] = await expandSceneScriptBatch(llm, {
      projectId,
      title: plan.title,
      theme: plan.theme,
      characters: plan.characters,
      graphNodes: plan.graphNodes,
      userFeedback: plan.userFeedback,
      effectiveConstraints: plan.effectiveConstraints,
      chunkSize: 4,
    });

    return {
      ...context,
      payload: {
        ...payload,
        expandedScenes: scenes,
      },
      lastSummary: `分场文学剧本推演完成：成功扩写 ${scenes.length} 个核心场次。`,
    };
  },
});
