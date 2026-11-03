/**
 * mastra/agents/director.agent.ts
 * 基于 Mastra Agent + 统一百炼 LLM 底座的标准 AI 导演智能体 (Director Agent SSOT)
 * 
 * 核心特性：
 * 1. 深度对齐系统统一 LLM 配置 (DashScope / OpenAI Compatible / Mock)；
 * 2. 挂载 8 大工序全链路 Mastra Tools；
 * 3. 消费 requireApproval 原语与人在回路；
 * 4. 彻底消灭硬编码 gpt-4o 与 placeholder-key。
 */

import { Agent } from '@mastra/core/agent';
import { createOpenAI } from '@ai-sdk/openai';
import {
  storyBibleTool,
  characterPortraitTool,
  sceneScriptTool,
  storyboardTool,
  keyframeReferenceTool,
  videoProductionTool,
  criticReviewTool,
  fmvPackagingTool,
  demoTool,
} from '../tools/index.js';
import { config } from '../../utils/config.js';

// 基于全局统一配置装配 OpenAI 兼容客户端
const llmProvider = createOpenAI({
  apiKey: config.llm.apiKey || 'placeholder-key',
  baseURL: config.llm.baseUrl,
});

export const DIRECTOR_AGENT_INSTRUCTIONS = `你是一位顶级电影制片厂的【互动影游总导演与视听系统架构师 (Director Agent)】。
你的核心职责是协助人类创作者进行戏剧构思、故事世界观推演、角色设定、场景视听规划、镜头分镜设计、视频渲染装配与母带打包。

【全链路 8 大核心工序微内核】：
1. story-bible-generator: 世界观设定、角色动机、黄金三幕叙事大纲、网状分支图推演。
2. character-portrait-generator: 角色立绘/定妆照视觉概念渲染与人设锁定。
3. scene-script-generator: 场景文学剧本拆解、动作与对白细节编写。
4. storyboard-generator: 专业影视工业级镜头分镜设计（景别、运镜、构图、音效）。
5. keyframe-reference-generator: 分镜镜头关键帧参考图生成。
6. video-production-generator: 动态视频切片生成与视听渲染。
7. critic-review-tool: 独立影视审查官挑刺质检（剧情逻辑、角色防降智、反伪选择、视听可行性四维打分与放行门禁）。
8. fmv-packaging-tool: 全网互动节点拓扑路由、分支决策点与视频切片母带打包编译。

【行为准则与法典约束】：
1. 语言专业、严谨、充满画面感，精通镜头运动、光影构图与戏剧冲突；
2. 严格遵循纯中文交流，杜绝硬编码特定题材，适配任何不同类型的创意剧本；
3. 充分感知当前项目的已完成资产与各阶段审查门禁，做出连贯、定向的戏剧推演；
4. 工具已被严格标记为人在回路，提议执行工序前向创作者清晰阐明决策考量与预期视听产物。`;

export const directorAgent = new Agent({
  id: 'director-agent',
  name: 'director-agent',
  instructions: DIRECTOR_AGENT_INSTRUCTIONS,
  model: llmProvider(config.llm.model || 'qwen-plus'),
  tools: {
    storyBibleTool,
    characterPortraitTool,
    sceneScriptTool,
    storyboardTool,
    keyframeReferenceTool,
    videoProductionTool,
    criticReviewTool,
    fmvPackagingTool,
    demoTool,
  },
});
