/**
 * agents/director/generator/steps/character-portrait/character-portrait.workflow.ts
 * 角色视觉定妆微观子工作流 (Character Portrait Micro Sub-Workflow SSOT)
 *
 * 核心架构特性（法典 0.3/0.4 极简微内核）：
 * 1. 业务层 100% 零侵入代码，完全由底座切面自动计算权重并在 Step 切换时上报；
 * 2. 独立原子 Step 解耦在 steps/ 物理模块；
 * 3. 统一使用 WorkflowContextSchema 串联上下文。
 */

import { Workflow } from '../../../../../workflow-engine/index.js';
import { WorkflowContextSchema } from '../common.js';
import {
  portraitAuditStep,
  portraitRenderStep,
  portraitAggregateStep,
} from './steps/index.js';

export * from './steps/index.js';

/**
 * 角色定妆微观子工作流实例 (Mastra Workflow SSOT)
 */
export const characterPortraitSubWorkflow = Workflow.getInstance().create({
  id: 'subwf-character-portrait',
  description: '角色视觉定妆微观生产子工作流：具备细粒度断点恢复与单角色靶向回退能力',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  requireConfirmation: false,
  steps: [
    { step: portraitAuditStep, weight: 20, name: '核验既有角色资产与断点' },
    { step: portraitRenderStep, weight: 60, name: '批量视觉定妆生图渲染' },
    { step: portraitAggregateStep, weight: 20, name: '定妆档案聚合持久化落盘' },
  ],
});
