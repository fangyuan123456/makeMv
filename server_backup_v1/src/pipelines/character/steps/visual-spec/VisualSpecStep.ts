/**
 * pipelines/character/steps/visual-spec/VisualSpecStep.ts
 * 工步 1：角色视觉定妆规范推演 (声明式 Pipeline Step)
 */

import { BaseStep } from '../../../../agent-runtime/index.js';
import { LLMRegistry } from '../../../../llm/LLMRegistry.js';
import { VISUAL_SPEC_SYSTEM_PROMPT, buildVisualSpecPrompt } from './prompt.js';
import { VisualSpecBatchSchema, type VisualSpecBatchData, type VisualSpecData } from './schema.js';
import type { VisualSpecInput } from '../../types.js';

export class VisualSpecStep extends BaseStep<VisualSpecInput, VisualSpecData[]> {
  public readonly name = 'VisualSpecStep';
  public readonly stepIndex = 'visual_spec';

  constructor(projectId?: string) {
    super('CHARACTER_DESIGNER', projectId);
  }

  public async run(input: VisualSpecInput): Promise<VisualSpecData[]> {
    const llm = LLMRegistry.get();
    const userPrompt = buildVisualSpecPrompt(
      input.rawCharacters,
      input.style,
      input.userFeedback,
    );

    const { specs } = await llm.generateObject<VisualSpecBatchData>(
      userPrompt,
      VisualSpecBatchSchema,
      VISUAL_SPEC_SYSTEM_PROMPT,
      {
        stage: 'character_visual_spec',
        abortSignal: input.abortSignal,
      }
    );

    return specs;
  }
}
