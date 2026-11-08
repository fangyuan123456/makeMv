/**
 * scripts/bench-agent-modify-v2.ts
 * 只读探针 v2：验证「结构感知检索」能否让 agent 自己找对事实定义处。
 *
 * v1 结论（已实测）：全文检索只索引字符串值，numeric 的 age:35 检索不到，
 * 而派生出来的 visualPrompt 里写着「年轻男子」反而是最高频命中——
 * 检索器把模型系统性推向派生处，于是「太老」被判定为改定妆图，改了等于没改。
 *
 * v2 只改检索，不改模型、不改 prompt 策略：
 *   1. 系统提示里常驻字段骨架（路径 + 类型 + 样例值），模型不用先盲搜也知道有什么字段；
 *   2. search_facts 同时匹配「字段路径」与「值（含数字）」；
 *   3. read_artifact 失败返回可自纠的错误信息（可用键、可用路径）。
 *
 * 用法：npx tsx scripts/bench-agent-modify-v2.ts <projectId> "<诉求>" [expectedArtifact] [expectedField]
 */
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { createTool } from '../src/mastra-compat/index.js';
import { LLMRegistry } from '../src/llm/LLMRegistry.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';

const PID = process.argv[2] || 'proj_1794101350967_b9al';
const USER_LINE = process.argv[3] || '男一太老了吧';
const EXPECT_ARTIFACT = process.argv[4];
const EXPECT_FIELD = process.argv[5];

const store = ProjectStore.getInstance();
const project = store.getProject(PID);
if (!project) {
  console.error(`项目不存在: ${PID}`);
  process.exit(1);
}
const artifacts: Record<string, any> = (project as any).stageArtifacts || {};
const availableKeys = Object.keys(artifacts).filter((k) => artifacts[k] && !k.startsWith('critic_review'));

/* ─── 字段骨架：告诉模型「有什么字段、什么类型、长什么样」 ─── */
interface FieldNode {
  path: string;
  type: string;
  sample?: string;
}

function typeOf(v: any): string {
  if (Array.isArray(v)) return `array(${v.length})`;
  if (v === null) return 'null';
  return typeof v;
}

function sampleOf(v: any): string | undefined {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return v.length > 48 ? `${v.slice(0, 48)}…` : v;
  return undefined;
}

function describe(node: any, prefix: string, out: FieldNode[], depth: number) {
  if (node == null) return;
  if (Array.isArray(node)) {
    if (node.length === 0) return;
    // 数组只描述第一个元素的字段（结构通常同构）
    const first = node[0];
    if (first && typeof first === 'object') {
      for (const k of Object.keys(first)) {
        const p = `${prefix}[].${k}`;
        const v = first[k];
        const s = sampleOf(v);
        out.push({ path: p, type: typeOf(v), ...(s ? { sample: s } : {}) });
        if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) {
          for (const k2 of Object.keys(v)) {
            const v2 = v[k2];
            const s2 = sampleOf(v2);
            out.push({ path: `${p}.${k2}`, type: typeOf(v2), ...(s2 ? { sample: s2 } : {}) });
          }
        }
      }
    } else {
      const s = sampleOf(first);
      out.push({ path: `${prefix}[]`, type: typeOf(first), ...(s ? { sample: s } : {}) });
    }
    return;
  }
  if (typeof node === 'object') {
    for (const k of Object.keys(node)) {
      const v = node[k];
      const p = prefix ? `${prefix}.${k}` : k;
      const s = sampleOf(v);
      out.push({ path: p, type: typeOf(v), ...(s ? { sample: s } : {}) });
      if (v && typeof v === 'object' && depth < 2) describe(v, p, out, depth + 1);
    }
  }
}

const skeletons: Record<string, FieldNode[]> = {};
for (const key of availableKeys) {
  const out: FieldNode[] = [];
  describe(artifacts[key], '', out, 0);
  // 只保留可读前缀，避免 storyGraph 之类的深层噪音撑爆上下文
  skeletons[key] = out.filter((f) => f.path.split('.').length <= 3).slice(0, 40);
}

function skeletonText(): string {
  return availableKeys
    .map((key) => {
      const lines = skeletons[key]
        .map((f) => `  - ${f.path}: ${f.type}${f.sample ? `  例: ${f.sample}` : ''}`)
        .join('\n');
      return `【${key}】\n${lines}`;
    })
    .join('\n');
}

/* ─── 打点 ─── */
const logs: Array<{ seq: number; name: string; detail: string; resultChars: number }> = [];
let seq = 0;

function flatten(node: any, path: string, out: Array<{ path: string; value: string; type: string }>) {
  if (node == null) return;
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    out.push({ path: path || '(root)', value: String(node), type: typeof node });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => flatten(v, `${path}[${i}]`, out));
    return;
  }
  if (typeof node === 'object') {
    for (const k of Object.keys(node)) flatten(node[k], path ? `${path}.${k}` : k, out);
  }
}

/* ─── 工具 1：结构感知检索（路径 + 值都匹配，数字也能搜） ─── */
const searchFactsTool = createTool({
  id: 'search_facts',
  description:
    '检索概念出现在哪个产物的哪个字段。同时匹配「字段路径」与「字段值」，数字字段（如 age）也能命中。' +
    '例如查「年龄」会命中 age 字段本身；查「35」会命中值为 35 的字段。',
  inputSchema: z.object({
    query: z.string().describe('关键词，可用空格分隔多个词，任一命中即返回'),
    limit: z.number().optional().describe('最多返回条数，默认 24'),
  }),
  outputSchema: z.object({
    hits: z.array(z.object({ where: z.string(), type: z.string(), value: z.string() })),
    note: z.string().optional(),
  }),
  execute: async ({ query, limit }: { query: string; limit?: number }) => {
    const terms = String(query || '')
      .toLowerCase()
      .split(/[\s,，、/|]+/)
      .filter((t) => t.length >= 1);
    const hits: Array<{ where: string; type: string; value: string }> = [];
    for (const key of availableKeys) {
      const flat: Array<{ path: string; value: string; type: string }> = [];
      flatten(artifacts[key], '', flat);
      for (const item of flat) {
        const haystack = `${item.path} ${item.value}`.toLowerCase();
        if (terms.some((t) => haystack.includes(t))) {
          hits.push({
            where: `${key}:${item.path}`,
            type: item.type,
            value: item.value.length > 120 ? `${item.value.slice(0, 120)}…` : item.value,
          });
          if (hits.length >= (limit || 24)) break;
        }
      }
      if (hits.length >= (limit || 24)) break;
    }
    const result = {
      hits,
      note: hits.length === 0 ? '没有命中。可换用字段名（如 age/appearance/visualPrompt）或直接读产物。' : undefined,
    };
    logs.push({ seq: ++seq, name: 'search_facts', detail: `"${query}" → ${hits.length} 条`, resultChars: JSON.stringify(result).length });
    return result;
  },
});

/* ─── 工具 2：读产物，失败时给可自纠的提示 ─── */
const readArtifactTool = createTool({
  id: 'read_artifact',
  description: `读取某份产物，可用 selector 按字段路径取子片段（如 characters[0]、characters）。可用产物：${availableKeys.join(', ')}。`,
  inputSchema: z.object({
    artifact: z.string().describe(`产物键名，必须是：${availableKeys.join(' / ')}`),
    selector: z.string().optional().describe('字段路径，如 characters[0] 或 characters'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    content: z.string(),
    error: z.string().optional(),
    availablePaths: z.array(z.string()).optional(),
  }),
  execute: async ({ artifact, selector }: { artifact: string; selector?: string }) => {
    const key = availableKeys.find((k) => k === artifact) || availableKeys.find((k) => k.includes(artifact));
    if (!key) {
      const result = {
        ok: false,
        content: '',
        error: `产物键 [${artifact}] 不存在`,
        availablePaths: availableKeys,
      };
      logs.push({ seq: ++seq, name: 'read_artifact', detail: `✗ ${artifact}`, resultChars: 80 });
      return result;
    }
    let node = artifacts[key];
    if (selector) {
      for (const seg of selector.split('.')) {
        if (node == null) break;
        const m = seg.match(/^(\w+)((\[\d+\])*)$/);
        if (!m) {
          node = undefined;
          break;
        }
        node = node[m[1]];
        for (const idx of seg.match(/\[(\d+)\]/g) || []) {
          node = node?.[Number(idx.replace(/[[\]]/g, ''))];
        }
      }
    }
    if (node === undefined) {
      const paths = (skeletons[key] || []).map((f) => f.path).slice(0, 24);
      const result = {
        ok: false,
        content: '',
        error: `字段路径 [${selector}] 在 ${key} 中不存在`,
        availablePaths: paths,
      };
      logs.push({ seq: ++seq, name: 'read_artifact', detail: `✗ ${key}:${selector}`, resultChars: 120 });
      return result;
    }
    const content = JSON.stringify(node, null, 1).slice(0, 4000);
    logs.push({ seq: ++seq, name: 'read_artifact', detail: `✓ ${key}:${selector || '(root)'}`, resultChars: content.length });
    return { ok: true, content };
  },
});

/* ─── 探针 agent（系统提示常驻字段骨架） ─── */
const agent = new Agent({
  id: 'probe-modify-scout-v2',
  name: 'probe-modify-scout-v2',
  instructions: `你是一名影视项目的「修改影响面分析员」。创作者提出一条修改诉求，你要判断：这个事实定义在哪份产物的哪个字段，哪些下游产物是它的派生。

【本项目已落盘产物的字段骨架】
${skeletonText()}

【判断原则】
1. 「事实」是设定本身（年龄 35、性别、身份、性格、动机、外貌文字）；「派生」是由事实生成的产物（定妆 visualPrompt、图片、分镜、视频）。事实只存在于上游文本产物，派生随事实变化。
2. 一条诉求要落到「事实定义处」：改年龄/设定 → 事实字段；只改这一次的画面表现（构图、光影、这张图重画）→ 派生字段。
3. 若事实与派生都提到同一件事，必须指事实字段，并说明哪些派生会因此失效。
4. 只用 search_facts / read_artifact 取证，不要凭空推断字段名，也不要修改任何东西。
5. 最多 4 轮工具调用。

最终只输出一段 JSON（不要额外解释）：
{"definition":{"artifact":"...","field":"...","current":"当前值"},"derivedBy":[{"artifact":"...","field":"...","why":"为何是派生"}],"verdict":"一句话","confidence":"high|medium|low"}`,
  model: LLMRegistry.getLanguageModel(),
  tools: { search_facts: searchFactsTool, read_artifact: readArtifactTool },
});

async function main() {
  console.log(`项目: ${PID}`);
  console.log(`可用产物: ${availableKeys.join(', ')}`);
  console.log(`诉求: ${USER_LINE}`);
  console.log(`期望: ${EXPECT_ARTIFACT || '(未指定)'} / ${EXPECT_FIELD || '(未指定)'}`);
  console.log(`骨架规模: ${JSON.stringify(Object.fromEntries(availableKeys.map((k) => [k, skeletons[k].length])))} `);
  console.log('─'.repeat(64));

  const t0 = Date.now();
  const stepTimeline: Array<{ step: number; ms: number; input: number; output: number; tools: number }> = [];
  let lastTs = t0;
  const res: any = await agent.generate(
    [{ role: 'user', content: `创作者说：${USER_LINE}\n请分析这条修改诉求的事实定义处与派生引用。` }] as any,
    {
      maxSteps: 10,
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
  const text = String(res?.text || '');

  console.log('\n=== 工具调用轨迹 ===');
  for (const l of logs) console.log(`#${l.seq} ${l.name.padEnd(13)} ${l.detail}`);
  console.log(`工具调用总数: ${logs.length}`);

  console.log('\n=== 每步耗时与 token ===');
  for (const s of stepTimeline) {
    console.log(`step ${String(s.step).padStart(2)}  ${(s.ms / 1000).toFixed(1).padStart(5)}s  in ${String(s.input).padStart(5)}  out ${String(s.output).padStart(4)}  工具 ${s.tools}`);
  }
  const sumIn = stepTimeline.reduce((a, s) => a + s.input, 0);
  const sumOut = stepTimeline.reduce((a, s) => a + s.output, 0);
  console.log(`合计 输入 ${sumIn} / 输出 ${sumOut} tokens，端到端 ${(totalMs / 1000).toFixed(1)}s`);

  console.log('\n=== 模型结论 ===');
  console.log(text.slice(0, 1600));

  if (EXPECT_ARTIFACT && EXPECT_FIELD) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let verdict = 'FAIL(无 JSON)';
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        const art = String(parsed?.definition?.artifact || '');
        const field = String(parsed?.definition?.field || '');
        // characters[].age 与 characters[0].age 视为同一字段
        const norm = (s: string) => s.replace(/\[\d*\]/g, '[]');
        const artOk = art.includes(EXPECT_ARTIFACT) || norm(art).includes(EXPECT_ARTIFACT);
        const fieldOk = norm(field).includes(norm(EXPECT_FIELD));
        verdict = artOk && fieldOk ? 'PASS' : `FAIL(实际 ${art} / ${field})`;
      } catch {
        verdict = 'FAIL(JSON 解析失败)';
      }
    }
    console.log(`\n=== 判定 ===\n${verdict}`);
  }
}

main().catch((e) => {
  console.error('探针失败:', e?.message || e);
  process.exit(1);
});
