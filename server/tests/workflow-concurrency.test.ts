/**
 * tests/workflow-concurrency.test.ts
 * 多项目并发工作流、全局算力信号量、AbortSignal 取消与重启自愈专项验证
 */

process.env.NODE_ENV = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { LanguageModelV1CallOptions } from 'ai';
import { createApp } from '../src/api/app.js';
import { LLMProvider, MockLanguageModel } from '../src/llm/index.js';
import { runPlannerWorkflow } from '../src/agents/planner/index.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { TaskStore } from '../src/workflow-engine/TaskStore.js';
import { RunAbortedError, withRunContext } from '../src/workflow-engine/run-context.js';
import { ProductionWorkflowEngine } from '../src/workflows/production.workflow.js';
import { ComfyUIMediaProvider } from '../src/media/index.js';

function delayWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RunAbortedError('模拟测试延迟期间信号已中止'));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new RunAbortedError('模拟测试延迟期间信号已中止'));
    };
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

class DelayedConcurrentMockModel extends MockLanguageModel {
  public activeCount = 0;
  public peakCount = 0;
  public abortedCount = 0;
  private readonly delayMs: number;

  constructor(delayMs: number = 15) {
    super();
    this.delayMs = delayMs;
  }

  public override async doGenerate(options: LanguageModelV1CallOptions) {
    this.activeCount++;
    this.peakCount = Math.max(this.peakCount, this.activeCount);
    try {
      await delayWithSignal(this.delayMs, options.abortSignal);
      return await super.doGenerate(options);
    } catch (err: any) {
      if (err?.name === 'AbortError' || options.abortSignal?.aborted) {
        this.abortedCount++;
      }
      throw err;
    } finally {
      this.activeCount--;
    }
  }
}

test('1. 跨项目并发执行 runPlannerWorkflow 零 #actor/#runId 冲突与独立进度序列', async () => {
  const model = new DelayedConcurrentMockModel(15);
  LLMProvider.setMockModel(model);
  const store = ProjectStore.getInstance();
  const pidA = `test_concurrent_planner_a_${Date.now()}`;
  const pidB = `test_concurrent_planner_b_${Date.now()}`;

  const progressA: number[] = [];
  const progressB: number[] = [];

  try {
    const [outA, outB] = await Promise.all([
      runPlannerWorkflow(
        { projectId: pidA, userPrompt: '深海潜艇悬疑谍战剧本' },
        { onProgress: (pct) => progressA.push(pct) }
      ),
      runPlannerWorkflow(
        { projectId: pidB, userPrompt: '古宅雨夜机关解谜剧本' },
        { onProgress: (pct) => progressB.push(pct) }
      ),
    ]);

    assert.strictEqual(outA.projectId, pidA);
    assert.strictEqual(outB.projectId, pidB);
    assert.ok(outA.clips.length > 0 && outB.clips.length > 0);
    assert.deepStrictEqual(progressA, [15, 35, 55, 75, 92]);
    assert.deepStrictEqual(progressB, [15, 35, 55, 75, 92]);
    assert.ok(store.getArtifact(pidA, 'gdd'), '项目 A 必须独立落盘 gdd');
    assert.ok(store.getArtifact(pidB, 'gdd'), '项目 B 必须独立落盘 gdd');
  } finally {
    LLMProvider.setMockModel(new MockLanguageModel());
    store.deleteProject(pidA);
    store.deleteProject(pidB);
  }
});

test('2. 全局 LLM 批处理信号量池限流 + interactive 快车道零阻塞', async () => {
  const model = new DelayedConcurrentMockModel(60);
  LLMProvider.setMockModel(model);
  const pool = LLMProvider.getBatchPool();
  const prevLimit = pool.limit;
  pool.setLimit(2);

  try {
    const proxied = LLMProvider.getModel();
    const callOptions: LanguageModelV1CallOptions = {
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: [{ role: 'user', content: [{ type: 'text', text: '测试信号量限流' }] }],
    };

    const batchJobs = [1, 2, 3, 4].map((idx) =>
      withRunContext(
        {
          projectId: `proj_batch_${idx}`,
          runId: `run_batch_${idx}`,
          lane: 'batch',
        },
        () => proxied.doGenerate(callOptions)
      )
    );

    // 等待批处理打满 2 个并发槽位，确保后续 interactive 真正跨过了满池阶段
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(pool.active, 2, '批处理信号量应精确占用 2 个槽位');
    assert.strictEqual(pool.pending, 2, '剩余 2 个批处理任务应处于排队中');

    let interactiveDoneBeforeBatch = false;
    const interactivePromise = withRunContext(
      {
        projectId: 'proj_chat',
        runId: 'chat_1',
        lane: 'interactive',
      },
      async () => {
        await proxied.doGenerate(callOptions);
        interactiveDoneBeforeBatch = true;
      }
    );

    await interactivePromise;
    assert.strictEqual(interactiveDoneBeforeBatch, true, '交互快车道必须绕过批处理队列完成');

    await Promise.all(batchJobs);
    // interactive 并发进来 1 个 + batch 最多 2 个，但批处理自身绝不可同时全部放行 4 个
    assert.ok(model.peakCount <= 3, `批处理并发未受限，实测峰值 ${model.peakCount}`);
  } finally {
    pool.setLimit(prevLimit);
    LLMProvider.setMockModel(new MockLanguageModel());
  }
});

test('3. ComfyUI 图像/视频同址共用全局 GPU 槽位池与队列取消机制', async () => {
  const host = `http://127.0.0.1:${19000 + Math.floor(Math.random() * 1000)}`;
  const imageProvider = new ComfyUIMediaProvider(host);
  const videoProvider = new ComfyUIMediaProvider(host);

  let activeGpu = 0;
  let peakGpu = 0;

  for (const p of [imageProvider, videoProvider]) {
    (p as any).uploadImage = async () => 'stub_ref.png';
    (p as any).executeAndPoll = async (_wf: any, _type: string, signal?: AbortSignal) => {
      activeGpu++;
      peakGpu = Math.max(peakGpu, activeGpu);
      try {
        await delayWithSignal(45, signal);
        return 'http://stub.invalid/out.png';
      } finally {
        activeGpu--;
      }
    };
  }

  // 1. 同地址 ImageProvider 与 VideoProvider 并发触发必须受同一 GPU 池串行护航 (maxConcurrency=1)
  await Promise.all([
    imageProvider.generateImage('测试分镜首帧', { mode: 'general_t2i' }),
    videoProvider.generateVideo('测试分镜运镜', { referenceImageUrl: '/media/stub/ref.png' }),
  ]);
  assert.strictEqual(peakGpu, 1, '同 ComfyUI 地址下的图像与视频请求必须共享单 GPU 串行槽位');

  // 2. 排队中的生图请求被 AbortSignal 中止后应立刻放弃排队
  const abortCtrl = new AbortController();
  const holder = imageProvider.generateImage('占用 GPU', { mode: 'general_t2i' });
  const queuedCall = videoProvider.generateVideo('排队中将被取消', {
    referenceImageUrl: '/media/stub/ref.png',
    abortSignal: abortCtrl.signal,
  });

  await new Promise((r) => setTimeout(r, 8));
  abortCtrl.abort();

  await assert.rejects(
    queuedCall,
    (err: any) => err?.name === 'AbortError' || String(err?.message).includes('取消'),
    '排队期间取消必须立即抛出 AbortError'
  );
  await holder;
});

test('4. 跨项目并发 API 流水线 + 同项目 409 互斥 + 运行中取消不覆盖且可立即可重开', async () => {
  const model = new DelayedConcurrentMockModel(35);
  LLMProvider.setMockModel(model);
  const store = ProjectStore.getInstance();
  const taskStore = TaskStore.getInstance();

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;

  const pidA = `test_api_conc_a_${Date.now()}`;
  const pidB = `test_api_conc_b_${Date.now()}`;

  try {
    // 1. 两个不同项目同时发起 Stage 1
    const [resA, resB] = await Promise.all([
      fetch(`${baseUrl}/api/workflow/${pidA}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userPrompt: '深海失压悬疑互动剧本' }),
      }),
      fetch(`${baseUrl}/api/workflow/${pidB}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userPrompt: '雪山列车密室逃脱剧本' }),
      }),
    ]);

    assert.strictEqual(resA.status, 200);
    assert.strictEqual(resB.status, 200);
    const jsonA = (await resA.json()) as any;
    const jsonB = (await resB.json()) as any;
    const runIdA = jsonA.data.runId as string;
    const runIdB = jsonB.data.runId as string;

    // 2. 同项目重复提交返回 HTTP 409
    const dupA = await fetch(`${baseUrl}/api/workflow/${pidA}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userPrompt: '重复提交应被拦截' }),
    });
    assert.strictEqual(dupA.status, 409, '同项目运行中重复 start 必须返回 HTTP 409 Conflict');

    // 3. 取消项目 A 的在途任务
    const cancelRes = await fetch(`${baseUrl}/api/workflow/${pidA}/${runIdA}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: '创作者测试主动取消' }),
    });
    assert.strictEqual(cancelRes.status, 200);
    const cancelJson = (await cancelRes.json()) as any;
    assert.strictEqual(cancelJson.data.status, 'cancelled');

    // 等项目 B 正常跑到 Stage 1 挂起，并确认项目 A 的状态不会被后台异常改写为 failed
    const deadline = Date.now() + 5000;
    let stateB: any;
    while (Date.now() < deadline) {
      const r = await fetch(`${baseUrl}/api/workflow/${pidB}/${runIdB}/state`);
      stateB = (await r.json()) as any;
      if (stateB.data?.status === 'suspended') break;
      await new Promise((r) => setTimeout(r, 30));
    }

    assert.strictEqual(stateB?.data?.status, 'suspended', '项目 B 必须不受项目 A 取消影响，正常到达 suspended');
    assert.strictEqual(stateB?.data?.pendingApproval?.type, 'gdd_approval');
    assert.strictEqual(
      taskStore.getTask(pidA, runIdA)?.status,
      'cancelled',
      '已取消任务终态必须锁定为 cancelled，绝不可被异步 catch 覆写为 failed'
    );

    // 4. 项目 A 取消后立即可重新发起新任务
    const restartA = await fetch(`${baseUrl}/api/workflow/${pidA}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userPrompt: '取消后重新开始的全新剧本' }),
    });
    assert.strictEqual(restartA.status, 200, '取消后项目 A 必须立即解锁并接受新任务');
    const restartJsonA = (await restartA.json()) as any;
    const newRunIdA = restartJsonA.data.runId as string;
    assert.notStrictEqual(newRunIdA, runIdA);

    // 等待重新发起的任务也收敛
    while (Date.now() < deadline) {
      const r = await fetch(`${baseUrl}/api/workflow/${pidA}/${newRunIdA}/state`);
      const s = (await r.json()) as any;
      if (s.data?.status === 'suspended') break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.strictEqual(taskStore.getTask(pidA, newRunIdA)?.status, 'suspended');
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    LLMProvider.setMockModel(new MockLanguageModel());
    store.deleteProject(pidA);
    store.deleteProject(pidB);
  }
});

test('5. 服务重启恢复：清理孤儿 running/queued 并完整保留 suspended 待审任务', () => {
  const store = ProjectStore.getInstance();
  const taskStore = TaskStore.getInstance();
  const pidCrash = `test_recover_crash_${Date.now()}`;
  const pidWait = `test_recover_wait_${Date.now()}`;

  try {
    const tRun = taskStore.createTask(pidCrash, 'production_pipeline', '崩溃残留 running', false);
    taskStore.setStatus(pidCrash, tRun.taskId, 'running');

    const tQueue = taskStore.createTask(pidCrash, 'production_pipeline', '崩溃残留 queued', false);
    taskStore.setStatus(pidCrash, tQueue.taskId, 'queued');

    const tSuspended = taskStore.createTask(pidWait, 'production_pipeline', '正常待审挂起', false);
    taskStore.setStatus(pidWait, tSuspended.taskId, 'suspended', {
      result: { currentStage: 'plan_gdd', pendingApproval: { type: 'gdd_approval' } },
    });

    const recovered = ProductionWorkflowEngine.recoverStaleTasks();
    assert.ok(recovered >= 2, `至少应恢复 2 条孤儿运行态任务，实测 ${recovered}`);

    assert.strictEqual(taskStore.getTask(pidCrash, tRun.taskId)?.status, 'failed');
    assert.strictEqual(taskStore.getTask(pidCrash, tQueue.taskId)?.status, 'failed');
    assert.strictEqual(taskStore.getRunningTask(pidCrash), null, '恢复后项目运行锁必须释放');
    assert.strictEqual(
      taskStore.getTask(pidWait, tSuspended.taskId)?.status,
      'suspended',
      'suspended 待审挂起任务在重启后必须完整保留'
    );
  } finally {
    store.deleteProject(pidCrash);
    store.deleteProject(pidWait);
  }
});
