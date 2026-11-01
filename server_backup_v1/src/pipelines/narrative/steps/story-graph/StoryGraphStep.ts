/**
 * pipelines/narrative/steps/story-graph/StoryGraphStep.ts
 * 工步 3：互动网状拓扑图编译生成 (纯数据流契约)
 */

import { BaseStep } from '../../../../agent-runtime/index.js';
import { LLMRegistry } from '../../../../llm/LLMRegistry.js';
import { STORY_GRAPH_SYSTEM_PROMPT, buildStoryGraphPrompt } from './prompt.js';
import { StoryGraphSchema, type StoryGraphData } from './schema.js';
import type { StoryGraphInput } from '../../types.js';

export class StoryGraphStep extends BaseStep<StoryGraphInput, StoryGraphData> {
  public readonly name = 'StoryGraphStep';
  public readonly stepIndex = 'story_graph';

  constructor(projectId?: string) {
    super('NARRATIVE_DESIGNER', projectId);
  }

  public async run(input: StoryGraphInput): Promise<StoryGraphData> {
    if (!input.spine || !input.pivots) {
      throw new Error('[StoryGraphStep] 缺少上游故事主干或抉择矩阵');
    }

    const llm = LLMRegistry.get();
    const userPrompt = buildStoryGraphPrompt(
      input.spine,
      input.pivots,
      input.userFeedback,
    );

    const storyGraph = await llm.generateObject<StoryGraphData>(
      userPrompt,
      StoryGraphSchema,
      STORY_GRAPH_SYSTEM_PROMPT,
      {
        stage: 'story_graph',
        abortSignal: input.abortSignal,
      }
    );

    const endings = storyGraph.nodes.filter((n: any) => n.isEnding);
    storyGraph.endingsCount = endings.length || 1;

    return storyGraph;
  }
}
