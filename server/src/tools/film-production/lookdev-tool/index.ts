import { BaseTaskTool } from '../../base/task-tool.js';
import { LookdevInputSchema, LookdevOutputSchema, type LookdevInput, type LookdevOutput } from './steps/01-render/schema.js';
import { renderLookdevTarget } from './render.js';
import { createLookdevWorkflow } from './workflow.js';

export * from './steps/01-render/schema.js';
export * from './workflow.js';

export class LookdevTool extends BaseTaskTool<LookdevInput, LookdevOutput> {
  public readonly toolName = 'film.lookdev';
  public readonly description = '为单个角色三视图、场景空镜或核心道具特写执行原子定妆生成或定向微调；需批量处理多个资产时请通过 Plan 的 operations 数组编排多步调用';
  public readonly inputSchema = LookdevInputSchema;
  public readonly outputSchema = LookdevOutputSchema;

  public override resolveConcurrencyKey(projectId: string, input?: Record<string, any>): string | null {
    const targetId = typeof input?.targetId === 'string' ? input.targetId.trim() : '';
    if (!targetId) return null;
    const kind = typeof input?.targetKind === 'string' ? input.targetKind.trim() : 'entity';
    return `${projectId}:${kind}:${targetId}`;
  }

  protected buildWorkflow() {
    return createLookdevWorkflow(renderLookdevTarget);
  }
}

export const lookdevTool = new LookdevTool();
