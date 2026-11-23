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
  public readonly description =
    '调用物理生图算力与定妆参考图渲染镜头首帧关键帧。支持两类模式：1) 全新出图/重绘(force=true)；2) 基于现有成图的定向画面微调(传入 instruction="微调要求"，保留原图构图与光影，自适应开启潜空间局部微调，用于消除肢体伪影、手脚错误、视线偏离等瑕疵，不污染剧本提示词)。';
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
