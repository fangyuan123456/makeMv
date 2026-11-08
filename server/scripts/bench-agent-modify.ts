/**
 * scripts/bench-agent-modify.ts
 * 只读探针：验证「工具会话式修改」到底要几轮、每轮多贵、总共多久。
 *
 * 刻意不写盘、不碰现有修改轨，只回答三个问题：
 *   1. 模型能不能自己找到「这个事实定义在哪、被谁引用」？
 *   2. 它实际发起了几轮工具调用、读了多少字符？
 *   3. 端到端耗时与 token 落在什么量级？
 *
 * 用法：npx tsx scripts/bench-agent-modify.ts [projectId] ["用户原话"]
 */
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { createTool } from '../src/mastra-compat/index.js';
import { LLMRegistry } from '../src/llm/LLMRegistry.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';

const PID = process.argv[2] || 'proj_1794101350967_b9al';
const USER_LINE = process.argv[3] || '男一太老了吧';

const store = ProjectStore.getInstance();
const project = store.getProject(PID);
if (!project) {
  console.error(`项目不存在: ${PID}`);
  process.exit(1);
}
const artifacts: Record<string, any> = (project as any).stageArtifacts || {};
const availableKeys = Object.keys(artifacts).filter((k) => artifacts[k] && !k.startsWith('critic_review'));

/* ─── 打点 ─── */
interface CallLog {
  seq: number;
  name: string;
  argsChars: number;
  resultChars: number;
  ms: number;
}
const logs: CallLog[] = [];
let seq = 0;

/* ─── 只读工具 1：全文检索事实 ─── */
function flattenStrings(node: any, prefix: string, out: Array<{ path: string; value: string }>) {
  if (node == null) return;
  if (typeof node === 'string') {
    out.push({ path: prefix || '(root)', value: node });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => flattenStrings(v, `${prefix}[${i}]`, out));
    return;
  }
  if (typeof node === 'object') {
    for (const k of Object.keys(node)) flattenStrings(node[k], prefix ? `${prefix}.${k}` : k, out);
  }
}

const searchFactsTool = createTool({
  id: 'search_facts',
  description:
    '在项目全部已落盘产物里检索一个概念（会同时检索数值与文本，例如「年龄」也会命中「45」这类字段）。' +
    '返回命中位置（产物 + 字段路径）与片段，用于判断这个概念定义在哪、又被谁引用。',
  inputSchema: z.object({
    query: z.string().describe('要检索的概念或关键词，例如 年龄、张明、发型'),
    limit: z.number().optional().describe('最多返回多少条，默认 20'),
  }),
  outputSchema: z.object({ hits: z.array(z.object({ where: z.string(), snippet: z.string() })) }),
  execute: async ({ query, limit }: { query: string; limit?: number }) => {
    const t0 = Date.now();
    // 模型常把多个词拼成一个查询（"男一 年龄"），逐词匹配，任一命中即算
    const terms = String(query || '')
      .toLowerCase()
      .split(/[\s,，、/|]+/)
      .filter((t) => t.length >= 2);
    const hits: Array<{ where: string; snippet: string }> = [];
    for (const key of availableKeys) {
      const flat: Array<{ path: string; value: string }> = [];
      flattenStrings(artifacts[key], '', flat);
      for (const item of flat) {
        const lower = item.value.toLowerCase();
        if (terms.some((t) => lower.includes(t))) {
          hits.push({ where: `${key}:${item.path}`, snippet: item.value.slice(0, 160) });
          if (hits.length >= (limit || 20)) break;
        }
      }
      if (hits.length >= (limit || 20)) break;
    }
    const result = { hits };
    logs.push({
      seq: ++seq,
      name: 'search_facts',
      argsChars: JSON.stringify({ query, limit }).length,
      resultChars: JSON.stringify(result).length,
      ms: Date.now() - t0,
    });
    return result;
  },
});

/* ─── 只读工具 2：读某份产物的指定片段 ─── */
const readArtifactTool = createTool({
  id: 'read_artifact',
  description:
    `读取某份产物。可选 selector 按字段路径取子片段以节省上下文。` +
    `可用产物：${availableKeys.join(', ')}。`,
  inputSchema: z.object({
    artifact: z.string().describe(`产物键名，可选：${availableKeys.join(' / ')}`),
    selector: z.string().optional().describe('字段路径，如 characters[0] 或 scenes[1].dialogues'),
  }),
  outputSchema: z.object({ ok: z.boolean(), content: z.string() }),
  execute: async ({ artifact, selector }: { artifact: string; selector?: string }) => {
    const t0 = Date.now();
    let node = artifacts[artifact];
    let ok = node !== undefined;
    if (ok && selector) {
      for (const seg of selector.split('.')) {
        const m = seg.match(/^(\w+)((\[\d+\])*)$/);
        if (!m) {
          ok = false;
          break;
        }
        node = node?.[m[1]];
        const idx = seg.match(/\[(\d+)\]/g) || [];
        for (const i of idx) node = node?.[Number(i.replace(/[[\]]/g, ''))];
      }
      if (node === undefined) ok = false;
    }
    const content = ok ? JSON.stringify(node, null, 1).slice(0, 4000) : '';
    const result = { ok, content };
    logs.push({
      seq: ++seq,
      name: 'read_artifact',
      argsChars: JSON.stringify({ artifact, selector }).length,
      resultChars: content.length,
      ms: Date.now() - t0,
    });
    return result;
  },
});

/* ─── 探针 agent ─── */
const agent = new Agent({
  id: 'probe-modify-scout',
  name: 'probe-modify-scout',
  instructions: `你是一名影视项目的「修改影响面分析员」。创作者提出了一条修改诉求，你要判断：这个改动的事实定义在哪份产物的哪个字段、有哪些下游产物引用了它。

工作方式（务必高效）：
1. 先用 search_facts 检索核心概念（如角色名、被改的属性名），一次可并发多个检索；
2. 只在必要时用 read_artifact 读指定字段，不要整份通读；
3. 最多进行 3 轮工具调用，拿到足够证据就停止；
4. 不要修改任何东西，本次是只读分析。

最终用一段 JSON 回答，字段：
{"definition":{"artifact":"...","field":"...","current":"..."},"references":[{"artifact":"...","field":"...","value":"..."}],"verdict":"应改哪个字段、哪些引用会失效","confidence":"high|medium|low"}`,
  model: LLMRegistry.getLanguageModel(),
  tools: { search_facts: searchFactsTool, read_artifact: readArtifactTool },
});

async function main() {
  console.log(`项目: ${PID}`);
  console.log(`可用产物: ${availableKeys.join(', ')}`);
  console.log(`诉求: ${USER_LINE}`);
  console.log('─'.repeat(60));

  const t0 = Date.now();
  const stepTimeline: Array<{ step: number; ms: number; input: number; output: number; tools: number }> = [];
  let lastTs = t0;
  const res: any = await agent.generate(
    [
      { role: 'user', content: `创作者说：${USER_LINE}\n请分析这条修改诉求的影响面。` },
    ] as any,
    {
      maxSteps: 12,
      prepareStep: ({ stepNumber }: any) => ({ toolChoice: stepNumber === 0 ? 'required' : 'auto' }),
      onStepFinish: ({ stepNumber, usage, toolCalls }: any) => {
        const now = Date.now();
        stepTimeline.push({
          step: (stepNumber ?? stepTimeline.length) + 1,
          ms: now - lastTs,
          input: usage?.inputTokens ?? 0,
          output: usage?.outputTokens ?? 0,
          tools: toolCalls?.length ?? 0,
        });
        lastTs = now;
      },
    } as any
  );
  const totalMs = Date.now() - t0;

  console.log('\n=== 工具调用轨迹 ===');
  for (const l of logs) {
    console.log(
      `#${l.seq} ${l.name.padEnd(14)} 参数 ${String(l.argsChars).padStart(4)}B → 返回 ${String(l.resultChars).padStart(5)}B  ${l.ms}ms`
    );
  }
  const batches = new Set(logs.map((l) => l.seq)).size;
  console.log(`\n工具调用总数: ${logs.length}（串行计 ${batches} 次，实际轮次可能更少）`);

  console.log('\n=== 每步耗时与 token ===');
  for (const s of stepTimeline) {
    console.log(
      `step ${String(s.step).padStart(2)}  ${(s.ms / 1000).toFixed(1).padStart(5)}s  in ${String(s.input).padStart(5)}  out ${String(s.output).padStart(4)}  工具 ${s.tools}`
    );
  }
  const sumIn = stepTimeline.reduce((a, s) => a + s.input, 0);
  const sumOut = stepTimeline.reduce((a, s) => a + s.output, 0);
  console.log(`合计 输入 ${sumIn} / 输出 ${sumOut} tokens，${(totalMs / 1000).toFixed(1)}s`);

  console.log('\n=== 耗时 ===');
  console.log(`端到端: ${(totalMs / 1000).toFixed(1)}s`);
  const toolMs = logs.reduce((s, l) => s + l.ms, 0);
  console.log(`工具自身耗时: ${toolMs}ms（占 ${((toolMs / totalMs) * 100).toFixed(2)}%）`);
  console.log(`模型耗时: ${((totalMs - toolMs) / 1000).toFixed(1)}s`);

  console.log('\n=== token ===');
  console.log('usage:', JSON.stringify(res?.usage ?? res?.totalUsage ?? '未返回'));
  console.log('finishReason:', res?.finishReason);

  console.log('\n=== 模型结论 ===');
  console.log((res?.text || '(空)').slice(0, 2400));

  console.log('\n=== 上下文规模 ===');
  const inputChars = logs.reduce((s, l) => s + l.resultChars, 0);
  console.log(`工具返回累计: ${inputChars} 字符（约 ${Math.round(inputChars / 2.2)} tokens，中文按 2.2 字符/token 估）`);

  const steps = res?.steps?.length;
  if (steps) console.log(`\nMastra steps: ${steps}`);
}

main().catch((e) => {
  console.error('探针失败:', e?.message || e);
  process.exit(1);
});
