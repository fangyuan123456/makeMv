/**
 * artifacts/keyframe-reference.ts
 * 关键帧参考图 —— 产物契约层 (Artifact Contract)
 *
 * 依赖方向：modifier → artifacts ← generator
 */

export type {
  KeyframeReferenceArtifact,
  KeyframeItem,
} from '../agents/director/generator/steps/keyframe-reference/schema.js';

/**
 * 关键帧提示词元数据（生成轨与修改轨共同使用的产物字段契约）
 * 原定义在生成轨 generator.ts，属于产物结构而非生成策略，故下沉至此。
 */
export interface KeyframePromptMeta {
  prompt: string;
  subjectAppearance?: string;
  sceneEnvironment?: string;
}

export const KEYFRAME_REFERENCE_STAGE = 'keyframe_reference';
