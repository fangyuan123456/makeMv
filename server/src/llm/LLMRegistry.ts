/**
 * llm/LLMRegistry.ts
 * 全局大模型服务与 LanguageModel 统一注册中心 (LLM Registry SSOT)
 * 
 * 核心机制：
 * 1. 统一管理 config.mockMode 与测试沙箱环境；
 * 2. 对外暴露高内聚的 get() 与 getLanguageModel()；
 * 3. 彻底根治各智能体绕过注册中心私自实例化外部 API 的硬编码行为。
 */

import { createOpenAI } from '@ai-sdk/openai';
import { MockLanguageModelV1, simulateReadableStream } from 'ai/test';
import type { LLMService } from './LLMService.js';
import { RealLLMService } from './RealLLMService.js';
import { MockLLMService } from './MockLLMService.js';
import { config } from '../utils/config.js';

export class LLMRegistry {
  private static instance?: LLMService;

  public static get(): LLMService {
    if (!LLMRegistry.instance) {
      if (process.env.USE_MOCK_LLM === 'true' || config.mockMode || process.env.NODE_ENV === 'test') {
        LLMRegistry.instance = new MockLLMService();
      } else {
        LLMRegistry.instance = new RealLLMService();
      }
    }
    return LLMRegistry.instance;
  }

  public static set(service: LLMService): void {
    LLMRegistry.instance = service;
  }

  public static reset(): void {
    LLMRegistry.instance = undefined;
  }

  /**
   * 获取符合当前运行环境 (真实百炼 vs 测试沙箱/离线Mock) 的统一 LanguageModel 配置 (供 Mastra Agent / AI SDK 消费)
   * 遵循 Mastra 微内核 OpenAI 兼容契约，使用 specificationVersion v2+ 标准
   */
  public static getLanguageModel(customModel?: string): any {
    const isMock = process.env.USE_MOCK_LLM === 'true' || config.mockMode || process.env.NODE_ENV === 'test';
    const hasValidKey = config.llm.apiKey && config.llm.apiKey !== 'placeholder-key';

    if (isMock && !hasValidKey) {
      const mockModel = new MockLanguageModelV1({
        defaultObjectGenerationMode: 'json',
        doGenerate: async () => ({
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 20 },
          text: '收到您的创作构想！作为总导演，我已为您准备好导演方案。',
        }),
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-delta', textDelta: '收到您的创作构想！' },
              { type: 'text-delta', textDelta: '作为总导演，我已为您准备好导演方案。' },
              { type: 'finish', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 20 } },
            ],
          }),
          rawCall: { rawPrompt: null, rawSettings: {} },
        }),
      });
      // 标记为 v2 以满足 Mastra stream()/generate() 现代模型校验门禁
      (mockModel as any).specificationVersion = 'v2';
      return mockModel;
    }

    // 返回符合 Mastra 官方微内核规范的 OpenAICompatibleConfig 对象
    // Mastra 内部自动将其装配为 ModelRouterLanguageModel (specificationVersion: 'v2')
    return {
      providerId: 'openai',
      modelId: customModel || config.llm.model || 'qwen-plus',
      url: config.llm.baseUrl,
      apiKey: config.llm.apiKey || 'placeholder-key',
    };
  }
}
