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
import { DirectorAgent } from '../agents/director/index.js';
import { JobAbortRegistry, ProgressBus } from '../agent-runtime/index.js';

import { WorkflowStage, SessionStatus } from '../types/index.js';

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

      const project = DirectorAgent.createProject(title, meta);
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

  // 阶段元数据清单 (Stages SSOT)
  const STAGES_METADATA = [
    { id: WorkflowStage.NARRATIVE_DESIGN, name: '叙事架构', order: 1, description: '网状故事圣经与黄金戏剧主干推演' },
    { id: WorkflowStage.CHARACTER_DESIGN, name: '角色定妆', order: 2, description: '全剧角色视觉锚点与定妆照多版本生成' },
    { id: WorkflowStage.SCENE_SCRIPT, name: '分场剧本', order: 3, description: '多分支逐场剧本与交互抉择点扩写' },
    { id: WorkflowStage.STORYBOARD, name: '视听分镜', order: 4, description: '导演机位视听规划与镜头构图切分' },
    { id: WorkflowStage.KEYFRAME_REFERENCE, name: '关键帧图', order: 5, description: '各镜头首帧画面与参考图高清渲染' },
    { id: WorkflowStage.VIDEO_PRODUCTION, name: '视频生成', order: 6, description: '各分支节点动态视频切片批量渲染' },
    { id: WorkflowStage.FMV_PACKAGING, name: '影游装配', order: 7, description: '工程母带混音与交互播放器 Manifest 打包' },
  ];

  app.get('/api/stages', (c) => {
    return c.json({ success: true, stages: STAGES_METADATA });
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

  // 上传图片资产 (支持角色定妆照与参考图)
  app.post('/api/project/:projectId/artifact/:stage/upload_image', async (c) => {
    try {
      const projectId = c.req.param('projectId');
      const stage = c.req.param('stage') as WorkflowStage;
      const body = await c.req.parseBody();
      const file = body['file'] as any;
      const itemId = (body['item_id'] || 'unnamed') as string;
      const itemType = (body['item_type'] || 'characters') as string;

      if (!file || typeof file.arrayBuffer !== 'function') {
        return c.json({ success: false, detail: '未找到有效上传图片文件' }, 400);
      }

      const store = ProjectStore.getInstance();
      const projectDir = store.getProjectDir(projectId);
      const safeItemName = itemId.replace(/[\/\\:*?"<>|]/g, '_');
      const targetDir = path.join(projectDir, itemType, safeItemName);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const fileName = `upload_${Date.now()}.png`;
      const localFilePath = path.join(targetDir, fileName);
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(localFilePath, buffer);

      const relativeMediaPath = `/media/${projectId}/${itemType}/${encodeURIComponent(safeItemName)}/${fileName}`;

      // 若为角色定妆阶段，同步更新状态黑板交付物
      const artifact = store.getArtifact<any>(projectId, stage) || {};
      if (stage === WorkflowStage.CHARACTER_DESIGN && artifact.characters) {
        const char = artifact.characters.find((ch: any) => ch.name === itemId || ch.id === itemId);
        if (char) {
          char.imageUrl = relativeMediaPath;
          char.referenceImageUrl = relativeMediaPath;
          char.selected = true;
          if (!char.versions) char.versions = [];
          char.versions.push({
            versionId: `upload_${Date.now()}`,
            imageUrl: relativeMediaPath,
            localPath: localFilePath,
            promptUsed: '用户手动上传定妆照',
            createdAt: new Date().toISOString(),
          });
          store.setArtifact(projectId, stage, artifact);
        }
      }

      return c.json({
        success: true,
        status: 'ok',
        path: relativeMediaPath,
        artifact,
        status_map: {},
      });
    } catch (err: any) {
      return c.json({ success: false, detail: err.message }, 500);
    }
  });

  // 阶段审计与调试追踪 (.agent_debug 归档读取)
  app.get('/api/project/:projectId/audit/:stage', (c) => {
    const projectId = c.req.param('projectId');
    const stage = c.req.param('stage');
    const store = ProjectStore.getInstance();
    const projectDir = store.getProjectDir(projectId);
    const auditDir = path.join(projectDir, '.agent_debug', stage);

    const readSafeJson = (p: string) => {
      try {
        return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
      } catch {
        return null;
      }
    };

    const readSafeText = (p: string) => {
      try {
        return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
      } catch {
        return '';
      }
    };

    if (!fs.existsSync(auditDir)) {
      return c.json({
        success: true,
        trace: {
          markdown: `> ⚠️ 阶段 [${stage}] 暂无 .agent_debug 归档。可能该工序尚未执行完毕。`,
          input: null,
          output: null,
          prompts: null,
          rawAiResponse: null,
        },
      });
    }

    return c.json({
      success: true,
      trace: {
        markdown: readSafeText(path.join(auditDir, 'trace.md')) || `> 阶段 [${stage}] 审计就绪`,
        input: readSafeJson(path.join(auditDir, 'input.json')),
        output: readSafeJson(path.join(auditDir, 'output.json')),
        prompts: readSafeJson(path.join(auditDir, 'prompts.json')),
        rawAiResponse: readSafeJson(path.join(auditDir, 'raw_ai_response.json')),
      },
    });
  });

  // 流水线控制
  app.post('/api/project/:projectId/continue', async (c) => {
    const projectId = c.req.param('projectId');
    let userFeedback: string | undefined;
    try {
      const body = await c.req.json();
      userFeedback = body?.userFeedback;
    } catch {
      // 容忍空 body
    }
    const director = new DirectorAgent(projectId);
    const project = await director.continue(userFeedback);
    return c.json({ success: true, project });
  });

  app.post('/api/project/:projectId/stop', (c) => {
    const projectId = c.req.param('projectId');
    JobAbortRegistry.abort(projectId);
    return c.json({ success: true, message: `项目 ${projectId} 执行已终止` });
  });

  // 阶段真流式执行 (SSE + ProgressBus 毫秒级打字机推送)
  app.post('/api/project/:projectId/execute/:stage', async (c) => {
    const projectId = c.req.param('projectId');
    const stage = c.req.param('stage') as WorkflowStage;

    let userFeedback: string | undefined;
    const extraOptions: Record<string, any> = {};
    try {
      const body = await c.req.json();
      userFeedback = body?.userFeedback;
      if (Array.isArray(body?.targetCharacterNames)) {
        extraOptions.targetCharacterNames = body.targetCharacterNames;
      }
      if (body?.episodeNumber) {
        extraOptions.episodeNumber = body.episodeNumber;
      }
    } catch {
      // 容忍空 body
    }

    c.header('Content-Type', 'text/event-stream; charset=utf-8');
    c.header('Cache-Control', 'no-cache, no-transform');
    c.header('Connection', 'keep-alive');

    return streamText(c, async (stream) => {
      // 🌟 实时订阅底层 ProgressBus 细粒度进度
      const unsubscribe = ProgressBus.getInstance().subscribe(projectId, async (payload) => {
        try {
          await stream.writeln(JSON.stringify({
            type: 'progress',
            percent: payload.percent,
            detail: payload.detail,
            stage: payload.stage,
            timestamp: payload.timestamp,
          }));
        } catch {
          // ignore stream write error if client disconnected
        }
      });

      try {
        await stream.writeln(JSON.stringify({ type: 'progress', percent: 5, detail: `开始执行: ${stage}` }));
        const director = new DirectorAgent(projectId);
        const project = await director.step(userFeedback, stage, extraOptions);
        const artifact = project?.stageArtifacts?.[stage];
        await stream.writeln(JSON.stringify({ type: 'stage_complete', stage, status: 'completed', artifact }));
      } catch (err: any) {
        await stream.writeln(JSON.stringify({ type: 'error', content: err.message || 'Execution failed' }));
      } finally {
        unsubscribe();
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
