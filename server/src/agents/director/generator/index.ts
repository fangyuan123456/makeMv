/**
 * agents/director/generator/index.ts
 * 影视生成制片流水线出口 (Generator Production Pipeline SSOT)
 *
 * 只导出生成轨私有能力。工作流注册器已迁到 ../orchestration/，
 * 修改轨在 ../modifier/，血缘重算在 ../lineage/ —— 三者都不从这里出去。
 */

export * from './constants.js';
export * from './steps/index.js';
export * from './generator.workflow.js';
