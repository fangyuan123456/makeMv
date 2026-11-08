/**
 * api/routes/projects.ts
 * 项目管理与状态图全景拓扑业务路由
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { ProjectStore, TaskStore } from '../../project-store/index.js';
import { WorkflowStage, SessionStatus } from '../../types/index.js';
import { CharacterRenderer } from '../../media/index.js';
import { hydrateCharacterArtifact, hydratePortraitArtifact } from '../../agents/director/character-facts.js';
import { buildRecomputePlan, formatRecomputePlan } from '../../agents/director/recompute-plan.js';
import { decideRecompute } from '../../agents/director/recompute-executor.js';
import { readJsonBody, sendJson, sendError } from '../helpers.js';

export async function handleProjectRoutes(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const projectStore = ProjectStore.getInstance();
  const taskStore = TaskStore.getInstance();

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
    const projectId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
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

  /*
   * 2.5 增量重算清单（只读 dry-run）: GET /api/projects/:projectId/recompute-plan
   *
   * 给人和脚本一个不花钱的核查口：当前哪些资产陈旧、按什么波次重做、费用口径。
   * 本端点绝不写盘、绝不触发渲染；真正的执行只走审批卡 approve → startTask。
   * 带 ?instruction= 时附带「精确 / 回退」决策，便于排查为何某次修改没走精确重算。
   */
  const recomputeMatch = pathname.match(/^\/api\/projects\/([^\/]+)\/recompute-plan$/);
  if (recomputeMatch && req.method === 'GET') {
    const projectId = decodeURIComponent(recomputeMatch[1]);
    const project = projectStore.getProject(projectId);
    if (!project) {
      sendError(res, 404, '项目不存在');
      return true;
    }
    try {
      const instruction =
        new URL(req.url || '', 'http://localhost').searchParams.get('instruction') || '';
      const plan = buildRecomputePlan(project.stageArtifacts);
      sendJson(res, 200, {
        success: true,
        projectId,
        plan,
        formatted: formatRecomputePlan(plan),
        ...(instruction
          ? { decision: decideRecompute(project.stageArtifacts, instruction) }
          : {}),
        notice: '只读 dry-run：本端点不触发任何渲染，也不修改产物',
      });
    } catch (err: any) {
      sendError(res, 400, err?.message || '重算清单计算失败');
    }
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
    const pendingTasks = taskStore.listTasks(projectId, { status: 'proposed' });

    sendJson(res, 200, {
      success: true,
      projectId,
      title: project.title,
      currentStage: project.currentStage,
      nodes,
      criticGate: criticReport?.gateStatus || 'NONE',
      pendingTasksCount: pendingTasks.length,
    });
    return true;
  }

  // 4. 单份工序产物: GET /api/projects/:projectId/artifacts/:stage（任务产物链接的落地端点）
  const artifactMatch = pathname.match(/^\/api\/projects\/([^\/]+)\/artifacts\/([^\/]+)$/);
  if (artifactMatch && req.method === 'GET') {
    const projectId = decodeURIComponent(artifactMatch[1]);
    const stage = decodeURIComponent(artifactMatch[2]);
    const artifact = projectStore.getArtifact(projectId, stage);
    if (!artifact) {
      sendError(res, 404, '产物不存在');
      return true;
    }
    // 定妆产物只存视觉结果，展示前按 name 合并故事圣经事实（只读投影，不落盘）
    const payload =
      stage === WorkflowStage.CHARACTER_DESIGN
        ? hydrateCharacterArtifact(projectStore.getProject(projectId), artifact)
        : artifact;
    sendJson(res, 200, { success: true, projectId, stage, artifact: payload });
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

    // 聚合当前项目的活跃会话消息作为 history (消灭历史消息空数组断裂，SSOT 闭环)
    const sessions = projectStore.listSessions(projectId);
    let messages: any[] = [];
    if (sessions.length > 0) {
      messages = projectStore.getMessages(projectId, sessions[0].sessionId) || [];
    }

    const projectWithHistory = {
      ...project,
      stageArtifacts: {
        ...project.stageArtifacts,
        // 只读投影：定妆产物不持有角色事实，展示时从故事圣经按 name 补齐
        character_design: hydratePortraitArtifact(project) ?? project.stageArtifacts?.[WorkflowStage.CHARACTER_DESIGN],
      },
      history: messages,
      sessions,
    };

    sendJson(res, 200, { success: true, project: projectWithHistory });
    return true;
  }

  // 6. 单角色定妆渲染/重绘接口 (手动定妆，严格区分垫图修改与纯文本全新生成)
  // POST /api/projects/:projectId/characters/:characterName/render
  const charRenderMatch = pathname.match(/^\/api\/projects\/([^\/]+)\/characters\/([^\/]+)\/render$/);
  if (charRenderMatch && req.method === 'POST') {
    const projectId = decodeURIComponent(charRenderMatch[1]);
    const characterName = decodeURIComponent(charRenderMatch[2]);
    const body = await readJsonBody(req);

    const project = projectStore.getProject(projectId);
    if (!project) {
      sendError(res, 404, '目标项目不存在');
      return true;
    }

    const artifact = projectStore.getArtifact<any>(projectId, WorkflowStage.CHARACTER_DESIGN);
    if (!artifact || !Array.isArray(artifact.characters)) {
      sendError(res, 400, '当前项目尚未初始化角色定妆资产');
      return true;
    }

    const charIndex = artifact.characters.findIndex((c: any) => c.name === characterName);
    if (charIndex === -1) {
      sendError(res, 404, `未在角色资产表中找到名为 [${characterName}] 的角色`);
      return true;
    }

    const targetChar = artifact.characters[charIndex];
    const visualPrompt = body.visualPrompt || targetChar.visualPrompt || `${characterName}，电影级高精度人物定妆照`;
    const useReference = body.useReference !== undefined ? Boolean(body.useReference) : (targetChar.useReference !== false);
    const referenceImageUrl = body.referenceImageUrl || targetChar.referenceImageUrl || targetChar.imageUrl;

    // 区分修改逻辑 (ref2i) 与全新生成逻辑 (t2i)
    const effectiveRefUrl = useReference ? referenceImageUrl : undefined;
    const mode = effectiveRefUrl ? 'character_ref2i' : 'character_t2i';

    try {
      const renderRes = await CharacterRenderer.renderCharacterPortrait(
        projectId,
        characterName,
        visualPrompt,
        {
          referenceImageUrl: effectiveRefUrl,
          mode,
          isMock: body.isMock,
        }
      );

      // 历史记录版本压栈
      const history = Array.isArray(targetChar.history) ? [...targetChar.history] : [];
      if (targetChar.imageUrl && !history.some((h: any) => h.imageUrl === targetChar.imageUrl)) {
        history.push({
          id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          imageUrl: targetChar.imageUrl,
          visualPrompt: targetChar.visualPrompt || visualPrompt,
          createdAt: new Date().toISOString(),
        });
      }

      // 更新角色对象
      const updatedChar = {
        ...targetChar,
        visualPrompt,
        imageUrl: renderRes.url,
        referenceImageUrl: effectiveRefUrl || targetChar.imageUrl || renderRes.url,
        useReference,
        isNew: false,
        history,
        selected: true,
        isDegraded: renderRes.isDegraded,
      };

      artifact.characters[charIndex] = updatedChar;
      artifact.updatedAt = new Date().toISOString();
      projectStore.setArtifact(projectId, WorkflowStage.CHARACTER_DESIGN, artifact);

      sendJson(res, 200, {
        success: true,
        character: updatedChar,
        mode,
        summary: `角色【${characterName}】定妆渲染完成 (${mode === 'character_ref2i' ? '垫图修改模式' : '全新生图模式'})`,
      });
      return true;
    } catch (err: any) {
      sendError(res, 500, `角色定妆渲染失败: ${err.message || '未知错误'}`);
      return true;
    }
  }

  return false;
}
