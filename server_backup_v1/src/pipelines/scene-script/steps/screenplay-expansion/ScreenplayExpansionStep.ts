import { BaseStep } from '../../../../agent-runtime/index.js';
import { LLMRegistry } from '../../../../llm/LLMRegistry.js';
import {
  SCREENPLAY_EXPANSION_SYSTEM_PROMPT,
  buildScreenplayExpansionUserPrompt,
} from './prompt.js';
import { ScreenplayExpansionSchema, ScreenplayExpansionOutput } from './schema.js';
import type { ScreenplayExpansionInput, ScreenplayExpansionResult } from '../../types.js';

export class ScreenplayExpansionStep extends BaseStep<ScreenplayExpansionInput, ScreenplayExpansionResult> {
  public readonly name = 'screenplay-expansion';
  public readonly stepIndex = 'screenplay_expansion';

  constructor(projectId?: string) {
    super('SCENE_SCRIPT', projectId);
  }

  public async run(input: ScreenplayExpansionInput): Promise<ScreenplayExpansionResult> {
    const episodeNumber = input.episodeNumber || 1;

    const userPrompt = buildScreenplayExpansionUserPrompt({
      title: input.title,
      theme: input.theme,
      style: input.style,
      episodeNumber,
      characters: input.characters,
      storyGraph: input.storyGraph,
      userFeedback: input.userFeedback,
    });

    const llm = LLMRegistry.get();
    const validated = await llm.generateObject<ScreenplayExpansionOutput>(
      userPrompt,
      ScreenplayExpansionSchema,
      SCREENPLAY_EXPANSION_SYSTEM_PROMPT,
      {
        stage: 'screenplay_expansion',
        abortSignal: input.abortSignal,
      }
    );

    return {
      title: validated.title || `第 ${episodeNumber} 集`,
      logline: validated.logline || '',
      cliffhanger: validated.cliffhanger,
      screenplayMarkdown: validated.screenplayMarkdown || '',
      episodeNumber,
    };
  }
}
