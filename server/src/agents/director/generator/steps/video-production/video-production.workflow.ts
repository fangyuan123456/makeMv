/**
 * agents/director/generator/steps/video-production/video-production.workflow.ts
 * 动态视频生成微观子工作流 (Video Production Micro Sub-Workflow SSOT)
 *
 * 核心架构特性（法典 0.3/0.4 极简微内核）：
 * 1. 业务层 100% 零侵入代码，完全由底座切面自动计算权重并在 Step 切换时上报；
 * 2. 独立原子 Step 解耦在 steps/ 物理模块；
 * 3. 统一使用 WorkflowContextSchema 串联上下文。
 */

import { Workflow } from '../../../../../workflow-engine/index.js';
import { WorkflowContextSchema } from '../common.js';
import {
  videoAuditStep,
  videoRenderStep,
  videoAggregateStep,
} from './steps/index.js';

export * from './steps/index.js';

/**
 * 动态视频切片微观子工作流实例 (Mastra Workflow SSOT)
 */
export const videoProductionSubWorkflow = Workflow.getInstance().create({
  id: 'subwf-video-production',
  description: '动态视频切片微观生产子工作流：具备细粒度断点恢复与单镜头靶向回退能力',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  requireConfirmation: false,
  steps: [
    { step: videoAuditStep, weight: 20, name: '核验视频切片断点' },
    { step: videoRenderStep, weight: 70, name: '动态视频切片生成渲染' },
    { step: videoAggregateStep, weight: 10, name: '视频分镜聚合持久化落盘' },
  ],
});
