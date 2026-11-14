/**
 * tools/film-production/02-storyboard-planning-tool/index.ts
 * 分镜台本规划工具 (Storyboard Planning Tool)
 */

import { BaseTaskTool } from '../../base/task-tool.js';
import { createStoryboardPlanningWorkflow } from './workflow.js';
import {
  StoryboardPlanningInputSchema,
  StoryboardPlanningOutputSchema,
  type StoryboardPlanningInput,
  type StoryboardPlanningOutput,
} from './steps/01-plan/index.js';

export * from './steps/01-plan/index.js';
export * from './workflow.js';

export class StoryboardPlanningTool extends BaseTaskTool<StoryboardPlanningInput, StoryboardPlanningOutput> {
  public readonly toolName = 'film.storyboard_planning';
  public readonly description = '纯文字视听拆解，将剧本与 PRD 拆解为各幕分镜镜头订单 (包含机位、运镜、首帧词、表演词)';

  protected buildWorkflow() {
    return createStoryboardPlanningWorkflow();
  }
}

export const storyboardPlanningTool = new StoryboardPlanningTool();
