/**
 * agents/pipeline/workflows/steps/character-portrait/generator.ts
 * 角色视觉定妆照全新批量推演与首次渲染引擎 (Character Portrait Generator SSOT)
 */

import type { LLMService } from '../../../../../llm/LLMService.js';
import { CharacterRenderer, type CharacterRenderOptions } from '../../../../../media/index.js';
import {
  CHARACTER_VISUAL_SPEC_SYSTEM_PROMPT,
  buildCharacterVisualSpecPrompt,
} from './prompt.js';
import {
  CharacterVisualSpecsListSchema,
  type CharacterVisualSpecsListOutput,
  type CharacterSheetItem,
} from './schema.js';

export interface GenerateBatchVisualSpecsOptions {
  style: string;
  characters: any[];
  userFeedback?: string;
  effectiveConstraints?: string[];
  projectId?: string;
}

export async function generateBatchVisualSpecs(
  llm: LLMService,
  options: GenerateBatchVisualSpecsOptions
): Promise<Map<string, string>> {
  const { style, characters, userFeedback, effectiveConstraints, projectId } = options;
  const specsMap = new Map<string, string>();

  if (!characters || characters.length === 0) {
    return specsMap;
  }

  try {
    const batchPrompt = buildCharacterVisualSpecPrompt(
      style,
      characters,
      userFeedback,
      effectiveConstraints
    );
    const specsResult = await llm.generateObject<CharacterVisualSpecsListOutput>(
      batchPrompt,
      CharacterVisualSpecsListSchema,
      CHARACTER_VISUAL_SPEC_SYSTEM_PROMPT,
      { stage: 'character_visual_spec', projectId, temperature: 0.3 }
    );
    for (const s of specsResult.specs || []) {
      specsMap.set(s.name, s.visualPrompt);
    }
  } catch (err) {
    console.warn('[character-portrait/generator] 批量推演提示词失败，将使用默认影调兜底:', err);
  }

  return specsMap;
}

export async function renderFreshCharacter(
  projectId: string,
  char: any,
  visualPrompt: string,
  options: CharacterRenderOptions = {}
): Promise<CharacterSheetItem> {
  const renderRes = await CharacterRenderer.renderCharacterPortrait(
    projectId,
    char.name,
    visualPrompt,
    {
      ...options,
      mode: 'character_t2i',
      referenceImageUrl: undefined,
    }
  );

  return {
    name: char.name,
    role: char.role || '主要角色',
    gender: char.gender,
    age: char.age,
    appearance: char.appearance,
    personality: char.personality,
    motivation: char.motivation,
    visualPrompt,
    imageUrl: renderRes.url,
    referenceImageUrl: renderRes.url,
    useReference: false,
    history: [],
    isNew: true,
  };
}
