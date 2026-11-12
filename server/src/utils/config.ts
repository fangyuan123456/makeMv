/**
 * utils/config.ts
 * 全局配置与物理路径解析器 (Configuration SSOT)
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// 物理锚定：严格基于当前文件物理路径解析 server 目录，杜绝受命令行 cwd 漂移影响
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverDir = path.resolve(__dirname, '../..');
const rootDir = path.resolve(serverDir, '..');

const rootEnv = path.join(rootDir, '.env');
const serverEnv = path.join(serverDir, '.env');

if (fs.existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
}
if (fs.existsSync(serverEnv)) {
  dotenv.config({ path: serverEnv, override: true });
}

export const config = {
  // 服务端口
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // 大模型集成配置
  llm: {
    provider: (process.env.LLM_PROVIDER || 'mock').toLowerCase(), // 'real' | 'openai' | 'mock'
    apiKey: process.env.LLM_API_KEY || process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY || '',
    baseURL: process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: process.env.LLM_MODEL || 'qwen-plus',
    // 是否启用推理模型的深度思考链。默认关闭：本项目产出物是长结构化文本/代码，
    // 关闭思考可把单步耗时压掉 50%+，且不显著影响结构化输出质量。
    // 需要更强推理时设 LLM_ENABLE_THINKING=true。
    enableThinking: (process.env.LLM_ENABLE_THINKING || 'false').toLowerCase() === 'true',
    // 全局后台批处理 LLM 并发池大小（交互式总导演对话走快车道不占此池）
    maxConcurrency: Math.max(1, parseInt(process.env.LLM_MAX_CONCURRENCY || '6', 10) || 6),
    // 单次真实 LLM 请求硬超时（毫秒），防止云端结构化推理异常卡死长期占用并发槽位
    timeoutMs: Math.max(5_000, parseInt(process.env.LLM_CALL_TIMEOUT_MS || '120000', 10) || 120_000),
  },

  // 文生图 / 图生视频 / ComfyUI 配置
  comfyui: {
    baseUrl: process.env.COMFYUI_BASE_URL || process.env.IMAGE_BASE_URL || 'https://u1248922-be10-709e627c.westd.seetacloud.com:8443',
    timeoutMs: parseInt(process.env.COMFYUI_TIMEOUT_MS || '300000', 10),
    // 单台 ComfyUI 实例并发执行槽位数（图像与视频共用同一地址池，默认单卡串行 1）
    maxConcurrency: Math.max(1, parseInt(process.env.COMFYUI_MAX_CONCURRENCY || '1', 10) || 1),
  },

  // 图像生成配置
  image: {
    provider: (process.env.IMAGE_PROVIDER || 'comfyui').toLowerCase(), // 'comfyui' | 'mock'
  },

  // 物理数据与项目工程存储路径
  paths: {
    root: serverDir,
    data: path.join(serverDir, 'data'),
    get projects(): string {
      const p =
        process.env.PROJECTS_DIR ||
        (process.env.NODE_ENV === 'test'
          ? path.join(serverDir, 'data', 'test_projects')
          : path.join(serverDir, 'data', 'projects'));
      if (!fs.existsSync(p)) {
        try {
          fs.mkdirSync(p, { recursive: true });
        } catch {}
      }
      return p;
    },
  },
};

// 确保存储目录物理就绪
try {
  fs.mkdirSync(config.paths.projects, { recursive: true });
} catch {}
