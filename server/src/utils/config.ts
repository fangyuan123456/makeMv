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
    // 单次 LLM 调用超时。全量生成工序（如叙事架构分支图谱）动辄输出数千 token 的长 JSON，
    // 72B 级模型 3 分钟内可能吐不完——默认放宽到 5 分钟，可用 LLM_TIMEOUT_MS 环境变量覆盖。
    timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '300000', 10),
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

  // ComfyUI 本地/云端机床专属配置 (ComfyUI Provider SSOT)
  comfyui: {
    baseUrl: process.env.COMFYUI_BASE_URL || process.env.IMAGE_BASE_URL || 'https://u1248922-be10-709e627c.westd.seetacloud.com:8443',
    timeoutMs: parseInt(process.env.COMFYUI_TIMEOUT_MS || '180000', 10),
  },

  // 影视生产流水线编排与人在回路策略 (Workflow Orchestration & Approval Policy)
  workflow: {
    // 是否需要人工在前端点击确认卡片才启动工作流 (架构诚实铁律：杜绝黑盒静默烧卡)
    // 默认行为：
    // - 测试环境: 默认 true (严格验证卡片状态机)
    // - 生产日常: 默认严格保护高昂算力工序 ['keyframe-reference', 'video-production', 'character-portrait']，必须由创作者明确授权后方可执行渲染
    // 环境变量显式覆盖：
    // - WORKFLOW_REQUIRE_CONFIRMATION="true":  全流程所有 8 大工序一律强制人工确认
    // - WORKFLOW_REQUIRE_CONFIRMATION="false": 极速全自动直通模式 (创作者主动放弃人工把关)
    // - WORKFLOW_REQUIRE_CONFIRMATION="a,b,c": 自定义需确认的工序清单
    get requireConfirmation(): boolean | string[] {
      const envVal = process.env.WORKFLOW_REQUIRE_CONFIRMATION?.trim();
      if (envVal === 'false') return false;
      if (envVal === 'true') return true;
      if (envVal) {
        try {
          const parsed = JSON.parse(envVal);
          if (Array.isArray(parsed)) return parsed;
        } catch {}
        if (envVal.includes(',')) {
          return envVal.split(',').map((s) => s.trim()).filter(Boolean);
        }
      }
      // 核心法典约束：影视生产 8 大主工序推进默认全面开启人在回路 (Human-in-the-Loop) 授权
      // 而 Step 内部的微观子工作流 (Micro Sub-Workflows，如 subwf-*) 属于原子算力闭环，一律全自动执行，绝不触发人工确认
      return true;
    },
  },

  // 本地数据与项目资产存储路径
  paths: {
    root: serverDir,
    data: path.join(serverDir, 'data'),
    // 隔离测试沙箱与自定义目录覆盖：动态响应 NODE_ENV === 'test'
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
    ffmpeg: findFFmpeg(),
  },
};

// 确保核心数据目录已创建
fs.mkdirSync(config.paths.projects, { recursive: true });
