/**
 * BrandRouter.ts
 * 大模型品牌自适应路由中枢
 * 
 * 核心职责：
 * 依据 modelId 自动解析最适配的专属 BaseURL 与 APIKey，
 * 解决不同供应商（DeepSeek官方、Gemini专属组、Moonshot官方、统一网关）混用时的鉴权与 401 路由问题。
 */

export interface ResolvedEndpoint {
  brand: 'deepseek' | 'gemini' | 'moonshot' | 'qwen' | 'gateway';
  model: string;
  baseURL: string;
  apiKey: string;
  presetName?: string;
  pricing?: {
    inputPerMillion: number;
    outputPerMillion: number;
    currency: 'CNY' | 'USD';
  };
}

export interface ModelPreset {
  id: number;
  key: string;
  name: string;
  model: string;
  brand: 'deepseek' | 'gemini' | 'moonshot' | 'qwen' | 'gateway';
  baseURL?: string;
  apiKeyEnv?: string;
  pricing: {
    inputPerMillion: number;
    outputPerMillion: number;
    currency: 'CNY' | 'USD';
  };
  description: string;
}

/**
 * 🌟 全局统一大模型预设注册表 (SSOT Preset Catalog)
 */
export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: 1,
    key: 'deepseek',
    name: 'DeepSeek-V3 (官方国内直连)',
    model: 'deepseek-chat',
    brand: 'deepseek',
    baseURL: 'https://api.deepseek.com/v1',
    pricing: { inputPerMillion: 1.0, outputPerMillion: 2.0, currency: 'CNY' },
    description: '国内官方直连，速度 80~120 tokens/s，代码与长文本极强（默认推荐）'
  },
  {
    id: 2,
    key: 'deepseek-r1',
    name: 'DeepSeek-R1 (官方深度推理)',
    model: 'deepseek-reasoner',
    brand: 'deepseek',
    baseURL: 'https://api.deepseek.com/v1',
    pricing: { inputPerMillion: 4.0, outputPerMillion: 16.0, currency: 'CNY' },
    description: '官方深度思考模型，超强数理与逻辑推演'
  },
  {
    id: 3,
    key: 'qwen-max',
    name: '通义千问 Qwen3-Max (阿里旗舰)',
    model: 'qwen3-max',
    brand: 'gateway',
    pricing: { inputPerMillion: 20.0, outputPerMillion: 60.0, currency: 'CNY' },
    description: '阿里通义千问顶配主力大模型'
  },
  {
    id: 4,
    key: 'qwen-plus',
    name: '通义千问 Qwen3.5-Plus (阿里高速)',
    model: 'qwen3.5-plus',
    brand: 'gateway',
    pricing: { inputPerMillion: 0.8, outputPerMillion: 2.0, currency: 'CNY' },
    description: '高性价比平稳快速输出'
  },
  {
    id: 5,
    key: 'glm',
    name: '智谱 GLM-5.2 (清言主力)',
    model: 'glm-5.2',
    brand: 'gateway',
    pricing: { inputPerMillion: 1.0, outputPerMillion: 2.0, currency: 'CNY' },
    description: '智谱新一代高智能通用模型'
  },
  {
    id: 6,
    key: 'kimi',
    name: '月之暗面 Kimi-K2.6',
    model: 'kimi-k2.6',
    brand: 'gateway',
    pricing: { inputPerMillion: 12.0, outputPerMillion: 12.0, currency: 'CNY' },
    description: '月之暗面长上下文大模型'
  },
  {
    id: 7,
    key: 'siliconflow-v3',
    name: 'DeepSeek-V3 (硅基流动云端)',
    model: 'deepseek-ai/DeepSeek-V3',
    brand: 'gateway',
    baseURL: 'https://api.siliconflow.cn/v1',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    pricing: { inputPerMillion: 2.0, outputPerMillion: 8.0, currency: 'CNY' },
    description: '国内云端聚合平台，高并发'
  },
  {
    id: 8,
    key: 'gemini',
    name: 'Gemini 3.8 Flash (海外节点)',
    model: 'gemini-3.8-flash',
    brand: 'gemini',
    pricing: { inputPerMillion: 0.15, outputPerMillion: 0.60, currency: 'USD' },
    description: '海外 Google Flash 快速通道'
  }
];

export class BrandRouter {
  private static readonly DEEPSEEK_OFFICIAL_BASE = 'https://api.deepseek.com/v1';
  private static readonly MOONSHOT_OFFICIAL_BASE = 'https://api.moonshot.cn/v1';
  private static readonly OPENAI_DEFAULT_BASE = 'https://api.openai.com/v1';

  /**
   * 自动探测模型品牌
   */
  public static detectBrand(modelId: string): 'deepseek' | 'gemini' | 'moonshot' | 'qwen' | 'gateway' {
    const id = modelId.toLowerCase();
    if (id.startsWith('deepseek')) return 'deepseek';
    if (id.startsWith('gemini')) return 'gemini';
    if (id.startsWith('kimi') || id.startsWith('moonshot')) return 'moonshot';
    if (id.startsWith('qwen')) return 'qwen';
    return 'gateway';
  }

  /**
   * 解析模型对应的权威端点与 API Key (单源事实解析)
   */
  public static resolve(customModelId?: string): ResolvedEndpoint {
    let model = customModelId;
    let matchedPreset: ModelPreset | undefined;

    if (!model) {
      const indexOrKey = (process.env.MODEL_INDEX || process.env.MODEL_PRESET || '').trim();
      if (indexOrKey) {
        const parsedNum = parseInt(indexOrKey, 10);
        if (!isNaN(parsedNum)) {
          matchedPreset = MODEL_PRESETS.find((p) => p.id === parsedNum);
        }
        if (!matchedPreset) {
          matchedPreset = MODEL_PRESETS.find((p) => p.key.toLowerCase() === indexOrKey.toLowerCase());
        }
      }
      if (matchedPreset) {
        model = matchedPreset.model;
      }
    }

    if (!model) {
      model = process.env.LLM_MODEL || MODEL_PRESETS[0].model;
    }

    const brand = matchedPreset?.brand || this.detectBrand(model);

    if (brand === 'deepseek') {
      const baseURL = matchedPreset?.baseURL || process.env.DEEPSEEK_BASE_URL || this.DEEPSEEK_OFFICIAL_BASE;
      const apiKey = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || '';
      return {
        brand,
        model,
        baseURL: baseURL.replace(/\/+$/, ''),
        apiKey,
        presetName: matchedPreset?.name,
        pricing: matchedPreset?.pricing,
      };
    }

    if (brand === 'gemini') {
      const baseURL = matchedPreset?.baseURL || process.env.GEMINI_BASE_URL || process.env.LLM_BASE_URL || this.OPENAI_DEFAULT_BASE;
      const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY || '';
      return {
        brand,
        model,
        baseURL: baseURL.replace(/\/+$/, ''),
        apiKey,
        presetName: matchedPreset?.name,
        pricing: matchedPreset?.pricing,
      };
    }

    if (brand === 'moonshot') {
      const baseURL = matchedPreset?.baseURL || process.env.MOONSHOT_BASE_URL || this.MOONSHOT_OFFICIAL_BASE;
      const apiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || process.env.LLM_API_KEY || '';
      return {
        brand,
        model,
        baseURL: baseURL.replace(/\/+$/, ''),
        apiKey,
        presetName: matchedPreset?.name,
        pricing: matchedPreset?.pricing,
      };
    }

    if (brand === 'qwen') {
      const baseURL = matchedPreset?.baseURL || process.env.QWEN_BASE_URL || process.env.LLM_BASE_URL || this.OPENAI_DEFAULT_BASE;
      const apiKey = process.env.QWEN_API_KEY || process.env.LLM_API_KEY || '';
      return {
        brand,
        model,
        baseURL: baseURL.replace(/\/+$/, ''),
        apiKey,
        presetName: matchedPreset?.name,
        pricing: matchedPreset?.pricing,
      };
    }

    const baseURL = matchedPreset?.baseURL || process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || this.OPENAI_DEFAULT_BASE;
    const apiKey = (matchedPreset?.apiKeyEnv && process.env[matchedPreset.apiKeyEnv])
      || process.env.LLM_API_KEY
      || process.env.OPENAI_API_KEY
      || '';
    return {
      brand,
      model,
      baseURL: baseURL.replace(/\/+$/, ''),
      apiKey,
      presetName: matchedPreset?.name,
      pricing: matchedPreset?.pricing,
    };
  }
}
