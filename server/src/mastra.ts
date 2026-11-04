/**
 * mastra.ts
 * Mastra 核心容器总装入口 (Canonical Mastra SSOT)
 * 
 * 架构核心：
 * 1. 负责 Mastra 官方微内核容器单例实例配置与总装；
 * 2. 挂载总导演智能体 (directorAgent) 与全流程流水线工作流 (filmProductionPipelineWorkflow)；
 * 3. 挂载具备细粒度断点恢复与单项回退能力的视听微观子工作流族 (Micro Sub-Workflows)；
 * 4. 彻底告别冗余别名，保持单一事实来源 (SSOT)。
 */

import { Mastra } from '@mastra/core/mastra';
import { directorAgent, filmProductionPipelineWorkflow } from './agents/director/index.js';
import { videoProductionSubWorkflow } from './tools/video-production/index.js';
import { characterPortraitSubWorkflow } from './tools/character-portrait/index.js';
import { keyframeReferenceSubWorkflow } from './tools/keyframe-reference/index.js';

export const mastra = new Mastra({
  agents: {
    'director-agent': directorAgent,
  },
  workflows: {
    'film-production-pipeline': filmProductionPipelineWorkflow,
    'subwf-video-production': videoProductionSubWorkflow,
    'subwf-character-portrait': characterPortraitSubWorkflow,
    'subwf-keyframe-reference': keyframeReferenceSubWorkflow,
  },
});

export { directorAgent, filmProductionPipelineWorkflow } from './agents/director/index.js';
export { videoProductionSubWorkflow } from './tools/video-production/index.js';
export { characterPortraitSubWorkflow } from './tools/character-portrait/index.js';
export { keyframeReferenceSubWorkflow } from './tools/keyframe-reference/index.js';
export * from './tools/index.js';
