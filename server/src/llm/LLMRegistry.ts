/**
 * llm/LLMRegistry.ts
 * 全局大模型服务单例注册中心 (LLM Registry SSOT)
 */

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
}
