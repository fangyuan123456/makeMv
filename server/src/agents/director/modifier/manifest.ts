/**
 * agents/director/modifier/manifest.ts
 * 微调工序规格清单 (Modifier Spec Manifest SSOT)
 *
 * 与 generator/manifest.ts 对称：生成轨的 manifest 声明「工序 → 生产执行体」，
 * 修改轨的 manifest 声明「工序 → 修改器」。
 *
 * 按产物媒介收敛成三个修改器：
 *   text  —— 故事圣经 / 分场剧本 / 分镜 共用一个（跨文件一致修改）
 *   image —— 角色定妆 / 关键帧参考图（各自单目标，逻辑不同，故各自一份规格）
 *   video —— 动态视频切片
 *
 * 全轨只有一条 workflow（modifier.workflow.ts），它不关心具体是哪个工序，
 * 只在每个阶段按 targetSkill 到这里查规格。
 */

import type { ModifierKind, ModifierSpec } from './spec.js';

import { textModifierSpec } from './steps/text/spec.js';
import { characterPortraitSpec } from './steps/image/character-portrait/spec.js';
import { keyframeReferenceSpec } from './steps/image/keyframe-reference/spec.js';
import { videoProductionSpec } from './steps/video/video-production/spec.js';

/**
 * 工序 → 修改器。
 * 三个文本工序指向同一个修改器实例：文本改动天生可能跨文件，拆开就会互相打架。
 */
export const MODIFIER_SPECS: Record<string, ModifierSpec> = {
  // ── 文本内容 ──
  'story-bible': textModifierSpec,
  'scene-script': textModifierSpec,
  storyboard: textModifierSpec,
  // ── 图像内容 ──
  'character-portrait': characterPortraitSpec,
  'keyframe-reference': keyframeReferenceSpec,
  // ── 动态内容 ──
  'video-production': videoProductionSpec,
};

/**
 * 工序 → 媒介（由规格自身派生，避免第二份真相）
 */
export const MEDIUM_OF_SKILL: Record<string, ModifierKind> = Object.fromEntries(
  Object.entries(MODIFIER_SPECS).map(([skill, spec]) => [skill, spec.kind])
);

/** 按工序键取微调规格；无微调能力的工序返回 undefined */
export function getModifierSpec(skillKey: string): ModifierSpec | undefined {
  return MODIFIER_SPECS[skillKey];
}
