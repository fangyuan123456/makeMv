/**
 * utils/config.ts
 * 全局运行环境与路径探测配置 (SSOT)
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 自动定位 .env 文件（无论从项目根目录还是 server/ 目录启动）
const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'server', '.env'),
  path.resolve(__dirname, '../../.env'),
];
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

function findServerDir(): string {
  if (fs.existsSync(path.resolve(process.cwd(), 'server', 'data')) || fs.existsSync(path.resolve(process.cwd(), 'server', 'package.json'))) {
    return path.resolve(process.cwd(), 'server');
  }
  if (fs.existsSync(path.resolve(process.cwd(), 'data'))) {
    return process.cwd();
  }
  return path.resolve(__dirname, '../../');
}

const serverDir = findServerDir();

function findFFmpeg(): string {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }

  const candidatePaths = [
    path.join(serverDir, '_tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe'),
    path.join(serverDir, '../_tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe'),
    'E:\\tools\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe',
    'ffmpeg',
  ];

  for (const candidate of candidatePaths) {
    if (candidate === 'ffmpeg') return 'ffmpeg';
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return 'ffmpeg';
}

export const config = {
  port: parseInt(process.env.PORT || '8000', 10),
  host: process.env.HOST || '127.0.0.1',
  mockMode: process.env.MOCK_MODE === 'true',

  // 大语言模型 (LLM)
  llm: {
    provider: process.env.LLM_PROVIDER || 'openai',
    baseUrl: process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'qwen-plus',
  },

  // 文生图模型 (Image)
  image: {
    provider: process.env.IMAGE_PROVIDER || 'mock',
    baseUrl: process.env.IMAGE_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1',
    apiKey: process.env.IMAGE_API_KEY || '',
    model: process.env.IMAGE_MODEL || 'wanx2.1-t2i-turbo',
    qualityLevel: (process.env.IMAGE_QUALITY_LEVEL || 'fast') as 'fast' | 'balanced' | 'high',
    maxKb: parseInt(process.env.IMAGE_MAX_KB || '100', 10),
  },

  // 视频生成模型 (Video)
  video: {
    provider: process.env.VIDEO_PROVIDER || 'mock',
    baseUrl: process.env.VIDEO_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1',
    apiKey: process.env.VIDEO_API_KEY || '',
    model: process.env.VIDEO_MODEL || 'wanx2.1-i2v-turbo',
    qualityLevel: (process.env.VIDEO_QUALITY_LEVEL || 'fast') as 'fast' | 'balanced' | 'high',
    resolution: (process.env.VIDEO_RESOLUTION || '480P') as '480P' | '720P' | '1080P',
    maxMb: parseFloat(process.env.VIDEO_MAX_MB || '1.5'),
    crf: parseInt(process.env.VIDEO_CRF || '32', 10),
  },

  // 本地数据与项目资产存储路径
  paths: {
    root: serverDir,
    data: path.join(serverDir, 'data'),
    projects: path.join(serverDir, 'data', 'projects'),
    ffmpeg: findFFmpeg(),
  },
};

// 确保核心数据目录已创建
fs.mkdirSync(config.paths.projects, { recursive: true });
