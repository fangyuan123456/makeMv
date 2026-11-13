/**
 * utils/llm-diagnostics.ts
 * 结构化生成失败诊断（LLM Structured Failure Diagnostics）
 *
 * 解决的问题：
 * AI SDK 的 `No object generated: response did not match schema.` 只给一句废话——
 * 哪个字段错、模型到底吐了什么、是不是被 maxTokens 截断，全都看不到，
 * 排查只能靠猜。这里做两件事：
 *
 * 1. 把失败上下文（提示词 / 模型原始输出 / 字段级 zod 错误 / finishReason）落到
 *    `.debug/<阶段>/<工序>/failures/<时间戳>/`，事后能完整复盘；
 * 2. 抛出的错误消息里带上「人话原因 + 落盘路径」，让它直接显示在任务面板上。
 *
 * 只做诊断，不改生成行为：不重试、不修补、不猜语义。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Agent } from '@mastra/core/agent';
import type { ZodTypeAny, infer as ZodInfer } from 'zod';
import { getArtifactDir, STAGE } from '../project-store/artifact-fs.js';
import { getRunContext } from '../workflow-engine/run-context.js';

export interface StructuredCallContext {
  /** 产物阶段目录，如 STAGE.planner / STAGE.textGame */
  stage: string;
  /** 工序目录，如 PLANNER_STEP.prd */
  step: string;
  /** 人看的这步在干什么，如「PRD 全案增补」 */
  label: string;
  /** 缺省取运行时上下文里的 projectId；两者都没有就只打印不落盘 */
  projectId?: string;
}

interface FailureDigest {
  /** 一句话原因，直接给人看 */
  summary: string;
  /** 落盘的相对路径（无项目目录时为 undefined） */
  dumpDir?: string;
}

/** AI SDK NoObjectGeneratedError 的形状（只取用得到的字段） */
interface NoObjectError {
  message?: string;
  name?: string;
  text?: string;
  finishReason?: string;
  usage?: unknown;
  cause?: unknown;
}

function asText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** 从 zod 错误 / JSON 语法错误里抽出字段级问题清单 */
function extractIssues(cause: unknown): string[] {
  if (!cause) return [];
  const c = cause as {
    issues?: Array<{ path?: Array<string | number>; message?: string; code?: string }>;
    errors?: Array<{ path?: Array<string | number>; message?: string }>;
    message?: string;
  };

  const rawIssues = c.issues || c.errors;
  if (Array.isArray(rawIssues) && rawIssues.length > 0) {
    return rawIssues.slice(0, 40).map((issue) => {
      const where = (issue.path || []).join('.') || '(根)';
      return `${where}: ${issue.message || '不符合约束'}`;
    });
  }
  if (typeof c.message === 'string' && c.message.trim()) return [c.message.trim()];
  return [];
}

/** 模型原始输出的可读形态：本来就是 JSON 就原样，不是就包一层方便看 */
function normalizeRawOutput(text: string): string {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
  }
}

/**
 * 把一次结构化生成失败完整落盘，并返回「人话摘要 + 目录」。
 * 落盘失败（无项目上下文 / 写盘异常）不影响主流程，最多少一份证据。
 */
export function dumpStructuredFailure(
  ctx: StructuredCallContext,
  err: unknown,
  prompt: string
): FailureDigest {
  const e = (err || {}) as NoObjectError;
  const issues = extractIssues(e.cause);
  const rawOutput = normalizeRawOutput(String(e.text || ''));
  const finishReason = String(e.finishReason || '');

  const hints: string[] = [];
  if (finishReason === 'length') {
    hints.push('模型输出被 maxTokens 截断（JSON 没写完）');
  }
  if (finishReason === 'content-filter') hints.push('被内容安全策略拦截');
  if (!rawOutput) hints.push('模型完全没有返回文本');
  if (rawOutput && !issues.length) hints.push('返回的是文本但不是合法 JSON');

  const head = issues.length
    ? `${issues.length} 处字段不符合 schema：${issues.slice(0, 3).join('；')}${issues.length > 3 ? ' …' : ''}`
    : hints[0] || String(e.message || '未知原因').slice(0, 160);

  const summary = `【${ctx.label}】${head}`;

  const projectId = ctx.projectId || getRunContext()?.projectId;
  let dumpDir: string | undefined;
  if (projectId) {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const dir = path.join(getArtifactDir(projectId, 'debug', ctx.stage, ctx.step), 'failures', stamp);
      fs.mkdirSync(dir, { recursive: true });

      fs.writeFileSync(
        path.join(dir, 'error.md'),
        [
          `# ${ctx.label} — 结构化生成失败`,
          '',
          `- 阶段: ${ctx.stage}`,
          `- 工序: ${ctx.step}`,
          `- 时间: ${new Date().toISOString()}`,
          `- finishReason: ${finishReason || '(未提供)'}`,
          `- token 用量: ${asText(e.usage) || '(未提供)'}`,
          `- 原始错误: ${String(e.message || err)}`,
          '',
          '## 字段级错误',
          '',
          issues.length ? issues.map((i, n) => `${n + 1}. ${i}`).join('\n') : '(无字段级信息)',
          '',
          '## 诊断提示',
          '',
          hints.length ? hints.map((h) => `- ${h}`).join('\n') : '- 无',
          '',
        ].join('\n'),
        'utf-8'
      );
      fs.writeFileSync(path.join(dir, 'prompt.md'), prompt || '(空提示词)', 'utf-8');
      fs.writeFileSync(
        path.join(dir, 'raw-output.txt'),
        rawOutput || '(空输出)',
        'utf-8'
      );
      fs.writeFileSync(
        path.join(dir, 'cause.txt'),
        asText(e.cause) || '(无 cause)',
        'utf-8'
      );
      dumpDir = dir;
    } catch (writeErr) {
      console.warn('[llm-diagnostics] 失败证据落盘异常:', writeErr);
    }
  }

  if (dumpDir) {
    const rel = path.relative(process.cwd(), dumpDir).replace(/\\/g, '/');
    console.warn(`[llm-diagnostics] ${summary} → ${rel}`);
    return { summary, dumpDir: rel };
  }
  console.warn(`[llm-diagnostics] ${summary}`);
  return { summary };
}

/**
 * 结构化生成的统一入口：成功返回解析后的对象，失败抛出「带原因和落盘路径」的错误。
 *
 * 用法：
 *   const object = await generateStructured({
 *     agent, prompt, schema: PrdEnhancementOutputSchema,
 *     stage: STAGE.planner, step: PLANNER_STEP.prd, label: 'PRD 全案增补',
 *   });
 */
export async function generateStructured<S extends ZodTypeAny>(params: {
  agent: Agent;
  prompt: string;
  schema: S;
  stage: string;
  step: string;
  label: string;
  projectId?: string;
}): Promise<ZodInfer<S>> {
  const { agent, prompt, schema, ...rest } = params;
  try {
    const response = (await agent.generate(prompt, { output: schema as any })) as {
      object?: ZodInfer<S>;
    };
    if (response?.object === undefined || response?.object === null) {
      throw Object.assign(new Error('模型未返回可解析对象'), { text: '' });
    }
    return response.object as ZodInfer<S>;
  } catch (err) {
    const digest = dumpStructuredFailure(rest, err, prompt);
    const suffix = digest.dumpDir ? `（原始输出与提示词已落盘：${digest.dumpDir}）` : '';
    throw new Error(`${digest.summary}${suffix}`);
  }
}

export { STAGE };
