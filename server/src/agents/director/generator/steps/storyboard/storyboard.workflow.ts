/**
 * agents/director/generator/steps/storyboard/storyboard.workflow.ts
 * 视听分镜头微观子工作流 (Storyboard Micro Sub-Workflow SSOT)
 *
 * 核心架构特性（法典 0.3/0.4 极简微内核）：
 * 1. 业务层 100% 零侵入代码，完全由底座切面自动计算权重并在 Step 切换时上报；
 * 2. 独立原子 Step 解耦在 steps/ 物理模块；
 * 3. 统一使用 WorkflowContextSchema 串联上下文。
 */

import { Workflow } from '../../../../../workflow-engine/index.js';
import { WorkflowContextSchema } from '../common.js';
import {
  storyboardAuditStep,
  storyboardSegmentStep,
  storyboardAggregateStep,
} from './steps/index.js';

export * from './steps/index.js';

/**
 * 视听分镜头微观子工作流实例 (Mastra Workflow SSOT)
 */
export const storyboardSubWorkflow = Workflow.getInstance().create({
  id: 'subwf-storyboard',
  description: '视听分镜头微观生产子工作流：具备场次核验、分块批量镜头拆解与时长核算聚合落盘能力',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  requireConfirmation: false,
  steps: [
    { step: storyboardAuditStep, weight: 20, name: '分场剧本核验与镜头节奏规划' },
    { step: storyboardSegmentStep, weight: 60, name: '视听镜头分块批量拆解推演' },
    { step: storyboardAggregateStep, weight: 20, name: '时长核算校验与分镜表聚合落盘' },
  ],
});
