/**
 * tools/video-production/video-production.tool.ts
 * Mastra 原生 Tool: 动态视频切片生成工具 (由内部 videoProductionSubWorkflow 微观子工作流驱动)
 * 
 * 核心机制：
 * 1. 细粒度断点恢复 (Resume)：自动识别已完成的视频切片，断点跳过已渲染镜头，绝不重复烧卡；
 * 2. 镜头级靶向回退 (Single-Shot Rollback)：支持 targetShotId 仅重做指定镜头，其他镜头资产完全保全；
 * 3. 驱动 Mastra 原生微观子工作流，具备细粒度步骤追踪与局部重试。
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { videoProductionSubWorkflow } from './video-production.workflow.js';
import { VideoProductionArtifactSchema } from './schema.js';

export const videoProductionTool = createTool({
  id: 'video-production-generator',
  description: '将分镜头首帧参考图与运镜指令驱动转化为连贯动态高清视频切片，支持单镜头靶向微调自愈与断点恢复',
  inputSchema: z.object({
    projectId: z.string().describe('项目全局唯一 ID (Project ID)'),
    sessionId: z.string().optional().describe('当前交互会话 ID'),
    targetShotId: z.string().optional().describe('指定单镜重做的镜头标识 (如 shot_1)'),
    targetShotIds: z.array(z.string()).optional().describe('指定批量镜头重做/回退列表'),
    cameraTrajectory: z.string().optional().describe('覆盖运镜轨迹 (如 pan_left, orbit, zoom_in 等)'),
    motionIntensity: z.union([z.string(), z.number()]).optional().describe('运活动量强度 (如 low, normal, high 或数值)'),
    userFeedback: z.string().optional().describe('运镜幅度或动态细节调整'),
    forceRegenerate: z.boolean().optional().describe('是否强制全量重跑（忽略断点缓存）'),
    proposalId: z.string().optional().describe('关联的人在回路提案 ID (细粒度进度反馈 SSOT)'),
    isMock: z.boolean().optional().describe('是否为 Mock 模拟测试'),
  }).strict(),
  outputSchema: z.object({
    success: z.boolean(),
    data: VideoProductionArtifactSchema.optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
  }),
  requireApproval: true,
  execute: async (params) => {
    try {
      const run = await videoProductionSubWorkflow.createRun();
      const runResult = await run.start({ inputData: params });

      const stepOutput =
        (runResult as any).result ||
        (runResult as any).steps?.['step-aggregate-video-artifact']?.output;

      if (!stepOutput || stepOutput.success === false || runResult.status !== 'success') {
        const errorMsg =
          (runResult as any).error ||
          stepOutput?.error ||
          `微观子工作流生成异常 (run status: ${runResult.status})`;
        return {
          success: false,
          error: errorMsg,
        };
      }

      return {
        success: true,
        data: stepOutput.data,
        summary: stepOutput.summary,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || '动态视频生成失败',
      };
    }
  },
});
