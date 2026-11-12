/**
 * agents/router/router.agent.ts
 * 中枢路由总控智能体 (Router Agent) - 基于 Mastra 官方微内核 Agent + mastra-compat 原生实现
 *
 * 核心定位：
 * 面向创作者的唯一官方对话门户，负责世界观推敲、审美启发与意图路由发射。
 */

import { Agent } from '@mastra/core/agent';
import type { CoreMessage, LanguageModelV1 } from 'ai';
import { LLMProvider } from '../../llm/index.js';
import { streamAgentWithCompat } from '../../mastra-compat/index.js';
import { buildRouterPrompt } from './prompt.js';
import {
  createRouterIntentTool,
  type RouterDialogueTurn,
  type RouterIntentToolContext,
} from './tools/emit-intent.tool.js';

function extractTextContent(content: CoreMessage['content']): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (part && typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }
  return '';
}

/**
 * 从 CoreMessage 数组提取纯文本轮次与最近一条创作者消息，供意图工具内聚注入实时上下文
 */
export function extractDialogueContextFromMessages(messages: CoreMessage[]): {
  latestUserMessage?: string;
  dialogueTurns: RouterDialogueTurn[];
} {
  const dialogueTurns: RouterDialogueTurn[] = [];
  for (const msg of messages || []) {
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    const text = extractTextContent(msg.content);
    if (!text) continue;
    dialogueTurns.push({ role: msg.role, content: text });
  }
  const latestUser = [...dialogueTurns].reverse().find((t) => t.role === 'user');
  return {
    latestUserMessage: latestUser?.content,
    dialogueTurns,
  };
}

export function createRouterAgent(
  projectId?: string,
  model?: LanguageModelV1,
  toolContext?: RouterIntentToolContext
): Agent {
  const effectiveCtx: RouterIntentToolContext | undefined =
    toolContext || (projectId ? { projectId } : undefined);
  return new Agent({
    name: 'router-agent',
    instructions: buildRouterPrompt(projectId),
    model: model || LLMProvider.getModel(),
    tools: {
      emit_router_intent: createRouterIntentTool(effectiveCtx),
    },
  });
}

export const routerAgent = createRouterAgent();

/**
 * 中枢路由总控多步流式推演入口：
 * 透过 mastra-compat 补齐 @mastra/core@0.2.0 缺失的按步 toolChoice 切换：
 * - step 0 强制 toolChoice='required'，100% 保证触发原生意图工具调用；
 * - step >= 1 回归 toolChoice='auto'，让模型依据工具返回结果流畅流式吐出正文回复。
 */
export function streamRouterDialogue(params: {
  projectId?: string;
  messages: CoreMessage[];
  model?: LanguageModelV1;
  abortSignal?: AbortSignal;
}) {
  const effectiveModel = params.model || LLMProvider.getModel();
  const { latestUserMessage, dialogueTurns } = extractDialogueContextFromMessages(params.messages);
  const agent = createRouterAgent(params.projectId, effectiveModel, {
    projectId: params.projectId,
    latestUserMessage,
    dialogueTurns,
  });
  return streamAgentWithCompat(agent, params.messages, {
    model: effectiveModel,
    maxSteps: 3,
    abortSignal: params.abortSignal,
    prepareStep: ({ stepNumber }) =>
      stepNumber === 0 ? { toolChoice: 'required' } : { toolChoice: 'auto' },
  });
}
