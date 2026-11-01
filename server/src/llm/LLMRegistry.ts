/**
 * llm/LLMRegistry.ts
 * 全局大模型服务单例注册中心 (LLM Registry SSOT)
 */

import type { LLMService } from './LLMService.js';
import { LLMServiceFactory } from './LLMServiceFactory.js';

export class LLMRegistry {
  private static instance?: LLMService;

  public static get(): LLMService {
    if (!LLMRegistry.instance) {
      LLMRegistry.instance = LLMServiceFactory.create();
    }
    return LLMRegistry.instance;
  }

  public static set(service: LLMService): void {
    LLMRegistry.instance = service;
  }
}
