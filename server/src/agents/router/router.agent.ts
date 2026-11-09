/**
 * agents/router/router.agent.ts
 * 中枢路由总控智能体 (Router Agent) - 基于 Mastra 官方微内核 Agent 原生实现
 *
 * 核心定位：
 * 面向创作者的唯一官方对话门户，负责世界观推敲、审美启发与意图路由发射。
 */

import { Agent } from '@mastra/core/agent';
import type { LanguageModelV1 } from 'ai';
import { LLMProvider } from '../../llm/index.js';
import { buildRouterPrompt } from './prompt.js';
import { emitRouterIntentTool } from './tools/emit-intent.tool.js';

export function createRouterAgent(projectId?: string, model?: LanguageModelV1): Agent {
  return new Agent({
    name: 'router-agent',
    instructions: buildRouterPrompt(projectId),
    model: model || LLMProvider.getModel(),
    tools: {
      emit_router_intent: emitRouterIntentTool,
    },
  });
}

export const routerAgent = createRouterAgent();
