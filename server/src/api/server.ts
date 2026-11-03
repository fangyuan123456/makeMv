/**
 * api/server.ts
 * 现代 Agentic 微内核 HTTP 服务入口 (Server SSOT)
 * 职责：中间件装配、静态资产托管、控制器路由挂载、优雅启动
 */

import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import pc from 'picocolors';
import { config } from '../utils/config.js';
import { ProjectStore } from '../project-store/ProjectStore.js';
import {
  SkillRegistry,
  StoryBibleSkill,
  CharacterPortraitSkill,
  SceneScriptSkill,
  StoryboardSkill,
  KeyframeReferenceSkill,
  VideoProductionSkill,
  FmvPackagingSkill,
  CriticReviewSkill,
} from '../skills/index.js';
import {
  projectController,
  chatController,
  reviewerController,
  skillController,
} from './controllers/index.js';

export function createServer(): Hono {
  const app = new Hono();

  // 1. 跨域安全配置 (收紧至信任客户端与环境变量，防止公网网页恶意跨域窃取)
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8000', 'http://127.0.0.1:8000'];

  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin || allowedOrigins.includes(origin)) {
          return origin || allowedOrigins[0];
        }
        return null;
      },
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'Range'],
      exposeHeaders: ['Content-Range', 'Content-Length', 'Accept-Ranges'],
    })
  );

  // 2. 初始化注册全链路核心技能包
  const skillRegistry = SkillRegistry.getInstance();
  skillRegistry.register(new StoryBibleSkill());
  skillRegistry.register(new CharacterPortraitSkill());
  skillRegistry.register(new SceneScriptSkill());
  skillRegistry.register(new StoryboardSkill());
  skillRegistry.register(new KeyframeReferenceSkill());
  skillRegistry.register(new VideoProductionSkill());
  skillRegistry.register(new FmvPackagingSkill());
  skillRegistry.register(new CriticReviewSkill());

  // 3. 静态本地资产文件服务 (/media/:projectId/...)
  app.get('/media/:projectId/*', (c) => {
    const projectId = c.req.param('projectId');
    const relativePath = c.req.path.replace(`/media/${projectId}/`, '');
    const projectDir = path.resolve(ProjectStore.getInstance().getProjectDir(projectId));
    const fullPath = path.resolve(projectDir, relativePath);

    // 🌟 严格边界安全检查：必须以 projectDir + path.sep 开头，杜绝兄弟前缀 (proj_x vs proj_x_backup) 穿越
    if (!fullPath.startsWith(projectDir + path.sep) && fullPath !== projectDir) {
      return c.text('Forbidden: Access denied', 403);
    }

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      return c.text('Media not found', 404);
    }

    const ext = path.extname(fullPath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.json': 'application/json',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const stat = fs.statSync(fullPath);
    const fileSize = stat.size;

    // 🌟 支持视频 Range 分片与非阻塞流式管道，消灭 readFileSync 阻塞 Node 主线程事件循环
    const range = c.req.header('range');
    if (range && contentType.startsWith('video/')) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const fileStream = fs.createReadStream(fullPath, { start, end });
      const webStream = Readable.toWeb(fileStream);

      return new Response(webStream as any, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunksize),
          'Content-Type': contentType,
        },
      });
    }

    const fileStream = fs.createReadStream(fullPath);
    const webStream = Readable.toWeb(fileStream);
    return new Response(webStream as any, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileSize),
        'Accept-Ranges': 'bytes',
      },
    });
  });

  // 4. 挂载领域控制器路由 (Controllers Mount)
  app.route('/', projectController);
  app.route('/', chatController);
  app.route('/', reviewerController);
  app.route('/', skillController);

  // 5. 系统配置与健康检查 (敏感凭据 100% 脱敏，杜绝明文泄露)
  app.get('/api/config', (c) => {
    const safeConfig = {
      port: config.port,
      host: config.host,
      mockMode: config.mockMode,
      llm: {
        provider: config.llm.provider,
        baseUrl: config.llm.baseUrl,
        model: config.llm.model,
        hasApiKey: Boolean(config.llm.apiKey),
      },
      image: {
        provider: config.image.provider,
        baseUrl: config.image.baseUrl,
        model: config.image.model,
        qualityLevel: config.image.qualityLevel,
        maxKb: config.image.maxKb,
        hasApiKey: Boolean(config.image.apiKey),
      },
      video: {
        provider: config.video.provider,
        baseUrl: config.video.baseUrl,
        model: config.video.model,
        qualityLevel: config.video.qualityLevel,
        resolution: config.video.resolution,
        maxMb: config.video.maxMb,
        crf: config.video.crf,
        hasApiKey: Boolean(config.video.apiKey),
      },
      comfyui: {
        baseUrl: config.comfyui.baseUrl,
        timeoutMs: config.comfyui.timeoutMs,
      },
    };
    return c.json({ success: true, config: safeConfig });
  });
  app.get('/health', (c) => c.json({ status: 'ok', time: Date.now() }));
  app.get('/api/system/status', (c) => c.json({ status: 'ok', time: Date.now() }));

  return app;
}

export function startServer(port: number = config.port) {
  const app = createServer();
  console.log(pc.cyan(`\n🎬 [FMV-Agent] 启动现代化 Agentic 微内核服务器...`));
  console.log(pc.gray(`--------------------------------------------------`));
  console.log(pc.green(`✔ Server listening on: http://${config.host}:${port}`));
  console.log(pc.yellow(`ℹ Architecture Mode: Node 单进程内存黑板 + 原子磁盘持久化 (多副本需单写节点)`));
  console.log(pc.gray(`--------------------------------------------------\n`));

  return serve({
    fetch: app.fetch,
    port,
  });
}
