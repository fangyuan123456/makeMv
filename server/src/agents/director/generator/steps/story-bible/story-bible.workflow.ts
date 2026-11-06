/**
 * agents/director/generator/steps/story-bible/story-bible.workflow.ts
 * 叙事架构 (Story Bible) 微内核多步骤原子子工作流 (Story Bible Sub-Workflow SSOT)
 *
 * 核心架构特性（法典 0.3/0.4 极简微内核与单一事实来源）：
 * 1. 业务层 100% 零侵入：业务大模型推演函数内部不写任何进度广播，完全依靠底座 Workflow 切面；
 * 2. 独立原子 Step 解耦：解耦为独立的 steps/ 物理模块 (spine, graph, character-profiles)；
 * 3. 底座无侵入计算与同步：由 Workflow.getInstance().create 编织权重切面，每当 Step 切换自动向客户端广播进度 (35% ➔ 70% ➔ 95% ➔ 100%)。
 */

import { Workflow } from '../../../../../workflow-engine/index.js';
import { WorkflowContextSchema } from '../common.js';
import {
  storySpineStep,
  storyGraphStep,
  characterProfilesStep,
} from './steps/index.js';

export * from './steps/index.js';

/**
 * 叙事架构微观子工作流实例 (遵循底座无侵入切面规范)
 */
export const storyBibleSubWorkflow = Workflow.getInstance().create({
  id: 'subwf-story-bible',
  description: '叙事架构 (Story Bible) 生产微观子工作流：具备三阶段原子 Step 切面与细粒度进度实时广播能力',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  requireConfirmation: false,
  steps: [
    { step: storySpineStep, weight: 35, name: '推演故事黄金三幕骨架' },
    { step: storyGraphStep, weight: 35, name: '编译网状分支图谱与核心抉择点' },
    { step: characterProfilesStep, weight: 30, name: '推演核心角色档案并聚合落盘' },
  ],
});
