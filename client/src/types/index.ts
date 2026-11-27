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

export interface ImageUpscaleMeta {
  multiplier: number;
  upscaledAt: string;
  sourceVersionId?: string;
}

export interface LookdevVersion {
  versionId: string;
  imageUrl: string;
  promptZh?: string;
  referenceImageUrl?: string;
  instruction?: string;
  reviewStatus?: 'pending' | 'accepted';
  upscale?: ImageUpscaleMeta;
  createdAt: string;
}

/** 分镜镜头某一帧（首帧/末帧）的历史版本 */
export interface ShotFrameVersion {
  versionId: string;
  imageUrl: string;
  fileName?: string;
  numericCode?: string;
  prompt?: string;
  instruction?: string;
  createdAt: string;
  source: 'generate' | 'refine' | 'upscale' | 'continuity_preceding' | 'detached_composition';
  continuityMode?: 'auto' | 'linked' | 'detached';
  cameraDirective?: VisualDirective;
  colorDirective?: VisualDirective;
  poseDirective?: VisualDirective;
  nameSegments?: {
    frameKind: string;
    continuity: string;
    visualCode?: string;
    motionCode?: string;
    versionSeq: string;
  };
  upscale?: ImageUpscaleMeta;
}

/** 分镜镜头视频历史版本 */
export interface ShotVideoVersion {
  versionId: string;
  videoUrl: string;
  fileName?: string;
  numericCode?: string;
  prompt?: string;
  instruction?: string;
  createdAt: string;
  source: 'generate' | 'upscale';
  continuityMode?: 'auto' | 'linked' | 'detached';
  motionDirective?: VisualDirective;
  dynamicDirective?: VisualDirective;
  focusDirective?: VisualDirective;
  nameSegments?: {
    frameKind: string;
    continuity: string;
    visualCode?: string;
    motionCode?: string;
    versionSeq: string;
  };
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
  imageUrl?: string;
  versions?: LookdevVersion[];
  selectedVersionId?: string;
}

export type SpatialLayout = string;

export interface ExtractedLocation {
  locationId: string;
  name: string;
  atmosphere: string;
  appearanceSummary: string;
  spatialLayout?: string;
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

export interface VisualDirective {
  label: string;
  instruction: string;
  presetId?: string;
}

export interface ShootingScriptEnvironmentLock {
  timeOfDay: string;
  weatherDirective: VisualDirective;
  lightingDirective: VisualDirective;
  colorTone?: VisualDirective;
}

export interface ShootingScriptActionBeat {
  beatId: string;
  beatTitle: string;
  space?: string;
  location?: string;
  locationId?: string;
  isSceneTransition?: boolean;
  actionDescription: string;
  characterIds?: string[];
  itemIds?: string[];
  estimatedSeconds?: number;
}

export interface ShootingScript {
  clipId: string;
  clipTitle: string;
  environmentLock: ShootingScriptEnvironmentLock;
  actionBeats: ShootingScriptActionBeat[];
  generatedAt?: string;
}

export interface CinematicShotOrder {
  shotId: string;
  clipId: string;
  shotIndex: number;
  durationSec: number;
  shotType: string;
  cameraMovement: string;
  generationMode?: 'ref2v';
  characters?: string[];
  items?: string[];
  // 视听工业级开放元数据体系 (SSOT，开放无边界)
  cameraDirective?: VisualDirective;
  colorDirective?: VisualDirective;
  poseDirective?: VisualDirective;
  weatherDirective?: VisualDirective;
  sceneSubject?: string;
  sliceSummary?: string;
  // 视频专属开放元数据体系
  motionDirective?: VisualDirective;
  dynamicDirective?: VisualDirective;
  focusDirective?: VisualDirective;
  backgroundImageUrl?: string;
  characterReferenceImageUrls?: string[];
  firstFramePrompt: string;
  lastFramePrompt?: string;
  videoPrompt: string;
  audioPrompt: string;
  firstFrameImageUrl?: string;
  lastFrameImageUrl?: string;
  firstFrameUpscale?: ImageUpscaleMeta;
  lastFrameUpscale?: ImageUpscaleMeta;
  keyframeUrl?: string;
  videoUrl?: string;
  characterName?: string;
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
  shootingScript?: ShootingScript;
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

export interface StaleEntry {
  reason: string;
  updatedAt: number;
}

export interface ProjectStaleMap {
  prd?: StaleEntry;
  clips: Record<string, StaleEntry>;
  shotKeyframes: Record<string, StaleEntry>;
  shotVideos: Record<string, StaleEntry>;
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
    staleMap?: ProjectStaleMap;
    [key: string]: any;
  };
  prd?: UniversalPrdSpec | any;
  prdMarkdown?: string;
  entities?: LookdevEntitiesArtifact | any;
  storyboards?: any[];
  screenplay?: string;
  screenplayReview?: ReviewFreshnessView;
  story?: string;
  storySections?: Record<string, { title: string; narrativeText: string }>;
  staleMap?: ProjectStaleMap;
}

export type ReviewSeverity = 'error' | 'warning';

export interface ReviewIssue {
  id: string;
  severity: ReviewSeverity;
  category: string;
  actNumber?: number;
  excerpt: string;
  reason: string;
  fixInstruction: string;
}

export interface ReviewReport {
  passed: boolean;
  summary: string;
  issues: ReviewIssue[];
}

export type ReviewArchiveStatus = 'idle' | 'reviewing' | 'passed' | 'issues_found' | 'failed';

export interface ReviewFreshnessView {
  targetType: string;
  status: ReviewArchiveStatus;
  isStale: boolean;
  currentHash: string;
  artifactHash?: string;
  artifactSnapshot?: string;
  reviewedAt?: number;
  error?: string;
  report?: ReviewReport;
}

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type TaskFailureType =
  | 'llm_contract_error'      // LLM 输出不符合契约/缺失必填/JSON解析失败/语义脱轨
  | 'media_service_error'     // ComfyUI / DashScope / 外部 GPU 算力异常 / 显存溢出 / 规格不符
  | 'system_interrupted'      // 服务重启中断 / 执行线程丢失 / 僵尸任务回收
  | 'transient_network_error' // 网络超时 / 连接重置 / 502 / 504 瞬态网关错误
  | 'system_fault';           // 其他系统未捕获异常

export interface TaskFailureRecord {
  timestamp: number;
  type: TaskFailureType;
  error: string;
  attempt: number;
  details?: Record<string, any>;
}

export interface TaskRecord<TInput = any, TOutput = any> {
  taskId: string;
  projectId: string;
  toolName: string;
  replacesTaskId?: string;
  status: TaskStatus;
  progress?: { current: number; total: number; message?: string; percent?: number };
  input: TInput;
  output?: TOutput;
  error?: string;
  failureType?: TaskFailureType;
  lastFailure?: TaskFailureRecord;
  retryCount?: number;
  maxRetries?: number;
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
  firstFrameImageUrl?: string;
  lastFrameUrl?: string;
  lastFrameImageUrl?: string;
  firstFrameUpscale?: ImageUpscaleMeta;
  lastFrameUpscale?: ImageUpscaleMeta;
  firstFrameVersions?: ShotFrameVersion[];
  lastFrameVersions?: ShotFrameVersion[];
  videoVersions?: ShotVideoVersion[];
  selectedFirstFrameVersionId?: string;
  selectedLastFrameVersionId?: string;
  selectedVideoVersionId?: string;
  generationMode?: 'ref2v';
  firstFramePrompt?: string;
  lastFramePrompt?: string;
  videoPrompt?: string;
  audioPrompt?: string;
  // 视听工业级开放元数据体系 (SSOT: 首帧/末帧/视频三轨独立存储)
  firstFrameCameraDirective?: VisualDirective;
  firstFrameColorDirective?: VisualDirective;
  firstFramePoseDirective?: VisualDirective;
  lastFrameCameraDirective?: VisualDirective;
  lastFrameColorDirective?: VisualDirective;
  lastFramePoseDirective?: VisualDirective;
  cameraDirective?: VisualDirective;
  colorDirective?: VisualDirective;
  poseDirective?: VisualDirective;
  weatherDirective?: VisualDirective;
  sceneSubject?: string;
  sliceSummary?: string;
  // 视频专属开放元数据体系
  motionDirective?: VisualDirective;
  dynamicDirective?: VisualDirective;
  focusDirective?: VisualDirective;
  location?: string;
  locationId?: string;
  space?: string;
  isSceneTransition?: boolean;
  characters?: CanvasLookdevEntitySummary[];
  locations?: CanvasLookdevEntitySummary[];
  isUnlocked?: boolean;
  staleKeyframeReason?: string;
  staleVideoReason?: string;
  // 视听摄制台本结构化要素 (Shooting Script Action Beat)
  actionDescription?: string;
  shotType?: string;
  cameraMovement?: string;
  // 前序镜头视听连续性模式：auto（智能决策）、linked（强制承接尾帧）、detached（独立机位）
  continuityMode?: 'auto' | 'linked' | 'detached';
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
