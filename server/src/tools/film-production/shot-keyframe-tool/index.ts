/**
 * tools/film-production/shot-keyframe-tool/index.ts
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
  public readonly description = '调用物理生图算力与定妆参考图，为单个分镜镜头（或未生成镜头）渲染首帧/末帧关键帧并与镜头强绑定';
  public readonly inputSchema = ShotKeyframeStepInputSchema;
  public readonly outputSchema = ShotKeyframeStepOutputSchema;

  public override resolveConcurrencyKey(projectId: string, input?: Record<string, any>): string | null {
    const shotId = typeof input?.shotId === 'string' ? input.shotId.trim() : '';
    return shotId ? `${projectId}:shot:${shotId}` : null;
  }

  protected buildWorkflow() {
    return createShotKeyframeWorkflow();
  }
}

export const shotKeyframeTool = new ShotKeyframeTool();
