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
import { modifierWorkflow } from './agents/director/modifier/index.js';

// 挂载说明：workflows 只用于拓扑自省（Studio / GET /api/workflows），不是执行入口。
// 业务执行的唯一入口是 Workflow.dispatch(key)，它带门禁、阶段推进与下游清理。
// 因此这里挂全部三条轨（主线 / 工序子流 / 修改流）是安全的，也是必要的可观测性。

// 显式标注类型：Mastra 构造器推断类型会引用 @mastra/core 内部 chunk 路径，
// 在 declaration: true 下部分 TS 版本会报 ts(2742)「推断类型不可命名」，标注后根除。
export const mastra: Mastra = new Mastra({
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
    'subwf-modify': (modifierWorkflow as any).nativeWorkflow || modifierWorkflow,
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
export { modifierWorkflow } from './agents/director/modifier/index.js';
export * from './tools/index.js';
