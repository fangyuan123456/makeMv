/**
 * workflow-engine/WorkflowContextStorage.ts
 * 引擎底座异步执行上下文基础设施 (Workflow Execution Context Storage SSOT)
 *
 * 核心架构定位（法典 0.3/0.4）：
 * 1. 利用 Node.js 原生 AsyncLocalStorage 实现跨异步调用栈的隐式上下文透传；
 * 2. 彻底解耦业务 Step 与基础设施，业务层无需手动传参 taskId，并发池等底座工具全自动感知当前任务；
 * 3. 强类型契约，单一事实来源，业务代码 100% 零侵入。
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface WorkflowTaskContext {
  projectId: string;
  taskId: string;
  skill: string;
  stage?: string;
  startTime: number;
}

export const workflowTaskStorage = new AsyncLocalStorage<WorkflowTaskContext>();

/**
 * 获取当前异步调用栈绑定的工作流任务上下文
 */
export function getCurrentTaskContext(): WorkflowTaskContext | undefined {
  return workflowTaskStorage.getStore();
}

