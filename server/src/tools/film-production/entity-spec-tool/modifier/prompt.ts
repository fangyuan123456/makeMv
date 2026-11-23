/**
 * tools/film-production/entity-spec-tool/modifier/prompt.ts
 * 单实体视觉规格增量微调提示词总装出口 (Entity Spec Modifier Prompt Assembler SSOT)
 */

import { buildCharacterSpecModifyPrompt } from '../character/index.js';
import { buildLocationSpecModifyPrompt } from '../location/index.js';
import { buildItemSpecModifyPrompt } from '../item/index.js';

export * from '../character/prompt.js';
export * from '../location/prompt.js';
export * from '../item/prompt.js';

export function buildEntitySpecModifyPrompt(params: {
  targetKind: 'character' | 'location' | 'item';
  name: string;
  existingSpec: any;
  instruction: string;
  artStyle?: string;
  storyMarkdown?: string;
  knownCharacters?: string[];
  knownLocations?: string[];
  knownItems?: string[];
}): string {
  const {
    targetKind,
    name,
    existingSpec,
    instruction,
    artStyle,
    storyMarkdown,
    knownCharacters,
    knownLocations,
    knownItems,
  } = params;

  if (targetKind === 'character') {
    return buildCharacterSpecModifyPrompt({
      name,
      existingSpec,
      instruction,
      artStyle,
      storyMarkdown,
      knownItems,
    });
  }

  if (targetKind === 'location') {
    return buildLocationSpecModifyPrompt({
      name,
      existingSpec,
      instruction,
      artStyle,
      storyMarkdown,
      knownCharacters,
      knownItems,
    });
  }

  return buildItemSpecModifyPrompt({
    name,
    existingSpec,
    instruction,
    artStyle,
    storyMarkdown,
    knownCharacters,
  });
}
