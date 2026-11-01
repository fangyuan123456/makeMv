import type { ActionProposal } from '@/lib/chatApi';

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
  actionProposal?: ActionProposal;
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
