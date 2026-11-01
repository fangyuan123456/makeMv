/**
 * llm/LLMServiceFactory.ts
 * LLM 服务工厂统一门面
 */

import { LLMService } from './LLMService.js';
import { RealLLMService } from './RealLLMService.js';
import { MockLLMService } from './MockLLMService.js';

export class LLMServiceFactory {
  public static create(customModelId?: string): LLMService {
    if (process.env.USE_MOCK_LLM === 'true') {
      return new MockLLMService();
    }
    return new RealLLMService(customModelId);
  }

  public static createMock(): MockLLMService {
    return new MockLLMService();
  }
}
