/**
 * agents/film-adapter/film-adapter.agent.ts
 * 影游转译智能体 (Film Adapter Agent) - 基于 Mastra 官方微内核 Agent 原生实现
 *
 * 核心定位：
 * 消费经过可玩性验证的文游，转译编译为包含景别、中英文生图/生视频 Prompt、音效台词与顺向转场锚点的影视资产切片清单。
 */

import { Agent } from '@mastra/core/agent';
import type { LanguageModelV1 } from 'ai';
import { LLMProvider } from '../../llm/index.js';
import type { TextGameArtifact } from '../text-game/schema.js';
import { FilmAdapterArtifactSchema, type FilmAdapterArtifact } from './schema.js';
import { FILM_ADAPTER_SYSTEM_PROMPT, buildFilmAdapterUserPrompt } from './prompt.js';

export function createFilmAdapterAgent(model?: LanguageModelV1): Agent {
  return new Agent({
    name: 'film-adapter-agent',
    instructions: FILM_ADAPTER_SYSTEM_PROMPT,
    model: model || LLMProvider.getModel(),
  });
}

export const filmAdapterAgent = createFilmAdapterAgent();

/**
 * 影游转译智能体核心编译函数：基于 Mastra Agent 原生结构化输出
 */
export async function adaptFilmWithAgent(
  textGame: TextGameArtifact,
  agent: Agent = filmAdapterAgent,
): Promise<FilmAdapterArtifact> {
  const prompt = buildFilmAdapterUserPrompt(textGame);
  const result = await agent.generate(prompt, {
    output: FilmAdapterArtifactSchema,
  });

  return result.object as FilmAdapterArtifact;
}
