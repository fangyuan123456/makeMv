/**
 * agents/film-production/steps/lookdev-extract/step.ts
 * 定妆第一段 · 提取 (Lookdev Extract)：定下全剧角色 / 道具 / 场景长什么样
 *
 * 只调模型产文本，不出任何图。出图是下一步 lookdev-render 的事。
 * 分开的理由：文字对了才值得花算力去画；文字改一句就重画一批图，代价完全不对等。
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { LLMProvider } from '../../../../llm/index.js';
import { runTaskRecordedStep } from '../../../../workflow-engine/TaskStore.js';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { generateStructured } from '../../../../utils/llm-diagnostics.js';
import { STAGE, TEXT_GAME_STEP } from '../../../../project-store/artifact-fs.js';
import { GlobalEntitiesSchema, type GlobalEntities } from '../../../../project-store/contracts/film-production/lookdev.js';
import { UniversalPrdSpecSchema } from '../../../../project-store/contracts/planner/index.js';
import {
  buildLookdevExtractSystemPrompt,
  buildLookdevExtractUserPrompt,
} from './prompt.js';

export const LookdevExtractInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识（母本说明书落盘用）'),
  title: z.string().describe('故事标题'),
  prd: UniversalPrdSpecSchema.describe('Step 4 通用策划案 PRD'),
  storyMarkdown: z.string().describe('Step 4 交付的按幕剧本全文 story.md，人物与道具以剧本里实际出现的为准'),
});

export type LookdevExtractInput = z.infer<typeof LookdevExtractInputSchema>;

export const LookdevExtractOutputSchema = z.object({
  entities: GlobalEntitiesSchema.describe('角色 / 道具 / 场景字典（含定妆描述与生图提示词，尚未出图）'),
});

export type LookdevExtractOutput = z.infer<typeof LookdevExtractOutputSchema>;

export function createConceptArtDirectorAgent(): Agent {
  return new Agent({
    name: 'concept-art-director-agent',
    instructions: buildLookdevExtractSystemPrompt(),
    model: LLMProvider.getModel(),
  });
}

/** 模型没给结果时的兜底：至少保证有主角一条，不让后续出图空转 */
function buildFallbackEntities(input: LookdevExtractInput): GlobalEntities {
  const defaultArtStyle = `${
    input.prd.genre ? `${input.prd.genre}，` : ''
  }电影级写实光影质感，细节丰富，自然色彩影调`;
  return {
    artStyle: defaultArtStyle,
    characters: [
      {
        characterId: 'char_protagonist',
        name: '主角',
        identity: input.prd.playerIdentity,
        appearanceSummary: '符合当前故事设定的主角形象与日常服饰',
        promptZh: `角色定妆照，单人正面全身站姿，双脚着地，${input.prd.playerIdentity || '主角'}，五官清晰，贴合设定的日常服饰，纯中性浅灰无缝工作室背景，正面均匀柔光，低对比度，无硬边投影、无明显背景投影、无戏剧性阴影，画面中只有这一个人，无文字无标签无水印，${defaultArtStyle}`,
      },
    ],
    items: [],
    locations: [],
  };
}

export async function executeLookdevExtractStep(
  input: LookdevExtractInput,
  agent: Agent = createConceptArtDirectorAgent()
): Promise<LookdevExtractOutput> {
  const prompt = buildLookdevExtractUserPrompt(input);
  const object = await generateStructured({
    agent,
    prompt,
    schema: GlobalEntitiesSchema,
    stage: STAGE.textGame,
    step: TEXT_GAME_STEP.lookdevExtract,
    label: '定妆实体提取',
  });
  return { entities: object || buildFallbackEntities(input) };
}

export const lookdevExtractStep = createStep({
  id: 'lookdev-extract-step',
  inputSchema: LookdevExtractInputSchema,
  outputSchema: LookdevExtractOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = ctx.triggerData || ctx;
    const projectId = input.projectId || ctx.projectId;

    const result = await runTaskRecordedStep(
      'lookdev-extract-step',
      () =>
        executeLookdevExtractStep({
          projectId,
          title: input.title,
          prd: input.prd,
          storyMarkdown: input.storyMarkdown,
        }),
      {
        // 有描述但一条实体都没有 = 上轮没产干净，不能当缓存命中
        verifyCached: (cached) => {
          const entities = (cached as LookdevExtractOutput)?.entities;
          return Boolean(
            entities && (entities.characters?.length || entities.items?.length || entities.locations?.length)
          );
        },
      }
    );
    // Store is the only handoff boundary between film-production steps.
    ProjectStore.getInstance().setArtifact(projectId, 'lookdev_draft', result);
    return result;
  },
});

