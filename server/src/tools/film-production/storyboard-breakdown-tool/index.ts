/**
 * tools/film-production/storyboard-breakdown-tool/index.ts
 * 单幕分镜剧本拆分与台本维护工具 (Storyboard Breakdown Tool SSOT)
 */

import { BaseTaskTool } from '../../base/task-tool.js';
import {
  createStoryboardBreakdownWorkflow,
  createStoryboardBreakdownModifierWorkflow,
} from './workflow.js';
import {
  StoryboardBreakdownInputSchema,
  StoryboardBreakdownOutputSchema,
  type StoryboardBreakdownInput,
  type StoryboardBreakdownOutput,
} from './steps/01-breakdown/index.js';
import {
  StoryboardBreakdownModifierInputSchema,
  type StoryboardBreakdownModifierInput,
} from './modifier/index.js';

export * from './steps/01-breakdown/index.js';
export * from './modifier/index.js';
export * from './workflow.js';

export class StoryboardBreakdownTool extends BaseTaskTool<
  StoryboardBreakdownInput | StoryboardBreakdownModifierInput,
  StoryboardBreakdownOutput
> {
  public readonly toolName = 'film.storyboard_breakdown';
  public readonly description = '单幕分镜剧本拆分与台本维护工具。负责单幕戏剧节拍切分、镜头编排、景别机位与台词拟音规划，或执行结构化与自然语言增删改。';
  public readonly inputSchema = StoryboardBreakdownInputSchema;
  public readonly outputSchema = StoryboardBreakdownOutputSchema;

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
   * 1. 当入参包含 mode === 'modify'、导演指令 instruction、指定单镜 targetShotId 或 modifications 数组时，派发至微调手术轨；
   * 2. 否则默认执行从 0 到 1 的初次分幕切分流水线。
   */
  protected buildWorkflow(input?: any) {
    if (
      input?.mode === 'modify' ||
      (input?.instruction && input.instruction.trim()) ||
      input?.targetShotId ||
      (Array.isArray(input?.modifications) && input.modifications.length > 0)
    ) {
      return createStoryboardBreakdownModifierWorkflow();
    }
    return createStoryboardBreakdownWorkflow();
  }
}

/** 单例导出 */
export const storyboardBreakdownTool = new StoryboardBreakdownTool();
