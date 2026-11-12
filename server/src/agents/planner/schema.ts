/**
 * agents/planner/schema.ts
 * 互动游戏系统策划案强类型 Zod 契约 (GDD PRD Schema SSOT)
 *
 * 核心设计哲学（先有 PRD，再去逐幕丰富文学细节）：
 * 1. 游戏系统主策划 (Planner) 专职出系统级 PRD：
 *    - 核心玩法与体验循环 (Core Loop)
 *    - 规则模型与状态机 (State Blueprint)
 *    - 出场角色网络 (Cast Profiles)
 *    - 三幕叙事节拍骨架 (Narrative Beats Outline)
 * 2. 严禁主策划越权偷写具体的台词剧本与微观场景描写，所有文学血肉一律留给阶段二 (Text Game Agent) 逐幕丰满！
 * 3. 纯强类型契约事实来源，杜绝内嵌校验与渲染等运行期副作用工具。
 */

import { z } from 'zod';
import { UniversalPrdSpecSchema } from './steps/prd-synthesis/schema.js';

// 1. 全局状态机数值变量定义 (Universal Number Slot)
export const StateVariableSpecSchema = z.object({
  name: z.string().describe('变量中文名（由题材决定，如倒计时、体力、声望；严禁为填表发明与题材无关的通用槽位）'),
  initial: z.number().describe('初始默认值'),
  min: z.number().default(0).describe('最小值下限'),
  max: z.number().default(100).describe('最大值上限'),
  description: z.string().optional().describe('数值含义与对游戏的影响（含阈值惩罚或临界后果）'),
});

export type StateVariableSpec = z.infer<typeof StateVariableSpecSchema>;

// 2. 逻辑门禁布尔旗标 (Universal Boolean Flag)
export const StateFlagSpecSchema = z.object({
  name: z.string().describe('旗标中文说明（描述某条剧情事实是否发生，命名由题材决定）'),
  initial: z.boolean().default(false).describe('初始值'),
  description: z.string().optional().describe('触发后对后续剧情或门禁的影响'),
});

export type StateFlagSpec = z.infer<typeof StateFlagSpecSchema>;

// 3. 全局状态机总纲 (World State Blueprint - 基于代数原语自主涌现)
export const GlobalStateMachineSchema = z.object({
  philosophy: z.string().optional().describe('机制哲学阐述（必须从本作题材推演而来，禁止套用通用模板）'),
  variables: z.record(StateVariableSpecSchema).default({}).describe('数值型变量字典（由大模型根据题材自主按需设计，可为空）'),
  flags: z.record(StateFlagSpecSchema).default({}).describe('布尔型旗标字典（由大模型根据题材自主按需设计，可为空）'),
  inventory: z.array(z.string()).default([]).describe('初始随身物品、线索、证据卡或记忆碎片清单'),
});

export type GlobalStateMachine = z.infer<typeof GlobalStateMachineSchema>;

// 4. 出场角色人设与存在形式 (Cast Entity - 零枚举枷锁，适配任何形态)
export const CharacterSpecSchema = z.object({
  characterId: z.string().describe('角色唯一标识，如 char_lin_xun'),
  name: z.string().describe('角色或实体名称'),
  role: z.string().describe('角色定位与存在形式（完全自由定义，如：玩家第一视角、心魔人格、飞船中央AI、初恋挚友、流浪黑猫）'),
  appearance: z.string().describe('核心外貌、发型、标志性服装细节与体态神态'),
  personality: z.string().describe('性格特质、致命弱点与核心欲望'),
});

export type CharacterSpec = z.infer<typeof CharacterSpecSchema>;

// 5. 宏观叙事节拍分支走向意图定义 (Branch Expectation)
export const BranchExpectationSchema = z.object({
  intent: z.string().describe('分支走向意图（必须代表真正不同的戏剧后果，而非同一结局的措辞变体）'),
  targetBeatId: z.string().describe('目标跳转节拍 ID'),
  isLoopBack: z.boolean().optional().default(false).describe('是否为时空循环回溯或箱庭折返'),
  gatingRequirement: z.string().optional().describe('前置门禁说明（如：需要持有密钥、理智>=30）'),
});

export type BranchExpectation = z.infer<typeof BranchExpectationSchema>;

// 6. 全剧三幕叙事节拍骨架定义 (Narrative Beat - 纯策划大纲，不写台词剧本)
export const NarrativeBeatSchema = z.object({
  beatId: z.string().describe('节拍唯一标识，如 beat_01_crisis'),
  act: z.string().describe('所属幕次（按本剧结构自行划分，如：第一幕·建立危机 / 第二幕A·搜证升级 / 第三幕·高潮摊牌）'),
  title: z.string().describe('本节拍标题'),
  dramaticGoal: z.string().describe('核心戏剧目标与玩家考验（必须写清：谁、在什么具体情境、面临什么具体利害、节拍结束时发生了什么变化；不写台词剧本）'),
  gameplayTask: z.string().describe('本拍的玩法任务：玩家在此拍具体执行什么交互（如：搜检房间热点、拼合记忆碎片、限时二选一）——互动可玩性第一，每个节拍必须可玩'),
  keyConflicts: z.string().describe('核心冲突焦点与交锋实体'),
  branchExpectations: z.array(BranchExpectationSchema).default([]).describe('宏观分支走向意图（结局节拍可为空）'),
  isEnding: z.boolean().optional().default(false).describe('是否为该走向的终局节拍'),
  endingTheme: z.string().optional().describe('终局艺术定性与主题（若为终局）'),
});

export type NarrativeBeat = z.infer<typeof NarrativeBeatSchema>;

// 旧版微观节点选项兼容定义 (向下兼容)
export const PlannerChoiceSchema = z.object({
  choiceId: z.string().describe('选项唯一标识'),
  text: z.string().describe('选项展示文本'),
  requiredFlags: z.array(z.string()).default([]),
  stateMutations: z
    .object({
      variables: z.record(z.number()).optional().default({}),
      flags: z.record(z.boolean()).optional().default({}),
      inventoryAdd: z.array(z.string()).optional().default([]),
      inventoryRemove: z.array(z.string()).optional().default([]),
    })
    .default({}),
  nextNodeId: z.string().describe('跳转节点 ID'),
  isLoopBack: z.boolean().optional().default(false),
});

export type PlannerChoice = z.infer<typeof PlannerChoiceSchema>;

export const PlannerNodeSchema = z.object({
  nodeId: z.string(),
  title: z.string(),
  summary: z.string(),
  choices: z.array(PlannerChoiceSchema).default([]),
  defaultFallbackChoiceId: z.string().optional(),
});

export type PlannerNode = z.infer<typeof PlannerNodeSchema>;

// 7. 完整游戏系统策划案 (GDD PRD) 产物 Schema
export const GDDSchema = z.object({
  schemaVersion: z.string().default('3.0.0'),
  title: z.string().describe('作品名称'),
  genre: z.string().default('互动影游').describe('题材类型（完全由大模型自主推断）'),
  hook: z.string().describe('一句话核心世界观与高概念冲突 (The Hook)'),
  playerRole: z.string().describe('玩家在游戏中的身份与第一视角定位'),
  coreLoop: z.string().default('核心体验循环：探索 ➔ 博弈 ➔ 决断').describe('核心玩法与体验循环（必须从本作题材自主推演，不得套用其他作品的循环模板）'),
  markdown: z.string().optional().default('').describe('游戏 PRD Markdown 交付文档（玩法/界面/机制/抉择流转，不含剧本正文；落盘 01-planner/04-prd-synthesis/prd.md）'),
  storyMarkdown: z.string().optional().default('').describe('分幕剧本 Markdown（只含剧本编号与剧情正文，一幕一节、支线接在源幕之后，供下游按幕生成图片/视频；落盘 story.md）'),
  spineScript: z.string().optional().default('').describe('Stage 1 Step 1 产出的未切分原始黄金主干剧本正文'),
  prd: UniversalPrdSpecSchema.optional().describe('阶段一 Step 4 结构化唯一事实来源（clips/interactions/endings/wiring）'),
  storySections: z
    .record(
      z.object({
        title: z.string(),
        narrativeText: z.string(),
      })
    )
    .optional()
    .describe('按片段 ID 切分的 story.md 剧本正文映射'),
  globalStateMachine: GlobalStateMachineSchema.describe('全局状态机与规则模型'),
  characters: z.array(CharacterSpecSchema).min(1).describe('出场实体/角色列表（至少 1 个，支持独角戏、心理人格与多重群像）'),
  beatOutline: z.array(NarrativeBeatSchema).default([]).describe('全剧三幕叙事节拍大纲骨架（只定节拍与宏观分支走向，不写具体台词剧本）'),
  flowchartNodes: z.array(PlannerNodeSchema).optional().describe('可选兼容旧版微观流程节点'),
});

export type GDDArtifact = z.infer<typeof GDDSchema>;
