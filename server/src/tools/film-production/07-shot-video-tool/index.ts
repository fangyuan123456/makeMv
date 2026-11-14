/**
 * tools/film-production/07-shot-video-tool/index.ts
 * 分镜视频视听渲染工具 (Shot Video Tool)
 */

import { BaseTaskTool } from '../../base/task-tool.js';
import { createShotVideoWorkflow } from './workflow.js';
import {
  ShotVideoStepInputSchema,
  ShotVideoStepOutputSchema,
  type ShotVideoStepInput,
  type ShotVideoStepOutput,
} from './steps/01-render/index.js';

export * from './steps/01-render/index.js';
export * from './workflow.js';

export class ShotVideoTool extends BaseTaskTool<ShotVideoStepInput, ShotVideoStepOutput> {
  public readonly toolName = 'film.shot_video';
  public readonly description = '以分镜关键帧为底，驱动物理图生视频算力渲染带声画的镜头视频并同步场景配置';

  protected buildWorkflow() {
    return createShotVideoWorkflow();
  }
}

export const shotVideoTool = new ShotVideoTool();
