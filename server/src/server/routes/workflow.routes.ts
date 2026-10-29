import { Hono } from 'hono';
import { streamText } from 'hono/streaming';
import fs from 'fs';
import path from 'path';
import { config } from '../../config/index.js';
import { orchestrator } from '../../orchestrator/orchestrator.js';
import { sessionManager } from '../../orchestrator/session.manager.js';
import { SessionStatus, STAGE_SEQUENCE } from '../../types/workflow.js';
import { parseScriptText } from '../../types/script.parser.js';

export const workflowRoutes = new Hono();

// Create Project (supports /api/project/create and /api/project/start)
const handleCreateProject = async (c: any) => {
  try {
    const body = await c.req.json();
    const title = body.title || '未命名互动短剧';
    const meta = {
      idea: body.idea || '在悬疑雨夜下的商业博弈',
      style: body.style || '电影质感，冷色调，高对比度光影',
      videoRatio: body.videoRatio || body.video_ratio || '16:9',
      videoResolution: body.videoResolution || body.video_resolution || '720P',
      episodes: body.episodes || 1,
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

workflowRoutes.post('/api/project/create', handleCreateProject);
workflowRoutes.post('/api/project/start', handleCreateProject);

// List Projects (supports /api/project/list and /api/sessions)
const handleListSessions = (c: any) => {
  const list = sessionManager.listSessions();
  return c.json({ success: true, list, sessions: list });
};
workflowRoutes.get('/api/project/list', handleListSessions);
workflowRoutes.get('/api/sessions', handleListSessions);

// Get Project Status & Detail (supports /api/project/:id and /api/project/:id/status)
const handleGetStatus = (c: any) => {
  const id = c.req.param('id');
  const session = sessionManager.getSession(id);
  if (!session) return c.json({ success: false, error: 'Project not found' }, 404);

  const stageStatusMap: Record<string, string> = {};
  for (const stage of STAGE_SEQUENCE) {
    if (session.stageArtifacts[stage]) {
      stageStatusMap[stage] = 'completed';
    } else if (session.currentStage === stage) {
      stageStatusMap[stage] = session.status === 'waiting_for_intervention' ? 'waiting' : session.status;
    } else {
      stageStatusMap[stage] = 'idle';
    }
  }
  if (session.status === 'completed') {
    for (const stage of STAGE_SEQUENCE) {
      stageStatusMap[stage] = 'completed';
    }
    stageStatusMap['video_post'] = 'completed';
  }

  return c.json({
    success: true,
    session_id: session.id,
    current_stage: session.currentStage,
    status: stageStatusMap,
    artifacts: session.stageArtifacts,
    error: session.status === 'failed' ? 'Stage execution failed' : null,
    session,
  });
};

workflowRoutes.get('/api/project/:id', handleGetStatus);
workflowRoutes.get('/api/project/:id/status', handleGetStatus);
workflowRoutes.get('/api/project/:id/status/from_disk', handleGetStatus);

// Get Specific Stage Artifact
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

// Update / Patch Stage Artifact (e.g. user selected portrait version, edited descriptions)
workflowRoutes.patch('/api/project/:id/artifact/:stage', async (c) => {
  try {
    const id = c.req.param('id');
    const stage = c.req.param('stage');
    const session = sessionManager.getSession(id);
    if (!session) return c.json({ success: false, error: 'Project not found' }, 404);

    const patchData = await c.req.json();
    const existing = session.stageArtifacts[stage] || {};

    if (patchData.selections && typeof patchData.selections === 'object') {
      if (Array.isArray(existing.characters)) {
        for (const ch of existing.characters) {
          const sel = patchData.selections[ch.id] || patchData.selections[ch.name];
          if (sel) {
            ch.selected = sel;
            ch.imageUrl = sel;
          }
        }
      }
      if (existing.bible && Array.isArray(existing.bible.characters)) {
        for (const ch of existing.bible.characters) {
          const sel = patchData.selections[ch.id] || patchData.selections[ch.name];
          if (sel) {
            ch.selected = sel;
            ch.imageUrl = sel;
          }
        }
      }
      if (Array.isArray(existing.settings)) {
        for (const st of existing.settings) {
          if (patchData.selections[st.id]) {
            st.selected = patchData.selections[st.id];
            st.imageUrl = patchData.selections[st.id];
          }
        }
      }
    }

    if (stage === 'script_generation' && patchData.scriptText) {
      const parsed = parseScriptText(patchData.scriptText);
      patchData.title = parsed.title !== '未命名剧作' ? parsed.title : (existing.title || patchData.title);
      patchData.theme = parsed.theme !== '影视短片' ? parsed.theme : (existing.theme || patchData.theme);
      if (parsed.characterNames.length > 0) patchData.characterNames = parsed.characterNames;
      if (parsed.locations.length > 0) patchData.locations = parsed.locations;
      if (parsed.episodes.length > 0) patchData.episodes = parsed.episodes;
      patchData.rawText = patchData.scriptText;
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

// Upload and attach image to a stage artifact
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

    const stageDir = path.join(config.paths.projects, id, stage);
    fs.mkdirSync(stageDir, { recursive: true });

    const originalName = (file as File).name || 'upload.png';
    const ext = path.extname(originalName) || '.png';
    const filename = `${itemId || 'uploaded'}_${itemType}_${Date.now()}${ext}`;
    const filePath = path.join(stageDir, filename);

    const arrayBuffer = await (file as File).arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

    const webPath = `/media/${id}/${stage}/${filename}`;

    const artifact = session.stageArtifacts[stage] || {};
    if (stage === 'script_generation') {
      const chars = artifact.characters || artifact.bible?.characters || [];
      const targetChar = chars.find((ch: any) => ch.name === itemId || ch.id === itemId);
      const isRef = itemType === 'reference';

      if (targetChar) {
        if (isRef) {
          targetChar.referenceImageUrl = webPath;
        } else {
          targetChar.imageUrl = webPath;
          targetChar.selected = webPath;
          if (!targetChar.versions) targetChar.versions = [];
          if (!targetChar.versions.includes(webPath)) targetChar.versions.unshift(webPath);
        }
      }
      if (artifact.bible && Array.isArray(artifact.bible.characters)) {
        const bChar = artifact.bible.characters.find((ch: any) => ch.name === itemId || ch.id === itemId);
        if (bChar) {
          if (isRef) {
            bChar.referenceImageUrl = webPath;
          } else {
            bChar.imageUrl = webPath;
            bChar.selected = webPath;
            if (!bChar.versions) bChar.versions = [];
            if (!bChar.versions.includes(webPath)) bChar.versions.unshift(webPath);
          }
        }
      }
    } else if (stage === 'character_design') {
      const isRef = itemType === 'reference';
      const chars = artifact.characters || [];
      const targetChar = chars.find((ch: any) => ch.id === itemId || ch.name === itemId);
      if (targetChar) {
        if (isRef) {
          targetChar.referenceImageUrl = webPath;
        } else {
          targetChar.imageUrl = webPath;
          targetChar.selected = webPath;
          if (!targetChar.versions) targetChar.versions = [];
          if (!targetChar.versions.includes(webPath)) targetChar.versions.unshift(webPath);
        }
      }
      const settings = artifact.settings || [];
      const targetSetting = settings.find((st: any) => st.id === itemId || st.location === itemId);
      if (targetSetting) {
        if (isRef) {
          targetSetting.referenceImageUrl = webPath;
        } else {
          targetSetting.imageUrl = webPath;
          targetSetting.selected = webPath;
          if (!targetSetting.versions) targetSetting.versions = [];
          if (!targetSetting.versions.includes(webPath)) targetSetting.versions.unshift(webPath);
        }
      }
    } else if (stage === 'reference_generation') {
      const shots = artifact.shots || [];
      const targetShot = shots.find((sh: any) => sh.shot_id === itemId || sh.id === itemId);
      if (targetShot) {
        targetShot.imageUrl = webPath;
        targetShot.selected = webPath;
        if (!targetShot.versions) targetShot.versions = [];
        if (!targetShot.versions.includes(webPath)) targetShot.versions.unshift(webPath);
      }
    }

    sessionManager.saveSession(session);

    return c.json({
      success: true,
      status: 'saved',
      path: webPath,
      artifact: session.stageArtifacts[stage],
      status_map: {},
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// Step / Advance Workflow
workflowRoutes.post('/api/project/:id/continue', async (c) => {
  try {
    const id = c.req.param('id');
    const session = await orchestrator.continue(id);
    return c.json({ success: true, session, next_stage: session.currentStage });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// Revise with user feedback (supports /revise and /intervene)
const handleRevise = async (c: any) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const feedback = body.feedback || body.modifications || (Object.keys(body).length > 0 ? body : '');
    const session = await orchestrator.revise(id, typeof feedback === 'string' ? feedback : JSON.stringify(feedback));
    return c.json({ success: true, session });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
};
workflowRoutes.post('/api/project/:id/revise', handleRevise);
workflowRoutes.post('/api/project/:id/intervene', handleRevise);

// Run all stages end-to-end
workflowRoutes.post('/api/project/:id/run-all', async (c) => {
  try {
    const id = c.req.param('id');
    const session = await orchestrator.runAll(id);
    return c.json({ success: true, session });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// Execute specific stage (called by WebUI stage controllers, with NDJSON streaming)
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
        data: stageArtifact,
      }));
    } catch (err: any) {
      await stream.writeln(JSON.stringify({
        type: 'error',
        content: err.message || 'Stage execution failed',
      }));
    }
  });
});

// Stop project execution
workflowRoutes.post('/api/project/:id/stop', (c) => {
  const id = c.req.param('id');
  const session = sessionManager.getSession(id);
  if (session) {
    session.status = SessionStatus.FAILED;
    sessionManager.saveSession(session);
  }
  return c.json({ status: 'ok', success: true });
});

// Delete session & local project directory
workflowRoutes.delete('/api/sessions/:id', (c) => {
  const id = c.req.param('id');
  const sessionPath = path.join(config.paths.sessions, `${id}.json`);
  const projectDir = path.join(config.paths.projects, id);
  if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
  if (fs.existsSync(projectDir)) fs.rmSync(projectDir, { recursive: true, force: true });
  return c.json({ status: 'ok', success: true });
});

// Query Scene Assets Count
workflowRoutes.get('/api/project/:id/scene/:sceneNumber/assets', (c) => {
  const { id, sceneNumber } = c.req.param();
  const session = sessionManager.getSession(id);
  const refCount = (session?.stageArtifacts?.reference_generation as any)?.shots?.length || 0;
  const videoCount = (session?.stageArtifacts?.video_post as any)?.totalClips || 0;
  const shotCount = (session?.stageArtifacts?.storyboard as any)?.shots?.length || 0;
  return c.json({
    scene_number: parseInt(sceneNumber, 10),
    reference_images: refCount,
    videos: videoCount,
    shot_count: shotCount,
  });
});
