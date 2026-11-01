/**
 * api/server.ts
 * 现代 Agentic 微内核 HTTP 服务入口 (Server SSOT)
 * 职责：中间件装配、静态资产托管、控制器路由挂载、优雅启动
 */

import fs from 'fs';
import path from 'path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import pc from 'picocolors';
import { config } from '../utils/config.js';
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

  // 1. 跨域支持
  app.use('*', cors());

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
    const fullPath = path.join(config.paths.projects, projectId, relativePath);

    if (fs.existsSync(fullPath)) {
      const ext = path.extname(fullPath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.mp4': 'video/mp4',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.json': 'application/json',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      const fileBuffer = fs.readFileSync(fullPath);
      return new Response(fileBuffer, { headers: { 'Content-Type': contentType } });
    }
    return c.text('Media not found', 404);
  });

  // 4. 挂载领域控制器路由 (Controllers Mount)
  app.route('/', projectController);
  app.route('/', chatController);
  app.route('/', reviewerController);
  app.route('/', skillController);

  // 5. 系统配置与健康检查
  app.get('/api/config', (c) => c.json({ success: true, config }));
  app.get('/health', (c) => c.json({ status: 'ok', time: Date.now() }));
  app.get('/api/system/status', (c) => c.json({ status: 'ok', time: Date.now() }));

  return app;
}

export function startServer(port: number = config.port) {
  const app = createServer();
  console.log(pc.cyan(`\n🎬 [FMV-Agent] 启动现代化 Agentic 微内核服务器...`));
  console.log(pc.gray(`--------------------------------------------------`));
  console.log(pc.green(`✔ Server listening on: http://${config.host}:${port}`));
  console.log(pc.gray(`--------------------------------------------------\n`));

  return serve({
    fetch: app.fetch,
    port,
  });
}
