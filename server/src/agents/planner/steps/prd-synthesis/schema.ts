/**
 * agents/planner/steps/prd-synthesis/schema.ts
 * 100% 通用互动影游 PRD 契约与状态机拓扑汇聚契约 (PRD Synthesis Schema SSOT)
 *
 * 核心架构：
 * 1. 零题材偏见、零双套别名：全链路唯一事实来源 `UniversalPrdSpecSchema`；
 * 2. 职责正交解耦：`clips`（视频）与 `interactions`（纯玩法与流外状态）不关心走向，由 `wiring` 统一串联；
 * 3. 状态变更消歧：明确拆分为 `add`（数值增量）与 `set`（覆盖赋值），开放可选 `config` 扩展任意玩法参数；
 * 4. 混合构建：代码确定性构建 `clips` 与基础 `wiring`，LLM 仅通过 `PrdEnhancementOutputSchema` 做全局增补，杜绝编造节点 ID。
 */

import { z } from 'zod';
import { SlicedClipNodeSchema } from '../interaction-slicing/schema.js';
import { DerivedBranchNodeSchema } from '../branch-derivation/schema.js';

export const PrdStateValueSchema = z.union([
  z.number(),
  z.boolean(),
  z.string(),
  z.array(z.string()),
]);

export type PrdStateValue = z.infer<typeof PrdStateValueSchema>;

export const PrdStateChangeSchema = z.object({
  add: z.record(z.number()).optional().describe('数值增减字典，如 { varA: 1, varB: -10 }'),
  set: z.record(PrdStateValueSchema).optional().describe('状态直接赋值字典，如 { flagA: true }'),
});

export type PrdStateChange = z.infer<typeof PrdStateChangeSchema>;

export const PrdClipNodeSchema = z.object({
  id: z.string().describe('视频片段唯一编号（与 story.md 及 {id}.mp4 1:1 对齐，如 S1, S1.1）'),
  title: z.string().describe('片段标题'),
  video: z.string().describe('对应视频文件名，如 S1.mp4'),
});

export type PrdClipNode = z.infer<typeof PrdClipNodeSchema>;

export const PrdInteractionOutcomeSchema = z.object({
  key: z.string().describe('结果枚举键，如 A / B / SUCCESS / TIMEOUT'),
  label: z.string().describe('展示文案或结果说明'),
  stateChange: PrdStateChangeSchema.optional().describe('流外状态变更（仅增删或赋值，不含跳转目标）'),
  feedback: z.string().optional().describe('即时反馈或解锁文案'),
});

export type PrdInteractionOutcome = z.infer<typeof PrdInteractionOutcomeSchema>;

export const PrdInteractionNodeSchema = z.object({
  id: z.string().describe('互动点唯一编号（1 片段至多对应 1 个互动点），如 I_S1 / I_S2'),
  kind: z.string().describe('交互形态，如 CHOICE / HOLD / TAP_HOTSPOT / WIPE / INPUT / QTE 等'),
  prompt: z.string().describe('面向玩家的操作提示'),
  timeoutSec: z.number().nullable().default(null).describe('超时秒数，null 表示无限等待'),
  config: z.record(z.unknown()).optional().describe('可选玩法参数字典，如 { durationSec: 1.5 }'),
  outcomes: z.array(PrdInteractionOutcomeSchema).min(1).describe('该互动可能产出的全部结果列表'),
});

export type PrdInteractionNode = z.infer<typeof PrdInteractionNodeSchema>;

export const PrdEndingNodeSchema = z.object({
  id: z.string().describe('结局节点唯一标识，如 END_S5_TE / END_S1.1'),
  endingType: z.enum(['TE', 'HE', 'BE', 'NE', 'SE']).describe('结局类别'),
  title: z.string().describe('结局名称'),
  isVictory: z.boolean().describe('是否属于胜利/通关结局'),
  summary: z.string().describe('结局结算说明与回溯引导'),
  rewindTargetClipId: z.string().optional().describe('失败或分支结局允许回溯重选的目标片段 ID'),
});

export type PrdEndingNode = z.infer<typeof PrdEndingNodeSchema>;

export const PrdTransitionCardSchema = z.object({
  text: z.string().describe('过场提示卡文案'),
  durationSec: z.number().default(1.5).describe('展示秒数'),
});

export type PrdTransitionCard = z.infer<typeof PrdTransitionCardSchema>;

export const PrdWiringEdgeSchema = z.object({
  from: z.string().describe('起点 ID（片段 ID 或互动 ID）'),
  onOutcome: z.string().describe('触发条件键：onEnded / * / A / B / SUCCESS / TIMEOUT 等'),
  condition: z.string().nullable().default(null).describe('可选前置状态条件表达式（如 varA >= 3），null 为兜底匹配'),
  transition: PrdTransitionCardSchema.nullable().default(null).describe('可选转场卡'),
  to: z.string().describe('目标 ID（下一片段 ID、互动 ID 或结局 ID）'),
});

export type PrdWiringEdge = z.infer<typeof PrdWiringEdgeSchema>;

export const PrdUiPageSpecSchema = z.object({
  page: z.string().describe('界面或弹层名称，如 主页 / 播放页 / 暂停设置 / 故事线选集'),
  features: z.string().describe('该界面的核心功能列表'),
});

export type PrdUiPageSpec = z.infer<typeof PrdUiPageSpecSchema>;

/**
 * 100% 通用互动影游 PRD 唯一事实来源契约
 */
export const UniversalPrdSpecSchema = z.object({
  gameTitle: z.string().describe('作品标题'),
  genre: z.string().describe('题材类型'),
  playerIdentity: z.string().describe('玩家代入身份'),
  premiseAndPerspective: z.string().describe('一两句话简述故事背景与玩家视角'),
  outOfFlowSummary: z.string().describe('流外状态设计与互动思路简述（无流外状态则写无）'),
  gameplayAndVictorySummary: z.string().describe('玩法循环与胜负判定概述'),
  uiPagesSummary: z.array(PrdUiPageSpecSchema).min(1).describe('按本作实际需要裁剪的界面功能列表'),
  startNodeId: z.string().describe('起始视频节点 ID，如 S1'),
  initialState: z.record(PrdStateValueSchema).default({}).describe('全局初始流外状态字典，无流外状态时为空 {}'),
  clips: z.array(PrdClipNodeSchema).min(1).describe('全部视频片段列表（1:1 对齐 story.md）'),
  interactions: z.array(PrdInteractionNodeSchema).default([]).describe('全部纯互动点列表（不含跳转目标）'),
  endings: z.array(PrdEndingNodeSchema).min(1).describe('全部结局节点列表'),
  wiring: z.array(PrdWiringEdgeSchema).min(1).describe('节点接线表（按数组从上到下顺序匹配第一条满足 condition 的边）'),
});

export type UniversalPrdSpec = z.infer<typeof UniversalPrdSpecSchema>;

/**
 * Step 4 轻量 AI 增补输出契约（不允许修改 clips 编号或编造不存在的节点 ID）
 */
export const PrdEnhancementOutputSchema = z.object({
  genre: z.string().describe('提炼自剧本的题材类型'),
  playerIdentity: z.string().describe('玩家在故事中的第一视角身份'),
  premiseAndPerspective: z.string().describe('一两句话简述故事背景与玩家代入视角'),
  outOfFlowSummary: z.string().describe('流外状态及交互设计总述（若无需数值/收集则写无）'),
  gameplayAndVictorySummary: z.string().describe('一两句话概括玩法循环与胜负判定规则'),
  uiPagesSummary: z.array(PrdUiPageSpecSchema).min(1).describe('按本作实际需要设计的界面及功能列表'),
  initialState: z.record(PrdStateValueSchema).default({}).describe('全剧初始流外状态（按需设计，可为空 {}）'),
  interactionPatches: z
    .array(
      z.object({
        interactionId: z.string().describe('必须匹配给定基础互动清单中的 id'),
        kind: z.string().optional().describe('规范交互类型，如 CHOICE / HOLD / TAP_HOTSPOT / WIPE / INPUT / QTE'),
        timeoutSec: z.number().nullable().optional().describe('超时秒数，null 表示无限等待（适合终极抉择）'),
        config: z.record(z.unknown()).optional().describe('可选交互参数，如 { durationSec: 1.5 }'),
        defaultOutcomeKey: z.string().nullable().optional().describe('超时默认触发的结果 key（如 "B" 或 "SKIP"），null 表示不设超时默认跳转'),
        outcomePatches: z
          .array(
            z.object({
              key: z.string().describe('对应结果的 key，如 A / B / SUCCESS'),
              stateChange: PrdStateChangeSchema.optional(),
              feedback: z.string().optional(),
            })
          )
          .default([]),
      })
    )
    .default([]),
  branchTransitions: z
    .array(
      z.object({
        fromClipId: z.string().describe('REJOIN 支线片段 ID'),
        text: z.string().describe('过场提示卡文案'),
        durationSec: z.number().default(1.5),
      })
    )
    .default([]),
  endingEnhancements: z
    .array(
      z.object({
        sourceClipId: z.string().describe('触发结局的视频片段 ID（如末幕 S5 或终局支线 S1.1）'),
        endingId: z.string().describe('结局 ID；若给主干末幕分出 TE 与 HE，可分别命名为 END_S5_TE 与 END_S5_HE'),
        endingType: z.enum(['TE', 'HE', 'BE', 'NE', 'SE']),
        title: z.string().describe('结局标题'),
        isVictory: z.boolean(),
        summary: z.string().describe('结局结算说明与回溯引导'),
        condition: z.string().nullable().default(null).describe('触发条件表达式（如 varA >= N），默认兜底填 null'),
      })
    )
    .default([]),
});

export type PrdEnhancementOutput = z.infer<typeof PrdEnhancementOutputSchema>;

/**
 * 工序输入契约
 */
export const PrdSynthesisInputSchema = z.object({
  title: z.string().min(1).describe('故事标题'),
  spineScript: z.string().optional().describe('黄金主干剧本文学正文'),
  clips: z.array(SlicedClipNodeSchema).min(1).describe('主干视听片段与互动切口数组'),
  branches: z.array(DerivedBranchNodeSchema).describe('推演所得的支线片段数组'),
  userToneOrPreference: z.string().optional().describe('创作者指定的风格偏好或补充要求'),
});

export type PrdSynthesisInput = z.infer<typeof PrdSynthesisInputSchema>;

/**
 * 拓扑图节点与边定义 (StoryGraph DAG，供客户端可视化与度量统计使用)
 */
export const StoryGraphNodeSchema = z.object({
  nodeId: z.string().describe('节点唯一标识'),
  nodeType: z.enum(['MAINLINE_CLIP', 'BRANCH_CLIP', 'ENDING']).describe('节点分类'),
  title: z.string().describe('节点展示标题'),
  level: z.number().describe('拓扑层级 (1 到 n)'),
  contentSnippet: z.string().describe('剧本或结局精要描述'),
  endingType: z.enum(['TE', 'HE', 'BE', 'NE', 'SE']).optional().describe('结局分类标识'),
});

export type StoryGraphNode = z.infer<typeof StoryGraphNodeSchema>;

export const StoryGraphEdgeSchema = z.object({
  fromNodeId: z.string().describe('起始节点标识'),
  toNodeId: z.string().describe('目标节点标识'),
  edgeType: z.enum(['MAINLINE_PROGRESS', 'CHOICE_BRANCH', 'REJOIN', 'REWIND']).describe('边类型'),
  label: z.string().describe('边展示文本'),
  condition: z.string().optional().describe('触发条件或代价'),
});

export type StoryGraphEdge = z.infer<typeof StoryGraphEdgeSchema>;

export const StoryGraphSchema = z.object({
  startNodeId: z.string().describe('图入口节点标识'),
  nodes: z.array(StoryGraphNodeSchema).describe('所有节点集合'),
  edges: z.array(StoryGraphEdgeSchema).describe('所有边集合'),
});

export type StoryGraph = z.infer<typeof StoryGraphSchema>;

/**
 * 工序输出契约
 */
export const PrdSynthesisOutputSchema = z.object({
  title: z.string().describe('故事标题'),
  prd: UniversalPrdSpecSchema.describe('100% 通用互动影游 PRD 唯一事实来源'),
  graph: StoryGraphSchema.describe('状态机拓扑有向无环图 (StoryGraph DAG)'),
});

export type PrdSynthesisOutput = z.infer<typeof PrdSynthesisOutputSchema>;
