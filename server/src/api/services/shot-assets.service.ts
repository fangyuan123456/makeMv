/**
 * api/services/shot-assets.service.ts
 * 分镜镜头首/末帧资产：历史版本切换、提示词保存、基于当前图定向微调。
 *
 * 与定妆资产的差别只有一个：这里的数据源是 storyboards.json（film_spec.clips），
 * 不是 scenes/entities.json。其余玩法（版本库 / 微调 / 保存提示词）保持一致。
 */

import path from 'node:path';
import type { Request, Response } from 'express';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import {
  activeFrameUrl,
  applyFrameVersion,
  applyVideoVersion,
  frameVersionsKey,
  readFrameVersions,
  readVideoVersions,
  type ShotFrameKind,
  type ShotFrameVersion,
  type ShotVideoVersion,
} from '../../project-store/shot-frame-versions.js';
import { recordShotKeyframeUpdated, recordShotPromptUpdated, recordStoryboardUpdated } from '../../project-store/freshness.js';
import { atomicWriteJsonSync } from '../../utils/atomicFile.js';
import { compileVisualEditPrompt } from '../../tools/film-production/shared/visual-edit-prompt.js';
import { taskDispatcher } from '../../task-engine/index.js';
import { sendError } from '../helpers.js';

const store = ProjectStore.getInstance();

function parseFrame(value: any): ShotFrameKind {
  return value === 'last' ? 'last' : 'first';
}

interface LocatedShot {
  shot: any;
  clip: any;
  clips: any[];
}

function locateShot(projectId: string, shotId: string): LocatedShot | null {
  const filmSpec = store.getArtifact<any>(projectId, 'film_spec');
  const clips: any[] =
    filmSpec?.clips || store.getArtifact<any[]>(projectId, 'storyboards') || [];
  for (const clip of clips) {
    if (!clip) continue;
    if ((clip.shotId || clip.id) === shotId && !Array.isArray(clip.shots)) {
      return { shot: clip, clip, clips };
    }
    const shot = Array.isArray(clip.shots)
      ? clip.shots.find((s: any) => (s?.shotId || s?.id) === shotId)
      : undefined;
    if (shot) return { shot, clip, clips };
  }
  return null;
}

function persistClips(projectId: string, clips: any[]): void {
  const filmSpec = store.getArtifact<any>(projectId, 'film_spec');
  if (filmSpec) store.setArtifact(projectId, 'film_spec', filmSpec);
  store.setArtifact(projectId, 'storyboards', clips);
  atomicWriteJsonSync(path.join(store.getProjectDir(projectId), 'storyboards.json'), clips);
}

/** 版本切换后同步分镜画布节点，避免主画布仍显示旧图及旧参数 */
function syncCanvasNode(
  projectId: string,
  shotId: string,
  frame: 'first' | 'last' | 'video',
  version: ShotFrameVersion | ShotVideoVersion
): void {
  const canvas = store.getArtifact<any>(projectId, 'storyboard_canvas');
  if (!canvas?.nodes) return;
  let updated = false;
  for (const node of Object.values<any>(canvas.nodes)) {
    if (node.shotId !== shotId && node.id !== `node_${shotId}`) continue;
    if (frame === 'video') {
      const v = version as ShotVideoVersion;
      node.videoUrl = v.videoUrl;
      if (v.prompt) node.videoPrompt = v.prompt;
      if (v.continuityMode) node.continuityMode = v.continuityMode;
      if (v.motionDirective !== undefined) node.motionDirective = v.motionDirective;
      if (v.dynamicDirective !== undefined) node.dynamicDirective = v.dynamicDirective;
      if (v.focusDirective !== undefined) node.focusDirective = v.focusDirective;
    } else if (frame === 'last') {
      const v = version as ShotFrameVersion;
      node.lastFrameUrl = v.imageUrl;
      if (v.upscale) node.lastFrameUpscale = v.upscale;
      else delete node.lastFrameUpscale;
      if (v.prompt) node.lastFramePrompt = v.prompt;
      if (v.continuityMode) node.lastFrameContinuityMode = v.continuityMode;
      if (v.cameraDirective !== undefined) node.lastFrameCameraDirective = v.cameraDirective;
      if (v.colorDirective !== undefined) node.lastFrameColorDirective = v.colorDirective;
      if (v.poseDirective !== undefined) node.lastFramePoseDirective = v.poseDirective;
    } else {
      const v = version as ShotFrameVersion;
      node.keyframeUrl = v.imageUrl;
      if (v.upscale) node.firstFrameUpscale = v.upscale;
      else delete node.firstFrameUpscale;
      if (v.prompt) node.firstFramePrompt = v.prompt;
      if (v.continuityMode) node.continuityMode = v.continuityMode;
      if (v.cameraDirective !== undefined) {
        node.firstFrameCameraDirective = v.cameraDirective;
        node.cameraDirective = v.cameraDirective;
      }
      if (v.colorDirective !== undefined) {
        node.firstFrameColorDirective = v.colorDirective;
        node.colorDirective = v.colorDirective;
      }
      if (v.poseDirective !== undefined) {
        node.firstFramePoseDirective = v.poseDirective;
        node.poseDirective = v.poseDirective;
      }
    }
    updated = true;
  }
  if (updated) {
    store.setArtifact(projectId, 'storyboard_canvas', canvas);
    atomicWriteJsonSync(path.join(store.getProjectDir(projectId), 'storyboard_canvas.json'), canvas);
  }
}

/** POST /api/projects/:id/shots/select-version */
export const selectShotVersion = (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const { shotId, frame: rawFrame, versionId } = req.body || {};
    if (!shotId || !versionId) {
      return sendError(res, 400, '缺少必要参数: shotId, versionId');
    }
    const located = locateShot(projectId, shotId);
    if (!located) return sendError(res, 404, `未在分镜中找到镜头 [${shotId}]`);

    if (rawFrame === 'video') {
      const versions = readVideoVersions(located.shot);
      const matched = versions.find((v) => v.versionId === versionId);
      if (!matched) return sendError(res, 404, `未在视频版本库中找到版本 [${versionId}]`);

      located.shot.videoVersions = versions;
      applyVideoVersion(located.shot, matched);
      persistClips(projectId, located.clips);
      syncCanvasNode(projectId, shotId, 'video', matched);
      return res.json({ success: true, shot: located.shot, activeVersion: matched });
    }

    const frame = parseFrame(rawFrame);
    const versions = readFrameVersions(located.shot, frame);
    const matched = versions.find((v) => v.versionId === versionId);
    if (!matched) return sendError(res, 404, `未在版本库中找到版本 [${versionId}]`);

    located.shot[frameVersionsKey(frame)] = versions;
    applyFrameVersion(located.shot, frame, matched);
    persistClips(projectId, located.clips);
    syncCanvasNode(projectId, shotId, frame, matched);
    recordShotKeyframeUpdated(projectId, shotId, frame);

    res.json({ success: true, shot: located.shot, activeVersion: matched });
  } catch (err: any) {
    sendError(res, 500, `切换镜头版本失败: ${err.message}`);
  }
};

/** POST /api/projects/:id/shots/update-prompt */
export const updateShotPrompt = (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const {
      shotId,
      frame: rawFrame,
      prompt,
      cameraDirective,
      colorDirective,
      poseDirective,
      motionDirective,
      dynamicDirective,
      focusDirective,
      continuityMode,
    } = req.body || {};
    if (!shotId || typeof prompt !== 'string') {
      return sendError(res, 400, '缺少必要参数: shotId, prompt');
    }
    const located = locateShot(projectId, shotId);
    if (!located) return sendError(res, 404, `未在分镜中找到镜头 [${shotId}]`);

    if (continuityMode !== undefined) {
      located.shot.continuityMode = continuityMode;
    }

    if (rawFrame === 'video') {
      located.shot.videoPrompt = prompt;
      if (motionDirective !== undefined) located.shot.motionDirective = motionDirective;
      if (dynamicDirective !== undefined) located.shot.dynamicDirective = dynamicDirective;
      if (focusDirective !== undefined) located.shot.focusDirective = focusDirective;
    } else if (rawFrame === 'last') {
      located.shot.lastFramePrompt = prompt;
      if (cameraDirective !== undefined) located.shot.lastFrameCameraDirective = cameraDirective;
      if (colorDirective !== undefined) located.shot.lastFrameColorDirective = colorDirective;
      if (poseDirective !== undefined) located.shot.lastFramePoseDirective = poseDirective;
      const versions = readFrameVersions(located.shot, 'last');
      const active = activeFrameUrl(located.shot, 'last');
      const activeVersion = versions.find((v) => v.imageUrl?.split('?')[0] === active);
      if (activeVersion) activeVersion.prompt = prompt;
      located.shot[frameVersionsKey('last')] = versions;
    } else {
      located.shot.firstFramePrompt = prompt;
      if (cameraDirective !== undefined) {
        located.shot.firstFrameCameraDirective = cameraDirective;
        located.shot.cameraDirective = cameraDirective;
      }
      if (colorDirective !== undefined) {
        located.shot.firstFrameColorDirective = colorDirective;
        located.shot.colorDirective = colorDirective;
      }
      if (poseDirective !== undefined) {
        located.shot.firstFramePoseDirective = poseDirective;
        located.shot.poseDirective = poseDirective;
      }
      const versions = readFrameVersions(located.shot, 'first');
      const active = activeFrameUrl(located.shot, 'first');
      const activeVersion = versions.find((v) => v.imageUrl?.split('?')[0] === active);
      if (activeVersion) activeVersion.prompt = prompt;
      located.shot[frameVersionsKey('first')] = versions;
    }

    persistClips(projectId, located.clips);

    // 同步更新 storyboard_canvas，确保大画布即时消费最新提示词与视听元数据
    const canvas = store.getArtifact<any>(projectId, 'storyboard_canvas');
    if (canvas?.nodes) {
      let canvasUpdated = false;
      for (const node of Object.values<any>(canvas.nodes)) {
        if (node.shotId !== shotId && node.id !== `node_${shotId}`) continue;
        if (rawFrame === 'video') {
          node.videoPrompt = prompt;
          if (motionDirective !== undefined) node.motionDirective = motionDirective;
          if (dynamicDirective !== undefined) node.dynamicDirective = dynamicDirective;
          if (focusDirective !== undefined) node.focusDirective = focusDirective;
        } else if (rawFrame === 'last') {
          node.lastFramePrompt = prompt;
          if (cameraDirective !== undefined) node.lastFrameCameraDirective = cameraDirective;
          if (colorDirective !== undefined) node.lastFrameColorDirective = colorDirective;
          if (poseDirective !== undefined) node.lastFramePoseDirective = poseDirective;
        } else {
          node.firstFramePrompt = prompt;
          if (cameraDirective !== undefined) {
            node.firstFrameCameraDirective = cameraDirective;
            node.cameraDirective = cameraDirective;
          }
          if (colorDirective !== undefined) {
            node.firstFrameColorDirective = colorDirective;
            node.colorDirective = colorDirective;
          }
          if (poseDirective !== undefined) {
            node.firstFramePoseDirective = poseDirective;
            node.poseDirective = poseDirective;
          }
        }
        if (continuityMode !== undefined) {
          node.continuityMode = continuityMode;
        }
        canvasUpdated = true;
      }
      if (canvasUpdated) {
        store.setArtifact(projectId, 'storyboard_canvas', canvas);
        atomicWriteJsonSync(path.join(store.getProjectDir(projectId), 'storyboard_canvas.json'), canvas);
      }
    }

    // 记账：提示词更新（基于内容指纹感知真实变动，内容未改时不刷时间戳）
    if (rawFrame !== 'video') {
      recordShotPromptUpdated(projectId, [shotId], { [shotId]: prompt });
    }

    res.json({ success: true, shot: located.shot });
  } catch (err: any) {
    sendError(res, 500, `保存镜头提示词失败: ${err.message}`);
  }
};

/** POST /api/projects/:id/shots/update-continuity */
export const updateShotContinuity = (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const { shotId, continuityMode } = req.body || {};
    if (!shotId || !['auto', 'linked', 'detached'].includes(continuityMode)) {
      return sendError(res, 400, '缺少必要参数或非法模式: shotId, continuityMode (auto|linked|detached)');
    }
    const located = locateShot(projectId, shotId);
    if (!located) return sendError(res, 404, `未在分镜中找到镜头 [${shotId}]`);

    located.shot.continuityMode = continuityMode;
    persistClips(projectId, located.clips);

    // 同步更新 storyboard_canvas
    const canvas = store.getArtifact<any>(projectId, 'storyboard_canvas');
    if (canvas?.nodes) {
      let canvasUpdated = false;
      for (const node of Object.values<any>(canvas.nodes)) {
        if (node.shotId !== shotId && node.id !== `node_${shotId}`) continue;
        node.continuityMode = continuityMode;
        canvasUpdated = true;
      }
      if (canvasUpdated) {
        store.setArtifact(projectId, 'storyboard_canvas', canvas);
        atomicWriteJsonSync(path.join(store.getProjectDir(projectId), 'storyboard_canvas.json'), canvas);
      }
    }

    res.json({ success: true, shotId, continuityMode });
  } catch (err: any) {
    sendError(res, 500, `更新镜头连续性模式失败: ${err.message}`);
  }
};

/** POST /api/projects/:id/shots/refine */
export const refineShotImage = async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const { shotId, frame: rawFrame, instruction, baseImageUrl } = req.body || {};
    if (!shotId || !instruction?.trim()) {
      return sendError(res, 400, '缺少必要参数: shotId, instruction');
    }
    if (rawFrame === 'video') {
      return sendError(res, 400, '视频不支持基于当前图定向微调，请选择首帧或末帧');
    }
    const frame = parseFrame(rawFrame);
    const located = locateShot(projectId, shotId);
    if (!located) return sendError(res, 404, `未在分镜中找到镜头 [${shotId}]`);

    const effectiveBaseImage = (baseImageUrl || activeFrameUrl(located.shot, frame)).split('?')[0].trim();
    if (!effectiveBaseImage) {
      return sendError(res, 400, '该镜头尚未生成图片，请先生成首帧再进行微调');
    }

    const { directedPrompt, negativePrompt } = await compileVisualEditPrompt({
      entityType: 'shot',
      name: located.shot.title || located.shot.shotId || shotId,
      originalDescription:
        (frame === 'last' ? located.shot.lastFramePrompt : located.shot.firstFramePrompt) ||
        located.shot.videoPrompt ||
        located.shot.prompt ||
        '',
      instruction: instruction.trim(),
    });

    const task = await taskDispatcher.dispatch({
      projectId,
      toolName: 'film.shot_keyframe',
      input: {
        projectId,
        shotId,
        clipId: located.clip?.clipId || located.clip?.id,
        frame,
        customPrompt: directedPrompt,
        customNegativePrompt: negativePrompt || undefined,
        referenceImageUrls: [effectiveBaseImage],
        instruction: instruction.trim(),
        force: true,
      },
    });

    res.json({ success: true, directedPrompt, baseImageUrl: effectiveBaseImage, task });
  } catch (err: any) {
    sendError(res, 500, `镜头定向微调失败: ${err.message}`);
  }
};

/**
 * 更新指定分幕的视听摄制台本 (Shooting Script)
 * POST /api/projects/:id/shooting-script/update
 * Body: { clipId: string, shootingScript: any }
 */
export const updateShootingScript = async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const { clipId, shootingScript } = req.body || {};
    if (!clipId || !shootingScript) {
      return sendError(res, 400, '缺少必要参数: clipId, shootingScript');
    }

    const filmSpec = store.getArtifact<any>(projectId, 'film_spec') || { clips: [] };
    filmSpec.clips = Array.isArray(filmSpec.clips) ? filmSpec.clips : [];
    let targetClip = filmSpec.clips.find((c: any) => c.clipId === clipId || c.sourceNodeId === clipId);
    if (!targetClip) {
      targetClip = { clipId, title: shootingScript.clipTitle || clipId, shots: [] };
      filmSpec.clips.push(targetClip);
    }

    const existingShots = Array.isArray(targetClip.shots) ? targetClip.shots : [];
    // 建立基于 beatId 与 shotId 的双重索引，确保插镜、删镜时资产（图片、视频、提示词）精准跟随，绝不错位
    const beatMap = new Map<string, any>();
    const shotMap = new Map<string, any>();
    for (const s of existingShots) {
      if (s.beatId) beatMap.set(s.beatId, s);
      if (s.shotId) shotMap.set(s.shotId, s);
    }

    // 更新台本数据
    targetClip.shootingScript = {
      ...shootingScript,
      clipId,
      updatedAt: new Date().toISOString(),
    };

    // 如果传入了 actionBeats，无损同步更新 shots 清单
    if (Array.isArray(shootingScript.actionBeats) && shootingScript.actionBeats.length > 0) {
      targetClip.shots = shootingScript.actionBeats.map((beat: any, idx: number) => {
        const shotId = `${clipId}-${String(beat.shotNumber || idx + 1).padStart(2, '0')}`;
        // 优先基于稳定唯一的 beatId 找回历史资产，避免顺延插入导致的资产错位
        const old: any = (beat.beatId && beatMap.get(beat.beatId)) || (!beat.beatId ? shotMap.get(shotId) : undefined) || {};
        return {
          ...old,
          beatId: beat.beatId,
          shotId,
          clipId,
          shotIndex: idx,
          durationSec: beat.estimatedSeconds || 4,
          shotType: beat.cinematicIntent || 'MEDIUM_SHOT',
          cameraMovement: 'locked-off',
          generationMode: 'first_frame',
          characters: beat.characterIds || [],
          items: beat.itemIds || [],
          sceneSubject: beat.actionDescription,
          sliceSummary: beat.beatTitle,
          dialogue: beat.dialogue || '',
          audioPrompt: beat.audioAmbience || '',
          weatherDirective: shootingScript.environmentLock?.weatherDirective,
          firstFramePrompt: old.firstFramePrompt || '',
          videoPrompt: old.videoPrompt || '',
          keyframeUrl: old.keyframeUrl || old.firstFrameImageUrl,
          firstFrameImageUrl: old.firstFrameImageUrl,
          lastFrameImageUrl: old.lastFrameImageUrl,
          videoUrl: old.videoUrl,
          firstFrameUpscale: old.firstFrameUpscale,
          lastFrameUpscale: old.lastFrameUpscale,
        };
      });
    }

    persistClips(projectId, filmSpec.clips);
    recordStoryboardUpdated(projectId, [clipId]);

    res.json({ success: true, shootingScript: targetClip.shootingScript, shots: targetClip.shots });
  } catch (err: any) {
    sendError(res, 500, `更新摄制台本失败: ${err.message}`);
  }
};
