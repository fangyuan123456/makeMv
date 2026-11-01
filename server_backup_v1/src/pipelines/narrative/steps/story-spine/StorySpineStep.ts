/**
 * pipelines/narrative/steps/story-spine/StorySpineStep.ts
 * 工步 1：黄金戏剧主干与故事大纲生成 (纯数据流契约)
 */

import { BaseStep } from '../../../../agent-runtime/index.js';
import { LLMRegistry } from '../../../../llm/LLMRegistry.js';
import { STORY_SPINE_SYSTEM_PROMPT, buildStorySpinePrompt } from './prompt.js';
import { StorySpineSchema, type StorySpineData } from './schema.js';
import type { StorySpineInput } from '../../types.js';

export class StorySpineStep extends BaseStep<StorySpineInput, StorySpineData> {
  public readonly name = 'StorySpineStep';
  public readonly stepIndex = 'story_spine';

  constructor(projectId?: string) {
    super('NARRATIVE_DESIGNER', projectId);
  }

  public async run(input: StorySpineInput): Promise<StorySpineData> {
    const llm = LLMRegistry.get();
    const userPrompt = buildStorySpinePrompt(
      input.idea,
      input.style,
      input.userFeedback,
    );

    const spine = await llm.generateObject<StorySpineData>(
      userPrompt,
      StorySpineSchema,
      STORY_SPINE_SYSTEM_PROMPT,
      {
        stage: 'story_spine',
        abortSignal: input.abortSignal,
      }
    );

    return spine;
  }
}
