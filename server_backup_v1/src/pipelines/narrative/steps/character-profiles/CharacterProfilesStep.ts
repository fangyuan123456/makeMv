/**
 * pipelines/narrative/steps/character-profiles/CharacterProfilesStep.ts
 * 工步 4：核心角色小传推演生成 (纯数据流契约)
 */

import { BaseStep } from '../../../../agent-runtime/index.js';
import { LLMRegistry } from '../../../../llm/LLMRegistry.js';
import {
  CHARACTER_PROFILES_SYSTEM_PROMPT,
  buildCharacterProfilesPrompt,
} from './prompt.js';
import { CharacterProfilesOutputSchema, type CharacterProfilesOutput } from './schema.js';
import type { CharacterProfile, CharacterProfilesInput } from '../../types.js';

export class CharacterProfilesStep extends BaseStep<CharacterProfilesInput, CharacterProfile[]> {
  public readonly name = 'CharacterProfilesStep';
  public readonly stepIndex = 'character_profiles';

  constructor(projectId?: string) {
    super('NARRATIVE_DESIGNER', projectId);
  }

  public async run(input: CharacterProfilesInput): Promise<CharacterProfile[]> {
    if (!input.spine || !input.graph) {
      throw new Error('[CharacterProfilesStep] 缺少上游故事主干或剧情拓扑图');
    }

    const llm = LLMRegistry.get();
    const userPrompt = buildCharacterProfilesPrompt(
      input.spine,
      input.graph,
      input.userFeedback,
    );

    const { characters } = await llm.generateObject<CharacterProfilesOutput>(
      userPrompt,
      CharacterProfilesOutputSchema,
      CHARACTER_PROFILES_SYSTEM_PROMPT,
      {
        stage: 'character_profiles',
        abortSignal: input.abortSignal,
      }
    );

    return characters;
  }
}
