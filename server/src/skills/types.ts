/**
 * skills/types.ts
 * 现代 Agentic 技能系统标准协议契约 (Skills Protocol SSOT)
 *
 * 核心设计：
 * 1. 彻底去 Agent 化：技能是无状态、纯数据输入输出的可执行算子；
 * 2. 声明式元数据 (SkillManifest)：向 Director Agent 与前端暴露可用技能；
 * 3. 统一执行上下文 (SkillContext) 与标准执行产物 (SkillResult)；
 * 4. 显式依赖装配：通过 SkillContext 显式透传 project 与 artifacts，彻底解除对底层持久化单例的隐式耦合。
 */

import type { WorkflowStage, ProjectEntity } from '../types/index.js';

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
  isRefinement?: boolean; // 🌟 显式指示微调/局部重绘自愈操作（绝不推进阶段）
  userConstraints?: string[]; // 备忘录白板中的刚性禁忌/要求
  abortSignal?: AbortSignal; // 中断信号
  onProgress?: SkillProgressCallback; // 实时进度回调
  project?: ProjectEntity; // 🌟 显式透传项目全景实体，消灭逆向依赖
  artifacts?: Record<string, any>; // 🌟 显式透传当前所有阶段产物快照
}

export type SkillResult<TData = any> =
  | {
      success: true;
      data: TData;
      summary: string; // 结果中文汇报
      durationMs: number; // 耗时毫秒
      error?: undefined;
    }
  | {
      success: false;
      error: string;
      summary: string;
      durationMs: number;
      data?: never;
      partial?: TData; // 🌟 部分成功保全：失败时允许带出局部成功产物，杜绝整批作废
      errorCode?: string;
    };

export interface ISkill<TParams = any, TData = any> {
  readonly manifest: SkillManifest;
  execute(context: SkillContext<TParams>): Promise<SkillResult<TData>>;
  executeOrThrow(context: SkillContext<TParams>): Promise<{ data: TData; summary: string; durationMs: number }>;
}
