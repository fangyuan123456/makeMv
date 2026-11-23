/**
 * tools/film-production/entity-spec-tool/index.ts
 * 单实体视觉规格精细化推演与调整工具 (Single Entity Spec Tool SSOT)
 */

import { BaseTaskTool } from '../../base/task-tool.js';
import { createEntitySpecWorkflow, createEntitySpecModifierWorkflow } from './workflow.js';
import {
  EntitySpecInputSchema,
  EntitySpecOutputSchema,
  type EntitySpecInput,
  type EntitySpecOutput,
} from './steps/01-spec/index.js';
import {
  EntitySpecModifierInputSchema,
  type EntitySpecModifierInput,
} from './modifier/index.js';

export * from './character/index.js';
export * from './location/index.js';
export * from './item/index.js';
export * from './steps/01-spec/index.js';
export * from './modifier/index.js';
export * from './workflow.js';

export class EntitySpecTool extends BaseTaskTool<
  EntitySpecInput | EntitySpecModifierInput,
  EntitySpecOutput
> {
  public readonly toolName = 'film.entity_spec';
  public readonly description = '单实体视觉规格推演与调整工具。只针对指定角色、场景或道具推演完整视觉规格或执行定向微调，绝对物理隔离。';
  public readonly inputSchema = EntitySpecInputSchema;
  public readonly outputSchema = EntitySpecOutputSchema;

  /** 实体级并发锁：精确锁定单个实体 ID 或实体名称 */
  public override resolveConcurrencyKey(projectIdOrParams: any, maybeInput?: Record<string, any>): string | null {
    const projectId = typeof projectIdOrParams === 'string' ? projectIdOrParams : projectIdOrParams?.projectId;
    const input = typeof projectIdOrParams === 'object' ? projectIdOrParams : maybeInput;
    if (!projectId) return null;
    const kind = input?.targetKind || 'entity';
    const idOrName = input?.targetId || input?.name || 'unnamed';
    return `${projectId}:${kind}:${idOrName}`;
  }

  /**
   * 双轨正交解耦路由分发：
   * 1. 当入参包含 mode === 'modify'、微调意见 instruction 或创作者自定义 customPrompt 时，派发至微调手术轨；
   * 2. 否则默认执行 0 到 1 的批量规格推演流水线。
   */
  protected buildWorkflow(input?: any) {
    if (
      input?.mode === 'modify' ||
      (input?.instruction && input.instruction.trim()) ||
      (input?.customPrompt && input.customPrompt.trim())
    ) {
      return createEntitySpecModifierWorkflow();
    }
    return createEntitySpecWorkflow();
  }
}

/** 单例导出 */
export const entitySpecTool = new EntitySpecTool();
