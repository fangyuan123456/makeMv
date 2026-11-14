/**
 * tools/planner/screenplay-tool/index.ts
 * 互动影游全景剧本生成工具 (Screenplay Tool)
 */

import { BaseTaskTool } from '../../base/task-tool.js';
import { createScreenplayWorkflow } from './workflow.js';
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
export * from './workflow.js';

export class ScreenplayTool extends BaseTaskTool<ScreenplayInput, ScreenplayOutput> {
  public readonly toolName = 'planner.screenplay_writer';
  public readonly description = '根据创作者创意推演完整的 Markdown 格式互动影游全景剧本 (含分幕、台词、抉择选项与分支终局)';

  protected buildWorkflow() {
    return createScreenplayWorkflow();
  }
}

/** 单例导出 */
export const screenplayTool = new ScreenplayTool();
