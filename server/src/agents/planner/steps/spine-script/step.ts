/**
 * agents/planner/steps/spine-script/step.ts
 * 黄金主干剧本工序 (writeSpineScriptStep) - 基于 Mastra 官方微内核原生 Step
 *
 * 彻底纯净化：零 projectId 基础设施污染！
 * 纯粹函数：输入创意 prompt ➔ 输出黄金主干剧本。
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { LLMProvider } from '../../../../llm/index.js';
import { runTaskRecordedStep } from '../../../../workflow-engine/TaskStore.js';
import { generateStructured } from '../../../../utils/llm-diagnostics.js';
import { STAGE, PLANNER_STEP } from '../../../../project-store/artifact-fs.js';
import {
  SpineScriptInputSchema,
  SpineScriptOutputSchema,
  type SpineScriptInput,
  type SpineScriptOutput,
} from './schema.js';
import {
  buildSpineScriptSystemPrompt,
  buildSpineScriptUserPrompt,
} from './prompt.js';

const SpineScriptStructuredOutputSchema = z.object({
  title: z.string().describe('短剧中文标题'),
  spineScript: z.string().describe('纯粹连贯的黄金主干剧情 Markdown 正文'),
});

/**
 * 创建专职编剧 Agent
 */
export function createScreenwriterAgent(): Agent {
  return new Agent({
    name: 'screenwriter-agent',
    instructions: buildSpineScriptSystemPrompt(),
    model: LLMProvider.getModel(),
  });
}

/**
 * 执行黄金主干剧本生成：纯粹认知计算，只专注好故事
 */
export async function executeWriteSpineScriptStep(
  input: SpineScriptInput,
  agent: Agent = createScreenwriterAgent()
): Promise<SpineScriptOutput> {
  const { userPrompt, userToneOrPreference } = input;

  // 1. 调用专职编剧 Agent 纯粹生成黄金主干短剧
  const prompt = buildSpineScriptUserPrompt({ userPrompt, userToneOrPreference });
  const parsed = await generateStructured({
    agent,
    prompt,
    schema: SpineScriptStructuredOutputSchema,
    stage: STAGE.planner,
    step: PLANNER_STEP.spine,
    label: '主干剧本生成',
  });

  return {
    title: parsed.title,
    spineScript: parsed.spineScript,
  };
}

/**
 * Mastra 官方原生 Step 实例
 */
export const writeSpineScriptStep = createStep({
  id: 'write-spine-script',
  description: '撰写 3~5 分钟纯连贯黄金主干短剧剧本 (Spine Script)',
  inputSchema: SpineScriptInputSchema,
  outputSchema: SpineScriptOutputSchema,
  execute: async ({ context }) => {
    return await runTaskRecordedStep('write-spine-script', async () => {
      const ctx = (context as any) || {};
      const userPrompt = ctx.userPrompt || ctx.triggerData?.userPrompt || '';
      const userToneOrPreference =
        ctx.userToneOrPreference || ctx.triggerData?.userToneOrPreference;
      return await executeWriteSpineScriptStep({ userPrompt, userToneOrPreference });
    });
  },
});
