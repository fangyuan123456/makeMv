import { Hono } from 'hono';
import { streamText } from 'hono/streaming';
import fs from 'fs';
import path from 'path';
import { config } from '../../config/index.js';
import { orchestrator } from '../../orchestrator/orchestrator.js';
import { sessionManager } from '../../orchestrator/session.manager.js';
import { SessionStatus, STAGE_SEQUENCE, WorkflowStage } from '../../types/workflow.js';
import { auditService } from '../../audit/index.js';

export const workflowRoutes = new Hono();

// ─── 1. 项目生命周期管理 ───

// 创建新项目
const handleCreateProject = async (c: any) => {
  try {
    const body = await c.req.json();
    const title = body.title;
    const meta = {
      idea: body.idea || '在悬疑雨夜下的商业博弈',
      style: body.style || '电影质感，冷色调，高对比度光影',
      videoRatio: body.videoRatio || '16:9',
      videoResolution: body.videoResolution || '720P',
      isInteractiveFMV: body.isInteractiveFMV ?? true,
    };

    const session = orchestrator.createProject(title, meta);
    return c.json({
      success: true,
      session_id: session.id,
      status: session.status,
      session,
      params: meta,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
};

workflowRoutes.post('/api/project/start', handleCreateProject);

// 获取项目列表
const handleListSessions = (c: any) => {
  const sessions = sessionManager.listSessions();
  return c.json({ success: true, sessions });
};
workflowRoutes.get('/api/sessions', handleListSessions);

// 获取指定项目的当前状态
const handleGetStatus = (c: any) => {
  const id = c.req.param('id');
  const session = sessionManager.getSession(id);
  if (!session) return c.json({ success: false, error: 'Project not found' }, 404);

  const isCompleted = session.status === SessionStatus.COMPLETED;
  const stageStatusMap: Record<string, string> = {};

  for (const stage of STAGE_SEQUENCE) {
    if (isCompleted || session.stageArtifacts[stage]) {
      stageStatusMap[stage] = 'completed';
    } else if (session.currentStage === stage) {
      stageStatusMap[stage] = session.status === SessionStatus.WAITING_FOR_INTERVENTION ? 'waiting' : session.status;
    } else {
      stageStatusMap[stage] = 'idle';
    }
  }

  return c.json({
    success: true,
    session_id: session.id,
    current_stage: session.currentStage,
    status: stageStatusMap,
    artifacts: session.stageArtifacts,
    error: session.status === SessionStatus.FAILED ? 'Stage execution failed' : null,
    session,
  });
};

workflowRoutes.get('/api/project/:id/status', handleGetStatus);

// 删除项目
workflowRoutes.delete('/api/sessions/:id', (c) => {
  const id = c.req.param('id');
  sessionManager.deleteSession(id);
  return c.json({ success: true, status: 'ok' });
});

// 终止当前项目执行
workflowRoutes.post('/api/project/:id/stop', (c) => {
  const id = c.req.param('id');
  const session = sessionManager.getSession(id);
  if (session) {
    session.status = SessionStatus.FAILED;
    sessionManager.saveSession(session);
  }
  return c.json({ success: true, status: 'ok' });
});

// ─── 2. 阶段资产数据管理 (Artifacts) ───

// 获取阶段产物交付物数据
workflowRoutes.get('/api/project/:id/artifact/:stage', (c) => {
  const id = c.req.param('id');
  const stage = c.req.param('stage');
  const session = sessionManager.getSession(id);
  if (!session) return c.json({ success: false, error: 'Project not found' }, 404);

  const artifact = session.stageArtifacts[stage];
  if (!artifact) {
    return c.json({ success: false, error: `Artifact for stage ${stage} not ready` }, 404);
  }
  return c.json({ success: true, stage, artifact });
});

// 更新/保存阶段产物数据（手动微调提示词、选定版本）
workflowRoutes.patch('/api/project/:id/artifact/:stage', async (c) => {
  try {
    const id = c.req.param('id');
    const stage = c.req.param('stage');
    const session = sessionManager.getSession(id);
    if (!session) return c.json({ success: false, error: 'Project not found' }, 404);

    const patchData = await c.req.json();
    const existing = session.stageArtifacts[stage] || {};

    // 处理用户选择的版本 (selections: { [itemId]: string })
    const selections = patchData?.selections && typeof patchData.selections === 'object' ? patchData.selections : null;
    if (selections) {
      const applySelection = (list?: any[]) => {
        if (!Array.isArray(list)) return;
        for (const item of list) {
          const sel = selections[item.id] || selections[item.name] || selections[item.location];
          if (sel) {
            item.selected = sel;
            item.imageUrl = sel;
          }
        }
      };

      applySelection(existing.characters);
      applySelection(existing.bible?.characters);
      applySelection(existing.settings);
      applySelection(existing.shots);
    }

    session.stageArtifacts[stage] = {
      ...existing,
      ...patchData,
    };

    sessionManager.saveSession(session);
    return c.json({ success: true, status: 'saved', artifact: session.stageArtifacts[stage] });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 上传图片并绑定至指定条目（支持参考垫图 reference 或最终成品 final）
workflowRoutes.post('/api/project/:id/artifact/:stage/upload_image', async (c) => {
  try {
    const id = c.req.param('id');
    const stage = c.req.param('stage');
    const session = sessionManager.getSession(id);
    if (!session) return c.json({ success: false, error: 'Project not found' }, 404);

    const body = await c.req.parseBody();
    const itemId = (body['item_id'] as string) || '';
    const itemType = (body['item_type'] as string) || 'final';
    const file = body['file'];

    if (!file || typeof file === 'string') {
      return c.json({ success: false, error: 'No file provided' }, 400);
    }

    const subDirName = stage === 'character_design' ? 'characters' : stage;
    const stageDir = path.join(config.paths.projects, id, subDirName);
    fs.mkdirSync(stageDir, { recursive: true });

    const originalName = (file as File).name || 'upload.png';
    const ext = path.extname(originalName) || '.png';
    const filename = `${itemId || 'uploaded'}_${itemType}_${Date.now()}${ext}`;
    const filePath = path.join(stageDir, filename);

    const arrayBuffer = await (file as File).arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

    const webPath = `/media/${id}/${subDirName}/${filename}`;
    const artifact = session.stageArtifacts[stage] || {};

    const updateItem = (item: any) => {
      if (!item) return;
      if (itemType === 'reference') {
        item.referenceImageUrl = webPath;
      } else {
        item.imageUrl = webPath;
        item.selected = webPath;
        if (!item.versions) item.versions = [];
        if (!item.versions.includes(webPath)) item.versions.push(webPath);
      }
    };

    // 匹配并更新对应的角色、场景或镜头
    const matchAndApply = (list?: any[]) => {
      if (!Array.isArray(list)) return;
      const target = list.find((it: any) =>
        it.id === itemId ||
        it.name === itemId ||
        it.location === itemId ||
        it.shotId === itemId ||
        it.shot_id === itemId
      );
      if (target) updateItem(target);
    };

    matchAndApply(artifact.characters);
    matchAndApply(artifact.bible?.characters);
    matchAndApply(artifact.settings);
    matchAndApply(artifact.shots);

    sessionManager.saveSession(session);

    return c.json({
      success: true,
      status: 'saved',
      path: webPath,
      artifact: session.stageArtifacts[stage],
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ─── 3. 工作流推进与交互干预 ───

// 继续推进进入下一阶段
workflowRoutes.post('/api/project/:id/continue', async (c) => {
  try {
    const id = c.req.param('id');
    const session = await orchestrator.continue(id);
    return c.json({ success: true, session, next_stage: session.currentStage });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 创作者修改或干预重绘 (/intervene, /revise)
const handleIntervene = async (c: any) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const stageOverride = body.stage as WorkflowStage | undefined;
    const rawFeedback = body.feedback ?? body.modifications ?? (Object.keys(body).length > 0 ? body : '');

    let feedbackStr = '';
    let parsedFeedback: any = null;

    if (typeof rawFeedback === 'string') {
      try {
        parsedFeedback = JSON.parse(rawFeedback);
        feedbackStr = parsedFeedback.instruction || parsedFeedback.feedback || rawFeedback;
      } catch {
        feedbackStr = rawFeedback;
      }
    } else if (typeof rawFeedback === 'object' && rawFeedback !== null) {
      parsedFeedback = rawFeedback;
      feedbackStr = rawFeedback.instruction || rawFeedback.feedback || JSON.stringify(rawFeedback);
    }

    const isCharRegen = Array.isArray(body.regenerate_characters) || Array.isArray(parsedFeedback?.regenerate_characters);

    // 记录纯文本自然语言反馈对话气泡（排除内部定向重绘参数）
    if (feedbackStr && !isCharRegen) {
      sessionManager.appendMessage(id, {
        id: `msg_user_rev_${Date.now()}`,
        sender: 'user',
        senderName: '我',
        content: feedbackStr,
        timestamp: new Date().toISOString(),
        stage: stageOverride,
      });
    }

    const feedbackPayload = typeof rawFeedback === 'string' ? rawFeedback : JSON.stringify(rawFeedback);
    const session = await orchestrator.revise(id, feedbackPayload, stageOverride);
    return c.json({ success: true, session });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
};

workflowRoutes.post('/api/project/:id/intervene', handleIntervene);

// 端到端执行所有阶段
workflowRoutes.post('/api/project/:id/run-all', async (c) => {
  try {
    const id = c.req.param('id');
    const session = await orchestrator.runAll(id);
    return c.json({ success: true, session });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 执行指定阶段（支持流式 NDJSON 监听）
workflowRoutes.post('/api/project/:id/execute/:stage', async (c) => {
  const id = c.req.param('id');
  const stage = c.req.param('stage');
  c.header('Content-Type', 'application/x-ndjson');
  c.header('Transfer-Encoding', 'chunked');

  return streamText(c, async (stream) => {
    await stream.writeln(JSON.stringify({
      type: 'progress',
      percent: 20,
      message: `正在执行: ${stage}`,
    }));
    try {
      const session = await orchestrator.step(id, undefined, stage as any);
      const stageArtifact = (session.stageArtifacts as any)?.[stage];
      await stream.writeln(JSON.stringify({
        type: 'progress',
        percent: 100,
        message: `阶段完成: ${stage}`,
      }));
      await stream.writeln(JSON.stringify({
        type: 'stage_complete',
        stage,
        status: 'completed',
        requires_intervention: false,
        artifact: stageArtifact,
      }));
    } catch (err: any) {
      await stream.writeln(JSON.stringify({
        type: 'error',
        content: err.message || 'Stage execution failed',
      }));
    }
  });
});

// ─── 4. 审计与追踪数据查询 ───

// 会话 .agent_debug 审计概览
workflowRoutes.get('/api/project/:id/audit', (c) => {
  const id = c.req.param('id');
  const projectDir = sessionManager.getProjectDir(id);
  const summary = auditService.getAuditSummary(projectDir);
  return c.json({ success: true, summary: summary || null });
});

// 查询指定阶段 trace.md 详细追踪
workflowRoutes.get('/api/project/:id/audit/:stage', (c) => {
  const id = c.req.param('id');
  const stage = c.req.param('stage') as WorkflowStage;
  const projectDir = sessionManager.getProjectDir(id);
  const trace = auditService.getStageTrace(projectDir, stage);
  if (!trace) {
    return c.json({ success: false, message: `No audit trace found for stage: ${stage}` }, 404);
  }
  return c.json({ success: true, trace });
});
