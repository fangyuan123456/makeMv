/**
 * tools/planner/screenplay-tool/index.ts
 * 互动影游全景剧本生成工具 (Screenplay Tool)
 */

import { BaseTaskTool } from '../../base/task-tool.js';
import { createScreenplayWorkflow, createScreenplayModifierWorkflow } from './workflow.js';
import {
  ScreenplayInputSchema,
  type ScreenplayInput,
} from './steps/01-premise/index.js';
import {
  ScreenplayOutputSchema,
  type ScreenplayOutput,
} from './steps/02-screenplay/index.js';

export * from './steps/01-premise/index.js';
export * from './steps/02-screenplay/index.js';
export * from './modifier/index.js';
export * from './workflow.js';

export class ScreenplayTool extends BaseTaskTool<ScreenplayInput, ScreenplayOutput> {
  public readonly toolName = 'planner.screenplay_writer';
  public readonly description = '推演并出具【互动全景剧本创作】的完整制片方案与执行参数（含分幕数、戏剧冲突、分幕对白规划），或遵照指令执行精准局部文本微调 (Patch)，提交给创作者在界面中审阅与授权批准后执行';
  public readonly inputSchema = ScreenplayInputSchema;
  public readonly outputSchema = ScreenplayOutputSchema;

  /**
   * 双轨正交解耦路由分发：
   * 1. 当入参包含局部微调指令 instruction 时，无状态派发至精修轨 (createScreenplayModifierWorkflow)；
   * 2. 否则默认走从 0 到 1 的批量正向生成流水线 (createScreenplayWorkflow)。
   */
  protected buildWorkflow(input?: ScreenplayInput) {
    if (input?.instruction && input.instruction.trim()) {
      return createScreenplayModifierWorkflow();
    }
    return createScreenplayWorkflow();
  }
}

/** 单例导出 */
export const screenplayTool = new ScreenplayTool();
