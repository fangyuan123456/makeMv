/**
 * api/server.ts
 * 现代微内核 HTTP 服务入口与路由挂载 (Server SSOT)
 * 全链路统一概念为 projectId
 */

import fs from 'fs';
import path from 'path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { streamText } from 'hono/streaming';
import pc from 'picocolors';
import { config } from '../utils/config.js';
import { ProjectStore } from '../project-store/ProjectStore.js';
import { director } from '../agents/director/index.js';
import { JobAbortRegistry } from '../queue/JobAbortRegistry.js';
import { ProgressBus } from '../queue/ProgressBus.js';
import { WorkflowStage, SessionStatus } from '../contracts/index.js';

export function createServer(): Hono {
  const app = new Hono();

  // 跨域支持
  app.use('*', cors());

  // 1. 项目生命周期路由 (统一为 projectId)
  app.post('/api/project/start', async (c) => {
    try {
      const body = await c.req.json();
      const title = body.title || '未命名互动影游';
      const meta = {
        idea: body.idea || '商业悬疑故事',
        style: body.style || '电影质感，冷色调，高对比度光影',
        videoRatio: body.videoRatio || '16:9',
        videoResolution: body.videoResolution || '720P',
        episodes: body.episodes || 1
      };

      const project = director.createProject(title, meta);
      JobAbortRegistry.create(project.projectId);

      return c.json({
        success: true,
        projectId: project.projectId,
        status: project.status,
        project,
        params: meta,
      });
    } catch (err: any) {
      return c.json({ success: false, error: err.message }, 400);
    }
  });

  // 获取所有项目列表 (SSOT 唯一标准路径)
  app.get('/api/projects', (c) => {
    const projects = ProjectStore.getInstance().listProjects();
    return c.json({ success: true, projects });
  });

  app.delete('/api/project/:projectId', (c) => {
    const projectId = c.req.param('projectId');
    ProjectStore.getInstance().deleteProject(projectId);
    return c.json({ success: true, message: `项目 ${projectId} 已删除` });
  });

  // 获取单个项目状态
  app.get('/api/project/:projectId/status', (c) => {
    const projectId = c.req.param('projectId');
    const project = ProjectStore.getInstance().getProject(projectId);
    if (!project) return c.json({ success: false, error: 'Project not found' }, 404);

    return c.json({
      success: true,
      projectId: project.projectId,
      currentStage: project.currentStage,
      status: project.status,
      artifacts: project.stageArtifacts,
      project,
    });
  });

  // 产物单点存取 (Artifact)
  app.get('/api/project/:projectId/artifact/:stage', (c) => {
    const projectId = c.req.param('projectId');
    const stage = c.req.param('stage') as WorkflowStage;
    const artifact = ProjectStore.getInstance().getArtifact(projectId, stage);
    if (!artifact) return c.json({ success: false, error: `Artifact for ${stage} not found` }, 404);
    return c.json({ success: true, stage, artifact });
  });

  app.patch('/api/project/:projectId/artifact/:stage', async (c) => {
    const projectId = c.req.param('projectId');
    const stage = c.req.param('stage') as WorkflowStage;
    const body = await c.req.json();
    ProjectStore.getInstance().setArtifact(projectId, stage, body);
    return c.json({ success: true, message: `阶段 ${stage} 交付物已更新` });
  });

  // 流水线控制
  app.post('/api/project/:projectId/continue', async (c) => {
    const projectId = c.req.param('projectId');
    const project = await director.continue(projectId);
    return c.json({ success: true, project });
  });

  app.post('/api/project/:projectId/stop', (c) => {
    const projectId = c.req.param('projectId');
    JobAbortRegistry.abort(projectId);
    return c.json({ success: true, message: `项目 ${projectId} 执行已终止` });
  });

  // 阶段流式执行 (SSE)
  app.post('/api/project/:projectId/execute/:stage', async (c) => {
    const projectId = c.req.param('projectId');
    const stage = c.req.param('stage') as WorkflowStage;

    c.header('Content-Type', 'text/event-stream; charset=utf-8');
    c.header('Cache-Control', 'no-cache, no-transform');
    c.header('Connection', 'keep-alive');

    return streamText(c, async (stream) => {
      await stream.writeln(JSON.stringify({ type: 'progress', percent: 10, detail: `开始执行: ${stage}` }));
      try {
        const project = await director.step(projectId, undefined, stage);
        const artifact = project?.stageArtifacts?.[stage];
        await stream.writeln(JSON.stringify({ type: 'stage_complete', stage, status: 'completed', artifact }));
      } catch (err: any) {
        await stream.writeln(JSON.stringify({ type: 'error', content: err.message || 'Execution failed' }));
      }
    });
  });

  // 2. 媒体静态托管 (GET /media/:projectId/*)
  app.get('/media/:projectId/*', (c) => {
    const projectId = c.req.param('projectId');
    const prefix = `/media/${projectId}/`;
    const relativePath = decodeURIComponent(c.req.path.substring(prefix.length));
    const projectRoot = ProjectStore.getInstance().getProjectDir(projectId);
    const targetPath = path.resolve(projectRoot, relativePath);

    if (!targetPath.startsWith(projectRoot) || !fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
      return c.notFound();
    }

    const fileStream = fs.createReadStream(targetPath);
    return c.body(fileStream as any);
  });

  // 3. 系统配置与健康检查
  app.get('/api/config', (c) => c.json({ success: true, config }));
  app.get('/health', (c) => c.json({ status: 'ok', time: Date.now() }));
  app.get('/api/system/status', (c) => c.json({ status: 'ok', time: Date.now() }));

  return app;
}

export function startServer(port: number = config.port) {
  const app = createServer();
  console.log(pc.cyan(`\n🎬 [FMV-Agent] 启动现代化微内核服务器...`));
  console.log(pc.gray(`--------------------------------------------------`));
  console.log(pc.green(`✔ Server listening on: http://${config.host}:${port}`));
  console.log(pc.gray(`--------------------------------------------------\n`));

  return serve({
    fetch: app.fetch,
    port,
  });
}
