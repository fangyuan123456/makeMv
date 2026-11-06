/**
 * agents/director/generator/steps/video-production/steps/render.step.ts
 * 动态视频切片第 2 阶段原子 Step：运镜轨迹与物理视频生成渲染
 */

import { createStep } from '@mastra/core/workflows';
import { WorkflowContextSchema, WorkflowContext } from '../../common.js';
import { asyncPoolSettled } from '../../../../../../utils/concurrency.js';
import { renderFreshVideoClip } from '../generator.js';
import type { VideoClipItem } from '../schema.js';

export const videoRenderStep = createStep({
  id: 'step-video-render',
  description: '对待渲染镜头调度物理视频算力并发生成动态视频切片',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const context = inputData as WorkflowContext;
    const { projectId, payload } = context;
    const auditData = payload?.videoAudit;

    if (!auditData) {
      throw new Error('[videoRenderStep] 缺少前置核验上下文 (videoAudit)');
    }

    const {
      targetShotIds,
      cameraTrajectory,
      motionIntensity,
      userFeedback,
      isMock,
      pendingShots,
      allShotsMap,
    } = auditData;

    if (!pendingShots || pendingShots.length === 0) {
      return {
        ...context,
        payload: {
          ...payload,
          videoRendered: [],
        },
        lastSummary: '视频切片无需重新渲染，已直接复用现有资产。',
      };
    }

    const renderResults = await asyncPoolSettled<any, VideoClipItem>(
      2,
      pendingShots,
      async (kf: any) => {
        const sbShot = allShotsMap[kf.shotId];
        return await renderFreshVideoClip({
          projectId,
          kf,
          sbShot,
          cameraTrajectory,
          motionIntensity,
          userFeedback,
          isMock,
        });
      }
    );

    const renderedClips: VideoClipItem[] = [];
    for (const r of renderResults) {
      if (r.status === 'fulfilled' && r.value) {
        renderedClips.push(r.value);
      } else {
        console.error('[videoRenderStep] 渲染视频切片失败:', r.reason);
      }
    }

    return {
      ...context,
      payload: {
        ...payload,
        videoRendered: renderedClips,
      },
      lastSummary: `动态视频切片渲染完成：成功渲染 ${renderedClips.length}/${pendingShots.length} 支切片。`,
    };
  },
});
