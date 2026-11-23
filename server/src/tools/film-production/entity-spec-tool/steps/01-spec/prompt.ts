/**
 * tools/film-production/entity-spec-tool/steps/01-spec/prompt.ts
 * 单实体视觉规格推演提示词总装出口 (Entity Spec Prompt Assembler SSOT)
 */

import { buildCharacterSpecPrompt } from '../../character/index.js';
import { buildLocationSpecPrompt } from '../../location/index.js';
import { buildItemSpecPrompt } from '../../item/index.js';

export * from '../../character/prompt.js';
export * from '../../location/prompt.js';
export * from '../../item/prompt.js';

export function buildEntitySpecPrompt(params: {
  targetKind: 'character' | 'location' | 'item';
  name: string;
  roleOrBrief?: string;
  instruction?: string;
  storyMarkdown: string;
  prd?: any;
  artStyle?: string;
  existingSpec?: any;
  knownCharacters?: string[];
  knownLocations?: string[];
  knownItems?: string[];
}): string {
  const {
    targetKind,
    name,
    roleOrBrief,
    instruction,
    storyMarkdown,
    prd,
    artStyle,
    existingSpec,
    knownCharacters,
    knownLocations,
    knownItems,
  } = params;

  if (targetKind === 'character') {
    return buildCharacterSpecPrompt({
      name,
      roleOrBrief,
      instruction,
      storyMarkdown,
      prd,
      artStyle,
      existingSpec,
      knownItems,
    });
  }

  if (targetKind === 'location') {
    return buildLocationSpecPrompt({
      name,
      roleOrBrief,
      instruction,
      storyMarkdown,
      prd,
      artStyle,
      existingSpec,
      knownCharacters,
      knownItems,
    });
  }

  return buildItemSpecPrompt({
    name,
    roleOrBrief,
    instruction,
    storyMarkdown,
    prd,
    artStyle,
    existingSpec,
    knownCharacters,
  });
}
