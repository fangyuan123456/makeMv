/**
 * agents/text-game/index.ts
 * 互动文游智能体自治领地统一对外总装出口 (SSOT)
 *
 * 核心法则：
 * 1. 彻底淘汰遗留伪工具黑盒死循环与单体大 JSON 资产；
 * 2. 导出互动短剧微内核官方 Agent (textGameAgent) 与 Workflow (textGameWorkflow)；
 * 3. 并发生图与切片打包全面内聚在流水线内部，杜绝外露冗余过程函数。
 */

export {
  textGameAgent,
  createTextGameAgent,
  buildTextGameDirectorSystemPrompt,
  type TextGameAgentOptions,
} from './text-game.agent.js';

export {
  // 分幕独立切片 SSOT 契约 (1:1 锚定未来独立视频切片)
  SingleSceneJsonSchema,
  GlobalEntitiesSchema,
  SceneChoiceItemSchema,
  SceneDialogueLineSchema,
  type SingleSceneJson,
  type GlobalEntities,
  type SceneChoiceItem,
  type SceneDialogueLine,

  // 兼容契约
  TextGameArtifactSchema,
  TextGameNodeSchema,
  TextGameChoiceSchema,
  SceneVisualSchema,
  type TextGameArtifact,
  type TextGameNode,
  type TextGameChoice,
  type SceneVisual,
} from './schema.js';

export {
  createTextGameWorkflow,
  runTextGameWorkflow,
  convertScenesToTextGameArtifact,
  TextGamePipelineInputSchema,
  TextGamePipelineOutputSchema,
  type TextGamePipelineInput,
  type TextGamePipelineOutput,
} from './text-game.workflow.js';

// 子工序 Steps 导出
export * from './steps/entity-extract/index.js';
export * from './steps/scene-packaging/index.js';
export * from './steps/image-gen-pool/index.js';
export * from './steps/tech-plan/index.js';
export * from './steps/codegen/index.js';
export * from './steps/bundler/index.js';
