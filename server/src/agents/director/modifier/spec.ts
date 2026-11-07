/**
 * agents/director/modifier/spec.ts
 * 微调规格契约 (Modifier Spec Contract)
 *
 * 一条 workflow、三个互斥 step（text / image / video），每个 step 内部串四段：
 *
 *   load    —— 读取底稿，定位改动目标（text 读全部文本产物，media 定位单条目）
 *   plan    —— 推演变更方案（text 出跨文件补丁清单，media 重写提示词/运镜参数）
 *   apply   —— 执行落地（text 两阶段原子校验，media 调渲染器出图/出视频）
 *   commit  —— 聚合落盘（text 逐文件写入并上报 changedStages，media 替换条目）
 *
 * 这么切的理由：一个媒介 = 一个完整修改单元。四段之间的中间态是局部变量，
 * 不再跨 step 序列化，因此每一段都有精确类型；step 只是调度容器，内部没有 if。
 *
 * 三种媒介之间没有任何共享代码：差异全部收在各自目录里。
 */

import type { WorkflowStage } from '../../../types/index.js';

export type ModifierKind = 'text' | 'image' | 'video';

/**
 * 子阶段进度上报。由 step 注入，spec 每完成一段调一次。
 *
 * 为什么需要它：三个 step 互斥，一次请求只有一条生效，进度天然只有一档。
 * spec 自己知道哪一段是重 IO（文本是推演、视频是渲染），由它上报比按步均分更准。
 */
export type PhaseReporter = (percent: number, message: string) => void;

/** 落盘结果：toolResult 透传给提案卡，summary 供正文与通知使用 */
export interface ModifierCommitResult {
  toolResult: any;
  summary: string;
}

/**
 * 修改器统一契约。四个方法对应四个阶段，state 在方法之间以局部变量流转。
 */
export interface ModifierSpec<TState = any, TPlan = any, TApplied = any> {
  /** 修改器唯一标识（text / character-portrait / keyframe-reference / video-production） */
  key: string;
  /** 中文名，用于日志与步骤标签 */
  title: string;
  kind: ModifierKind;
  /** 产物所属法定阶段（commit 落盘时使用） */
  stage?: WorkflowStage;

  load(ctx: any, report: PhaseReporter): Promise<TState>;
  plan(state: TState, ctx: any, report: PhaseReporter): Promise<TPlan>;
  apply(state: TState, plan: TPlan, ctx: any, report: PhaseReporter): Promise<TApplied>;
  commit(
    state: TState,
    applied: TApplied,
    ctx: any,
    report: PhaseReporter
  ): Promise<ModifierCommitResult>;
}

/**
 * 文本轨的文件规格：只声明「它是谁、骨架长什么样、怎么落盘」，
 * 不声明任何生成过程信息。
 */
export interface TextFileSpec<T = any> {
  /** 与 catalog 的工序 key 一致（story-bible / scene-script / storyboard） */
  key: string;
  /** 所属法定阶段 */
  stage: WorkflowStage;
  /** 产物中文名 */
  title: string;
  /** 产物 JSON 相对项目根目录的路径（同时作为补丁的 file 归属标识） */
  jsonPath: string;
  /** setArtifact 时记录的生产者标识 */
  artifactSkill: string;
  /** 骨架索引：跨文件引用定位所需的主键清单（角色/场次/镜号） */
  probe: (artifact: T) => string;
  /** 补丁落地后的派生字段重算（如 totalScenes / 总时长） */
  normalize?: (artifact: T) => void;
  /** 聚合根额外同步（如故事圣经需回写 project.title） */
  commitExtras?: (projectId: string, artifact: T) => void;
  /** 导出人类可读产物到磁盘 */
  exportToDisk: (projectId: string, artifact: T) => void;
}

/** 从上下文里提取用户修改指令 */
export function extractUserFeedback(ctx: any): string {
  const payload = ctx?.payload || {};
  return payload.userFeedback || payload.userPrompt || ctx?.userFeedback || ctx?.feedback || '';
}

/** 从上下文里提取本次微调的目标工序键 */
export function extractTargetSkill(ctx: any): string | undefined {
  return ctx?.targetSkill || ctx?.payload?.targetSkill;
}
