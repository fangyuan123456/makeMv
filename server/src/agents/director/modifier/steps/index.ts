/**
 * agents/director/modifier/steps/index.ts
 * 微调轨统一出口 (Modifier Steps SSOT)
 *
 * 与 generator/steps/index.ts 同构：
 *   common.ts       上下文契约（对应生成轨的 steps/common.ts）
 *   text/step.ts    互斥分支 1：文本内容（故事圣经 / 分场剧本 / 分镜）
 *   image/step.ts   互斥分支 2：图像内容（角色定妆 / 镜头关键帧）
 *   video/step.ts   互斥分支 3：视频内容（动态切片）
 *
 * 每个 step 内部串 load → plan → apply → commit 四段（见 run-phases.ts）。
 * 唯一的那条 workflow 在 ../modifier.workflow.ts。
 */

export * from './common.js';
export * from './run-phases.js';

export * from './text/step.js';
export * from './image/step.js';
export * from './video/step.js';

export * from './text/index.js';
export * from './image/character-portrait/index.js';
export * from './image/keyframe-reference/index.js';
export * from './video/video-production/index.js';
