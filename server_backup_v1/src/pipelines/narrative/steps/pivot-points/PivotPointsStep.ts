/**
 * pipelines/narrative/steps/pivot-points/PivotPointsStep.ts
 * 工步 2：交互关键抉择点提取 (纯数据流契约)
 */

import { BaseStep } from '../../../../agent-runtime/index.js';
import { LLMRegistry } from '../../../../llm/LLMRegistry.js';
import { PIVOT_POINTS_SYSTEM_PROMPT, buildPivotPointsPrompt } from './prompt.js';
import { PivotPointsSchema, type PivotPointsOutput } from './schema.js';
import type { PivotPointsInput } from '../../types.js';

export class PivotPointsStep extends BaseStep<PivotPointsInput, PivotPointsOutput> {
  public readonly name = 'PivotPointsStep';
  public readonly stepIndex = 'pivot_points';

  constructor(projectId?: string) {
    super('NARRATIVE_DESIGNER', projectId);
  }

  public async run(input: PivotPointsInput): Promise<PivotPointsOutput> {
    if (!input.spine) {
      throw new Error('[PivotPointsStep] 缺少上游故事主干 (input.spine)');
    }

    const llm = LLMRegistry.get();
    const userPrompt = buildPivotPointsPrompt(input.spine, input.userFeedback);

    const pivotPoints = await llm.generateObject<PivotPointsOutput>(
      userPrompt,
      PivotPointsSchema,
      PIVOT_POINTS_SYSTEM_PROMPT,
      {
        stage: 'pivot_points',
        abortSignal: input.abortSignal,
      }
    );

    return pivotPoints;
  }
}
