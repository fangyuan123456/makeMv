/**
 * skills/types.ts
 * 现代 Agentic 技能系统标准协议契约 (Skills Protocol SSOT)
 *
 * 核心设计：
 * 1. 彻底去 Agent 化：技能是无状态、纯数据输入输出的可执行算子；
 * 2. 声明式元数据 (SkillManifest)：向 Director Agent 与前端暴露可用技能；
 * 3. 统一执行上下文 (SkillContext) 与标准执行产物 (SkillResult)。
 */

import type { WorkflowStage } from '../types/index.js';

export type SkillCategory =
  | 'narrative' // 叙事架构与世界观
  | 'character' // 角色设计与视觉定妆
  | 'script' // 分场多分支剧本扩写
  | 'storyboard' // 导演视听分镜切分
  | 'keyframe' // 关键帧高清生图渲染
  | 'video' // 动态视频切片生成
  | 'audio' // 音效配音与母带混音
  | 'packaging' // 影游母带装配发布
  | 'critic'; // 独立审查官挑刺质检

export interface SkillManifest {
  name: string; // 技能唯一标识 (如 'story-bible')
  displayName: string; // 中文显示名 (如 '故事世界观圣经推演')
  description: string; // 技能详细能力描述
  category: SkillCategory; // 分类
  targetStage: WorkflowStage; // 归属的标准制片工序
  parameters?: Record<string, any>; // 入参模式说明
}

export type SkillProgressCallback = (percent: number, message: string) => Promise<void> | void;

export interface SkillContext<TParams = any> {
  projectId: string; // 项目唯一标识 (SSOT)
  sessionId?: string; // 触发该工序的会话 ID
  params: TParams; // 业务入参
  userConstraints?: string[]; // 备忘录白板中的刚性禁忌/要求
  abortSignal?: AbortSignal; // 中断信号
  onProgress?: SkillProgressCallback; // 实时进度回调
}

export interface SkillResult<TData = any> {
  success: boolean;
  data: TData;
  summary: string; // 结果中文汇报
  durationMs: number; // 耗时毫秒
  error?: string;
}

export interface ISkill<TParams = any, TData = any> {
  readonly manifest: SkillManifest;
  execute(context: SkillContext<TParams>): Promise<SkillResult<TData>>;
}
