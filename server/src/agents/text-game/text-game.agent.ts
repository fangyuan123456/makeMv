/**
 * agents/text-game/text-game.agent.ts
 * 互动文游 Pi Agent 核心智能体与自主推演执行器 (Pi Game Agent SSOT)
 *
 * 核心定位：
 * 吸收 GamePilot Pi Agent 哲学，采用自主决策循环 + 4 个高内聚原子工具，
 * 专注从策划 PRD (gdd.md) 闭环推演并交付高品质图文交互游戏。
 */

import { Agent } from '@mastra/core/agent';
import type { LanguageModelV1 } from 'ai';
import { LLMProvider } from '../../llm/index.js';
import type { GDDArtifact } from '../planner/schema.js';
import { TextGameArtifactSchema, type TextGameArtifact } from './schema.js';
import { TEXT_GAME_SYSTEM_PROMPT, buildTextGameUserPrompt } from './prompt.js';
import {
  writeGameNodeTool,
  auditGameGraphTool,
  simulateTestPlayTool,
  submitGameDeliveryTool,
} from './tools/index.js';
import { TextGameDraftRegistry } from './draft-store.js';

/**
 * 构建高内聚文游 Pi Agent 实例 (挂载专属外挂建造工具)
 */
export function createTextGameAgent(model?: LanguageModelV1): Agent {
  return new Agent({
    name: 'text-game-agent',
    instructions: TEXT_GAME_SYSTEM_PROMPT,
    model: model || LLMProvider.getModel(),
    tools: {
      writeGameNodeTool,
      auditGameGraphTool,
      simulateTestPlayTool,
      submitGameDeliveryTool,
    },
  });
}

export const textGameAgent = createTextGameAgent();

/**
 * 文游 Pi Agent 核心推演函数：基于自主决策工具循环与双重交付兜底
 */
export async function writeTextGameWithAgent(
  gdd: GDDArtifact | string,
  agent: Agent = textGameAgent,
  customSessionId?: string,
): Promise<TextGameArtifact> {
  const sessionId = customSessionId || `session_pi_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const session = TextGameDraftRegistry.getOrCreate(sessionId);

  // 设置初始默认标题
  if (typeof gdd === 'object' && gdd.title) {
    session.title = gdd.title;
  }

  const prompt = buildTextGameUserPrompt(gdd, sessionId);

  try {
    // 启动 Mastra Agent 原生自主推演循环 (支持工具多轮调用自检与结构化收敛)
    const result = await agent.generate(prompt, {
      maxSteps: 15,
      output: TextGameArtifactSchema,
    });

    // 优先返回通过工具正式提交定稿的实体
    if (session.deliveredArtifact) {
      return session.deliveredArtifact;
    }

    // 其次若草稿中存在通过工具已录入的节点，导出草稿
    if (session.nodes.size > 0) {
      return session.toArtifact();
    }

    // 最后兼容单跳结构化对象返回 (如离线 Mock 模式)
    if (result.object) {
      return result.object as TextGameArtifact;
    }

    throw new Error(`[TextGameAgent] Pi Agent 执行结束但未能交付有效的图文游戏产物`);
  } finally {
    // 清理本次内存建造沙箱，杜绝内存泄漏
    TextGameDraftRegistry.remove(sessionId);
  }
}
