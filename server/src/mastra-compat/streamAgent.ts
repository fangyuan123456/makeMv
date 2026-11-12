/**
 * mastra-compat/streamAgent.ts
 * 为 @mastra/core@0.2.0 的 Agent 补齐分步 toolChoice 控制 (`experimental_prepareStep`)、
 * Tool 参数自动自愈 (`experimental_repairToolCall`) 与流式 JSON 抢救中间件，
 * 同时提供严格交替的多轮对话历史清洗器 `buildWorkingDialogueTurns`。
 */

import type { Agent } from '@mastra/core/agent';
import {
  streamText,
  wrapLanguageModel,
  type CoreMessage,
  type LanguageModelV1,
  type LanguageModelV1Middleware,
  type ToolCallRepairFunction,
  type ToolSet,
} from 'ai';
import { JsonSanitizer } from '../utils/JsonSanitizer.js';
import { toolCallJsonHealingMiddleware } from './jsonHealing.js';

export type StepToolChoice = 'auto' | 'required' | 'none';

export interface CompatAgentStreamOptions {
  model?: LanguageModelV1;
  maxSteps?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
  prepareStep?: (ctx: { stepNumber: number; maxSteps: number }) => {
    toolChoice?: StepToolChoice;
    experimental_activeTools?: string[];
  };
  repairToolCall?: ToolCallRepairFunction<ToolSet>;
}

/**
 * 严格遵循大模型多轮消息三条铁律（吸收旧版 conversation.ts）：
 * 1. 过滤空白占位与非 user/assistant 角色；
 * 2. 去重尾部已携带的当前轮用户发言（防止客户端+服务端双发重复 user 消息）；
 * 3. 首条必须为 user，相邻同角色自动合并折叠，保证 user / assistant 严格交替。
 */
export function buildWorkingDialogueTurns(
  history: Array<{ role?: unknown; content?: unknown }> | undefined,
  currentMessage: string,
  maxTurns: number = 12
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const cleanCurrent = (currentMessage || '').trim();
  const validHistory = (history || [])
    .filter(
      (m): m is { role: 'user' | 'assistant'; content: string } =>
        Boolean(m) &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim().length > 0
    )
    .map((m) => ({
      role: m.role,
      content: m.content.trim(),
    }));

  // 客户端乐观更新若把本轮 userMsg 一起放进了 history，此处去重避免连发两条相同 user
  while (
    validHistory.length > 0 &&
    validHistory[validHistory.length - 1].role === 'user' &&
    validHistory[validHistory.length - 1].content === cleanCurrent
  ) {
    validHistory.pop();
  }

  const combined = cleanCurrent
    ? [...validHistory, { role: 'user' as const, content: cleanCurrent }]
    : validHistory;

  if (combined.length === 0) {
    return [{ role: 'user', content: '请根据当前项目进展继续推进' }];
  }

  let windowed = combined.slice(-Math.max(1, maxTurns));
  const firstUserIdx = windowed.findIndex((m) => m.role === 'user');
  if (firstUserIdx > 0) {
    windowed = windowed.slice(firstUserIdx);
  } else if (firstUserIdx === -1) {
    windowed = [{ role: 'user', content: cleanCurrent || '请根据当前项目进展继续推进' }, ...windowed];
  }

  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const msg of windowed) {
    const last = turns[turns.length - 1];
    if (last && last.role === msg.role) {
      last.content = `${last.content}\n\n${msg.content}`;
    } else {
      turns.push({ ...msg });
    }
  }

  return turns;
}

function buildDefaultToolCallRepair(rawTools: Record<string, any>): ToolCallRepairFunction<ToolSet> {
  return async ({ toolCall }) => {
    const compatTool = rawTools?.[toolCall.toolName];
    const targetSchema = compatTool?._cleanedInputSchema || compatTool?.inputSchema;
    if (!targetSchema) return null;

    try {
      const parsed = JsonSanitizer.extractJsonFromText<Record<string, any>>(toolCall.args || '{}');
      const normalized = JsonSanitizer.sanitizeAndNormalize<Record<string, any>>(parsed, targetSchema);
      const checked = targetSchema.safeParse(normalized);
      if (checked.success) {
        console.warn(`[mastra-compat] experimental_repairToolCall 已修复工具 [${toolCall.toolName}] 参数`);
        return {
          ...toolCall,
          args: JSON.stringify(checked.data),
        };
      }
      // 尝试用最小安全默认值补齐，确保 AI SDK 不会因校验失败阻断后续流式吐字
      const fallbackObj = {
        action: 'propose_stage',
        summary: typeof normalized?.summary === 'string' && normalized.summary.trim() ? normalized.summary : '推进当前工序',
        payload: typeof normalized?.payload === 'object' ? normalized.payload : {},
        ...normalized,
      };
      const fallbackCheck = targetSchema.safeParse(fallbackObj);
      if (fallbackCheck.success) {
        console.warn(`[mastra-compat] experimental_repairToolCall 已兜底修复工具 [${toolCall.toolName}] 参数`);
        return {
          ...toolCall,
          args: JSON.stringify(fallbackCheck.data),
        };
      }
      return {
        ...toolCall,
        args: JSON.stringify(normalized),
      };
    } catch {
      return null;
    }
  };
}

/**
 * 复用 Mastra Agent 自身的 instructions、tools 与 model，
 * 补齐 @mastra/core@0.2.0 缺失的 experimental_prepareStep、流式 JSON 抢救与工具参数自愈。
 */
export function streamAgentWithCompat(
  agent: Agent,
  messages: CoreMessage[],
  options: CompatAgentStreamOptions = {}
) {
  const baseModel = options.model || (agent.model as LanguageModelV1);
  if (!baseModel) {
    throw new Error(`[mastra-compat/streamAgent] Agent [${agent.name}] 缺少有效 LanguageModelV1`);
  }

  const rawTools = (agent.tools || {}) as Record<string, any>;
  const aiTools = agent.convertTools({}) as ToolSet;
  const maxSteps = options.maxSteps ?? 5;

  const middlewares: LanguageModelV1Middleware[] = [toolCallJsonHealingMiddleware];
  if (options.prepareStep) {
    const prepareStep = options.prepareStep;
    middlewares.push({
      middlewareVersion: 'v1',
      transformParams: async ({ params }) => {
        if (params.mode?.type !== 'regular') return params;
        const stepNumber = params.prompt.filter((m) => m.role === 'tool').length;
        const stepCfg = prepareStep({ stepNumber, maxSteps });
        if (!stepCfg?.toolChoice && !stepCfg?.experimental_activeTools) return params;

        const activeSet = stepCfg.experimental_activeTools
          ? new Set(stepCfg.experimental_activeTools)
          : null;
        const nextTools =
          activeSet && params.mode.tools
            ? params.mode.tools.filter((t) => activeSet.has(t.name))
            : params.mode.tools;

        const nextToolChoice =
          stepCfg.toolChoice === 'required'
            ? ({ type: 'required' } as const)
            : stepCfg.toolChoice === 'none'
              ? ({ type: 'none' } as const)
              : stepCfg.toolChoice === 'auto'
                ? ({ type: 'auto' } as const)
                : params.mode.toolChoice;

        return {
          ...params,
          mode: {
            ...params.mode,
            tools: nextTools,
            toolChoice: nextToolChoice,
          },
        };
      },
    });
  }

  const wrappedModel = wrapLanguageModel({
    model: baseModel,
    middleware: middlewares,
  });

  return streamText({
    model: wrappedModel,
    system: agent.instructions || undefined,
    messages,
    tools: aiTools,
    maxSteps,
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    experimental_repairToolCall: options.repairToolCall || buildDefaultToolCallRepair(rawTools),
  });
}
