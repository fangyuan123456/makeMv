export interface TaskProgress {
  current: number; // 当前已完成切片数 (如 3)
  total: number;   // 总切片数 (如 12)
  percent: number; // 0..100 百分比
  note?: string;   // 当前阶段可读描述
}

export type TaskStatus = 'proposed' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface TaskArtifact {
  stage: string;
  kind?: string;
  label?: string;
  url?: string;
  path?: string;
  summary?: string;
  createdAt?: string;
}

/**
 * 任务（唯一状态载体）。
 * 铁律：对话消息只保存 taskId，状态 / 进度 / 产物一律从任务实体读取，
 * 客户端不再从消息快照派生任何执行态。
 */
export interface TaskItem {
  taskId: string;
  projectId: string;
  sessionId?: string;
  intent: 'generate' | 'revise' | 'review';
  skill?: string;
  actionType?: string;
  title: string;
  description?: string;
  status: TaskStatus;
  stages: string[];
  approval: { required: boolean; approvedAt?: string };
  payload?: Record<string, any>;
  progress?: TaskProgress;
  artifacts: TaskArtifact[];
  resultSummary?: string;
  error?: string;
  isGateIntercept?: boolean;
  parentTaskId?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export type MilestoneId =
  | 'milestone_1'
  | 'milestone_2'
  | 'milestone_3'
  | 'milestone_4'
  | 'milestone_5';

export interface MilestoneInfo {
  id: MilestoneId;
  index: number;
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  primaryStage: string;
  stages: string[];
}

export const MILESTONES: MilestoneInfo[] = [
  {
    id: 'milestone_1',
    index: 1,
    name: '第一步：互动叙事架构',
    shortName: '叙事架构',
    tagline: '故事大纲与分支拓扑',
    description: '生成网状故事大纲、核心看点与互动分支拓扑图谱',
    primaryStage: 'narrative_design',
    stages: ['narrative_design'],
  },
  {
    id: 'milestone_2',
    index: 2,
    name: '第二步：剧本与角色资产',
    shortName: '剧本角色',
    tagline: '双轨并发生产',
    description: '节点互动剧本详写与角色视觉定妆双轨并发推进',
    primaryStage: 'character_design',
    stages: ['character_design', 'scene_script'],
  },
  {
    id: 'milestone_3',
    index: 3,
    name: '第三步：视听故事板预演',
    shortName: '分镜关键帧',
    tagline: '分镜切分与视觉质检',
    description: '镜头切分、运镜视听语言与高清关键帧图 (含 Doctor 质检)',
    primaryStage: 'storyboard',
    stages: ['storyboard', 'keyframe_reference'],
  },
  {
    id: 'milestone_4',
    index: 4,
    name: '第四步：节点视频切片',
    shortName: '视频生成',
    tagline: '动态渲染与音频对齐',
    description: '各节点独立视频切片 (.mp4) 与 TTS 对白声画合流',
    primaryStage: 'video_production',
    stages: ['video_production'],
  },
  {
    id: 'milestone_5',
    index: 5,
    name: '第五步：影游装配与发布',
    shortName: '影游装配',
    tagline: '决策微循环与可玩游戏',
    description: '提取决策等待呼吸帧，装配 manifest.json 与交付交互播放器',
    primaryStage: 'fmv_packaging',
    stages: ['fmv_packaging'],
  },
];

export interface ChatMessageItem {
  id: string;
  sender: 'user' | 'agent' | 'system';
  senderName?: string;
  avatar?: string;
  content: string;
  thought?: string;
  thinkingDurationSec?: number;
  timestamp: string;
  stage?: string;
  /** 本轮对话对应的任务 ID：唯一引用，消息本身不携带任何任务状态 */
  taskId?: string;
  milestoneId?: MilestoneId;
  stopPoint?: {
    id: string;
    stage: string;
    title: string;
    description: string;
  };
  actions?: Array<{
    label: string;
    action: string;
    primary?: boolean;
    payload?: any;
  }>;
  suggestedActions?: Array<{
    label: string;
    action: string;
    primary?: boolean;
    payload?: any;
  }>;
}
