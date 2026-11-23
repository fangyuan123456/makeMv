/**
 * api/routes/projects.route.ts
 * 项目工程管理与资产查询路由 (Projects Domain Route SSOT)
 */

import { Router } from 'express';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { getProjectSnapshot } from '../services/project-read.service.js';
import {
  getStoryboardCanvas,
  saveStoryboardCanvas,
  selectStoryboardCandidate,
} from '../services/storyboard-canvas.service.js';
import {
  uploadReference,
  updateEntity,
  selectEntityVersion,
  refineEntityImage,
} from '../services/lookdev-assets.service.js';
import {
  selectShotVersion,
  updateShotPrompt,
  updateShotContinuity,
  refineShotImage,
} from '../services/shot-assets.service.js';
import { sendError } from '../helpers.js';

export const projectsRouter = Router();
const store = ProjectStore.getInstance();

async function projectMutationLock(req: any, res: any, next: any): Promise<void> {
  if (req.method === 'GET' || !req.params.id) {
    next();
    return;
  }

  let release: (() => void) | undefined;
  try {
    release = await store.acquireProjectLock(req.params.id);
    let released = false;
    const releaseOnce = () => {
      if (released) return;
      released = true;
      release?.();
    };
    res.once('finish', releaseOnce);
    res.once('close', releaseOnce);
    next();
  } catch (err) {
    release?.();
    next(err);
  }
}

projectsRouter.use('/:id', projectMutationLock);

/**
 * 列出所有项目元数据
 * GET /api/projects
 */
projectsRouter.get('/', (_req, res) => {
  const list = store.listProjects();
  res.json(list);
});

/**
 * 创建新项目
 * POST /api/projects
 */
projectsRouter.post('/', (req, res) => {
  try {
    const { title, genre } = req.body || {};
    const projectId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const proj = store.getProject(projectId);
    if (title) proj.meta.title = title;
    if (genre) proj.meta.genre = genre;
    store.saveProject(proj);
    res.json(proj.meta);
  } catch (err: any) {
    sendError(res, 500, err.message);
  }
});

/**
 * 获取指定项目的完整工程详情与资产
 * GET /api/projects/:id
 */
projectsRouter.get('/:id', getProjectSnapshot);

/**
 * 获取指定项目的视听分镜无限画布拓扑数据
 * GET /api/projects/:id/canvas/storyboard
 */
projectsRouter.get('/:id/canvas/storyboard', getStoryboardCanvas);

/**
 * 保存/更新视听分镜画布数据 (坐标位置、连线流向、新增/复制节点)
 * POST /api/projects/:id/canvas/storyboard
 */
projectsRouter.post('/:id/canvas/storyboard', saveStoryboardCanvas);

/**
 * 切换分镜节点的当前激活候选视频 (Candidate Selection)
 * POST /api/projects/:id/canvas/storyboard/select-candidate
 * Body: { nodeId: string, taskId: string }
 */
projectsRouter.post('/:id/canvas/storyboard/select-candidate', selectStoryboardCandidate);

/**
 * 上传角色或场景的参考图（垫图）
 * POST /api/projects/:id/upload-reference
 * Body: { filename: string, dataUrl: string, entityType: 'character' | 'location', entityId: string }
 */
projectsRouter.post('/:id/upload-reference', uploadReference);

/**
 * 实时更新实体属性 (如微调 promptZh 或清除 referenceImageUrl)
 * POST /api/projects/:id/entities/update
 * Body: { entityType: 'character' | 'location', entityId: string, updates: { promptZh?: string, referenceImageUrl?: string } }
 */
projectsRouter.post('/:id/entities/update', updateEntity);

/**
 * 切换指定实体的激活版本 (Lookdev Version Switch)
 * POST /api/projects/:id/entities/select-version
 * Body: { entityType: 'character' | 'location', entityId: string, versionId: string }
 */
projectsRouter.post('/:id/entities/select-version', selectEntityVersion);

/**
 * 基于当前图的 AI 定向精修 (Image-to-Image / Ref2Image)
 * 严格锁定人物面容五官、体型骨骼与构图，根据自然语言指令定向修改服饰/发型/色彩并自动出图
 * POST /api/projects/:id/entities/image-refine
 * Body: { entityType: 'character' | 'location', entityId: string, instruction: string, baseImageUrl?: string }
 */
projectsRouter.post('/:id/entities/image-refine', refineEntityImage);

/**
 * 分镜镜头首/末帧资产（版本库 / 提示词 / 定向微调）
 */
projectsRouter.post('/:id/shots/select-version', selectShotVersion);
projectsRouter.post('/:id/shots/update-prompt', updateShotPrompt);
projectsRouter.post('/:id/shots/update-continuity', updateShotContinuity);
projectsRouter.post('/:id/shots/refine', refineShotImage);
