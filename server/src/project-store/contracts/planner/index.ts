/**
 * project-store/contracts/planner/index.ts
 * 剧本与策划通用 PRD 规格强类型契约 (Planner SSOT)
 */

import { z } from 'zod';

export const PrdStateValueSchema = z.union([
  z.number(),
  z.boolean(),
  z.string(),
  z.array(z.string()),
]);

export type PrdStateValue = z.infer<typeof PrdStateValueSchema>;

export const PrdStateChangeSchema = z.object({
  add: z.record(z.number()).optional(),
  set: z.record(z.unknown()).optional(),
});

export type PrdStateChange = z.infer<typeof PrdStateChangeSchema>;

export const PrdClipNodeSchema = z.object({
  id: z.string().describe('镜头切片编号，如 c1, c2, b1_a'),
  title: z.string().describe('镜头分幕标题'),
  video: z.string().describe('对应的视频文件命名'),
});

export type PrdClipNode = z.infer<typeof PrdClipNodeSchema>;

export const InteractionKindSchema = z.enum([
  'CHOICE',
  'TIMED_CHOICE',
  'SEARCH',
  'HOLD',
  'QTE_TAP',
  'TIMING',
  'CLICK',
  'ACTION_ZONE',
]);

export type InteractionKind = z.infer<typeof InteractionKindSchema>;

export const InteractionSearchTargetSchema = z.object({
  name: z.string().describe('道具/线索显示名称'),
  imageUrl: z.string().optional().describe('关联的定妆道具图 URL（总装时可自动匹配注入）'),
  feedback: z.string().optional().describe('点击该物件后的即时气泡反馈'),
  stateTag: z.string().optional().describe('收集后写入的状态标签，如 +ledger'),
});

export type InteractionSearchTarget = z.infer<typeof InteractionSearchTargetSchema>;

export const InteractionConfigSchema = z
  .object({
    targets: z.array(InteractionSearchTargetSchema).optional().describe('SEARCH 搜证目标物证列表'),
    decoys: z.array(InteractionSearchTargetSchema).optional().describe('SEARCH 搜证干扰/背景线索列表'),
    searchMode: z.enum(['SCATTER', 'FLASHLIGHT']).optional().describe('SEARCH 呈现模式：散落微光或暗场探照'),
    holdDurationMs: z.number().int().positive().optional().describe('HOLD 长按蓄力所需毫秒数'),
    targetTaps: z.number().int().positive().optional().describe('QTE_TAP 连点目标次数'),
    sweetSpotPct: z.tuple([z.number(), z.number()]).optional().describe('TIMING 靶区百分比区间，如 [40, 62]'),
    zoneLayout: z.enum(['LEFT_RIGHT', 'TOP_BOTTOM']).optional().describe('ACTION_ZONE 空间热区布局'),
    allowRetry: z.boolean().optional().describe('失败或松手时是否允许原地重试（单线沉浸模式常用）'),
  })
  .passthrough();

export type InteractionConfig = z.infer<typeof InteractionConfigSchema>;

export const PrdInteractionOutcomeSchema = z.object({
  key: z.string(),
  label: z.string(),
  stateChange: PrdStateChangeSchema.optional(),
  feedback: z.string().optional(),
});

export type PrdInteractionOutcome = z.infer<typeof PrdInteractionOutcomeSchema>;

export const PrdInteractionNodeSchema = z.object({
  id: z.string(),
  kind: InteractionKindSchema.or(z.string()),
  isBranching: z.boolean().optional(),
  prompt: z.string(),
  timeoutSec: z.number().nullable().optional(),
  config: InteractionConfigSchema.optional(),
  outcomes: z.array(PrdInteractionOutcomeSchema),
});

export type PrdInteractionNode = z.infer<typeof PrdInteractionNodeSchema>;

export const PrdEndingNodeSchema = z.object({
  id: z.string(),
  endingType: z.enum(['TE', 'HE', 'BE', 'NE', 'SE']),
  title: z.string(),
  isVictory: z.boolean(),
  summary: z.string(),
  rewindTargetClipId: z.string().optional(),
});

export type PrdEndingNode = z.infer<typeof PrdEndingNodeSchema>;

export const PrdTransitionCardSchema = z.object({
  text: z.string(),
  durationSec: z.number().optional(),
});

export type PrdTransitionCard = z.infer<typeof PrdTransitionCardSchema>;

export const PrdWiringEdgeSchema = z.object({
  from: z.string(),
  onOutcome: z.string(),
  condition: z.string().nullable().optional(),
  transition: PrdTransitionCardSchema.nullable().optional(),
  to: z.string(),
});

export type PrdWiringEdge = z.infer<typeof PrdWiringEdgeSchema>;

export const PrdUiPageSpecSchema = z.object({
  page: z.string(),
  features: z.string(),
});

export type PrdUiPageSpec = z.infer<typeof PrdUiPageSpecSchema>;

export const PrdUiThemeSchema = z.object({
  primaryColor: z.string().describe('主色调十六进制，如 #b91c1c'),
  accentColor: z.string().describe('强调/高亮色十六进制，如 #d97706'),
  bgColor: z.string().describe('深色背景色十六进制，如 #0b0d12'),
  vibeKeywords: z.string().describe('视觉质感与排版基调关键词，如：中式民俗暗红烛火、青石冷灰、宣纸契约边框'),
});

export type PrdUiTheme = z.infer<typeof PrdUiThemeSchema>;

export const PrdStateFieldSchema = z.object({
  key: z.string().describe('状态变量英文键名，如 ledger'),
  label: z.string().describe('HUD 展示的中文名称，如 泛黄旧册'),
  initialValue: PrdStateValueSchema.default(0).describe('初始值'),
  showInHud: z.boolean().default(true).describe('是否在游玩界面的 HUD 角标中展示'),
  description: z.string().describe('状态来源与剧情用途说明'),
});

export type PrdStateField = z.infer<typeof PrdStateFieldSchema>;

export const UniversalPrdSpecSchema = z.object({
  gameTitle: z.string(),
  genre: z.string(),
  playerIdentity: z.string(),
  premiseAndPerspective: z.string(),
  uiTheme: PrdUiThemeSchema.optional(),
  outOfFlowSummary: z.string(),
  gameplayAndVictorySummary: z.string(),
  uiPagesSummary: z.array(PrdUiPageSpecSchema),
  startNodeId: z.string().optional(),
  initialState: z.record(PrdStateValueSchema).default({}),
  stateSchema: z.array(PrdStateFieldSchema).optional(),
  clips: z.array(PrdClipNodeSchema),
  interactions: z.array(PrdInteractionNodeSchema),
  endings: z.array(PrdEndingNodeSchema),
  wiring: z.array(PrdWiringEdgeSchema),
});

export type UniversalPrdSpec = z.infer<typeof UniversalPrdSpecSchema>;

export const StoryGraphNodeSchema = z.object({
  nodeId: z.string(),
  title: z.string(),
  nodeType: z.enum(['CLIP', 'MAINLINE_CLIP', 'INTERACTION', 'ENDING']),
  level: z.number().int().nonnegative().optional(),
  contentSnippet: z.string().optional(),
  endingType: z.enum(['TE', 'HE', 'BE', 'NE', 'SE']).optional(),
});

export type StoryGraphNode = z.infer<typeof StoryGraphNodeSchema>;

export const StoryGraphEdgeSchema = z.object({
  fromNodeId: z.string(),
  toNodeId: z.string(),
  edgeType: z.enum(['MAINLINE_PROGRESS', 'CHOICE_BRANCH', 'REWIND_LOOP']),
  label: z.string(),
  condition: z.string().optional(),
});

export type StoryGraphEdge = z.infer<typeof StoryGraphEdgeSchema>;

export const StoryGraphSchema = z.object({
  startNodeId: z.string(),
  nodes: z.array(StoryGraphNodeSchema),
  edges: z.array(StoryGraphEdgeSchema),
});

export type StoryGraph = z.infer<typeof StoryGraphSchema>;

export interface CharacterSpec {
  characterId: string;
  name: string;
  role: string;
  appearance: string;
  personality: string;
}

export interface NarrativeBeat {
  beatId: string;
  act: string;
  title: string;
  dramaticGoal: string;
  keyConflicts: string;
  branchExpectations: any[];
  isEnding?: boolean;
  endingTheme?: string;
}

export interface GlobalStateMachine {
  variables?: Record<string, { name: string; initial: number; min?: number; max?: number }>;
  flags?: Record<string, { name: string; initial: boolean }>;
  inventory?: string[];
}

export interface GDDArtifact {
  schemaVersion?: string;
  title: string;
  spineScript: string;
  prd: UniversalPrdSpec;
  storySections: Record<string, any>;
  globalStateMachine: GlobalStateMachine;
  characters: CharacterSpec[];
  beatOutline: NarrativeBeat[];
}
