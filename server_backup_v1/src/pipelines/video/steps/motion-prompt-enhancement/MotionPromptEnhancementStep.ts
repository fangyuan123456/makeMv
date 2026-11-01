import { BaseStep } from '../../../../agent-runtime/index.js';
import { LLMRegistry } from '../../../../llm/LLMRegistry.js';
import {
  MOTION_PROMPT_ENHANCEMENT_SYSTEM_PROMPT,
  buildMotionPromptEnhancementUserPrompt,
} from './prompt.js';
import {
  MotionPromptEnhancementOutputSchema,
  MotionPromptEnhancementOutput,
} from './schema.js';
import type { MotionPromptEnhancementInput } from '../../types.js';

export class MotionPromptEnhancementStep extends BaseStep<MotionPromptEnhancementInput, Map<string, string>> {
  public readonly name = 'motion-prompt-enhancement';
  public readonly stepIndex = 'motion_prompt_enhancement';

  constructor(projectId?: string) {
    super('VIDEO_PRODUCTION', projectId);
  }

  public async run(input: MotionPromptEnhancementInput): Promise<Map<string, string>> {
    const shots = input.shots || [];
    const motionPromptMap = new Map<string, string>();

    if (shots.length === 0) {
      return motionPromptMap;
    }

    const userPrompt = buildMotionPromptEnhancementUserPrompt(shots, input.style, input.userFeedback);
    const llm = LLMRegistry.get();
    const result = await llm.generateObject<MotionPromptEnhancementOutput>(
      userPrompt,
      MotionPromptEnhancementOutputSchema,
      MOTION_PROMPT_ENHANCEMENT_SYSTEM_PROMPT,
      {
        stage: 'motion_prompt_enhancement',
        abortSignal: input.abortSignal,
      }
    );

    for (const item of result.enhancedPrompts) {
      motionPromptMap.set(item.shotId, item.motionPrompt);
    }

    return motionPromptMap;
  }
}
