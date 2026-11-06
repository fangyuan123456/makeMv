/**
 * agents/director/generator/steps/keyframe-reference/keyframe-reference.workflow.ts
 * 关键帧首帧基准图微观子工作流 (Keyframe Reference Micro Sub-Workflow SSOT)
 *
 * 核心架构特性（法典 0.3/0.4 极简微内核）：
 * 1. 业务层 100% 零侵入代码，完全由底座切面自动计算权重并在 Step 切换时上报；
 * 2. 独立原子 Step 解耦在 steps/ 物理模块；
 * 3. 统一使用 WorkflowContextSchema 串联上下文。
 */

import { Workflow } from '../../../../../workflow-engine/index.js';
import { WorkflowContextSchema } from '../common.js';
import {
  keyframeAuditStep,
  keyframeRenderStep,
  keyframeAggregateStep,
} from './steps/index.js';

export * from './steps/index.js';

/**
 * 关键帧基准图微观子工作流实例 (Mastra Workflow SSOT)
 */
export const keyframeReferenceSubWorkflow = Workflow.getInstance().create({
  id: 'subwf-keyframe-reference',
  description: '关键帧首帧基准图微观生产子工作流：具备细粒度断点恢复与单镜头靶向回退能力',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  requireConfirmation: false,
  steps: [
    { step: keyframeAuditStep, weight: 20, name: '核验既有分镜关键帧断点' },
    { step: keyframeRenderStep, weight: 60, name: '分镜首帧生图批量渲染' },
    { step: keyframeAggregateStep, weight: 20, name: '关键帧档案聚合持久化落盘' },
  ],
});
