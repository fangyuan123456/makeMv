/**
 * agents/director/modifier/steps/image/character-portrait/character-portrait.modifier.ts
 * 角色定妆增量微调、历史版本压栈与锁定原图修改引擎 (Character Portrait Modifier SSOT)
 */

import type { LLMService } from '../../../../../../llm/LLMService.js';
import { CharacterRenderer } from '../../../../../../media/index.js';
import { REFINE_CHARACTER_SYSTEM_PROMPT, buildRefineCharacterPrompt } from './prompt.js';
import {
  RefineCharacterVisualPromptSchema,
  type RefineCharacterVisualPromptOutput,
} from './schema.js';
import type {
  CharacterSheetItem,
  PortraitHistoryRecord,
} from '../../../../../../artifacts/character-portrait.js';

export interface RefineCharacterPromptOptions {
  existingChar: CharacterSheetItem;
  userFeedback: string;
  style: string;
  effectiveConstraints?: string[];
  projectId?: string;
}

export async function refineCharacterVisualPrompt(
  llm: LLMService,
  options: RefineCharacterPromptOptions
): Promise<string> {
  const { existingChar, userFeedback, style, effectiveConstraints, projectId } = options;
  try {
    const refinePrompt = buildRefineCharacterPrompt(
      existingChar,
      userFeedback,
      style,
      effectiveConstraints
    );
    const refineRes = await llm.generateObject<RefineCharacterVisualPromptOutput>(
      refinePrompt,
      RefineCharacterVisualPromptSchema,
      REFINE_CHARACTER_SYSTEM_PROMPT,
      { stage: 'character_refine', projectId, temperature: 0.3 }
    );
    return refineRes.refinedVisualPrompt || existingChar.visualPrompt;
  } catch (err) {
    console.warn(`[character-portrait.modifier] 微调角色【${existingChar.name}】提示词重写失败，保持原提示词微调:`, err);
    return `${existingChar.visualPrompt}，${userFeedback}`;
  }
}

export function archiveHistoryAndPrepareRefine(existingChar: CharacterSheetItem | undefined): {
  history: PortraitHistoryRecord[];
  referenceImageUrl?: string;
  useReference: boolean;
} {
  const history: PortraitHistoryRecord[] = Array.isArray(existingChar?.history)
    ? [...existingChar.history]
    : [];

  let referenceImageUrl: string | undefined = undefined;
  let useReference = false;

  if (existingChar?.imageUrl) {
    const alreadyInHistory = history.some((h) => h.imageUrl === existingChar.imageUrl);
    if (!alreadyInHistory) {
      history.push({
        id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        imageUrl: existingChar.imageUrl,
        visualPrompt: existingChar.visualPrompt || '',
        createdAt: new Date().toISOString(),
      });
    }
    referenceImageUrl = existingChar.imageUrl;
    useReference = true;
  }

  return {
    history,
    referenceImageUrl,
    useReference,
  };
}

export async function renderModifiedCharacter(
  projectId: string,
  char: any,
  visualPrompt: string,
  options: {
    useReference?: boolean;
    referenceImageUrl?: string;
    isMock?: boolean;
    history?: PortraitHistoryRecord[];
  } = {}
): Promise<CharacterSheetItem> {
  const { useReference = true, referenceImageUrl, isMock, history = [] } = options;
  const effectiveRefUrl = useReference ? referenceImageUrl : undefined;

  const renderRes = await CharacterRenderer.renderCharacterPortrait(
    projectId,
    char.name,
    visualPrompt,
    {
      isMock,
      referenceImageUrl: effectiveRefUrl,
      mode: effectiveRefUrl ? 'character_ref2i' : 'character_t2i',
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
    referenceImageUrl: referenceImageUrl || renderRes.url,
    useReference,
    history,
    isNew: false,
  };
}
