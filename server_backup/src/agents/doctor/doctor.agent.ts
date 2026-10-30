import { llmProvider, ChatMessage } from '../../providers/llm.provider.js';
import { loadPrompt, formatPrompt } from '../../prompts/loader.js';
import { DoctorDiagnosisInput, DoctorDiagnosisResult } from './types.js';

export class DoctorAgent {
  private static instance: DoctorAgent;

  static getInstance(): DoctorAgent {
    if (!DoctorAgent.instance) {
      DoctorAgent.instance = new DoctorAgent();
    }
    return DoctorAgent.instance;
  }

  /**
   * 诊断生成阶段发生的错误，评估是否可通过重写提示词自愈修复。
   */
  async diagnose(input: DoctorDiagnosisInput): Promise<DoctorDiagnosisResult> {
    try {
      const template = loadPrompt('doctor', 'diagnose', 'zh');
      const systemPrompt = formatPrompt(template, {
        reason_types: '["prompt_safety", "prompt_too_long", "prompt_format", "quota_or_network", "unknown"]',
        tools: '["rewrite_prompt", "none"]',
        rewritable_reason_types: '["prompt_safety", "prompt_too_long", "prompt_format"]',
        stage: input.stage,
        model: input.model,
        error: input.error,
        original_prompt: input.originalPrompt,
        context: input.context || '无额外上下文',
        validation_error: input.validationError || '无',
      });

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `请对以下错误进行自愈诊断并输出纯 JSON：\n阶段: ${input.stage}\n模型: ${input.model}\n错误信息: ${input.error}\n原始提示词: ${input.originalPrompt}`,
        },
      ];

      const diagnosis = await llmProvider.chatJSON<DoctorDiagnosisResult>(messages);
      return diagnosis;
    } catch (err) {
      console.warn('[DoctorAgent] Diagnosis failed, returning fallback:', err);
      // 兜底启发式规则：检测错误是否明确提及内容安全或长度超限
      const errorStr = (input.error || '').toLowerCase();
      if (errorStr.includes('safety') || errorStr.includes('policy') || errorStr.includes('sensitive') || errorStr.includes('block') || errorStr.includes('涉敏')) {
        return {
          matched: true,
          reason_type: 'prompt_safety',
          tool: 'rewrite_prompt',
          should_retry: true,
          confidence: 0.8,
          reason: '规则回退判定：触发内容安全策略拦截',
        };
      }
      if (errorStr.includes('too long') || errorStr.includes('length') || errorStr.includes('token') || errorStr.includes('max')) {
        return {
          matched: true,
          reason_type: 'prompt_too_long',
          tool: 'rewrite_prompt',
          should_retry: true,
          confidence: 0.8,
          reason: '规则回退判定：提示词超出长度上限',
        };
      }
      return {
        matched: false,
        reason_type: 'unknown',
        tool: 'none',
        should_retry: false,
        confidence: 0.5,
        reason: '未知或网络/服务故障，无法通过提示词重写修复',
      };
    }
  }

  /**
   * 根据医生智能体的诊断结论安全重写提示词。
   */
  async rewritePrompt(
    input: DoctorDiagnosisInput,
    reasonType: string,
    doctorReason: string
  ): Promise<string> {
    try {
      const template = loadPrompt('doctor', 'rewrite_prompt', 'zh');
      const systemPrompt = formatPrompt(template, {
        stage: input.stage,
        reason_type: reasonType,
        reason: doctorReason,
        context: input.context || '无额外上下文',
        validation_error: input.validationError || '无',
        original_prompt: input.originalPrompt,
      });

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `请根据诊断依据「${doctorReason}」对原始提示词进行重写降敏与修正，只输出包含 rewrite_prompt 的 JSON：\n${input.originalPrompt}`,
        },
      ];

      const result = await llmProvider.chatJSON<{ rewrite_prompt: string }>(messages);
      if (result?.rewrite_prompt) {
        return result.rewrite_prompt.trim();
      }
    } catch (err) {
      console.warn('[DoctorAgent] Prompt rewrite failed:', err);
    }

    // 兜底策略：过滤极端违禁词汇或在提示词过长时进行安全截断
    if (reasonType === 'prompt_too_long') {
      return input.originalPrompt.slice(0, Math.floor(input.originalPrompt.length * 0.7));
    }
    return input.originalPrompt;
  }

  /**
   * One-click self-healing: diagnoses and returns a healed prompt if applicable.
   */
  async heal(input: DoctorDiagnosisInput): Promise<{
    shouldRetry: boolean;
    healedPrompt?: string;
    diagnosis: DoctorDiagnosisResult;
  }> {
    const diagnosis = await this.diagnose(input);
    if (diagnosis.should_retry && diagnosis.tool === 'rewrite_prompt') {
      const rewritten = await this.rewritePrompt(input, diagnosis.reason_type, diagnosis.reason);
      return {
        shouldRetry: true,
        healedPrompt: rewritten,
        diagnosis,
      };
    }

    return {
      shouldRetry: false,
      diagnosis,
    };
  }
}

export const doctorAgent = DoctorAgent.getInstance();
