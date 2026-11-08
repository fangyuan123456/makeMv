/**
 * agents/director/modifier/steps/video/step.ts
 * 视频内容修改 step（互斥分支 3/3）
 *
 * 视频修改本质是「局部重生产」：要调渲染器、要等几十秒、可能失败重试。
 * 因此它是三种媒介里唯一把渲染当作主耗时的路径，进度上报占比也相应前置。
 */

import { createStep } from '@mastra/core/workflows';
import { ModifierContextSchema } from '../common.js';
import { runModifierPhases } from '../run-phases.js';
import { videoProductionSpec } from './video-production/spec.js';

export const videoModifierStep = createStep({
  id: 'step-modify-video',
  description: '动态视频切片定向修改',
  inputSchema: ModifierContextSchema,
  outputSchema: ModifierContextSchema,
  execute: async ({ inputData, report }: any) =>
    runModifierPhases(videoProductionSpec, inputData, report),
});
