/**
 * 验证：batch 池排队时长不应计入单次 LLM 调用的超时预算。
 *
 * 场景：并发上限 1，每次调用耗时 600ms，单次超时设为 800ms。
 * - 正确行为：排队不消耗预算 → 3 次调用全部成功（总墙钟约 1800ms）。
 * - 旧行为：计时从入队开始 → 第 2 次在排队时就被判定超时、第 3 次直接排队失败。
 */
import { config } from '../src/utils/config.js';
import { LLMProvider } from '../src/llm/provider.js';
import { withRunContext } from '../src/workflow-engine/run-context.js';

const CALL_COST_MS = 600;
const TIMEOUT_MS = 800;
const CONCURRENCY = 1;
const CALLS = 3;

config.llm.timeoutMs = TIMEOUT_MS;
LLMProvider.getBatchPool().setLimit(CONCURRENCY);

let abortedCount = 0;

const fakeModel: any = {
  specificationVersion: 'v1',
  provider: 'fake-provider',
  modelId: 'fake-model',
  defaultObjectGenerationMode: 'json',
  async doGenerate(options: any) {
    const startedAt = Date.now();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, CALL_COST_MS);
      options?.abortSignal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          abortedCount++;
          reject(new Error(`aborted(${Date.now() - startedAt}ms): ${options.abortSignal.reason?.message ?? ''}`));
        },
        { once: true }
      );
    });
    return {
      text: '{"ok":true}',
      finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 1 },
      rawCall: { rawPrompt: null, rawSettings: {} },
      durationMs: Date.now() - startedAt,
    };
  },
};

LLMProvider.setMockModel(fakeModel);
const model = LLMProvider.getModel();

async function main() {
  console.log(
    `[Diag] concurrency=${CONCURRENCY} callCost=${CALL_COST_MS}ms timeout=${TIMEOUT_MS}ms calls=${CALLS}`
  );
  const startedAt = Date.now();

  const results = await withRunContext({ projectId: 'diag', runId: 'diag', lane: 'batch' }, () =>
    Promise.all(
      Array.from({ length: CALLS }, (_, i) =>
        model
          .doGenerate({ mode: { type: 'object-json' }, prompt: [] } as any)
          .then(() => ({ i, ok: true as const, err: '' }))
          .catch((e: any) => ({ i, ok: false as const, err: e?.message ?? String(e) }))
      )
    )
  );

  const wall = Date.now() - startedAt;
  for (const r of results) {
    console.log(`  · 调用#${r.i}: ${r.ok ? '成功' : `失败 - ${r.err}`}`);
  }
  const okCount = results.filter((r) => r.ok).length;
  console.log(`[Diag] 成功 ${okCount}/${CALLS}，墙钟 ${wall}ms，被超时中止 ${abortedCount} 次`);
  console.log(
    okCount === CALLS
      ? '[Diag] ✅ 通过：排队未占用单次调用超时预算'
      : '[Diag] ❌ 失败：排队仍被计入超时预算'
  );
  process.exit(okCount === CALLS ? 0 : 1);
}

void main();
