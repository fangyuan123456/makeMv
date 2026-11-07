/**
 * artifacts/video-production.ts
 * 动态视频切片 —— 产物契约层 (Artifact Contract)
 *
 * 依赖方向：modifier → artifacts ← generator
 */

export type {
  VideoProductionArtifact,
  VideoClipItem,
  KeyPoseItem,
} from '../agents/director/generator/steps/video-production/schema.js';

export const VIDEO_PRODUCTION_STAGE = 'video_production';
