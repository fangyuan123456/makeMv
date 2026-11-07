/**
 * workflow-engine/types.ts
 * 通用工作流微内核强类型契约与生命周期钩子规范 (Universal Workflow SSOT)
 *
 * 任务（Task）是唯一的状态载体：引擎只创建/推进 Task，不向消息写任何状态快照。
 */

import type { Task } from '../types/index.js';

export interface WorkflowHookContext {
  projectId: string;
  sessionId?: string;
  taskId: string;
  actionType?: string;
  payload: any;
  result?: any;
}

export interface StageExecutionInput {
  projectId: string;
  sessionId?: string;
  activeStage?: string;
  payload?: Record<string, any>;
  overrideParams?: Record<string, any>;
  feedback?: string;
}

export interface StageExecutionOutput {
  projectId: string;
  activeStage?: string;
  lastSummary?: string;
  criticGateStatus?: string;
  toolResult?: any;
  [key: string]: any;
}

export type StageHandler =
  | ((ctx: { inputData: StageExecutionInput }) => Promise<StageExecutionOutput | any>)
  | { execute: (ctx: { inputData: StageExecutionInput }) => Promise<StageExecutionOutput | any> };

export interface WorkflowRegistration {
  key: string;                                          // 工序唯一标识 (如 'story-bible', 'bgm-synthesis')
  execute: StageHandler;                                // 原生工序执行器 (支持 Mastra Step 或直接异步函数)
  title?: string;                                        // 任务默认展示标题
  legalStage?: string;                                   // 该工序所属的法定业务阶段 (可选)
  nextStage?: string;                                    // 执行成功后推进的下一业务阶段 (可选)
  requireConfirmation?: boolean;                         // 是否需要人工确认 (微工作流等设为 false 可全自动直通)
  validateGate?: (ctx: WorkflowHookContext) => { pass: boolean; reason?: string }; // 可选通用质检门禁校验钩子
  onSuccess?: (ctx: WorkflowHookContext) => Promise<void> | void;                  // 可选成功后业务状态机推进钩子
}

export interface DispatchWorkflowOptions {
  projectId: string;
  sessionId?: string;
  workflowKey: string;
  actionType?: 'PROCEED_STAGE' | 'TARGETED_REVISE' | 'RETRY_STAGE' | 'CRITIC_AUDIT' | 'STAGE_ROLLBACK';
  title?: string;
  reason: string;
  userPrompt?: string;
  affectedSteps?: string[];
  parameters?: Record<string, any>;
  requireConfirmation?: boolean;
}

export interface DispatchWorkflowResult {
  success: boolean;
  taskId: string;
  task: Task;
  summary: string;
  isReused?: boolean;
  autoStarted?: boolean;
}

export interface ExecuteTaskOptions {
  projectId: string;
  taskId: string;
  overrideParameters?: Record<string, any>;
}

export interface ExecuteTaskResult {
  success: boolean;
  task: Task;
  result?: any;
  error?: string;
}

export interface StartTaskResult {
  accepted: boolean;
  task: Task;
}
