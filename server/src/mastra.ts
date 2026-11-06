/**
 * mastra.ts
 * Mastra 核心容器总装入口 (Canonical Mastra SSOT)
 * 
 * 架构核心：
 * 1. 负责 Mastra 官方微内核容器单例配置与总装；
 * 2. 统一对外单一主入口：挂载 AI 视听总导演智能体 (directorAgent)，单跳直出；
 * 3. 挂载影视生成制片流水线工作流 (filmProductionPipelineWorkflow) 与视听微观子工作流族；
 * 4. 彻底告别冗余别名，保持单一事实来源 (SSOT)。
 */

import { Mastra } from '@mastra/core/mastra';
import { installMastraJsonSelfHealing } from './mastra-compat/index.js';
import { directorAgent, createDirectorAgent } from './agents/director/index.js';

// 初始化并激活 Mastra 兼容层针对国产大模型工具流式输出的语法自愈扩展
installMastraJsonSelfHealing();
import { filmProductionPipelineWorkflow } from './agents/director/generator/index.js';
import {
  storyBibleSubWorkflow,
  characterPortraitSubWorkflow,
  sceneScriptSubWorkflow,
  storyboardSubWorkflow,
  keyframeReferenceSubWorkflow,
  videoProductionSubWorkflow,
} from './agents/director/generator/steps/index.js';

export const mastra = new Mastra({
  agents: {
    'director-agent': directorAgent,
  },
  workflows: {
    'film-production-pipeline': (filmProductionPipelineWorkflow as any).nativeWorkflow || filmProductionPipelineWorkflow,
    'subwf-story-bible': (storyBibleSubWorkflow as any).nativeWorkflow || storyBibleSubWorkflow,
    'subwf-character-portrait': (characterPortraitSubWorkflow as any).nativeWorkflow || characterPortraitSubWorkflow,
    'subwf-scene-script': (sceneScriptSubWorkflow as any).nativeWorkflow || sceneScriptSubWorkflow,
    'subwf-storyboard': (storyboardSubWorkflow as any).nativeWorkflow || storyboardSubWorkflow,
    'subwf-keyframe-reference': (keyframeReferenceSubWorkflow as any).nativeWorkflow || keyframeReferenceSubWorkflow,
    'subwf-video-production': (videoProductionSubWorkflow as any).nativeWorkflow || videoProductionSubWorkflow,
  },
});

export { directorAgent, createDirectorAgent } from './agents/director/index.js';
export { filmProductionPipelineWorkflow } from './agents/director/generator/index.js';
export {
  storyBibleSubWorkflow,
  characterPortraitSubWorkflow,
  sceneScriptSubWorkflow,
  storyboardSubWorkflow,
  keyframeReferenceSubWorkflow,
  videoProductionSubWorkflow,
} from './agents/director/generator/steps/index.js';
export * from './tools/index.js';
