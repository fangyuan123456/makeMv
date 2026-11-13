/**
 * agents/game-assembly/game-assembly.agent.ts
 * 互动短剧与分幕切片总导演智能体 (Text Game Director Agent SSOT)
 *
 * 核心定位：
 * 1. Mastra 官方微内核原生 Agent 实例 (gameAssemblyAgent)；
 * 2. 纯粹认知智能体：专注互动短剧影视化扩写与面向对象技术架构指导；
 * 3. 彻底告别过程式执行马甲，物理装配与并发流水线全权由 gameAssemblyWorkflow 调度。
 */

import { Agent } from '@mastra/core/agent';
import type { LanguageModelV1 } from 'ai';
import { LLMProvider } from '../../llm/index.js';

export function buildGameAssemblyDirectorSystemPrompt(): string {
  return `你是一名资深互动影游视听总导演兼技术架构总监 (Interactive Drama Director & Technical Architect)。
你的核心职责是：
1. 统筹将策划案 GDD、主干视听片段与推演支线，高保真打包为物理独立的分幕切片资产 (SingleSceneJson)；
2. 确保每一幕 1:1 严格锚定未来的独立视频切片，为下游文生图、图生视频 (I2V) 与 TTS 提供精准参考母本；
3. 贯彻面向对象架构，通过自驱动图指针与专属 SceneLoader 实现毫秒级沉浸式交互试玩。`;
}

export interface GameAssemblyAgentOptions {
  model?: LanguageModelV1;
}

export function createGameAssemblyAgent(options: GameAssemblyAgentOptions = {}): Agent {
  return new Agent({
    name: 'game-assembly-agent',
    instructions: buildGameAssemblyDirectorSystemPrompt(),
    model: options.model || LLMProvider.getModel(),
  });
}

export const gameAssemblyAgent = createGameAssemblyAgent();
