/**
 * llm/provider.ts
 * 模型工厂与驱动提供者 (LLM Provider SSOT)
 *
 * 核心职责：
 * 遵循 Mastra 官方微内核理念，专注于为 Agent 提供符合 LanguageModelV1 规范的模型硬件驱动。
 * 杜绝传统伪 Service 抽象层，达成最高代码信噪比。
 */

import type { LanguageModelV1 } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { MockLanguageModel } from './mock-model.js';
import { config } from '../utils/config.js';

export class LLMProvider {
  private static modelInstance: LanguageModelV1 | null = null;

  /**
   * 获取 Mastra 原生 Agent 所需的标准 LanguageModelV1 实例
   */
  public static getModel(): LanguageModelV1 {
    if (!this.modelInstance) {
      const isReal = config.llm.provider === 'real' && Boolean(config.llm.apiKey);
      if (isReal) {
        const baseURL = (config.llm.baseURL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '');
        console.log(`[LLMProvider] 挂载生产级商用模型 (LanguageModelV1): ${config.llm.model} (${baseURL})`);
        const openai = createOpenAI({
          baseURL,
          apiKey: config.llm.apiKey,
        });
        this.modelInstance = openai(config.llm.model || 'qwen-plus') as unknown as LanguageModelV1;
      } else {
        console.log(`[LLMProvider] 挂载离线确定性驱动 (MockLanguageModel)`);
        this.modelInstance = new MockLanguageModel();
      }
    }
    return this.modelInstance!;
  }

  /**
   * 允许在自动化测试用例中一键切换驱动
   */
  public static setMockModel(mock: LanguageModelV1): void {
    this.modelInstance = mock;
  }

  /**
   * 重置单例驱动
   */
  public static reset(): void {
    this.modelInstance = null;
  }
}
