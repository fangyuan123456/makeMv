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
  public readonly description = '根据剧本与 PRD 出具专业分镜镜头拆解规划提案 (包含机位、运镜、首帧构图与表演词)，提交给创作者在界面中审阅批准后执行';
  public readonly inputSchema = StoryboardPlanningInputSchema;
  public readonly outputSchema = StoryboardPlanningOutputSchema;

  protected buildWorkflow() {
    return createStoryboardPlanningWorkflow();
  }
}

export const storyboardPlanningTool = new StoryboardPlanningTool();
