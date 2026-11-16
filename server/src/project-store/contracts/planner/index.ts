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

export const PrdInteractionOutcomeSchema = z.object({
  key: z.string(),
  label: z.string(),
  stateChange: PrdStateChangeSchema.optional(),
  feedback: z.string().optional(),
});

export type PrdInteractionOutcome = z.infer<typeof PrdInteractionOutcomeSchema>;

export const PrdInteractionNodeSchema = z.object({
  id: z.string(),
  kind: z.string(),
  prompt: z.string(),
  timeoutSec: z.number().nullable().optional(),
  config: z.record(z.unknown()).optional(),
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

export const UniversalPrdSpecSchema = z.object({
  gameTitle: z.string(),
  genre: z.string(),
  playerIdentity: z.string(),
  premiseAndPerspective: z.string(),
  outOfFlowSummary: z.string(),
  gameplayAndVictorySummary: z.string(),
  uiPagesSummary: z.array(PrdUiPageSpecSchema),
  startNodeId: z.string().optional(),
  initialState: z.record(PrdStateValueSchema).default({}),
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
