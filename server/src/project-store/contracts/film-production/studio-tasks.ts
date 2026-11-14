/**
 * project-store/contracts/film-production/studio-tasks.ts
 * 视频制作工坊多维工序任务树强类型契约 (Multi-Dimensional Studio Task Registry SSOT)
 *
 * 核心设计：
 * 告别单一扁平的全局 taskId，将全局主流水线与各实体、各幕、各分镜镜头任务
 * 组织为强类型的多维任务拓扑树，支撑细粒度独立并发、进度反馈与局部断点续传。
 */

import { z } from 'zod';

export const StudioTaskRegistrySchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  masterPipelineRunId: z.string().optional().describe('全生命周期主流水线 RunId'),

  // 1. 顶层工序阶段任务槽位
  stages: z.object({
    planGddTaskId: z.string().optional().describe('阶段一：策划案推演任务'),
    assetExtractionTaskId: z.string().optional().describe('Step 1：视觉资产提炼任务'),
    storyboardPlanningTaskId: z.string().optional().describe('Step 2：分镜台本规划任务'),
    studioMasterTaskId: z.string().optional().describe('Step 3：视频工坊总调度任务'),
  }).default({}),

  // 2. 定妆子系统各实体多维任务槽位
  lookdev: z.object({
    stageTaskId: z.string().optional().describe('定妆批量生产总任务'),
    characters: z.record(z.string()).default({}).describe('角色立绘独立任务映射 characterId -> taskId'),
    items: z.record(z.string()).default({}).describe('道具特写独立任务映射 itemId -> taskId'),
    locations: z.record(z.string()).default({}).describe('场景空镜独立任务映射 locationId -> taskId'),
  }).default({
    characters: {},
    items: {},
    locations: {},
  }),

  // 3. 各幕与各分镜镜头多维任务槽位
  acts: z.record(
    z.object({
      actTaskId: z.string().optional().describe('该幕全量镜头批量渲染任务'),
      shots: z.record(
        z.object({
          keyframeTaskId: z.string().optional().describe('镜头关键帧出图任务'),
          videoTaskId: z.string().optional().describe('镜头视频视听渲染任务'),
        })
      ).default({}),
    })
  ).default({}),

  updatedAt: z.string().describe('最后更新时间戳'),
});

export type ProjectStudioTaskRegistry = z.infer<typeof StudioTaskRegistrySchema>;

/**
 * 创建空白多维工序任务树实例
 */
export function createEmptyStudioTaskRegistry(projectId: string): ProjectStudioTaskRegistry {
  return {
    projectId,
    stages: {},
    lookdev: {
      characters: {},
      items: {},
      locations: {},
    },
    acts: {},
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 挂载顶层工序阶段任务槽位 (plan_gdd, asset_extraction, storyboard_planning, studio_master)
 */
export function mountStudioStageTask(
  registry: ProjectStudioTaskRegistry,
  stageKey: keyof ProjectStudioTaskRegistry['stages'],
  taskId: string
): ProjectStudioTaskRegistry {
  return {
    ...registry,
    stages: {
      ...registry.stages,
      [stageKey]: taskId,
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 针对指定工序动作，将 taskId 精准挂载到多维任务树对应的槽位中
 */
export function mountStudioTaskSlot(
  registry: ProjectStudioTaskRegistry,
  actionType: string,
  targetId: string,
  taskId: string,
  clipId?: string
): ProjectStudioTaskRegistry {
  const updated: ProjectStudioTaskRegistry = {
    ...registry,
    updatedAt: new Date().toISOString(),
  };

  switch (actionType) {
    case 'character_portrait':
      updated.lookdev.characters = {
        ...updated.lookdev.characters,
        [targetId]: taskId,
      };
      break;

    case 'prop_lookdev':
      updated.lookdev.items = {
        ...updated.lookdev.items,
        [targetId]: taskId,
      };
      break;

    case 'scene_atmosphere':
      updated.lookdev.locations = {
        ...updated.lookdev.locations,
        [targetId]: taskId,
      };
      break;

    case 'shot_keyframe':
      if (clipId) {
        const act = updated.acts[clipId] || { shots: {} };
        const shot = act.shots[targetId] || {};
        updated.acts = {
          ...updated.acts,
          [clipId]: {
            ...act,
            shots: {
              ...act.shots,
              [targetId]: {
                ...shot,
                keyframeTaskId: taskId,
              },
            },
          },
        };
      }
      break;

    case 'shot_video':
      if (clipId) {
        const act = updated.acts[clipId] || { shots: {} };
        const shot = act.shots[targetId] || {};
        updated.acts = {
          ...updated.acts,
          [clipId]: {
            ...act,
            shots: {
              ...act.shots,
              [targetId]: {
                ...shot,
                videoTaskId: taskId,
              },
            },
          },
        };
      }
      break;

    case 'act_batch':
      updated.acts = {
        ...updated.acts,
        [targetId]: {
          ...(updated.acts[targetId] || { shots: {} }),
          actTaskId: taskId,
        },
      };
      break;

    default:
      break;
  }

  return updated;
}
