/**
 * agents/film-production/film-production.agent.ts
 * 影游转译智能体 (Film Adapter Agent) - 基于 Mastra 官方微内核 Agent 原生实现
 *
 * 核心定位：
 * 消费经过可玩性验证的文游，转译编译为包含景别、中英文生图/生视频 Prompt、音效台词与顺向转场锚点的影视资产切片清单。
 */

import { Agent } from '@mastra/core/agent';
import type { LanguageModelV1 } from 'ai';
import type { GlobalEntities } from '../../project-store/contracts/film-production/lookdev.js';
import type { FilmAdapterArtifact } from './schema.js';
import { generateStoryboard, createStoryboardAgent } from './steps/storyboard/agent.js';

export function createFilmAdapterAgent(model?: LanguageModelV1): Agent {
  return createStoryboardAgent(model);
}

export const filmAdapterAgent = createFilmAdapterAgent();

/**
 * 影游转译智能体核心编译函数：基于 Mastra Agent 原生结构化输出
 */
export async function adaptFilmWithAgent(
  textGame: { title: string; prd: unknown; storyMarkdown?: string },
  entitiesOrAgent?: GlobalEntities | Agent,
  maybeAgent: Agent = filmAdapterAgent,
): Promise<FilmAdapterArtifact> {
  // Legacy structural adapter retained without importing another agent's contract.
  const entities = entitiesOrAgent instanceof Agent ? undefined : entitiesOrAgent;
  const agent = entitiesOrAgent instanceof Agent ? entitiesOrAgent : maybeAgent;
  // Legacy structural adapter; production workflow uses ProjectStore-backed steps.
  return generateStoryboard(
    {
      title: textGame.title,
      prd: (textGame as any).prd,
      storyMarkdown: (textGame as any).storyMarkdown || '',
      entities,
    },
    agent
  );
}
