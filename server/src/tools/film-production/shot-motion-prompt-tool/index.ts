/**
 * tools/film-production/shot-motion-prompt-tool/index.ts
 * 单镜视频时序动态推演与微调工具 (Shot Motion Prompt Tool SSOT)
 */

import { BaseTaskTool } from '../../base/task-tool.js';
import {
  createShotMotionPromptWorkflow,
} from './workflow.js';
import {
  createShotMotionPromptModifierWorkflow,
} from './modifier/workflow.js';
import {
  ShotMotionPromptInputSchema,
  ShotMotionPromptOutputSchema,
  type ShotMotionPromptInput,
  type ShotMotionPromptOutput,
} from './steps/01-motion-prompt/index.js';
import {
  ShotMotionPromptModifierInputSchema,
  type ShotMotionPromptModifierInput,
} from './modifier/index.js';

export * from './steps/01-motion-prompt/index.js';
export * from './modifier/index.js';
export * from './workflow.js';

export class ShotMotionPromptTool extends BaseTaskTool<
  ShotMotionPromptInput | ShotMotionPromptModifierInput,
  ShotMotionPromptOutput
> {
  public readonly toolName = 'film.shot_motion_prompt';
  public readonly description = '单镜视频时序动态与运镜推演工具 (Motion-First)。以首帧起幅状态与视觉画面为物理基准，专注推演3~5秒连贯动作流、主角核心表演、同框全员生理微动态（呼吸/眼动/随动）与次级环境物理流，或执行定向微调，彻底消灭背景蜡像假人感。';
  public readonly inputSchema = ShotMotionPromptInputSchema;
  public readonly outputSchema = ShotMotionPromptOutputSchema;

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
   * 2. 否则默认执行从 0 到 1 的视频动态时序推演流水线。
   */
  protected buildWorkflow(input?: any) {
    if (
      input?.mode === 'modify' ||
      (input?.instruction && input.instruction.trim()) ||
      (input?.customVideoPrompt && input.customVideoPrompt.trim())
    ) {
      return createShotMotionPromptModifierWorkflow();
    }
    return createShotMotionPromptWorkflow();
  }
}

/** 单例导出 */
export const shotMotionPromptTool = new ShotMotionPromptTool();
