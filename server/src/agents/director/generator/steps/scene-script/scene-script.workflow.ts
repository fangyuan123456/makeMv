/**
 * agents/director/generator/steps/scene-script/scene-script.workflow.ts
 * 分场剧本微观子工作流 (Scene Script Micro Sub-Workflow SSOT)
 *
 * 核心架构特性（法典 0.3/0.4 极简微内核）：
 * 1. 业务层 100% 零侵入代码，完全由底座切面自动计算权重并在 Step 切换时上报；
 * 2. 独立原子 Step 解耦在 steps/ 物理模块；
 * 3. 统一使用 WorkflowContextSchema 串联上下文。
 */

import { Workflow } from '../../../../../workflow-engine/index.js';
import { WorkflowContextSchema } from '../common.js';
import {
  sceneScriptAuditStep,
  sceneScriptExpandStep,
  sceneScriptAggregateStep,
} from './steps/index.js';

export * from './steps/index.js';

/**
 * 分场剧本微观子工作流实例 (Mastra Workflow SSOT)
 */
export const sceneScriptSubWorkflow = Workflow.getInstance().create({
  id: 'subwf-scene-script',
  description: '分场剧本生产微观子工作流：具备剧情拓扑核验、分块批量扩写与连通性校验聚合落盘能力',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  requireConfirmation: false,
  steps: [
    { step: sceneScriptAuditStep, weight: 20, name: '剧情拓扑节点核验与场次规划' },
    { step: sceneScriptExpandStep, weight: 60, name: '分场剧本文学扩写与互动抉择' },
    { step: sceneScriptAggregateStep, weight: 20, name: '场次拓扑连通校验与资产落盘' },
  ],
});
