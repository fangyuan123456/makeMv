import { BaseStep } from '../../../../agent-runtime/index.js';
import { LLMRegistry } from '../../../../llm/LLMRegistry.js';
import {
  SHOT_COMPOSITION_SYSTEM_PROMPT,
  buildShotCompositionUserPrompt,
} from './prompt.js';
import { ShotCompositionOutputSchema, ShotCompositionOutput } from './schema.js';
import type { ShotCompositionInput, ShotCompositionResult } from '../../types.js';

export class ShotCompositionStep extends BaseStep<ShotCompositionInput, ShotCompositionResult> {
  public readonly name = 'shot-composition';
  public readonly stepIndex = 'shot_composition';

  constructor(projectId?: string) {
    super('STORYBOARD', projectId);
  }

  public async run(input: ShotCompositionInput): Promise<ShotCompositionResult> {
    const userPrompt = buildShotCompositionUserPrompt({
      title: input.title,
      theme: input.theme,
      scriptText: input.scriptText,
      characterVisuals: input.characterVisuals,
      scenes: input.scenes,
      userFeedback: input.userFeedback,
    });

    const llm = LLMRegistry.get();
    const result = await llm.generateObject<ShotCompositionOutput>(
      userPrompt,
      ShotCompositionOutputSchema,
      SHOT_COMPOSITION_SYSTEM_PROMPT,
      {
        stage: 'shot_composition',
        abortSignal: input.abortSignal,
      }
    );

    return {
      rawShots: result.shots || [],
      episodeNumber: result.episodeNumber || 1,
    };
  }
}
