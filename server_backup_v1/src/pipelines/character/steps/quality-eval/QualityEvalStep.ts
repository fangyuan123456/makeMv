/**
 * pipelines/character/steps/quality-eval/QualityEvalStep.ts
 * 工步 3：角色一致性与画质质检选优 (声明式 Pipeline Step)
 */

import { BaseStep } from '../../../../agent-runtime/index.js';
import { LLMRegistry } from '../../../../llm/LLMRegistry.js';
import { QUALITY_EVAL_SYSTEM_PROMPT, buildQualityEvalPrompt } from './prompt.js';
import { QualityEvalBatchSchema, type QualityEvalBatchData } from './schema.js';
import type { QualityEvalInput, CharacterSheet } from '../../types.js';

export class QualityEvalStep extends BaseStep<QualityEvalInput, CharacterSheet[]> {
  public readonly name = 'QualityEvalStep';
  public readonly stepIndex = 'quality_eval';

  constructor(projectId?: string) {
    super('CHARACTER_DESIGNER', projectId);
  }

  public async run(input: QualityEvalInput): Promise<CharacterSheet[]> {
    if (!input.characterSheets || input.characterSheets.length === 0) {
      return [];
    }

    const llm = LLMRegistry.get();
    const evaluatedSheets: CharacterSheet[] = [];

    for (const sheet of input.characterSheets) {
      if (!sheet.visualSpec || sheet.versions.length <= 1) {
        evaluatedSheets.push(sheet);
        continue;
      }

      const userPrompt = buildQualityEvalPrompt(sheet.visualSpec, sheet.versions);

      try {
        const evalResult = await llm.generateObject<QualityEvalBatchData>(
          userPrompt,
          QualityEvalBatchSchema,
          QUALITY_EVAL_SYSTEM_PROMPT,
          {
            stage: 'character_quality_eval',
            abortSignal: input.abortSignal,
          }
        );

        const updatedVersions = sheet.versions.map((v) => {
          const found = evalResult.evaluations?.find((e: any) => e.versionId === v.versionId);
          return {
            ...v,
            score: found?.fidelityScore,
            evalSummary: found?.summary,
          };
        });

        const bestVersion =
          updatedVersions.find((v) => v.versionId === evalResult.recommendedVersionId) ||
          updatedVersions[0];

        evaluatedSheets.push({
          ...sheet,
          currentVersionId: bestVersion.versionId,
          imageUrl: bestVersion.imageUrl,
          referenceImageUrl: bestVersion.imageUrl,
          versions: updatedVersions,
        });
      } catch {
        evaluatedSheets.push(sheet);
      }
    }

    return evaluatedSheets;
  }
}
