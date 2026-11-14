/**
 * tools/film-production/06-shot-keyframe-tool/index.ts
 * 分镜关键帧出图工具 (Shot Keyframe Tool)
 */

import { BaseTaskTool } from '../../base/task-tool.js';
import { createShotKeyframeWorkflow } from './workflow.js';
import {
  ShotKeyframeStepInputSchema,
  ShotKeyframeStepOutputSchema,
  type ShotKeyframeStepInput,
  type ShotKeyframeStepOutput,
} from './steps/01-render/index.js';

export * from './steps/01-render/index.js';
export * from './workflow.js';

export class ShotKeyframeTool extends BaseTaskTool<ShotKeyframeStepInput, ShotKeyframeStepOutput> {
  public readonly toolName = 'film.shot_keyframe';
  public readonly description = '调用物理生图算力与垫参考图，为分镜镜头渲染首尾帧关键帧并与镜头强绑定';

  protected buildWorkflow() {
    return createShotKeyframeWorkflow();
  }
}

export const shotKeyframeTool = new ShotKeyframeTool();
