/**
 * scripts/diag-workflow-watch.ts
 * 验证「工序级增量落盘」赖以成立的前提：
 * 1. workflow.watch 的回调里能读到 state.context.steps[stepId].status / .output；
 * 2. 后续工序失败时，先前已完成工序的完成状态**已经**通过 watch 暴露出来（不会被整批吞掉）。
 */
import { Workflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';

const step1 = createStep({
  id: 'demo-step-1',
  inputSchema: z.object({}),
  outputSchema: z.object({ value: z.number() }),
  execute: async () => ({ value: 42 }),
});

const step2 = createStep({
  id: 'demo-step-2',
  inputSchema: z.object({ value: z.number() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async () => {
    throw new Error('模拟第二步失败（例如模型超时）');
  },
});

async function main() {
  const workflow = new Workflow({
    name: 'diag-watch-workflow',
    triggerSchema: z.object({}),
  })
    .step(step1)
    .then(step2)
    .commit();

  const run = workflow.createRun();
  const seen: Array<{ id: string; hasOutput: boolean }> = [];

  const stop = workflow.watch((state: any) => {
    if (state?.runId && state.runId !== run.runId) return;
    const steps: Record<string, any> = state?.context?.steps || {};
    for (const [id, v] of Object.entries(steps)) {
      if (v?.status === 'success' && !seen.some((s) => s.id === id)) {
        seen.push({ id, hasOutput: v.output !== undefined });
      }
    }
  });

  try {
    await run.start({ triggerData: {} });
    console.log('[Diag] run.start 正常返回（未抛错）');
  } catch (err: any) {
    console.log(`[Diag] run.start 抛出错误: ${err?.message || err}`);
  } finally {
    stop();
  }

  console.log('[Diag] watch 观察到的已完成工序:', JSON.stringify(seen));
  const ok = seen.some((s) => s.id === 'demo-step-1' && s.hasOutput);
  console.log(
    ok
      ? '[Diag] ✅ 通过：失败前已完成工序的产出可通过 watch 拿到，增量落盘可行'
      : '[Diag] ❌ 失败：watch 拿不到已完成工序的产出'
  );
  process.exit(ok ? 0 : 1);
}

void main();
