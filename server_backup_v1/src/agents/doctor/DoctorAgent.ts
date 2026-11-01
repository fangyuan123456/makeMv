/**
 * agents/doctor/DoctorAgent.ts
 * 全局质检与自愈专家智能体 (Doctor Agent SSOT)
 *
 * 核心职责：
 * 1. 负责全链路第三道刚性质检门禁与错误诊断；
 * 2. 负责第二道提示词优化与自愈重写；
 * 3. 决定是否触发流水线局部自愈重试，避免整剧报废。
 */

import {
  BaseAgent,
  StagePipeline,
  type AgentResult,
} from '../../agent-runtime/index.js';
import type { DoctorDiagnosisInput, DoctorDiagnosisResult } from './types.js';
import { ErrorDiagnosisStep } from './steps/error-diagnosis/ErrorDiagnosisStep.js';
import { PromptRewriterStep } from './steps/prompt-rewriter/PromptRewriterStep.js';

export class DoctorAgent extends BaseAgent<DoctorDiagnosisInput, DoctorDiagnosisResult> {
  constructor(projectId: string) {
    super('DOCTOR', projectId);
  }

  public async run(input: DoctorDiagnosisInput): Promise<AgentResult<DoctorDiagnosisResult>> {
    const startMs = Date.now();
    const activeProjectId = this.projectId;
    // 瞬态创建工步实例，杜绝多工程并发篡改 projectId
    const pipeline = new StagePipeline('DoctorPipeline', activeProjectId);
    pipeline
      .addStep(new ErrorDiagnosisStep(activeProjectId))
      .addStep(new PromptRewriterStep(activeProjectId));

    const result = await pipeline.run({
      ...input,
      projectId: activeProjectId,
    });

    const diagnosis: DoctorDiagnosisResult = result.diagnosis;

    return {
      success: true,
      data: diagnosis,
      summary: `诊断完成：原因类型「${diagnosis.reason_type}」，建议重试：${diagnosis.should_retry ? '是' : '否'}`,
      durationMs: Date.now() - startMs,
    };
  }

  /** 便捷诊断方法 */
  public async diagnose(input: DoctorDiagnosisInput): Promise<DoctorDiagnosisResult> {
    const res = await this.execute(input);
    if (!res.success) {
      throw new Error(res.error || res.summary || 'Doctor 诊断异常');
    }
    return res.data;
  }

  /** 便捷重写提示词方法 */
  public async rewritePrompt(
    input: DoctorDiagnosisInput,
    reasonType: string,
    doctorReason: string
  ): Promise<string> {
    const enrichedContext = [
      input.context,
      `【诊断原因分类】: ${reasonType}`,
      `【医生修正建议】: ${doctorReason}`,
    ].filter(Boolean).join('\n');

    const res = await this.execute({
      ...input,
      validationError: doctorReason,
      context: enrichedContext,
    });
    return res.data?.rewrittenPrompt || input.originalPrompt;
  }
}
