/**
 * agents/modifier/modifiers/keyframe-reference.modifier.ts
 * 关键帧单镜靶向微调、提示词重写与局部重绘引擎 (Keyframe Reference Modifier SSOT)
 */

import { KeyframeRenderer } from '../../../../media/index.js';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../types/index.js';
import type {
  KeyframeItem,
  KeyframeReferenceArtifact,
} from '../../generator/steps/keyframe-reference/schema.js';
import type { KeyframePromptMeta } from '../../generator/steps/keyframe-reference/generator.js';

export interface RefineKeyframePromptOptions {
  existingShot: KeyframeItem;
  userFeedback?: string;
  fallbackVisualComposition?: string;
}

export function refineKeyframePrompt(options: RefineKeyframePromptOptions): {
  finalPrompt: string;
  meta: KeyframePromptMeta;
} {
  const { existingShot, userFeedback, fallbackVisualComposition } = options;
  const currentPrompt = existingShot.prompt || fallbackVisualComposition || existingShot.shotId;
  const finalPrompt = userFeedback ? `${currentPrompt}，${userFeedback}` : currentPrompt;

  const meta: KeyframePromptMeta = {
    prompt: finalPrompt || '',
    subjectAppearance: existingShot.subjectAppearance,
    sceneEnvironment: existingShot.sceneEnvironment || fallbackVisualComposition,
  };

  return {
    finalPrompt: finalPrompt || '',
    meta,
  };
}

export async function renderModifiedKeyframe(
  projectId: string,
  shot: any,
  finalPrompt: string,
  meta?: KeyframePromptMeta,
  options?: { isMock?: boolean }
): Promise<KeyframeItem> {
  const renderRes = await KeyframeRenderer.renderKeyframeImage(
    projectId,
    shot.shotId,
    '16:9',
    finalPrompt,
    options
  );

  return {
    shotId: shot.shotId,
    shotNumber: typeof shot.shotNumber === 'number' ? shot.shotNumber : 1,
    subjectAppearance: meta?.subjectAppearance,
    sceneEnvironment: meta?.sceneEnvironment || shot.visualComposition,
    prompt: finalPrompt,
    imageUrl: renderRes.url,
    aspectRatio: '16:9',
    status: 'ready' as const,
    isDegraded: renderRes.isDegraded,
    degradedReason: renderRes.degradedReason,
  };
}

export interface ModifyKeyframeReferenceOptions {
  projectId: string;
  targetShotId?: string;
  userFeedback: string;
  isMock?: boolean;
}

export interface ModifyKeyframeReferenceResult {
  success: boolean;
  data?: KeyframeReferenceArtifact;
  summary?: string;
  error?: string;
}

export async function modifyKeyframeReference(
  options: ModifyKeyframeReferenceOptions
): Promise<ModifyKeyframeReferenceResult> {
  const { projectId, targetShotId, userFeedback, isMock } = options;
  const store = ProjectStore.getInstance();
  const existingArtifact = store.getArtifact<KeyframeReferenceArtifact>(
    projectId,
    WorkflowStage.KEYFRAME_REFERENCE
  );

  if (!existingArtifact || !Array.isArray(existingArtifact.shots) || existingArtifact.shots.length === 0) {
    return {
      success: false,
      error: `项目 [${projectId}] 尚未生成关键帧参考图，无法执行局部微调`,
    };
  }

  const shots = [...existingArtifact.shots];
  const targetIndex = targetShotId
    ? shots.findIndex(
        (k) =>
          k.shotId.toLowerCase() === targetShotId.toLowerCase() ||
          k.shotId.includes(targetShotId) ||
          targetShotId.includes(k.shotId)
      )
    : 0;

  if (targetIndex < 0) {
    return {
      success: false,
      error: `未在已有关键帧中找到镜头【${targetShotId}】`,
    };
  }

  const targetShot = shots[targetIndex];

  // 1. 局部重写提示词
  const { finalPrompt, meta } = refineKeyframePrompt({
    existingShot: targetShot,
    userFeedback,
  });

  // 2. 单点重新渲染关键帧
  const updatedShot = await renderModifiedKeyframe(projectId, targetShot, finalPrompt, meta, { isMock });

  // 3. 单点替换目标镜头，其余关键帧 100% 物理保全
  shots[targetIndex] = updatedShot;

  const updatedArtifact: KeyframeReferenceArtifact = {
    ...existingArtifact,
    shots,
    updatedAt: new Date().toISOString(),
  };

  store.setArtifact(projectId, WorkflowStage.KEYFRAME_REFERENCE, updatedArtifact);

  return {
    success: true,
    data: updatedArtifact,
    summary: `已完成镜头【${targetShot.shotId}】的关键帧局部微调与重绘。全片其余 ${shots.length - 1} 个镜头关键帧 100% 保持原状。`,
  };
}
