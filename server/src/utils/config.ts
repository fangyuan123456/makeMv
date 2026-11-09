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
    provider: (process.env.LLM_PROVIDER || 'mock').toLowerCase(), // 'real' | 'mock'
    apiKey: process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY || '',
    baseURL: process.env.OPENAI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: process.env.LLM_MODEL || 'qwen-plus',
  },

  // 文生图 / 图生视频 / ComfyUI 配置
  comfyui: {
    baseUrl: process.env.COMFYUI_BASE_URL || process.env.IMAGE_BASE_URL || 'https://u1248922-be10-709e627c.westd.seetacloud.com:8443',
    timeoutMs: parseInt(process.env.COMFYUI_TIMEOUT_MS || '180000', 10),
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
