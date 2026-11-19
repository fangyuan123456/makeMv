/**
 * tools/film-production/shot-video-tool/index.ts
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
  public readonly description = '以分镜关键帧为底，驱动物理图生视频算力为单个镜头（或待渲染镜头）渲染带声画的动态视频';
  public readonly inputSchema = ShotVideoStepInputSchema;
  public readonly outputSchema = ShotVideoStepOutputSchema;

  public override resolveConcurrencyKey(projectId: string, input?: Record<string, any>): string | null {
    const shotId = typeof input?.shotId === 'string' ? input.shotId.trim() : '';
    return shotId ? `${projectId}:shot:${shotId}` : null;
  }

  protected buildWorkflow() {
    return createShotVideoWorkflow();
  }
}

export const shotVideoTool = new ShotVideoTool();
