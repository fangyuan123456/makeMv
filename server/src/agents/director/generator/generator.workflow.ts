/**
 * agents/director/generator/generator.workflow.ts
 * 互动影游全流程声明式生产流水线工作流 (Film Production Pipeline Workflow SSOT)
 * 
 * 核心架构特性（法典 0.3/0.4 极简微内核）：
 * 1. 0 硬编码串联：流水线工序 100% 由 STEP_MANIFESTS 清单注册表按 order 动态自动链式构建；
 * 2. 插件化插拔：新增或调整工序位序，工作流拓扑全自动无缝自愈；
 * 3. 官方原生微内核：兼容 Mastra Studio 原生 DAG 拓扑渲染。
 */

import { Workflow } from '../../../workflow-engine/index.js';
import { WorkflowContextSchema } from './steps/common.js';
import { STEP_MANIFESTS } from './manifest.js';

export function buildFilmProductionPipelineWorkflow() {
  const sequentialSteps = STEP_MANIFESTS
    .filter((m) => m.isPipelineStep && m.order >= 0)
    .sort((a, b) => a.order - b.order);

  return Workflow.getInstance().create({
    id: 'film-production-pipeline',
    inputSchema: WorkflowContextSchema,
    outputSchema: WorkflowContextSchema,
    requireConfirmation: true,
    steps: sequentialSteps.map((item) => ({
      step: item.step,
      name: item.title,
    })),
  });
}

/**
 * 互动影游核心生产流水线工作流 (Mastra Workflow SSOT)
 */
export const filmProductionPipelineWorkflow = buildFilmProductionPipelineWorkflow();
