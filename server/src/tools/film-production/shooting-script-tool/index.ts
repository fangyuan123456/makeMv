/**
 * tools/film-production/shooting-script-tool/index.ts
 * 单幕导演视听演绎剧本工具 (Shooting / Performance Script Tool SSOT)
 */

import { BaseTaskTool } from '../../base/task-tool.js';
import {
  createShootingScriptWorkflow,
  createShootingScriptModifierWorkflow,
} from './workflow.js';
import {
  ShootingScriptInputSchema,
  ShootingScriptOutputSchema,
  type ShootingScriptInput,
  type ShootingScriptOutput,
} from './schema.js';
import {
  ShootingScriptModifierInputSchema,
  type ShootingScriptModifierInput,
} from './modifier/index.js';

export * from './schema.js';
export * from './modifier/index.js';
export * from './workflow.js';
export * from './step.js';
export * from './prompt.js';

export class ShootingScriptTool extends BaseTaskTool<
  ShootingScriptInput | ShootingScriptModifierInput,
  ShootingScriptOutput
> {
  public readonly toolName = 'film.shooting_script';
  public readonly description =
    '单幕导演视听演绎剧本工具。负责提取并锁定场景时空与光影环境（黄昏薄雾、冷暖光斑），并将文学故事剧本升级为纯物理动作表演流与机位构想的视听演绎剧本，或针对已有演绎剧本进行定向增删改。';
  public readonly inputSchema = ShootingScriptInputSchema;
  public readonly outputSchema = ShootingScriptOutputSchema;

  /** 分幕级并发锁：锁定单幕操作 */
  public override resolveConcurrencyKey(projectIdOrParams: any, maybeInput?: Record<string, any>): string | null {
    const projectId = typeof projectIdOrParams === 'string' ? projectIdOrParams : projectIdOrParams?.projectId;
    const input = typeof projectIdOrParams === 'object' ? projectIdOrParams : maybeInput;
    const clipId = input?.clipId;
    if (!projectId || !clipId) return null;
    return `${projectId}:${clipId}`;
  }

  /**
   * 双轨正交解耦路由分发（基于契约字段，零硬编码猜测）：
   * 1. 显式指定 mode === 'modify' 或指定靶向操作（targetBeatId / modifications）时，执行微调手术轨；
   * 2. 否则按摄制台本标准契约执行全量镜头规划流水线（可包含导演细化 instruction 要求）。
   */
  protected buildWorkflow(input?: any) {
    const isModifierMode =
      input?.mode === 'modify' ||
      Boolean(input?.targetBeatId) ||
      (Array.isArray(input?.modifications) && input.modifications.length > 0);

    if (isModifierMode) {
      return createShootingScriptModifierWorkflow();
    }
    return createShootingScriptWorkflow();
  }
}

/** 单例导出 */
export const shootingScriptTool = new ShootingScriptTool();
