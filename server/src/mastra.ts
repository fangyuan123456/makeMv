/**
 * mastra.ts
 * Mastra 官方微内核总装出口 (Canonical Mastra SSOT)
 *
 * 核心架构特性（遵循最小暴露与单一门面原则）：
 * 1. 对外唯一认知中枢：agents 仅暴露 routerAgent 作为面向人类创作者的统一门户；
 * 2. 内部专业领域工匠：plannerAgent, gameAssemblyAgent, filmAdapterAgent 作为私有 Worker 被流水线 Steps 原生调度；
 * 3. 生产流水线闭环：workflows 注册全生命周期 productionWorkflow，实现 0 as any 的纯净强类型装配。
 */

import { Mastra } from '@mastra/core';
import { routerAgent } from './agents/router/router.agent.js';
import { plannerAgent } from './agents/planner/planner.agent.js';
import { gameAssemblyAgent } from './agents/game-assembly/index.js';
import { filmAdapterAgent } from './agents/film-production/film-production.agent.js';
import { createProductionWorkflow } from './workflows/production.workflow.js';

const productionWorkflow = createProductionWorkflow();

export const mastra = new Mastra({
  agents: {
    routerAgent, // 🎯【系统对外唯一合法认知中枢与对话门户】
  },
  workflows: {
    productionWorkflow, // ⚙️【系统唯一生产流水线，3 个专业 Agent 封装在 Steps 内部纯净干活】
  },
});

export {
  routerAgent,
  plannerAgent,
  gameAssemblyAgent,
  filmAdapterAgent,
  createProductionWorkflow,
};
