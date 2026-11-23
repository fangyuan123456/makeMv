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
   * 双轨正交解耦路由分发：
   * 1. 当入参包含 mode === 'modify'、导演指令 instruction、指定节拍 targetBeatId、显式 environmentLock 或 modifications 时，走微调手术轨；
   * 2. 否则默认执行从 0 到 1 的初次故事剧本升级演绎剧本流水线。
   */
  protected buildWorkflow(input?: any) {
    if (
      input?.mode === 'modify' ||
      (input?.instruction && input.instruction.trim()) ||
      input?.targetBeatId ||
      input?.environmentLock ||
      (Array.isArray(input?.modifications) && input.modifications.length > 0)
    ) {
      return createShootingScriptModifierWorkflow();
    }
    return createShootingScriptWorkflow();
  }
}

/** 单例导出 */
export const shootingScriptTool = new ShootingScriptTool();
