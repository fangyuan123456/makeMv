import { createStep } from '@mastra/core/workflows';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import type { TaskExecutionContext } from '../../../../base/task-tool.js';
import {
  LookdevStepInputSchema,
  LookdevOutputSchema,
  type LookdevOutput,
  type LookdevTarget,
} from './schema.js';

export type RenderLookdevTarget = (
  target: LookdevTarget,
  projectId: string,
  execution: TaskExecutionContext,
) => Promise<{ mediaUrl?: string; versionId?: string; renderedCount: number; reviewStatus?: 'pending' | 'accepted' }>;

export function createLookdevRenderStep(renderTarget: RenderLookdevTarget) {
  return createStep({
    id: 'render-lookdev-target',
    description: '为单个角色、场景或道具执行原子定妆渲染并落盘',
    inputSchema: LookdevStepInputSchema,
    outputSchema: LookdevOutputSchema,
    execute: async ({ context }) => {
      const ctx = context as any;
      const input = LookdevStepInputSchema.parse(ctx?.triggerData || ctx?.inputData || ctx || {});
      const execution = input._context as TaskExecutionContext;
      const entities = ProjectStore.getInstance().getArtifact<any>(input.projectId, 'lookdev_entities');
      if (!entities) throw new Error('项目尚未提取视觉资产');

      const collections = {
        character: entities.characters || [],
        location: entities.locations || [],
        item: entities.items || [],
      };
      const idKeys = { character: 'characterId', location: 'locationId', item: 'itemId' } as const;
      const matched = collections[input.targetKind].find(
        (entity: any) => entity[idKeys[input.targetKind]] === input.targetId
      );
      if (!matched) {
        throw new Error(`定妆清单中不存在 ${input.targetKind} ID: ${input.targetId}`);
      }

      execution.reportProgress(20, `正在定妆渲染【${matched.name || input.targetId}】...`);
      const output = await renderTarget(input, input.projectId, execution);
      execution.reportProgress(100, `【${matched.name || input.targetId}】定妆完成`);

      return {
        projectId: input.projectId,
        targetKind: input.targetKind,
        targetId: input.targetId,
        mediaUrl: output.mediaUrl,
        versionId: output.versionId,
        renderedCount: output.renderedCount,
        reviewStatus: output.reviewStatus,
      };
    },
  });
}
