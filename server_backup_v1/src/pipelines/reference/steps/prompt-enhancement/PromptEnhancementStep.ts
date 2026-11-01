import { BaseStep } from '../../../../agent-runtime/index.js';
import { LLMRegistry } from '../../../../llm/LLMRegistry.js';
import {
  PROMPT_ENHANCEMENT_SYSTEM_PROMPT,
  buildPromptEnhancementUserPrompt,
} from './prompt.js';
import {
  PromptEnhancementOutputSchema,
  PromptEnhancementOutput,
} from './schema.js';
import type { PromptEnhancementInput } from '../../types.js';

export class PromptEnhancementStep extends BaseStep<PromptEnhancementInput, Map<string, string>> {
  public readonly name = 'prompt-enhancement';
  public readonly stepIndex = 'prompt_enhancement';

  constructor(projectId?: string) {
    super('KEYFRAME_REFERENCE', projectId);
  }

  public async run(input: PromptEnhancementInput): Promise<Map<string, string>> {
    const shots = input.shots || [];
    const promptMap = new Map<string, string>();

    if (shots.length === 0) {
      return promptMap;
    }

    const userPrompt = buildPromptEnhancementUserPrompt({
      shots,
      characters: input.characters,
      style: input.style,
      userFeedback: input.userFeedback,
    });

    const llm = LLMRegistry.get();
    const result = await llm.generateObject<PromptEnhancementOutput>(
      userPrompt,
      PromptEnhancementOutputSchema,
      PROMPT_ENHANCEMENT_SYSTEM_PROMPT,
      {
        stage: 'keyframe_prompt_enhancement',
        abortSignal: input.abortSignal,
      }
    );

    for (const item of result.enhancedShots) {
      promptMap.set(item.shotId, item.fullPrompt);
    }

    return promptMap;
  }
}
