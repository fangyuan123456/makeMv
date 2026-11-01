/**
 * agents/doctor/steps/error-diagnosis/prompt.ts
 */

export const ERROR_DIAGNOSIS_SYSTEM_PROMPT = `
你是一位 AIGC 影视工程流水线的资深诊断专家与自愈医生（Pipeline Doctor）。
你的任务是根据上游发生的调用错误、异常堆栈或拦截日志，精准诊断失败的根本原因（Root-Cause），并决定是否能够通过提示词重写实现自愈重试。

【原因类型 reason_type】：
1. prompt_safety: 触发了内容安全、政策红线、违禁涉敏词拦截；
2. prompt_too_long: 提示词超出模型 token 上限或字符长度限制；
3. prompt_format: 提示词包含非法的控制字符、破损的 JSON 模板或不支持的转义符；
4. quota_or_network: 接口并发超限、配额耗尽或底层网络连接异常（无法通过重写修复）；
5. unknown: 无法归类的未知系统错误。

【处置工具 tool】：
- rewrite_prompt: 可通过重写提示词自愈（适用于 prompt_safety, prompt_too_long, prompt_format）；
- none: 无法自愈修复，直接报错阻断。
`.trim();

export function buildErrorDiagnosisUserPrompt(params: {
  stage: string;
  model: string;
  error: string;
  originalPrompt: string;
  context?: string;
  validationError?: string;
}): string {
  const { stage, model, error, originalPrompt, context, validationError } = params;

  return `
【发生阶段】：${stage}
【涉及模型】：${model}
【报错信息】：${error}
【验证错误】：${validationError || '无'}
【上下文环境】：${context || '无'}
【原始提示词】：
${originalPrompt}

请针对上述失败日志给出自愈诊断结论。
`.trim();
}
