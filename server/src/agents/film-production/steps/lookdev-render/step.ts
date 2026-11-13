/**
 * agents/film-production/steps/lookdev-render/step.ts
 * 定妆第二段 · 出图 (Lookdev Render)：把母本说明书变成三类母本图
 *
 * 输入是上一步产出的实体字典，不调模型、只拼提示词并发生图。
 * 磁盘已有同名文件即复用（可人工替换的一等资产），单张失败不阻断整批。
 */

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { runTaskRecordedStep } from '../../../../workflow-engine/TaskStore.js';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { GlobalEntitiesSchema } from '../../../../project-store/contracts/film-production/lookdev.js';
import { hasCompleteLookdev, renderLookdev } from './render.js';

export const LookdevRenderInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识（母本图与台账按它落盘）'),
  entities: GlobalEntitiesSchema.describe('上一步产出的角色 / 道具 / 场景字典'),
  concurrency: z.number().default(4).describe('母本图并发池大小'),
  force: z.boolean().default(false).describe('强制重绘全部母本（人工换过描述或图片后整批重来）'),
});

export type LookdevRenderInput = z.infer<typeof LookdevRenderInputSchema>;

export const LookdevRenderOutputSchema = z.object({
  entities: GlobalEntitiesSchema.describe('已回填 referenceImageUrl 的角色 / 道具 / 场景字典'),
  renderedCount: z.number().describe('本轮实际新绘制的母本图数量'),
  reusedCount: z.number().describe('命中磁盘母本直接复用的数量'),
  failedCount: z.number().describe('生成失败数量（保留旧图，不阻断流水线）'),
});

export type LookdevRenderOutput = z.infer<typeof LookdevRenderOutputSchema>;

export async function executeLookdevRenderStep(
  input: LookdevRenderInput
): Promise<LookdevRenderOutput> {
  const { projectId, entities, concurrency = 4, force = false } = input;
  const rendered = await renderLookdev(projectId, entities, { force, concurrency });
  return {
    entities: rendered.entities,
    renderedCount: rendered.rendered,
    reusedCount: rendered.reused,
    failedCount: rendered.failed,
  };
}

export const lookdevRenderStep = createStep({
  id: 'lookdev-render-step',
  inputSchema: LookdevRenderInputSchema,
  outputSchema: LookdevRenderOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = ctx.triggerData || ctx;
    const projectId = input.projectId || ctx.projectId;
    const store = ProjectStore.getInstance();
    const stored = store.getArtifact<LookdevRenderOutput>(projectId, 'lookdev_draft');
    const entities = stored?.entities || input.entities;
    if (!entities) {
      throw new Error('[LookdevRender] 缺少实体字典，提取工序未产出');
    }
    const concurrency = input.concurrency ?? ctx.concurrency ?? 4;
    const force = Boolean(input.force ?? ctx.force ?? false);

    const result = await runTaskRecordedStep(
      'lookdev-render-step',
      () => executeLookdevRenderStep({ projectId, entities, concurrency, force }),
      {
        skipCache: force,
        // 有实体但缺母本图 = 上轮出图中断/失败，必须重跑补齐，不能当缓存命中
        verifyCached: (cached) => hasCompleteLookdev((cached as LookdevRenderOutput)?.entities),
      }
    );
    // Persist the rendered dictionary for storyboard and later steps.
    store.setArtifact(projectId, 'lookdev_draft', result);
    return result;
  },
});

