/**
 * client/src/types/index.ts
 * 客户端全局强类型契约体系 (SSOT)
 */

export interface ProjectMetadata {
  projectId: string;
  title: string;
  genre?: string;
  createdAt: string;
  updatedAt: string;
  currentStage: 'gdd_planning' | 'text_game_authoring' | 'film_compiling' | 'completed';
}

export interface StateVariableSpec {
  name: string;
  initial: number;
  min?: number;
  max?: number;
  description?: string;
}

export interface StateFlagSpec {
  name: string;
  initial: boolean;
  description?: string;
}

export interface GlobalStateMachine {
  philosophy?: string;
  variables?: Record<string, StateVariableSpec>;
  flags?: Record<string, StateFlagSpec>;
  inventory?: string[];
}

export interface CharacterSpec {
  characterId: string;
  name: string;
  role: string;
  appearance: string;
  personality: string;
}

export interface BranchExpectation {
  intent: string;
  targetBeatId: string;
  isLoopBack?: boolean;
  gatingRequirement?: string;
}

export interface NarrativeBeat {
  beatId: string;
  act: string;
  title: string;
  dramaticGoal: string;
  keyConflicts: string;
  branchExpectations: BranchExpectation[];
  isEnding?: boolean;
  endingTheme?: string;
}

export interface PlannerChoice {
  choiceId: string;
  text: string;
  requiredFlags?: string[];
  stateMutations?: {
    variables?: Record<string, number>;
    flags?: Record<string, boolean>;
    inventoryAdd?: string[];
    inventoryRemove?: string[];
  };
  nextNodeId: string;
  isLoopBack?: boolean;
}

export interface PlannerNode {
  nodeId: string;
  title: string;
  summary: string;
  choices: PlannerChoice[];
  defaultFallbackChoiceId?: string;
}

export type PrdStateValue = number | boolean | string | string[];

export interface PrdStateChange {
  add?: Record<string, number>;
  set?: Record<string, PrdStateValue>;
}

export interface PrdClipNode {
  id: string;
  title: string;
  video: string;
}

export interface PrdInteractionOutcome {
  key: string;
  label: string;
  stateChange?: PrdStateChange;
  feedback?: string;
}

export interface PrdInteractionNode {
  id: string;
  kind: string;
  prompt: string;
  timeoutSec: number | null;
  config?: Record<string, unknown>;
  outcomes: PrdInteractionOutcome[];
}

export interface PrdEndingNode {
  id: string;
  endingType: 'TE' | 'HE' | 'BE' | 'NE' | 'SE';
  title: string;
  isVictory: boolean;
  summary: string;
  rewindTargetClipId?: string;
}

export interface PrdTransitionCard {
  text: string;
  durationSec?: number;
}

export interface PrdWiringEdge {
  from: string;
  onOutcome: string;
  condition: string | null;
  transition: PrdTransitionCard | null;
  to: string;
}

export interface PrdUiPageSpec {
  page: string;
  features: string;
}

export interface UniversalPrdSpec {
  gameTitle: string;
  genre: string;
  playerIdentity: string;
  premiseAndPerspective: string;
  outOfFlowSummary: string;
  gameplayAndVictorySummary: string;
  uiPagesSummary: PrdUiPageSpec[];
  startNodeId: string;
  initialState: Record<string, PrdStateValue>;
  clips: PrdClipNode[];
  interactions: PrdInteractionNode[];
  endings: PrdEndingNode[];
  wiring: PrdWiringEdge[];
}

export interface StorySectionItem {
  title: string;
  narrativeText: string;
}

export interface GDDArtifact {
  schemaVersion?: string;
  title: string;
  genre?: string;
  hook: string;
  playerRole: string;
  coreLoop?: string;
  markdown?: string;
  storyMarkdown?: string;
  spineScript?: string;
  prd?: UniversalPrdSpec;
  storySections?: Record<string, StorySectionItem>;
  globalStateMachine: GlobalStateMachine;
  characters: CharacterSpec[];
  beatOutline?: NarrativeBeat[];
  flowchartNodes?: PlannerNode[];
}

export interface TextGameChoice {
  id: string;
  text: string;
  requiredFlags?: string[];
  requiredItems?: string[];
  requiredVariables?: Record<string, { gte?: number; lte?: number }>;
  stateMutation?: {
    variables?: Record<string, number>;
    flags?: Record<string, boolean>;
    inventoryAdd?: string[];
    inventoryRemove?: string[];
  };
  targetNodeId: string;
}

export interface SceneVisual {
  imageUrl?: string;
  locationName?: string;
  entityNames?: string[];
  perspective?: string;
  scenePrompt: string;
  characterPrompt: string;
  composition: string;
  imagePromptEn: string;
}

export interface TextGameNode {
  id: string;
  title: string;
  visual?: SceneVisual;
  narrativeText: string;
  choices: TextGameChoice[];
  audioCue?: string;
  isEnding?: boolean;
  endingType?: string;
}

export interface TextGameArtifact {
  schemaVersion?: string;
  title: string;
  startNodeId: string;
  nodes: TextGameNode[];
}

export interface FilmSliceArtifact {
  sceneId: string;
  title: string;
  videoUrl?: string;
  keyframeImageUrl?: string;
  cameraMovement?: string;
  lighting?: string;
  soundEffects?: string[];
  durationSeconds?: number;
}

export interface ProjectChatRecord {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  status?: 'streaming' | 'done' | 'error';
  proposal?: ActionProposal;
  proposalResolved?: boolean;
  taskRunId?: string;
  taskStage?: 'plan_gdd' | 'build_text_game';
  nextProposalResolved?: boolean;
}

export interface ProjectData {
  meta: ProjectMetadata;
  artifacts: {
    gdd?: GDDArtifact;
    text_game?: TextGameArtifact;
    hasStandaloneGame?: boolean;
    film_spec?: {
      slices: FilmSliceArtifact[];
    };
    [key: string]: any;
  };
  chat?: ProjectChatRecord[];
}

export interface ActionProposal {
  action:
    | 'propose_stage'
    | 'approve_stage'
    | 'resume_task'
    | 'modify_asset'
    | 'build_text_game'
    | 'start_pipeline'
    | string;
  targetStage?: 'plan_gdd' | 'build_text_game' | 'compile_film' | string;
  taskId?: string;
  summary: string;
  payload?: Record<string, any>;
}

/**
 * 对话气泡内嵌的阶段任务快照。
 * 客户端把 /api/tasks/:id 的进度 与 /api/workflow/:id/state 的阶段结果
 * 投影到「确认后那一条 AI 回复气泡」上，沿用旧版单气泡任务面板的口径：
 * 排队 → 进度条 → 完成内容 + 下一个人在回路确认意图。
 */
export interface StageTaskView {
  runId: string;
  stage: 'plan_gdd' | 'build_text_game';
  title: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  percent: number;
  note: string;
  startedAt: string;
  resultSummary?: string;
  gameUrl?: string;
  nextProposal?: ActionProposal;
  nextProposalResolved?: boolean;
}

export interface PlayerGameHistoryItem {
  nodeId: string;
  choiceId?: string;
  timestamp?: string;
}

export interface PlayerGameState {
  currentNodeId: string;
  variables: Record<string, number>;
  flags: Record<string, boolean>;
  inventory: string[];
  history: Array<string | PlayerGameHistoryItem>;
}
