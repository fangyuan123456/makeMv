/**
 * agents/text-game/steps/entity-extract/step.ts
 * 全局角色一致性与道具字典提取工序 (entityExtractStep) - 基于 Mastra 官方微内核原生 Step
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { LLMProvider } from '../../../../llm/index.js';
import { runTaskRecordedStep } from '../../../../workflow-engine/TaskStore.js';
import { GlobalEntitiesSchema, type GlobalEntities } from '../../schema.js';
import { UniversalPrdSpecSchema } from '../../../planner/steps/prd-synthesis/schema.js';
import {
  buildEntityExtractSystemPrompt,
  buildEntityExtractUserPrompt,
} from './prompt.js';

export const EntityExtractInputSchema = z.object({
  title: z.string().describe('故事标题'),
  prd: UniversalPrdSpecSchema.describe('Step 4 通用策划案 PRD'),
  storyMarkdown: z.string().describe('Step 4 交付的按幕剧本全文 story.md，人物与道具以剧本里实际出现的为准'),
});

export type EntityExtractInput = z.infer<typeof EntityExtractInputSchema>;

export function createConceptArtDirectorAgent(): Agent {
  return new Agent({
    name: 'concept-art-director-agent',
    instructions: buildEntityExtractSystemPrompt(),
    model: LLMProvider.getModel(),
  });
}

export async function executeEntityExtractStep(
  input: EntityExtractInput,
  agent: Agent = createConceptArtDirectorAgent()
): Promise<GlobalEntities> {
  const prompt = buildEntityExtractUserPrompt(input);
  const response = await agent.generate(prompt, {
    output: GlobalEntitiesSchema,
  });

  const defaultArtStyle = `${input.prd.genre ? `${input.prd.genre}，电影级写实光影质感，细节丰富，自然色彩影调` : '电影级写实光影质感，细节丰富，自然色彩影调'}`;

  const parsed = response.object || {
    artStyle: defaultArtStyle,
    characters: [
      {
        characterId: 'char_protagonist',
        name: '主角',
        identity: input.prd.playerIdentity,
        appearanceSummary: '符合当前故事设定的主角形象与日常服饰',
        promptZh: `角色定妆照，单人正面全身站姿，双脚着地，${input.prd.playerIdentity || '主角'}，五官清晰，贴合设定的日常服饰，纯中性浅灰无缝工作室背景，画面中只有这一个人，无文字无标签无水印，${defaultArtStyle}`,
        promptEn: `${input.prd.genre ? `${input.prd.genre} style, ` : ''}character turnaround front full-body look-dev portrait of ${input.prd.playerIdentity || 'protagonist'}, clean neutral light gray seamless studio background, single person, no text, no watermark`,
      },
    ],
    items: [],
  };

  return parsed;
}

export const entityExtractStep = createStep({
  id: 'entity-extract-step',
  inputSchema: EntityExtractInputSchema,
  outputSchema: GlobalEntitiesSchema,
  execute: async ({ context }) => {
    return await runTaskRecordedStep('entity-extract-step', async () => {
      const ctx = context as any;
      const input = ctx.triggerData || ctx;
      return await executeEntityExtractStep({
        title: input.title,
        prd: input.prd,
        storyMarkdown: input.storyMarkdown,
      });
    });
  },
});
