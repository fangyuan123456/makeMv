/**
 * agents/pipeline/workflows/steps/keyframe-reference/generator.ts
 * 关键帧首帧基准图全新批量推演与首次渲染引擎 (Keyframe Reference Generator SSOT)
 */

import type { LLMService } from '../../../../../llm/LLMService.js';
import { KeyframeRenderer } from '../../../../../media/index.js';
import type { KeyframePromptMeta } from '../../../../../artifacts/keyframe-reference.js';
import { KEYFRAME_REFERENCE_SYSTEM_PROMPT, buildKeyframeReferencePrompt } from './prompt.js';
import {
  KeyframeBatchOutputSchema,
  type KeyframeBatchOutput,
  type KeyframeItem,
} from './schema.js';

export interface GenerateKeyframePromptsBatchOptions {
  style: string;
  characterVisualSpecs: any[];
  shots: any[];
  userFeedback?: string;
  projectId?: string;
}

/** 提示词元数据属于产物契约，实现已下沉至 artifacts/keyframe-reference.ts */
export type { KeyframePromptMeta };

export async function generateKeyframePromptsBatch(
  llm: LLMService,
  options: GenerateKeyframePromptsBatchOptions
): Promise<Map<string, KeyframePromptMeta>> {
  const { style, characterVisualSpecs, shots, userFeedback, projectId } = options;
  const promptMetaMap = new Map<string, KeyframePromptMeta>();

  if (!shots || shots.length === 0) {
    return promptMetaMap;
  }

  try {
    const anchorsSummary = characterVisualSpecs
      .map((c: any) => `角色【${c.name}】(${c.role}): 定妆视觉规范: ${c.visualPrompt}`)
      .join('\n');

    const batchPrompt = buildKeyframeReferencePrompt(style, anchorsSummary, shots, userFeedback);
    const batchResult = await llm.generateObject<KeyframeBatchOutput>(
      batchPrompt,
      KeyframeBatchOutputSchema,
      KEYFRAME_REFERENCE_SYSTEM_PROMPT,
      { stage: 'keyframe_prompt_generation', projectId, temperature: 0.3 }
    );

    for (const k of batchResult.keyframes || []) {
      promptMetaMap.set(k.shotId, {
        prompt: k.prompt,
        subjectAppearance: k.subjectAppearance,
        sceneEnvironment: k.sceneEnvironment,
      });
    }
  } catch (err) {
    console.warn('[keyframe-reference/generator] 批量推演关键帧提示词异常，使用兜底提示词:', err);
  }

  return promptMetaMap;
}

export async function renderFreshKeyframe(
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
