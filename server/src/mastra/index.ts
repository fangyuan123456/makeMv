/**
 * mastra/index.ts
 * Mastra 核心容器总装入口 (Canonical Mastra SSOT)
 */

import { Mastra } from '@mastra/core/mastra';
import { directorAgent } from './agents/index.js';
import { pipelineWorkflow } from './workflows/index.js';

export const mastra = new Mastra({
  agents: {
    directorAgent,
  },
  workflows: {
    pipelineWorkflow,
  },
});

export { directorAgent } from './agents/index.js';
export { pipelineWorkflow } from './workflows/index.js';
export * from './tools/index.js';
