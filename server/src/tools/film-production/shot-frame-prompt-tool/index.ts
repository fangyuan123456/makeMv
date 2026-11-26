/**
 * tools/film-production/shot-frame-prompt-tool/index.ts
 * 单镜首帧视觉推演与微调工具 (Shot Frame Prompt Tool SSOT)
 */

import { BaseTaskTool } from '../../base/task-tool.js';
import { createShotPromptWorkflow, createShotPromptModifierWorkflow } from './workflow.js';
import {
  ShotPromptInputSchema,
  ShotPromptOutputSchema,
  type ShotPromptInput,
  type ShotPromptOutput,
} from './steps/01-prompt/index.js';
import {
  ShotPromptModifierInputSchema,
  type ShotPromptModifierInput,
} from './modifier/index.js';

export * from './steps/01-prompt/index.js';
export * from './modifier/index.js';
export * from './workflow.js';

export class ShotFramePromptTool extends BaseTaskTool<
  ShotPromptInput | ShotPromptModifierInput,
  ShotPromptOutput
> {
  public readonly toolName = 'film.shot_frame_prompt';
  public readonly description = '单镜首帧视觉生图推演与微调工具 (Direction-First)。依据摄制台本、演员定妆与场景环境锁，专注推演五层摄影公理纯正向首帧生图词，或执行定向微调，彻底消灭克隆分身与空间视线矛盾。';
  public readonly inputSchema = ShotPromptInputSchema;
  public readonly outputSchema = ShotPromptOutputSchema;

  /** 镜头级并发隔离锁 */
  public override resolveConcurrencyKey(projectIdOrParams: any, maybeInput?: Record<string, any>): string | null {
    const projectId = typeof projectIdOrParams === 'string' ? projectIdOrParams : projectIdOrParams?.projectId;
    const input = typeof projectIdOrParams === 'object' ? projectIdOrParams : maybeInput;
    const clipId = input?.clipId;
    const shotId = input?.shotId;
    if (!projectId || !clipId || !shotId) return null;
    return `${projectId}:${clipId}:${shotId}`;
  }

  /**
   * 双轨正交解耦路由分发：
   * 1. 当入参包含 mode === 'modify'、修改要求 instruction 或自定义词时，派发至微调手术轨；
   * 2. 否则默认执行从 0 到 1 的首帧视觉推演流水线。
   */
  protected buildWorkflow(input?: any) {
    if (
      input?.mode === 'modify' ||
      (input?.instruction && input.instruction.trim()) ||
      (input?.customPrompt && input.customPrompt.trim()) ||
      (input?.customVideoPrompt && input.customVideoPrompt.trim())
    ) {
      return createShotPromptModifierWorkflow();
    }
    return createShotPromptWorkflow();
  }
}

/** 兼容旧版命名 */
export const ShotPromptTool = ShotFramePromptTool;

/** 单例导出 */
export const shotFramePromptTool = new ShotFramePromptTool();
export const shotPromptTool = shotFramePromptTool;
