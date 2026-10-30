/**
 * llm/telemetry/ModelPricing.ts
 * 权威模型价格库与单价匹配器 (Model Pricing Registry)
 */

import { ModelPricing, CurrencyType } from './types.js';
import { BrandRouter } from '../BrandRouter.js';

export const DEFAULT_MODEL_PRICINGS: Record<string, ModelPricing> = {
  // DeepSeek 官方
  'deepseek-chat': { inputPerMillion: 1.0, outputPerMillion: 2.0, currency: 'CNY' },
  'deepseek-reasoner': { inputPerMillion: 4.0, outputPerMillion: 16.0, currency: 'CNY' },

  // 通义千问 Qwen
  'qwen3-max': { inputPerMillion: 20.0, outputPerMillion: 60.0, currency: 'CNY' },
  'qwen3.5-plus': { inputPerMillion: 0.8, outputPerMillion: 2.0, currency: 'CNY' },
  'qwen-max': { inputPerMillion: 20.0, outputPerMillion: 60.0, currency: 'CNY' },
  'qwen-plus': { inputPerMillion: 0.8, outputPerMillion: 2.0, currency: 'CNY' },
  'qwen-turbo': { inputPerMillion: 0.3, outputPerMillion: 0.6, currency: 'CNY' },
  'qwen-vl-max': { inputPerMillion: 20.0, outputPerMillion: 60.0, currency: 'CNY' },

  // 智谱 GLM
  'glm-5.2': { inputPerMillion: 1.0, outputPerMillion: 2.0, currency: 'CNY' },
  'glm-4.6': { inputPerMillion: 1.0, outputPerMillion: 2.0, currency: 'CNY' },

  // 月之暗面 Kimi
  'kimi-k2.6': { inputPerMillion: 12.0, outputPerMillion: 12.0, currency: 'CNY' },

  // Google Gemini
  'gemini-3.8-flash': { inputPerMillion: 0.15, outputPerMillion: 0.60, currency: 'USD' },
  'gemini-2.5-flash': { inputPerMillion: 0.15, outputPerMillion: 0.60, currency: 'USD' },

  // OpenAI
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10.0, currency: 'USD' },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6, currency: 'USD' },
  'o1': { inputPerMillion: 15.0, outputPerMillion: 60.0, currency: 'USD' },
  'o1-mini': { inputPerMillion: 3.0, outputPerMillion: 12.0, currency: 'USD' },

  // Anthropic Claude
  'claude-3-5-sonnet': { inputPerMillion: 3.0, outputPerMillion: 15.0, currency: 'USD' },
  'claude-3-5-haiku': { inputPerMillion: 0.8, outputPerMillion: 4.0, currency: 'USD' },
  'claude-3-opus': { inputPerMillion: 15.0, outputPerMillion: 75.0, currency: 'USD' },

  // 默认兜底价格 (按主流普惠模型对齐)
  'default': { inputPerMillion: 1.0, outputPerMillion: 2.0, currency: 'CNY' },
};

export class ModelPricingRegistry {
  /**
   * 权威解析指定模型的输入输出单价 (单一事实来源 SSOT)
   */
  public static resolvePricing(modelName?: string): ModelPricing {
    if (process.env.MODEL_INPUT_PRICE_PER_M && process.env.MODEL_OUTPUT_PRICE_PER_M) {
      const currency = (process.env.MODEL_PRICE_CURRENCY as CurrencyType) || 'CNY';
      return {
        inputPerMillion: parseFloat(process.env.MODEL_INPUT_PRICE_PER_M),
        outputPerMillion: parseFloat(process.env.MODEL_OUTPUT_PRICE_PER_M),
        currency,
      };
    }

    try {
      const endpoint = BrandRouter.resolve(modelName);
      if (endpoint?.pricing) {
        return endpoint.pricing;
      }
    } catch {
      // 容错降级
    }

    if (!modelName) {
      return DEFAULT_MODEL_PRICINGS['default'];
    }

    const clean = modelName.toLowerCase().trim();

    if (DEFAULT_MODEL_PRICINGS[clean]) {
      return DEFAULT_MODEL_PRICINGS[clean];
    }

    for (const [key, pricing] of Object.entries(DEFAULT_MODEL_PRICINGS)) {
      if (key !== 'default' && (clean.includes(key) || key.includes(clean))) {
        return pricing;
      }
    }

    if (clean.includes('deepseek')) return DEFAULT_MODEL_PRICINGS['deepseek-chat'];
    if (clean.includes('qwen')) return DEFAULT_MODEL_PRICINGS['qwen3.5-plus'];
    if (clean.includes('glm')) return DEFAULT_MODEL_PRICINGS['glm-5.2'];
    if (clean.includes('kimi')) return DEFAULT_MODEL_PRICINGS['kimi-k2.6'];
    if (clean.includes('gemini')) return DEFAULT_MODEL_PRICINGS['gemini-3.8-flash'];
    if (clean.includes('gpt-4')) return DEFAULT_MODEL_PRICINGS['gpt-4o'];
    if (clean.includes('claude')) return DEFAULT_MODEL_PRICINGS['claude-3-5-sonnet'];

    return DEFAULT_MODEL_PRICINGS['default'];
  }

  /**
   * 计算指定 Token 消耗的具体花费
   */
  public static calculateCost(
    promptTokens: number,
    completionTokens: number,
    modelName?: string
  ): { cost: number; currency: CurrencyType } {
    const pricing = this.resolvePricing(modelName);
    const inputCost = (promptTokens / 1_000_000) * pricing.inputPerMillion;
    const outputCost = (completionTokens / 1_000_000) * pricing.outputPerMillion;
    const totalCost = Number((inputCost + outputCost).toFixed(6));
    return {
      cost: totalCost,
      currency: pricing.currency,
    };
  }
}
