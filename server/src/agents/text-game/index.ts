/**
 * agents/text-game/index.ts
 * 互动文游智能体自治领地统一对外总装出口 (SSOT)
 *
 * 核心法则：
 * 1. 互动文游所有逻辑、强类型契约、文学提示词、工具箱与 Pi Agent 实例完全高内聚于本目录；
 * 2. 对外提供纯净统一门面，杜绝跨模块私有细节外溢。
 */

export {
  textGameAgent,
  createTextGameAgent,
  writeTextGameWithAgent,
} from './text-game.agent.js';

export {
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
  TEXT_GAME_SYSTEM_PROMPT,
  buildTextGameUserPrompt,
} from './prompt.js';

export {
  writeGameNodeTool,
  auditGameGraphTool,
  simulateTestPlayTool,
  submitGameDeliveryTool,
} from './tools/index.js';
