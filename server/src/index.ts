/**
 * src/index.ts
 * makeMv - Mastra 官方微内核与 Vercel AI SDK 影视工业引擎启动入口 (SSOT)
 * 
 * 职责：
 * 1. 验证 Mastra 微内核智能体与工作流注册；
 * 2. 启动常驻 HTTP / SSE 接口服务 (监听 4111 端口)；
 * 3. 动态状态图自由对话路由与服务端双轨记忆持久化 (/api/chat)；
 * 4. Mastra 原生工作流与人在回路挂起/恢复端点 (/api/workflow/resume, /api/proposals/:id/approve)；
 * 5. 安全沙箱防路径穿越媒体切片托管 (/media/:projectId/*)。
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { mastra } from './mastra/index.js';
import { ProjectStore, ProposalStore } from './project-store/index.js';
import { DirectorRouter, ProposalExecutor } from './mastra/router/index.js';
import { WorkflowManager } from './mastra/workflows/index.js';
import { WorkflowStage, SessionStatus } from './types/index.js';

const PORT = process.env.PORT || 4111;

async function bootstrap() {
  console.log('====================================================');
  console.log('🎬 makeMv - Mastra 动态状态图与自由对话微内核已就绪');
  console.log('====================================================');

  const directorAgent = mastra.getAgent('directorAgent');
  console.log(`[Mastra Agent] 挂载成功: id=${directorAgent.id}, name=${directorAgent.name}`);

  const workflow = mastra.getWorkflow('pipelineWorkflow');
  console.log(`[Mastra Workflow] 挂载成功: id=${workflow.id}`);

  const projectStore = ProjectStore.getInstance();
  const proposalStore = ProposalStore.getInstance();
  const router = DirectorRouter.getInstance();
  const executor = ProposalExecutor.getInstance();
  const workflowManager = WorkflowManager.getInstance();

  const server = http.createServer(async (req, res) => {
    // 跨域 CORS 支持与安全收敛
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    const readBody = (): Promise<any> => {
      return new Promise((resolve) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            resolve(JSON.parse(body || '{}'));
          } catch {
            resolve({});
          }
        });
      });
    };

    // 1. 健康检查端点
    if (pathname === '/health' || pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'makemv-mastra-server' }));
      return;
    }

    // 2. 静态媒体切片路由: /media/:projectId/... (P0-1 严格相对路径沙箱防穿越)
    if (pathname.startsWith('/media/') && req.method === 'GET') {
      const parts = pathname.replace('/media/', '').split('/');
      const projectId = parts[0];
      const relativeFilePath = parts.slice(1).join('/');

      if (!projectId || !relativeFilePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '非法媒体请求路径' }));
        return;
      }

      const projectDir = projectStore.getProjectDir(projectId);
      const safePath = path.resolve(projectDir, relativeFilePath);

      // 安全沙箱刚性防御：严格检查 relative 路径不能逃逸出 projectDir
      const relative = path.relative(projectDir, safePath);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(safePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '媒体文件不存在或禁止跨项目越权访问' }));
        return;
      }

      const ext = path.extname(safePath).toLowerCase();
      let contentType = 'application/octet-stream';
      if (ext === '.mp4') contentType = 'video/mp4';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.json') contentType = 'application/json';

      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(safePath).pipe(res);
      return;
    }

    // 3. 项目列表: GET /api/projects
    if (pathname === '/api/projects' && req.method === 'GET') {
      const projects = projectStore.listProjects();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, projects }));
      return;
    }

    // 4. 创建项目: POST /api/projects
    if (pathname === '/api/projects' && req.method === 'POST') {
      const body = await readBody();
      const { title, idea, style, videoRatio } = body;

      const now = new Date().toISOString();
      const projectId = `proj_${Date.now()}`;
      const entity = {
        projectId,
        title: title || '未命名互动影游',
        status: SessionStatus.IDLE,
        currentStage: WorkflowStage.NARRATIVE_DESIGN,
        stageArtifacts: {},
        history: [],
        meta: {
          idea: idea || '',
          style: style || '电影质感，写实光影',
          videoRatio: videoRatio || '16:9',
          videoResolution: '720P' as const,
        },
        createdAt: now,
        updatedAt: now,
      };

      projectStore.saveProject(entity);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, project: entity }));
      return;
    }

    // 5. 单项目详情: GET /api/projects/:projectId
    if (pathname.startsWith('/api/projects/') && req.method === 'GET' && !pathname.endsWith('/graph') && !pathname.endsWith('/proposals')) {
      const projectId = pathname.replace('/api/projects/', '').split('/')[0];
      const project = projectStore.getProject(projectId);
      if (!project) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: '项目不存在' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, project }));
      return;
    }

    // 6. 类 LangGraph 状态图全景拓扑: GET /api/projects/:projectId/graph
    if (pathname.startsWith('/api/projects/') && pathname.endsWith('/graph') && req.method === 'GET') {
      const parts = pathname.split('/');
      const projectId = parts[3];
      const project = projectStore.getProject(projectId);
      if (!project) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: '项目不存在' }));
        return;
      }

      const allStages = [
        { id: WorkflowStage.NARRATIVE_DESIGN, label: '叙事架构', desc: '世界观网状故事圣经' },
        { id: WorkflowStage.CHARACTER_DESIGN, label: '角色定妆', desc: '角色视觉锚点与定妆照' },
        { id: WorkflowStage.SCENE_SCRIPT, label: '分场剧本', desc: '逐场对白与分支剧本' },
        { id: WorkflowStage.STORYBOARD, label: '视听分镜', desc: '导演镜头机位与运镜规划' },
        { id: WorkflowStage.KEYFRAME_REFERENCE, label: '关键帧图', desc: '首帧高清参考图生成' },
        { id: WorkflowStage.VIDEO_PRODUCTION, label: '视频切片', desc: '动态视频切片渲染' },
        { id: WorkflowStage.FMV_PACKAGING, label: '母带打包', desc: '全网交互播放清单编译' },
      ];

      const nodes = allStages.map((s) => {
        const artifact = projectStore.getArtifact(projectId, s.id);
        return {
          id: s.id,
          label: s.label,
          description: s.desc,
          isCompleted: Boolean(artifact),
          artifactSummary: artifact ? `${s.label}已落盘` : '待生成',
        };
      });

      // P1-6 阶段隔离读取门禁状态
      const criticReport = projectStore.getArtifact<any>(projectId, `critic_review_${project.currentStage}`) || projectStore.getArtifact<any>(projectId, 'critic_review');
      const pendingProposals = proposalStore.listProposals(projectId, { status: 'pending' });
      const activeWorkflow = workflowManager.getStatus(projectId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        projectId,
        title: project.title,
        currentStage: project.currentStage,
        nodes,
        criticGate: criticReport?.gateStatus || 'NONE',
        pendingProposalsCount: pendingProposals.length,
        activeWorkflow,
      }));
      return;
    }

    // 7. 查询项目提案: GET /api/projects/:projectId/proposals
    if (pathname.startsWith('/api/projects/') && pathname.endsWith('/proposals') && req.method === 'GET') {
      const parts = pathname.split('/');
      const projectId = parts[3];
      const proposals = proposalStore.listProposals(projectId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, proposals }));
      return;
    }

    // 8. 自由对话交互与动态意图路由: POST /api/chat (支持 SSE 流式打字机与双轨记忆落盘)
    if (pathname === '/api/chat' && req.method === 'POST') {
      try {
        const body = await readBody();
        const { message, projectId, history } = body;
        const wantsStream = req.headers.accept === 'text/event-stream' || parsedUrl.searchParams.get('stream') === 'true';

        let effectiveProjectId = projectId;
        if (!effectiveProjectId) {
          const list = projectStore.listProjects();
          if (list.length > 0) {
            effectiveProjectId = list[0].projectId;
          } else {
            const now = new Date().toISOString();
            effectiveProjectId = `proj_${Date.now()}`;
            projectStore.saveProject({
              projectId: effectiveProjectId,
              title: '全新互动影游项目',
              status: SessionStatus.IDLE,
              currentStage: WorkflowStage.NARRATIVE_DESIGN,
              stageArtifacts: {},
              history: [],
              meta: {
                idea: message || '',
                style: '电影质感，写实光影',
                videoRatio: '16:9',
                videoResolution: '720P' as const,
              },
              createdAt: now,
              updatedAt: now,
            });
          }
        }

        console.log(`[HTTP API] 对话干预 -> 项目 [${effectiveProjectId}]: "${message}" (流式: ${wantsStream})`);

        // 调度 DirectorRouter 进行状态图分析与意图推演
        const routeResult = await router.routeMessage({
          projectId: effectiveProjectId,
          userMessage: message || '',
          history,
        });

        // P1-5 服务端双轨记忆持久化落盘 SSOT
        const project = projectStore.getProject(effectiveProjectId);
        if (project) {
          const now = new Date().toISOString();
          const currentHistory = Array.isArray(project.history) ? project.history : [];
          currentHistory.push({ role: 'user', content: message || '', timestamp: now } as any);
          currentHistory.push({
            role: 'assistant',
            content: routeResult.reply,
            timestamp: now,
            thought: routeResult.thought,
            proposal: routeResult.proposal,
          } as any);
          project.history = currentHistory;
          project.updatedAt = now;
          projectStore.saveProject(project);
        }

        if (wantsStream) {
          // SSE 流式输出
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          // 分段推送思考与回复
          res.write(`data: ${JSON.stringify({ type: 'thought', text: routeResult.thought })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'reply', text: routeResult.reply })}\n\n`);
          if (routeResult.proposal) {
            res.write(`data: ${JSON.stringify({ type: 'proposal', proposal: routeResult.proposal })}\n\n`);
          }
          res.write(`data: [DONE]\n\n`);
          res.end();
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          projectId: effectiveProjectId,
          reply: routeResult.reply,
          thought: routeResult.thought,
          intent: routeResult.intent,
          proposal: routeResult.proposal,
        }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message || '对话调度异常' }));
      }
      return;
    }

    // 9. Mastra 原生工作流推进与恢复端点: POST /api/workflow/resume
    if (pathname === '/api/workflow/resume' && req.method === 'POST') {
      try {
        const body = await readBody();
        const { projectId, stepId, overrideData } = body;
        if (!projectId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '缺少 projectId 参数' }));
          return;
        }

        const runStatus = await workflowManager.resumeWorkflow(projectId, stepId, overrideData);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, runStatus }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message || '工作流恢复异常' }));
      }
      return;
    }

    // 10. 人在回路批准提案: POST /api/proposals/:proposalId/approve (含并发锁与状态机防御)
    if (pathname.startsWith('/api/proposals/') && pathname.endsWith('/approve') && req.method === 'POST') {
      try {
        const parts = pathname.split('/');
        const proposalId = parts[3];
        const body = await readBody();
        const { projectId, overrideParameters } = body;

        if (!projectId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '缺少 projectId 参数' }));
          return;
        }

        console.log(`[HTTP API] 批准执行提案 [${proposalId}] -> 项目 [${projectId}]`);
        const execResult = await executor.executeProposal({
          projectId,
          proposalId,
          overrideParameters,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(execResult));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message || '执行提案异常' }));
      }
      return;
    }

    // 11. 人在回路驳回提案: POST /api/proposals/:proposalId/reject
    if (pathname.startsWith('/api/proposals/') && pathname.endsWith('/reject') && req.method === 'POST') {
      try {
        const parts = pathname.split('/');
        const proposalId = parts[3];
        const body = await readBody();
        const { projectId, reason } = body;

        if (!projectId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '缺少 projectId 参数' }));
          return;
        }

        console.log(`[HTTP API] 创作者驳回提案 [${proposalId}] -> 原因: ${reason || '无'}`);
        const proposal = executor.rejectProposal(projectId, proposalId, reason);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, proposal }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message || '驳回提案异常' }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  server.listen(PORT, () => {
    console.log(`\n🚀 Mastra 后端服务正在监听: http://localhost:${PORT}`);
    console.log(`📡 提供核心接口:`);
    console.log(`   - POST http://localhost:${PORT}/api/chat (自由对话、SSE流式打字机与双轨记忆落盘)`);
    console.log(`   - POST http://localhost:${PORT}/api/workflow/resume (Mastra 工作流恢复与人在回路)`);
    console.log(`   - POST http://localhost:${PORT}/api/proposals/:id/approve (安全互斥批准提案)`);
    console.log(`   - POST http://localhost:${PORT}/api/proposals/:id/reject  (驳回提案)`);
    console.log(`   - GET  http://localhost:${PORT}/api/projects/:id/graph (状态图全景拓扑与阶段隔离门禁)`);
    console.log(`   - GET  http://localhost:${PORT}/api/projects (项目列表)`);
    console.log(`   - GET  http://localhost:${PORT}/media/:projectId/* (安全防穿越媒体切片托管)`);
  });
}

bootstrap().catch((err) => {
  console.error('❌ 服务启动失败:', err);
  process.exit(1);
});
