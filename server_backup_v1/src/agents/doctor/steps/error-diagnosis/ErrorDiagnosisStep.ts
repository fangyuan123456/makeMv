import { BaseStep } from '../../../../agent-runtime/index.js';
import { LLMRegistry } from '../../../../llm/LLMRegistry.js';
import { JsonSanitizer } from '../../../../utils/JsonSanitizer.js';
import {
  ERROR_DIAGNOSIS_SYSTEM_PROMPT,
  buildErrorDiagnosisUserPrompt,
} from './prompt.js';
import {
  ErrorDiagnosisOutputSchema,
  ErrorDiagnosisOutput,
} from './schema.js';

export class ErrorDiagnosisStep extends BaseStep<any, any> {
  public readonly name = 'error-diagnosis';
  public readonly stepIndex = 'error_diagnosis';

  constructor(projectId?: string) {
    super('DOCTOR', projectId);
  }

  public async run(ctx: any): Promise<any> {
    const {
      stage = 'unknown_stage',
      model = 'unknown_model',
      error = '',
      originalPrompt = '',
      context = '',
      validationError = '',
    } = ctx;

    try {
      const userPrompt = buildErrorDiagnosisUserPrompt({
        stage,
        model,
        error,
        originalPrompt,
        context,
        validationError,
      });

      const llm = LLMRegistry.get();
      const diagnosis = await llm.generateObject<ErrorDiagnosisOutput>(
        userPrompt,
        ErrorDiagnosisOutputSchema,
        ERROR_DIAGNOSIS_SYSTEM_PROMPT,
        {
          stage: 'doctor_diagnosis',
          abortSignal: ctx.abortSignal,
        }
      );

      return {
        ...ctx,
        diagnosis,
      };
    } catch (err) {
      console.warn('[ErrorDiagnosisStep] 诊断解析异常，执行规则兜底:', err);
      const errStr = (error || '').toLowerCase();
      let reasonType: any = 'unknown';
      let tool: any = 'none';
      let shouldRetry = false;

      if (errStr.includes('safety') || errStr.includes('sensitive') || errStr.includes('policy') || errStr.includes('涉敏')) {
        reasonType = 'prompt_safety';
        tool = 'rewrite_prompt';
        shouldRetry = true;
      } else if (errStr.includes('too long') || errStr.includes('token') || errStr.includes('length')) {
        reasonType = 'prompt_too_long';
        tool = 'rewrite_prompt';
        shouldRetry = true;
      }

      const fallbackDiagnosis: ErrorDiagnosisOutput = {
        matched: shouldRetry,
        reason_type: reasonType,
        tool,
        should_retry: shouldRetry,
        confidence: 0.75,
        reason: shouldRetry ? '规则防御网判定：内容安全或长度异常，建议自愈重写' : '系统故障或配额耗尽，不可自愈',
      };

      return {
        ...ctx,
        diagnosis: fallbackDiagnosis,
      };
    }
  }
}
