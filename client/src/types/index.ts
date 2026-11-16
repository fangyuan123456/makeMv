/**
 * client/src/types/index.ts
 * 客户端全局强类型契约体系 (SSOT)
 *
 * 纯 Tool-First 任务工坊架构，消灭旧时代对话流与气泡类型
 */

export interface ProjectMetadata {
  projectId: string;
  title: string;
  genre?: string;
  createdAt: string;
  updatedAt: string;
  currentStage: 'gdd_planning' | 'text_game_authoring' | 'film_compiling' | 'completed';
}

export interface LookdevVersion {
  versionId: string;
  imageUrl: string;
  promptZh?: string;
  referenceImageUrl?: string;
  createdAt: string;
}

export interface ExtractedCharacter {
  characterId: string;
  name: string;
  identity: string;
  appearanceSummary: string;
  promptZh: string;
  referenceImageUrl?: string;
  imageUrl?: string;
  versions?: LookdevVersion[];
  selectedVersionId?: string;
}

export interface ExtractedItem {
  itemId: string;
  name: string;
  description: string;
  appearanceSummary: string;
  promptZh: string;
  referenceImageUrl?: string;
}

export interface ExtractedLocation {
  locationId: string;
  name: string;
  atmosphere: string;
  appearanceSummary: string;
  promptZh: string;
  sceneIds: string[];
  referenceImageUrl?: string;
  imageUrl?: string;
  versions?: LookdevVersion[];
  selectedVersionId?: string;
}

export interface LookdevEntitiesArtifact {
  artStyle: string;
  characters: ExtractedCharacter[];
  items: ExtractedItem[];
  locations: ExtractedLocation[];
}

export interface CinematicShotOrder {
  shotId: string;
  clipId: string;
  shotIndex: number;
  durationSec: number;
  shotType: string;
  cameraMovement: string;
  generationMode?: 'first_frame' | 'first_last_frame';
  characters?: string[];
  items?: string[];
  backgroundImageUrl?: string;
  characterReferenceImageUrls?: string[];
  firstFramePrompt: string;
  lastFramePrompt?: string;
  videoPrompt: string;
  audioPrompt: string;
  firstFrameImageUrl?: string;
  lastFrameImageUrl?: string;
  keyframeUrl?: string;
  videoUrl?: string;
  dialogue?: string;
  characterName?: string;
  ambience?: string;
  sceneTitle?: string;
  promptZh?: string;
  description?: string;
}

export interface CinematicClipOrder {
  clipId: string;
  sourceNodeId?: string;
  title?: string;
  targetDurationSec?: number;
  shots: CinematicShotOrder[];
  videoUrl?: string;
}

export interface FilmAdapterArtifact {
  projectId?: string;
  projectTitle?: string;
  clips: CinematicClipOrder[];
  slices?: any[];
}

export interface PrdUiPage {
  page: string;
  features: string;
}

export interface PrdStateChange {
  add?: Record<string, number>;
  set?: Record<string, any>;
}

export interface PrdInteractionOutcome {
  key: string;
  label: string;
  feedback?: string;
  stateChange?: PrdStateChange;
}

export interface PrdInteractionNode {
  id: string;
  kind: 'CHOICE' | 'ACTION' | 'CLICK' | 'HOLD' | string;
  prompt: string;
  timeoutSec?: number | null;
  config?: Record<string, any>;
  outcomes: PrdInteractionOutcome[];
}

export interface PrdEndingNode {
  id: string;
  endingType: 'TE' | 'HE' | 'BE' | 'NE' | string;
  title: string;
  isVictory: boolean;
  summary: string;
  rewindTargetClipId?: string;
}

export interface PrdClipNode {
  id: string;
  title: string;
  video?: string;
  narrativeText?: string;
  choices?: any[];
}

export interface PrdWiringEdge {
  from: string;
  onOutcome: string;
  condition?: string | null;
  transition?: { text: string; durationSec: number } | null;
  to: string;
}

export interface UniversalPrdSpec {
  gameTitle: string;
  genre: string;
  playerIdentity?: string;
  premiseAndPerspective?: string;
  outOfFlowSummary?: string;
  gameplayAndVictorySummary?: string;
  uiPagesSummary?: PrdUiPage[];
  startNodeId: string;
  initialState?: Record<string, any>;
  clips: PrdClipNode[];
  interactions: PrdInteractionNode[];
  endings: PrdEndingNode[];
  wiring: PrdWiringEdge[];
  [key: string]: any;
}

export interface ProjectData {
  meta: ProjectMetadata;
  artifacts: {
    prd?: UniversalPrdSpec | any;
    prdMarkdown?: string;
    lookdev_entities?: LookdevEntitiesArtifact;
    hasStandaloneGame?: boolean;
    film_spec?: FilmAdapterArtifact;
    storyboards?: any[];
    [key: string]: any;
  };
  prd?: UniversalPrdSpec | any;
  prdMarkdown?: string;
  entities?: LookdevEntitiesArtifact | any;
  storyboards?: any[];
  screenplay?: string;
  story?: string;
  storySections?: Record<string, { title: string; narrativeText: string }>;
}

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskRecord<TInput = any, TOutput = any> {
  taskId: string;
  projectId: string;
  toolName: string;
  status: TaskStatus;
  progress?: { current: number; total: number; message?: string; percent?: number };
  input: TInput;
  output?: TOutput;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

export interface ToolMetadata {
  toolName: string;
  description: string;
}

export interface CanvasLookdevEntitySummary {
  characterId?: string;
  locationId?: string;
  name: string;
  imageUrl?: string;
}

export interface CanvasShotNode {
  id: string;
  type?: 'shot_node' | 'lookdev_root';
  shotId?: string;
  clipId?: string;
  title: string;
  prompt?: string;
  durationSec?: number;
  position: { x: number; y: number };
  size?: { w: number; h: number };
  activeTaskId?: string;
  candidateTaskIds?: string[];
  videoUrl?: string;
  keyframeUrl?: string;
  characters?: CanvasLookdevEntitySummary[];
  locations?: CanvasLookdevEntitySummary[];
}

export interface CanvasBranchEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  choiceText?: string;
}

export interface StoryboardCanvasData {
  projectId: string;
  viewport: { x: number; y: number; zoom: number };
  nodes: Record<string, CanvasShotNode>;
  edges: Record<string, CanvasBranchEdge>;
}
