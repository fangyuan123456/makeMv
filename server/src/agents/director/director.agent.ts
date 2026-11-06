/**
 * agents/director/director.agent.ts
 * 基于 Mastra Agent 的 AI 视听总导演智能体 (Director Agent SSOT)
 * 
 * 核心架构特性：
 * 1. 唯一交互中枢：创作者自然语言统一面对总导演，单跳直出秒级打字，彻底消灭两连跳与延迟；
 * 2. 纯认知大脑：0 业务伪工具套娃，大模型直接输出剧情推演与 <intent> 协议；
 * 3. 动态状态机感知：通过 buildDirectorPrompt 注入当前项目的全景黑板工程状态。
 */

import { Agent } from '@mastra/core/agent';
import { LLMRegistry } from '../../llm/LLMRegistry.js';
import { buildDirectorPrompt } from './prompt.js';
import { emitDirectorIntentTool } from './tools/emit-director-intent.tool.js';

export function createDirectorAgent(projectId?: string, sessionId?: string): Agent {
  return new Agent({
    id: 'director-agent',
    name: 'director-agent',
    instructions: buildDirectorPrompt(projectId, sessionId),
    model: LLMRegistry.getLanguageModel(),
    tools: {
      emit_director_intent: emitDirectorIntentTool,
    },
  });
}

export const directorAgent = createDirectorAgent();
