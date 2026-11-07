/**
 * artifacts/character-portrait.ts
 * 角色定妆照 —— 产物契约层 (Artifact Contract)
 *
 * 依赖方向：modifier → artifacts ← generator
 */

export type {
  CharacterPortraitArtifact,
  CharacterSheetItem,
  PortraitHistoryRecord,
} from '../agents/director/generator/steps/character-portrait/schema.js';

/** 产物所在阶段（聚合根索引键） */
export const CHARACTER_PORTRAIT_STAGE = 'character_design';
