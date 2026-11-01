/**
 * agents/doctor/steps/prompt-rewriter/prompt.ts
 */

export const PROMPT_REWRITER_SYSTEM_PROMPT = `
你是一位影视提示词安全脱敏与质量精炼专家（Prompt Healing Specialist）。
你的任务是对触发拦截或报错的原始提示词进行精准修复重写。

【重写铁律】：
1. 语义保留度：尽可能 100% 保留故事、人物、镜头构图与视觉基调的核心意图；
2. 针对性修复：
   - 涉敏/安全问题：将具有暴力、血腥或低俗倾向的词汇，替换为含蓄、电影隐喻艺术化的文学修辞；
   - 长度超限问题：剔除啰嗦冗余修饰，保留最具画面塑造力的关键视觉实体；
   - 格式破损问题：修补残缺引号、转义符与模板乱码；
3. 输出纯 JSON，包含 rewrittenPrompt 与 changesExplanation。
`.trim();

export function buildPromptRewriterUserPrompt(params: {
  originalPrompt: string;
  reasonType: string;
  reason: string;
  context?: string;
}): string {
  const { originalPrompt, reasonType, reason, context } = params;

  return `
【错误类型】：${reasonType}
【诊断建议】：${reason}
【上下文】：${context || '无'}
【原始提示词】：
${originalPrompt}

请重写该提示词以自愈该错误，严格以 JSON 输出。
`.trim();
}
