/**
 * agents/film-production/03-video-studio/studio-master.workflow.ts
 * 视频制作工坊总调度流水线 (Video Studio Master Workflow SSOT)
 *
 * 核心架构：
 * 1. 专职做图片与视频：零大模型文本推演，纯物理硬件/媒体算力流水线；
 * 2. 消费前置 Step 产物：
 *    - 消费 Step 1 产物：lookdev_entities (实物与场景设定)
 *    - 消费 Step 2 产物：film_spec (各幕全量分镜台本与镜头清单)
 * 3. 编排纯物理媒体子系统：
 *    - lookdev (定妆子系统)：角色全身立绘、道具特写、场景无人空镜 (文生图物理算力)
 *    - cinema-act (按幕分镜视听子系统)：逐镜头确立首尾关键帧高清原图 (文生图) ➔ 渲染镜头动态视频 (图生视频)
 */

import { Workflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import type { GlobalEntities } from '../../../project-store/contracts/film-production/lookdev.js';
import type { FilmAdapterArtifact } from '../../../project-store/contracts/film-production/film-spec.js';
import {
  executeLookdevWorkflow,
  type LookdevWorkflowResult,
} from './lookdev/index.js';
import {
  executeActShotWorkflow,
  type ActShotWorkflowResult,
} from './cinema-act/index.js';

export const StudioMasterInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  forceLookdev: z.boolean().default(false).describe('是否强制重绘定妆资产'),
  forceKeyframe: z.boolean().default(false).describe('是否强制重绘分镜关键帧'),
  forceVideo: z.boolean().default(false).describe('是否强制重绘分镜视频'),
});

export const StudioMasterOutputSchema = z.object({
  projectId: z.string(),
  success: z.boolean(),
  lookdev: z.custom<LookdevWorkflowResult>(),
  acts: z.array(z.custom<ActShotWorkflowResult>()),
  totalShots: z.number(),
  completedShots: z.number(),
});

export type StudioMasterInput = z.infer<typeof StudioMasterInputSchema>;
export type StudioMasterOutput = z.infer<typeof StudioMasterOutputSchema>;

/**
 * 影视定妆总控原子 Step (调用定妆子系统)
 */
export const lookdevStageStep = createStep({
  id: 'step_studio_lookdev_stage',
  description: '视频工坊定妆总控工序 (驱动各实体母本图物理生成)',
  inputSchema: StudioMasterInputSchema,
  outputSchema: z.custom<LookdevWorkflowResult>(),
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = ctx.triggerData || ctx;
    return await executeLookdevWorkflow({
      projectId: input.projectId,
      force: input.forceLookdev,
    });
  },
});

/**
 * 为指定分幕创建视频生成 Step 工厂
 */
export function createActProductionStep(clipId: string) {
  return createStep({
    id: `step_studio_act_${clipId}`,
    description: `视频工坊分幕 [${clipId}] 视听生成工序 (驱动各镜头关键帧与视频生成)`,
    inputSchema: StudioMasterInputSchema,
    outputSchema: z.custom<ActShotWorkflowResult>(),
    execute: async ({ context }) => {
      const ctx = context as any;
      const input = ctx.triggerData || ctx;
      return await executeActShotWorkflow({
        projectId: input.projectId,
        clipId,
        forceKeyframe: input.forceKeyframe,
        forceVideo: input.forceVideo,
      });
    },
  });
}

/**
 * 动态组装视频工坊总调度流水线实例 (Mastra 原生 Workflow)
 */
export function createStudioMasterWorkflow(projectId: string, filmSpec: FilmAdapterArtifact): Workflow {
  const wf = new Workflow({
    name: `studio_master_workflow_${projectId}`,
    triggerSchema: StudioMasterInputSchema,
  });

  // 1. 挂载定妆工序
  let builder: any = wf.step(lookdevStageStep);

  // 2. 依次挂载每一幕的分镜视听生成工序
  for (const clip of filmSpec.clips || []) {
    const actStep = createActProductionStep(clip.clipId);
    builder = builder.then(actStep);
  }

  return builder.commit();
}

/**
 * 视频制作工坊总调度高阶执行器 (专职做图片和视频，纯物理算力工厂)
 */
export async function executeStudioMasterWorkflow(params: {
  projectId: string;
  forceLookdev?: boolean;
  forceKeyframe?: boolean;
  forceVideo?: boolean;
  onProgress?: (note: string, percent: number) => void;
}): Promise<StudioMasterOutput> {
  const {
    projectId,
    forceLookdev = false,
    forceKeyframe = false,
    forceVideo = false,
    onProgress,
  } = params;

  const store = ProjectStore.getInstance();

  // 1. 确保已完成 Step 1 视觉资产提取
  const entities = store.getArtifact<GlobalEntities>(projectId, 'lookdev_entities');
  if (!entities) {
    throw new Error(`[StudioMasterWorkflow] 项目 [${projectId}] 尚未完成 Step 1 视觉资产提取，无法启动物理工坊`);
  }

  // 2. 确保已完成 Step 2 分镜台本规划 (film_spec)
  const filmSpec = store.getArtifact<FilmAdapterArtifact>(projectId, 'film_spec');
  if (!filmSpec || !filmSpec.clips?.length) {
    throw new Error(`[StudioMasterWorkflow] 项目 [${projectId}] 尚未完成 Step 2 分镜台本规划，缺少分镜镜头清单 film_spec`);
  }

  // 3. 执行定妆子工作流：物理生成角色立绘、道具特写与场景空镜
  onProgress?.('视频制作工坊 · 定妆阶段：正在驱动影视定妆子工作流 (lookdev.workflow)...', 10);
  const lookdevResult = await executeLookdevWorkflow({
    projectId,
    force: forceLookdev,
    onProgress: (note, p) => onProgress?.(`[定妆阶段] ${note}`, Math.round(10 + p * 0.25)),
  });

  const clips = filmSpec.clips || [];
  const totalClips = clips.length;
  let totalShots = 0;
  let completedShots = 0;
  const actResults: ActShotWorkflowResult[] = [];

  // 4. 遍历每一幕，执行单幕分镜视频子工作流：驱动关键帧高清生图与视频渲染
  for (let cIdx = 0; cIdx < totalClips; cIdx++) {
    const clip = clips[cIdx];
    totalShots += clip.shots?.length || 0;
    const baseProgress = 35 + Math.round((cIdx / totalClips) * 60);

    onProgress?.(
      `视频制作工坊 · 按幕生成 (${cIdx + 1}/${totalClips})：第 [${clip.clipId}] 幕开始渲染...`,
      baseProgress
    );

    const actResult = await executeActShotWorkflow({
      projectId,
      clipId: clip.clipId,
      forceKeyframe,
      forceVideo,
      onProgress: (note, p) => {
        const span = Math.round(60 / totalClips);
        const cur = baseProgress + Math.round((p / 100) * span);
        onProgress?.(`[${clip.clipId} 视听] ${note}`, Math.min(95, cur));
      },
    });

    completedShots += actResult.completedCount;
    actResults.push(actResult);
  }

  onProgress?.('视频制作工坊：全剧定妆与各幕分镜视频渲染装配已完成！', 100);

  return {
    projectId,
    success: completedShots > 0,
    lookdev: lookdevResult,
    acts: actResults,
    totalShots,
    completedShots,
  };
}
