import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { recordEntityUpdated, recordEntitySpecUpdated } from '../../project-store/freshness.js';
import { safeReadJsonSync, atomicWriteJsonSync } from '../../utils/atomicFile.js';
import { compileVisualEditPrompt } from '../../tools/film-production/shared/visual-edit-prompt.js';
import { taskDispatcher } from '../../task-engine/index.js';
import { sendError } from '../helpers.js';

const store = ProjectStore.getInstance();

export const uploadReference = (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const { filename, dataUrl, entityType, entityId } = req.body || {};

    if (!dataUrl || !entityType || !entityId) {
      return sendError(res, 400, '缺少必要参数: dataUrl, entityType, entityId');
    }

    const projectDir = store.getProjectDir(projectId);
    const refDir = path.join(projectDir, 'assets', 'references');
    if (!fs.existsSync(refDir)) {
      fs.mkdirSync(refDir, { recursive: true });
    }

    // 解析 Base64
    const matches = String(dataUrl).match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    let buffer: Buffer;
    let ext = '.png';
    if (matches && matches.length === 3) {
      const mime = matches[1];
      if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg';
      else if (mime.includes('webp')) ext = '.webp';
      else if (mime.includes('svg')) ext = '.svg';
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(String(dataUrl), 'base64');
    }

    const safeBaseName = (filename || `${entityId}_ref`)
      .replace(/[^a-zA-Z0-9_\-\.]/g, '_')
      .replace(/\.[^/.]+$/, '');
    const cleanFilename = `${safeBaseName}_${Date.now()}${ext}`;
    const filePath = path.join(refDir, cleanFilename);
    fs.writeFileSync(filePath, buffer);

    const mediaUrl = `/media/${encodeURIComponent(projectId)}/assets/references/${encodeURIComponent(cleanFilename)}`;

    // 同步更新实体
    const scenesDir = path.join(projectDir, 'scenes');
    const entitiesPath = path.join(scenesDir, 'entities.json');
    const entities =
      store.getArtifact<any>(projectId, 'lookdev_entities') ||
      safeReadJsonSync<any>(entitiesPath) ||
      {};

    if (entityType === 'character') {
      const char = (entities.characters || []).find((c: any) => c.characterId === entityId);
      if (char) {
        char.referenceImageUrl = mediaUrl;
      }
    } else if (entityType === 'location') {
      const loc = (entities.locations || []).find((l: any) => l.locationId === entityId);
      if (loc) {
        loc.referenceImageUrl = mediaUrl;
      }
    } else if (entityType === 'item') {
      const item = (entities.items || []).find((i: any) => i.itemId === entityId);
      if (item) item.referenceImageUrl = mediaUrl;
    }

    store.setArtifact(projectId, 'lookdev_entities', entities);
    if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
    atomicWriteJsonSync(entitiesPath, entities);

    res.json({ success: true, mediaUrl });
  } catch (err: any) {
    sendError(res, 500, `上传参考图失败: ${err.message}`);
  }
};
export const updateEntity = (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const { entityType, entityId, updates } = req.body || {};

    if (!entityType || !entityId || !updates) {
      return sendError(res, 400, '缺少必要参数');
    }

    const projectDir = store.getProjectDir(projectId);
    const scenesDir = path.join(projectDir, 'scenes');
    const entitiesPath = path.join(scenesDir, 'entities.json');
    const entities =
      store.getArtifact<any>(projectId, 'lookdev_entities') ||
      safeReadJsonSync<any>(entitiesPath) ||
      {};

    let target: any = null;
    if (entityType === 'character') {
      target = (entities.characters || []).find((c: any) => (c.characterId || c.id) === entityId);
    } else if (entityType === 'location') {
      target = (entities.locations || []).find((l: any) => (l.locationId || l.id) === entityId);
    } else if (entityType === 'item') {
      target = (entities.items || []).find((i: any) => (i.itemId || i.id) === entityId);
    }

    if (!target) {
      return sendError(res, 404, `未在视觉资产中找到实体 [${entityId}]`);
    }

    if (updates.promptZh !== undefined) {
      target.promptZh = updates.promptZh;
    }
    if (updates.appearanceSummary !== undefined) {
      target.appearanceSummary = updates.appearanceSummary;
    }
    if (updates.voiceStyle !== undefined) {
      target.voiceStyle = updates.voiceStyle;
    }
    if (updates.atmosphere !== undefined) {
      target.atmosphere = updates.atmosphere;
    }
    if (updates.spatialLayout !== undefined) {
      target.spatialLayout = String(updates.spatialLayout || '');
    }
    if (updates.referenceImageUrl !== undefined) {
      if (!updates.referenceImageUrl) {
        const oldRefUrl = target.referenceImageUrl;
        delete target.referenceImageUrl;
        // 同步物理清理磁盘残留文件，彻底杜绝死灰复燃
        const refDir = path.join(projectDir, 'assets', 'references');
        if (fs.existsSync(refDir)) {
          // 1. 若有明确原底图路径，直接物理删除
          if (oldRefUrl) {
            try {
              const directName = path.basename(String(oldRefUrl).split('?')[0]);
              const directFile = path.join(refDir, directName);
              if (fs.existsSync(directFile)) {
                fs.unlinkSync(directFile);
              }
            } catch (e) {
              console.warn('[DeleteReference] 清理原底图文件失败:', e);
            }
          }
          // 2. 匹配所有属于该实体的历史碎片文件并物理清理
          const files = fs.readdirSync(refDir);
          const targetId = entityId;
          const matchedFiles = files.filter(
            (f) => f.startsWith(`${targetId}_`) || f.startsWith(`${targetId}.`) || f.includes(targetId)
          );
          matchedFiles.forEach((file) => {
            try {
              fs.unlinkSync(path.join(refDir, file));
            } catch (e) {
              console.warn(`[DeleteReference] 物理清理底图文件失败: ${file}`, e);
            }
          });
        }
      } else {
        target.referenceImageUrl = updates.referenceImageUrl;
      }
    }

    store.setArtifact(projectId, 'lookdev_entities', entities);
    if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
    atomicWriteJsonSync(entitiesPath, entities);

    // 若更新了设定字段（prompt/门窗/陈设/氛围），登记设定变更记账以触发脏态检测
    if (
      updates.promptZh !== undefined ||
      updates.spatialLayout !== undefined ||
      updates.appearanceSummary !== undefined ||
      updates.atmosphere !== undefined
    ) {
      recordEntitySpecUpdated(projectId, {
        kind: entityType,
        id: entityId,
        label: target.name || entityId,
      });
    }

    res.json({ success: true, entity: target });
  } catch (err: any) {
    sendError(res, 500, `更新实体失败: ${err.message}`);
  }
};
export const selectEntityVersion = (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const { entityType, entityId, versionId } = req.body || {};

    if (!entityType || !entityId || !versionId) {
      return sendError(res, 400, '缺少必要参数: entityType, entityId, versionId');
    }

    const projectDir = store.getProjectDir(projectId);
    const scenesDir = path.join(projectDir, 'scenes');
    const entitiesPath = path.join(scenesDir, 'entities.json');
    const entities =
      store.getArtifact<any>(projectId, 'lookdev_entities') ||
      safeReadJsonSync<any>(entitiesPath) ||
      {};

    let target: any = null;
    if (entityType === 'character') {
      target = (entities.characters || []).find((c: any) => c.characterId === entityId);
    } else if (entityType === 'location') {
      target = (entities.locations || []).find((l: any) => l.locationId === entityId);
    } else if (entityType === 'item') {
      target = (entities.items || []).find((i: any) => i.itemId === entityId);
    }

    if (!target) {
      return sendError(res, 404, `未在视觉资产中找到实体 [${entityId}]`);
    }

    if (!Array.isArray(target.versions)) {
      return sendError(res, 409, '资产缺少版本清单');
    }
    const versions = target.versions;
    const matchedVersion = versions.find((v: any) => v.versionId === versionId);
    if (!matchedVersion) {
      return sendError(res, 404, `未在实体历史版本中找到版本 [${versionId}]`);
    }

    // 激活该版本 (只切换立绘版本与状态，保留当前最新 promptZh，绝不篡改 target.referenceImageUrl)
    target.selectedVersionId = matchedVersion.versionId;
    target.imageUrl = matchedVersion.imageUrl;
    if (matchedVersion.reviewStatus === 'pending') matchedVersion.reviewStatus = 'accepted';
    if (matchedVersion.poseConstraint) target.poseConstraint = matchedVersion.poseConstraint;

    store.setArtifact(projectId, 'lookdev_entities', entities);
    if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
    atomicWriteJsonSync(entitiesPath, entities);

    if (entityType === 'character' || entityType === 'location' || entityType === 'item') {
      recordEntityUpdated(projectId, {
        kind: entityType,
        id: entityId,
        label: target.name || entityId,
      });
    }

    res.json({ success: true, entity: target });
  } catch (err: any) {
    sendError(res, 500, `切换定妆版本失败: ${err.message}`);
  }
};
export const refineEntityImage = async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const { entityType, entityId, instruction, baseImageUrl } = req.body || {};

    if (!entityType || !entityId || !instruction || !instruction.trim()) {
      return sendError(res, 400, '缺少必要参数: entityType, entityId, instruction');
    }

    const projectDir = store.getProjectDir(projectId);
    const scenesDir = path.join(projectDir, 'scenes');
    const entitiesPath = path.join(scenesDir, 'entities.json');
    const entities =
      store.getArtifact<any>(projectId, 'lookdev_entities') ||
      safeReadJsonSync<any>(entitiesPath) ||
      {};

    let target: any = null;
    if (entityType === 'character') {
      target = (entities.characters || []).find((c: any) => c.characterId === entityId);
    } else if (entityType === 'location') {
      target = (entities.locations || []).find((l: any) => l.locationId === entityId);
    } else if (entityType === 'item') {
      target = (entities.items || []).find((i: any) => i.itemId === entityId);
    }

    if (!target) {
      return sendError(res, 404, `未在视觉资产中找到实体 [${entityId}]`);
    }

    // 确定参考底图：优先指定 baseImageUrl，其次 target.imageUrl
    const effectiveBaseImage = baseImageUrl || target.imageUrl || target.referenceImageUrl;
    if (!effectiveBaseImage) {
      return sendError(
        res,
        400,
        `该${entityType === 'character' ? '角色' : entityType === 'item' ? '道具' : '场景'}尚未生成首张图，无法基于原图进行定向修改。请先生成首张图。`
      );
    }

    // 1. 调用大模型进行通用的多模态视听语义动态差分编译 (Dynamic Differential Multi-Modal Compilation)
    const isChar = entityType === 'character';
    const isItem = entityType === 'item';
    const { directedPrompt, negativePrompt, poseConstraint } = await compileVisualEditPrompt({
      entityType: isChar ? 'character' : isItem ? 'item' : 'location',
      name: target.name,
      originalDescription: target.promptZh || target.appearanceSummary || '',
      instruction,
    });

    // 2. 派发单实体原子渲染任务（带 referenceImageUrls 触发 ref2i 多模态工作流，并传入针对性负向词与原始指令）
    const taskInput = {
      projectId,
      targetKind: entityType,
      targetId: entityId,
      instruction: instruction.trim(),
      customPrompt: directedPrompt,
      customNegativePrompt: negativePrompt || undefined,
      ...(isChar && poseConstraint ? { poseConstraint } : {}),
      referenceImageUrls: [effectiveBaseImage],
      force: true,
    };

    const task = await taskDispatcher.dispatch({
      projectId,
      toolName: 'film.lookdev',
      input: taskInput,
    });

    res.json({
      success: true,
      directedPrompt,
      negativePrompt,
      poseConstraint,
      baseImageUrl: effectiveBaseImage,
      task,
    });
  } catch (err: any) {
    sendError(res, 500, `基于当前图定向精修失败: ${err.message}`);
  }
};
