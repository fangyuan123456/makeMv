import { BaseStep } from '../../../../agent-runtime/index.js';
import { LLMRegistry } from '../../../../llm/LLMRegistry.js';
import { JsonSanitizer } from '../../../../utils/JsonSanitizer.js';
import {
  PROMPT_REWRITER_SYSTEM_PROMPT,
  buildPromptRewriterUserPrompt,
} from './prompt.js';
import {
  PromptRewriterOutputSchema,
  PromptRewriterOutput,
} from './schema.js';

export class PromptRewriterStep extends BaseStep<any, any> {
  public readonly name = 'prompt-rewriter';
  public readonly stepIndex = 'prompt_rewriter';

  constructor(projectId?: string) {
    super('DOCTOR', projectId);
  }

  public async run(ctx: any): Promise<any> {
    const diagnosis = ctx.diagnosis;
    if (!diagnosis || !diagnosis.should_retry || diagnosis.tool !== 'rewrite_prompt') {
      return ctx;
    }

    try {
      const userPrompt = buildPromptRewriterUserPrompt({
        originalPrompt: ctx.originalPrompt || '',
        reasonType: diagnosis.reason_type,
        reason: diagnosis.reason,
        context: ctx.context,
      });

      const llm = LLMRegistry.get();
      const result = await llm.generateObject<PromptRewriterOutput>(
        userPrompt,
        PromptRewriterOutputSchema,
        PROMPT_REWRITER_SYSTEM_PROMPT,
        {
          stage: 'doctor_rewrite_prompt',
          abortSignal: ctx.abortSignal,
        }
      );

      diagnosis.rewrittenPrompt = result.rewrittenPrompt;

      return {
        ...ctx,
        diagnosis,
        rewrittenPrompt: result.rewrittenPrompt,
      };
    } catch (err) {
      console.warn('[PromptRewriterStep] 提示词重写失败:', err);
      return ctx;
    }
  }
}
