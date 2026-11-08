/**
 * client/src/lib/stages.ts
 * 工序阶段键唯一来源 (Client Stage Keys SSOT)
 *
 * 过去 7 个 stage 字面量在 studio.types.ts 的 MILESTONES、App.tsx 的
 * artifacts[...] 索引、GameDisplayPanel.tsx 里各抄一份，增删工序时前端会
 * 静默漂移（后端由 catalog.ts 单一派生，前端却没有对应出口）。
 *
 * 这里与 server/src/types/index.ts 的 WorkflowStage 保持一致；
 * 值本身是跨端 API 契约，不用 import 服务端代码，避免前端打包进后端依赖。
 */

export const STAGE = {
  NARRATIVE_DESIGN: 'narrative_design',
  CHARACTER_DESIGN: 'character_design',
  SCENE_SCRIPT: 'scene_script',
  STORYBOARD: 'storyboard',
  KEYFRAME_REFERENCE: 'keyframe_reference',
  VIDEO_PRODUCTION: 'video_production',
  FMV_PACKAGING: 'fmv_packaging',
} as const;

export type StageKey = (typeof STAGE)[keyof typeof STAGE];

/** 与后端 STAGE_SEQUENCE 同序 */
export const STAGE_SEQUENCE: StageKey[] = [
  STAGE.NARRATIVE_DESIGN,
  STAGE.CHARACTER_DESIGN,
  STAGE.SCENE_SCRIPT,
  STAGE.STORYBOARD,
  STAGE.KEYFRAME_REFERENCE,
  STAGE.VIDEO_PRODUCTION,
  STAGE.FMV_PACKAGING,
];
