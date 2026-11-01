/**
 * api/controllers/ProjectController.ts
 * 项目生命周期与阶段元数据控制器 (Project Controller SSOT)
 */

import fs from 'fs';
import path from 'path';
import { Hono } from 'hono';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { WorkflowStage, SessionStatus, type WorkflowSession } from '../../types/index.js';

export const projectController = new Hono();

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

// 阶段清单接口
projectController.get('/api/stages', (c) => {
  return c.json({ success: true, stages: STAGES_METADATA });
});

// 创建新项目
projectController.post('/api/project/start', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const rawIdea = typeof body.idea === 'string' ? body.idea.trim() : '';
    if (!rawIdea) {
      return c.json({ success: false, error: '缺少核心故事构思或题材创意 (idea)，创建项目必须提供明确创意输入' }, 400);
    }

    const title = (typeof body.title === 'string' && body.title.trim()) ? body.title.trim() : '未命名互动影游';
    // 🌟 源头单一事实来源收敛 (SSOT)：严格消费标准驼峰契约，连根拔除旧别名
    const standardRatio = (body.videoRatio === '9:16' || body.videoRatio === '1:1') ? body.videoRatio : '16:9';
    const standardResolution = (body.videoResolution === '1080P' || body.videoResolution === '480P') ? body.videoResolution : '720P';

    const meta = {
      idea: rawIdea,
      style: (typeof body.style === 'string' && body.style.trim()) ? body.style.trim() : '电影质感，高品质影视光影',
      videoRatio: standardRatio as '16:9' | '9:16' | '1:1',
      videoResolution: standardResolution as '480P' | '720P' | '1080P',
      episodes: body.episodes || 1,
    };

    const projectId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const store = ProjectStore.getInstance();

    const project: WorkflowSession = {
      projectId,
      title,
      meta,
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [
        {
          timestamp: new Date().toISOString(),
          stage: WorkflowStage.NARRATIVE_DESIGN,
          action: 'PROJECT_CREATED',
          details: `Project "${title}" created`,
        },
      ],
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    store.saveProject(project);

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

// 获取项目列表 (同时支持标准 REST /api/projects 与 /api/project/list)
const handleListProjects = (c: any) => {
  try {
    const store = ProjectStore.getInstance();
    const projects = store.listProjects();
    return c.json({ success: true, projects });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
};
projectController.get('/api/projects', handleListProjects);

// 获取项目状态快照 (对齐 workflowApi.ts 中的 /api/project/:projectId/status)
projectController.get('/api/project/:projectId/status', (c) => {
  try {
    const projectId = c.req.param('projectId');
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }
    return c.json({
      success: true,
      projectId,
      status: project.status,
      currentStage: project.currentStage,
      project,
      artifacts: project.stageArtifacts || {},
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 获取项目全局状态黑板指定阶段产物 (Artifact GET SSOT)
projectController.get('/api/project/:projectId/artifact/:stage', (c) => {
  try {
    const projectId = c.req.param('projectId');
    const stage = c.req.param('stage');
    const store = ProjectStore.getInstance();
    const artifact = store.getArtifact(projectId, stage);
    if (!artifact) {
      return c.json({ success: false, error: `阶段 [${stage}] 产物尚未生成` }, 404);
    }
    return c.json({ success: true, stage, artifact });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 写入/更新项目全局状态黑板指定阶段产物 (Artifact POST/PATCH SSOT)
const handleSaveArtifact = async (c: any) => {
  try {
    const projectId = c.req.param('projectId');
    const stage = c.req.param('stage');
    const body = await c.req.json().catch(() => ({}));
    const store = ProjectStore.getInstance();
    store.setArtifact(projectId, stage, body);
    return c.json({ success: true, stage, message: `阶段 [${stage}] 产物已更新` });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
};
projectController.post('/api/project/:projectId/artifact/:stage', handleSaveArtifact);
projectController.patch('/api/project/:projectId/artifact/:stage', handleSaveArtifact);

// 🌟 上传阶段媒体图片 (如角色定妆目标图、面部参考图等，消除 404)
projectController.post('/api/project/:projectId/artifact/:stage/upload_image', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const stage = c.req.param('stage');
    const store = ProjectStore.getInstance();

    const body = await c.req.parseBody();
    const file = body['file'];
    const itemType = (body['item_type'] as string) || 'characters';
    const itemId = (body['item_id'] as string) || `img_${Date.now()}`;

    if (!file || typeof file === 'string') {
      return c.json({ success: false, error: '缺少有效的上传文件' }, 400);
    }

    const projectDir = store.getProjectDir(projectId);
    const targetDir = path.join(projectDir, itemType);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const safeItemId = encodeURIComponent(itemId);
    const originalName = (file as any).name || 'upload.png';
    const ext = path.extname(originalName) || '.jpg';
    const filename = `${safeItemId}_${Date.now()}${ext}`;
    const fullPath = path.join(targetDir, filename);

    // 将二进制写入本地磁盘
    const arrayBuffer = await (file as Blob).arrayBuffer();
    fs.writeFileSync(fullPath, Buffer.from(arrayBuffer));

    const localUrl = `/media/${projectId}/${itemType}/${filename}`;

    // 🌟 自动回写并持久化该阶段资产 (如 character_design 角色列表)
    let artifact = store.getArtifact<any>(projectId, stage as any);
    if (stage === 'character_design' && artifact && Array.isArray(artifact.characters)) {
      artifact.characters = artifact.characters.map((char: any) => {
        if (char.name === itemId || char.id === itemId) {
          if (itemType === 'reference') {
            return { ...char, referenceImageUrl: localUrl };
          } else {
            return { ...char, imageUrl: localUrl, selected: true };
          }
        }
        return char;
      });
      store.setArtifact(projectId, stage as any, artifact);
    }

    return c.json({
      status: 'success',
      path: localUrl,
      artifact,
      status_map: { [itemId]: 'ready' },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 获取项目详情
projectController.get('/api/project/:projectId', (c) => {
  try {
    const projectId = c.req.param('projectId');
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }
    return c.json({ success: true, project });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 删除项目
projectController.delete('/api/project/:projectId', (c) => {
  try {
    const projectId = c.req.param('projectId');
    const store = ProjectStore.getInstance();
    store.deleteProject(projectId);
    return c.json({ success: true, message: 'Project deleted' });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});
