/**
 * scripts/bench-llm-throughput.ts
 * 上游吐字测速：贴近 story-bible 第 2 步的真实负载（长中文 JSON 输出），
 * 测首 token 延迟 (TTFT) 与吐字速度 (tokens/s)，横向对比同上游不同模型。
 * 用法: npx tsx scripts/bench-llm-throughput.ts
 */
import fs from 'fs';

// 载入 .env
for (const line of fs.readFileSync('.env', 'utf-8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const BASE_URL = process.env.LLM_BASE_URL!;
const API_KEY = process.env.LLM_API_KEY!;

// 模拟分支图谱步骤的输出体量：3 幕 × 节点 × 抉择 + pivot 点，要求长描述
const PROMPT = `你是一名互动影视叙事架构师。基于主干「记忆神偷杰克潜入脑机财阀调查意识篡改案」，输出三幕网状分支剧情图谱 JSON。

要求：
- 三幕 (act_1/act_2/act_3)，每幕 2-3 个节点 (nodes)，每个节点含 sceneName、summary(80字以上)、position；
- 每个节点含 choices 数组 (2-3 个抉择)，每个 choice 含 text、dramaticImpact(60字以上)、targetAct；
- 另含 microPivotPoints 数组 (3 个)，各含 sceneName、interactiveMechanic、feedback(60字以上)；
- 全部中文，直接输出纯 JSON 对象，禁止任何解释文字。`;

interface BenchResult {
  model: string;
  ttftMs: number;
  totalMs: number;
  outputChars: number;
  charsPerSec: number;
  completionTokens?: number;
  tokensPerSec?: number;
  error?: string;
}

async function bench(model: string): Promise<BenchResult> {
  const start = Date.now();
  let ttftMs = 0;
  let outputChars = 0;
  let completionTokens: number | undefined;

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: PROMPT }],
      temperature: 0.3,
      max_tokens: 4096,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    return { model, ttftMs: 0, totalMs: Date.now() - start, outputChars: 0, charsPerSec: 0, error: `HTTP ${res.status}: ${errText.slice(0, 120)}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content || '';
        if (delta) {
          if (!ttftMs) ttftMs = Date.now() - start;
          outputChars += delta.length;
        }
        if (json.usage?.completion_tokens) completionTokens = json.usage.completion_tokens;
      } catch {
        /* 忽略不完整行 */
      }
    }
  }

  const totalMs = Date.now() - start;
  const genMs = totalMs - ttftMs;
  return {
    model,
    ttftMs,
    totalMs,
    outputChars,
    charsPerSec: Math.round((outputChars / genMs) * 1000),
    completionTokens,
    tokensPerSec: completionTokens ? Math.round((completionTokens / genMs) * 1000) : undefined,
  };
}

const MODELS = [
  'Qwen/Qwen2.5-72B-Instruct',
  'Pro/Qwen/Qwen2.5-72B-Instruct',
  'Qwen/Qwen2.5-7B-Instruct',
  'deepseek-ai/DeepSeek-V3',
];

(async () => {
  console.log(`上游测速: ${BASE_URL}  负载: 分支图谱级长 JSON 生成\n`);
  for (const model of MODELS) {
    process.stdout.write(`▶ ${model} ... `);
    const r = await bench(model);
    if (r.error) {
      console.log(`失败 — ${r.error}`);
      continue;
    }
    console.log(
      `TTFT ${r.ttftMs}ms | 总耗时 ${(r.totalMs / 1000).toFixed(1)}s | 输出 ${r.outputChars} 字符` +
        (r.tokensPerSec ? ` | ${r.tokensPerSec} tokens/s` : ` | ${r.charsPerSec} 字符/s`)
    );
  }
})();
