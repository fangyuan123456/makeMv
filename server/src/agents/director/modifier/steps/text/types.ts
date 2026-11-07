/**
 * agents/director/modifier/steps/text/types.ts
 * 文本轨四段之间的中间态类型
 *
 * 这些类型只在 text 轨内部流转，不进入 workflow 上下文 schema——
 * 四段在同一个 step 内顺序调用，state 是普通局部变量，全程精确类型。
 */

import type { WorkflowStage } from '../../../../../types/index.js';
import type { JsonStringPatchPlan } from '../../../../../utils/universal-patch.js';

/** 单份参与修改的文本产物 */
export interface TextFileState {
  /** 工序键（story-bible / scene-script / storyboard） */
  key: string;
  stage: WorkflowStage;
  title: string;
  /** 相对项目根的路径，同时作为补丁 file 归属标识 */
  relPath: string;
  /** 磁盘绝对路径 */
  jsonPath: string;
  artifactSkill: string;
  /** 文件原文（补丁匹配基准，也是回滚依据） */
  content: string;
  /** 骨架索引（角色/场次/镜号主键清单） */
  probe: string;
  artifact: any;
}

/** load 段产物：本次参与修改的全部文本产物 + 主命中文件 + 用户指令 */
export interface TextLoadState {
  files: TextFileState[];
  primaryFileKey: string;
  userFeedback: string;
}

/** plan 段产物：带 file 归属的跨文件补丁清单 */
export type TextPlan = JsonStringPatchPlan;

/** apply 段产物：已在内存中校验通过的新产物 */
export interface TextApplied {
  updated: Array<{
    key: string;
    stage: WorkflowStage;
    title: string;
    artifactSkill: string;
    artifact: any;
    appliedCount: number;
  }>;
  summary: string;
}
