/**
 * api/routes/projects.ts
 * 项目管理与状态图全景拓扑业务路由
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { ProjectStore, ProposalStore } from '../../project-store/index.js';
import { WorkflowManager } from '../../mastra/workflows/index.js';
import { WorkflowStage, SessionStatus } from '../../types/index.js';
import { readJsonBody, sendJson, sendError } from '../helpers.js';

export async function handleProjectRoutes(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const projectStore = ProjectStore.getInstance();
  const proposalStore = ProposalStore.getInstance();
  const workflowManager = WorkflowManager.getInstance();

  // 1. 项目列表: GET /api/projects
  if (pathname === '/api/projects' && req.method === 'GET') {
    const projects = projectStore.listProjects();
    sendJson(res, 200, { success: true, projects });
    return true;
  }

  // 2. 创建项目: POST /api/projects
  if (pathname === '/api/projects' && req.method === 'POST') {
    const body = await readJsonBody(req);
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
    sendJson(res, 200, { success: true, project: entity });
    return true;
  }

  // 3. 类 LangGraph 状态图全景拓扑: GET /api/projects/:projectId/graph
  if (pathname.startsWith('/api/projects/') && pathname.endsWith('/graph') && req.method === 'GET') {
    const parts = pathname.split('/');
    const projectId = parts[3];
    const project = projectStore.getProject(projectId);
    if (!project) {
      sendError(res, 404, '项目不存在');
      return true;
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

    const criticReport = projectStore.getArtifact<any>(projectId, `critic_review_${project.currentStage}`) || projectStore.getArtifact<any>(projectId, 'critic_review');
    const pendingProposals = proposalStore.listProposals(projectId, { status: 'pending' });
    const activeWorkflow = workflowManager.getStatus(projectId);

    sendJson(res, 200, {
      success: true,
      projectId,
      title: project.title,
      currentStage: project.currentStage,
      nodes,
      criticGate: criticReport?.gateStatus || 'NONE',
      pendingProposalsCount: pendingProposals.length,
      activeWorkflow,
    });
    return true;
  }

  // 4. 查询项目提案列表: GET /api/projects/:projectId/proposals
  if (pathname.startsWith('/api/projects/') && pathname.endsWith('/proposals') && req.method === 'GET') {
    const parts = pathname.split('/');
    const projectId = parts[3];
    const proposals = proposalStore.listProposals(projectId);
    sendJson(res, 200, { success: true, proposals });
    return true;
  }

  // 5. 单项目详情: GET /api/projects/:projectId
  if (pathname.startsWith('/api/projects/') && req.method === 'GET') {
    const projectId = pathname.replace('/api/projects/', '').split('/')[0];
    const project = projectStore.getProject(projectId);
    if (!project) {
      sendError(res, 404, '项目不存在');
      return true;
    }
    sendJson(res, 200, { success: true, project });
    return true;
  }

  return false;
}
