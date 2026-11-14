/**
 * agents/film-production/03-video-studio/studio-dispatcher.ts
 * 视频制作工坊统一调度网关 (Unified Studio Dispatcher SSOT)
 *
 * 核心规范：
 * 告别零散接口，提供唯一且标准的单一控制网关。
 * 消费端发送 { taskId, actionType, targetId, customPrompt, referenceImageUrls... }
 * 本分发器自动按工序路由执行、回写资产状态，并提供全链路可追溯性。
 */

import { z } from 'zod';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { TaskStore } from '../../../workflow-engine/TaskStore.js';
import type { ProjectStudioTaskRegistry } from '../../../project-store/contracts/film-production/studio-tasks.js';
import {
  renderCharacterPortrait,
  renderPropLookdev,
  renderSceneAtmosphere,
} from './lookdev/index.js';
import {
  renderShotKeyframe,
  renderShotCinematography,
  executeActShotWorkflow,
} from './cinema-act/index.js';

export const StudioActionTypeEnum = z.enum([
  'character_portrait', // 重做角色全身立绘
  'prop_lookdev',       // 重做关键道具特写
  'scene_atmosphere',   // 重做场景无人空镜
  'shot_keyframe',      // 重做分镜关键帧
  'shot_video',         // 重做分镜视频
  'act_batch',          // 重做整幕分镜流
]);

export const StudioActionRequestSchema = z.object({
  taskId: z.string().optional().describe('流水线/任务 ID，用于进度同步与日志追溯'),
  actionType: StudioActionTypeEnum.describe('工序类型'),
  targetId: z.string().describe('目标标识 (characterId / itemId / locationId / shotId / clipId)'),
  clipId: z.string().optional().describe('所属分幕 ID (操作镜头关键帧/视频时提供)'),
  customPrompt: z.string().optional().describe('创作者手动调整的提示词'),
  customNegativePrompt: z.string().optional().describe('创作者调整的负向词'),
  referenceImageUrls: z.array(z.string()).optional().describe('创作者上传或指定的参考图 URLs (垫图/参考图)'),
  force: z.boolean().default(true).describe('是否强制重新物理生成'),
});

export type StudioActionType = z.infer<typeof StudioActionTypeEnum>;
export type StudioActionRequest = z.infer<typeof StudioActionRequestSchema>;

export interface StudioActionResult {
  success: boolean;
  actionType: StudioActionType;
  targetId: string;
  taskId: string;
  result: any;
  updatedArtifactKey: 'lookdev_entities' | 'film_spec';
  studioTasks: ProjectStudioTaskRegistry;
  note: string;
}

/**
 * 视频工坊统一原子动作分发器 (自动挂载至多维工序任务树)
 */
export async function dispatchStudioAction(
  projectId: string,
  request: StudioActionRequest
): Promise<StudioActionResult> {
  const parsed = StudioActionRequestSchema.parse(request);
  const {
    taskId,
    actionType,
    targetId,
    clipId,
    customPrompt,
    customNegativePrompt,
    referenceImageUrls,
    force = true,
  } = parsed;

  const store = ProjectStore.getInstance();
  const taskStore = TaskStore.getInstance();

  // 1. 生成或复用语义化专属 taskId，并自动挂载至多维工序任务树对应槽位
  const actualTaskId = taskId || `task_${actionType}_${targetId}_${Date.now()}`;
  store.updateStudioTaskSlot(projectId, actionType, targetId, actualTaskId, clipId);

  // 2. 在 TaskStore 中注册/更新该局部任务运行状态
  const existingTask = taskStore.getTask(projectId, actualTaskId);
  if (!existingTask) {
    taskStore.createTask(
      projectId,
      actionType,
      `视频工坊原子工序：[${actionType}] -> ${targetId}`,
      false,
      { actionType, targetId, clipId }
    );
  }
  taskStore.updateProgress(projectId, actualTaskId, {
    percent: 30,
    current: 30,
    total: 100,
    note: `工坊原子任务正在执行：[${actionType}] -> ${targetId}...`,
  });

  let result: any;
  let updatedArtifactKey: 'lookdev_entities' | 'film_spec';
  let note: string;

  switch (actionType) {
    case 'character_portrait': {
      result = await renderCharacterPortrait({
        projectId,
        characterId: targetId,
        force,
        customPrompt,
        customNegativePrompt,
        referenceImageUrls,
      });
      updatedArtifactKey = 'lookdev_entities';
      note = `角色立绘 [${targetId}] 重做${result.success ? '成功' : '失败'}`;
      break;
    }

    case 'prop_lookdev': {
      result = await renderPropLookdev({
        projectId,
        itemId: targetId,
        force,
        customPrompt,
        customNegativePrompt,
        referenceImageUrls,
      });
      updatedArtifactKey = 'lookdev_entities';
      note = `道具特写 [${targetId}] 重做${result.success ? '成功' : '失败'}`;
      break;
    }

    case 'scene_atmosphere': {
      result = await renderSceneAtmosphere({
        projectId,
        locationId: targetId,
        force,
        customPrompt,
        customNegativePrompt,
        referenceImageUrls,
      });
      updatedArtifactKey = 'lookdev_entities';
      note = `场景空镜 [${targetId}] 重做${result.success ? '成功' : '失败'}`;
      break;
    }

    case 'shot_keyframe': {
      if (!clipId) {
        throw new Error(`[StudioDispatcher] 重做分镜关键帧必须指定所属 clipId`);
      }
      result = await renderShotKeyframe({
        projectId,
        clipId,
        shotId: targetId,
        force,
        customPrompt,
        customNegativePrompt,
        referenceImageUrls,
      });
      updatedArtifactKey = 'film_spec';
      note = `镜头关键帧 [${clipId} · ${targetId}] 重做${result.success ? '成功' : '失败'}`;
      break;
    }

    case 'shot_video': {
      if (!clipId) {
        throw new Error(`[StudioDispatcher] 重做分镜视频必须指定所属 clipId`);
      }
      const refUrl = referenceImageUrls && referenceImageUrls.length > 0 ? referenceImageUrls[0] : undefined;
      result = await renderShotCinematography({
        projectId,
        clipId,
        shotId: targetId,
        force,
        customPrompt,
        referenceImageUrl: refUrl,
      });
      updatedArtifactKey = 'film_spec';
      note = `镜头视频 [${clipId} · ${targetId}] 重做${result.success ? '成功' : '失败'}`;
      break;
    }

    case 'act_batch': {
      result = await executeActShotWorkflow({
        projectId,
        clipId: targetId,
        forceKeyframe: force,
        forceVideo: force,
        onProgress: (progNote, p) => {
          taskStore.updateProgress(projectId, actualTaskId, {
            percent: p,
            current: p,
            total: 100,
            note: `[整幕重做 ${targetId}] ${progNote}`,
          });
        },
      });
      updatedArtifactKey = 'film_spec';
      note = `第 [${targetId}] 幕全量镜头重做完成 (完成 ${result.completedCount}/${result.totalCount})`;
      break;
    }

    default:
      throw new Error(`[StudioDispatcher] 未知的工坊操作类型: ${actionType}`);
  }

  // 3. 在 TaskStore 中回写任务终态
  const isSuccess = Boolean(result?.success || result?.completedCount > 0);
  taskStore.setStatus(projectId, actualTaskId, isSuccess ? 'succeeded' : 'failed', {
    result,
    error: isSuccess ? undefined : `工坊原子工序执行未达到成功态: [${actionType}] -> ${targetId}`,
  });

  return {
    success: isSuccess,
    actionType,
    targetId,
    taskId: actualTaskId,
    result,
    updatedArtifactKey,
    studioTasks: store.getStudioTasks(projectId),
    note,
  };
}
