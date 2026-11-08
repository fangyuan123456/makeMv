/**
 * tests/mastra/RecomputeExecutor.test.ts
 * 增量重算执行层回归套件
 *
 * 锁住的口径：
 *   1. 未人工确认 / dry-run / 空清单 → 一次渲染都不能触发（runner 调用数 0）；
 *   2. W1 首帧图 → W2 视频 串行，W1 失败绝不跑 W2；
 *   3. 勾选粒度是镜头，首帧图与视频同进同出，不会留下画面对不上的中间态；
 *   4. 数据判不准时 decideRecompute 必须回退，绝不给出「看起来精确」的清单；
 *   5. 全部真执行路径都用注入的假 runner 覆盖，测试不花一分钱、不写产物。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecomputePlan } from '../../src/agents/director/lineage/recompute-plan.js';
import {
  computeKeyframeFingerprint,
  computeClipFingerprint,
} from '../../src/agents/director/lineage/fingerprint.js';
import {
  buildRecomputeWaves,
  decideRecompute,
  runIncrementalRecompute,
  createIncrementalRecomputeExecutor,
  type SubWorkflowRunner,
} from '../../src/agents/director/lineage/recompute-executor.js';
import { dispatchHttpRequest } from '../../src/api/app.js';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { MemoryProjectStateStore } from '../../src/project-store/MemoryProjectStateStore.js';

const BIBLE = {
  characters: [
    { name: '李明', characterId: 'c1', gender: '男', age: 38, appearance: '短发' },
  ],
  storyGraph: {
    nodes: [{ nodeId: 'node_1', title: '灾难降临', characterNames: ['李明'] }],
  },
};

const SHOTS = [
  { shotId: 'shot_1', nodeId: 'node_1', shotNumber: 1, shotScale: '中景', durationSec: 3, characterIds: ['c1'] },
  { shotId: 'shot_2', nodeId: 'node_1', shotNumber: 2, shotScale: '特写', durationSec: 4, characterIds: ['c1'] },
];

interface FixtureOptions {
  staleAll?: boolean;
  unknownAll?: boolean;
  withoutMedia?: boolean;
}

function project(opts: FixtureOptions = {}): Record<string, any> {
  const kfs = SHOTS.map((s) => ({
    shotId: s.shotId,
    prompt: `P_${s.shotId}`,
    imageUrl: `${s.shotId}.png`,
    status: 'rendered',
    inputFingerprint: opts.unknownAll
      ? undefined
      : opts.staleAll
        ? 'OLD_KEYFRAME'
        : computeKeyframeFingerprint(BIBLE, s),
  }));
  const clips = SHOTS.map((s) => ({
    clipId: `clip_${s.shotId}`,
    shotId: s.shotId,
    durationSec: s.durationSec,
    status: 'rendered',
    videoUrl: `${s.shotId}.mp4`,
    inputFingerprint: opts.unknownAll
      ? undefined
      : opts.staleAll
        ? 'OLD_CLIP'
        : computeClipFingerprint(BIBLE, s, kfs.find((k) => k.shotId === s.shotId)),
  }));
  const artifacts: Record<string, any> = {
    narrative_design: JSON.parse(JSON.stringify(BIBLE)),
    storyboard: { shots: JSON.parse(JSON.stringify(SHOTS)) },
  };
  if (!opts.withoutMedia) {
    artifacts.keyframe_reference = { shots: kfs };
    artifacts.video_production = { clips };
  }
  return artifacts;
}

/** 记录调用顺序与参数的假渲染器，绝不碰真实渲染入口 */
function fakeRunner(into: Array<{ kind: string; shotIds: string[] }>): SubWorkflowRunner {
  return async (kind, ctx) => {
    into.push({ kind, shotIds: [...(ctx?.payload?.targetShotIds || [])] });
    return { success: true };
  };
}

describe('RecomputeExecutor - 波次编排', () => {
  it('清单按波次拆成两个镜头集合，传递依赖已在清单里闭合', () => {
    const plan = buildRecomputePlan(project({ staleAll: true }));
    const waves = buildRecomputeWaves(plan);
    assert.deepEqual(waves.shotIds.sort(), ['shot_1', 'shot_2']);
    assert.deepEqual(waves.wave1ShotIds, ['shot_1', 'shot_2']);
    assert.ok(waves.wave2ShotIds.includes('shot_1'), '首帧图重做时视频必须跟进');
    assert.ok(waves.wave2ShotIds.includes('shot_2'));
  });

  it('勾选粒度是镜头：选一个镜头时它的图与视频同进同出', () => {
    const plan = buildRecomputePlan(project({ staleAll: true }));
    const waves = buildRecomputeWaves(plan, ['shot_1']);
    assert.ok(waves.wave1ShotIds.includes('shot_1'));
    assert.ok(waves.wave2ShotIds.includes('shot_1'));
    assert.ok(!waves.wave1ShotIds.includes('shot_2'));
    assert.ok(!waves.wave2ShotIds.includes('shot_2'));
  });

  it('传入清单外的镜头只记录、不扩大执行面', () => {
    const plan = buildRecomputePlan(project({ staleAll: true }));
    const waves = buildRecomputeWaves(plan, ['shot_1', 'shot_999']);
    assert.deepEqual(waves.skippedShotIds, ['shot_999']);
    assert.ok(!waves.wave1ShotIds.includes('shot_999'));
  });
});

describe('RecomputeExecutor - 花钱门禁', () => {
  const plan = buildRecomputePlan(project({ staleAll: true }));
  const waves = buildRecomputeWaves(plan);

  it('未人工确认：即使显式 dryRun:false 也不触发渲染', async () => {
    const calls: Array<{ kind: string; shotIds: string[] }> = [];
    const result = await runIncrementalRecompute({
      projectId: 'proj_test',
      plan,
      waves,
      confirmed: false,
      dryRun: false,
      runner: fakeRunner(calls),
    });
    assert.equal(result.executed, false);
    assert.equal(result.dryRun, true);
    assert.equal(calls.length, 0, '没确认就一个渲染器都不能调');
  });

  it('默认 dryRun：确认了也只回计划，不触发渲染', async () => {
    const calls: Array<{ kind: string; shotIds: string[] }> = [];
    const result = await runIncrementalRecompute({
      projectId: 'proj_test',
      plan,
      waves,
      confirmed: true,
      runner: fakeRunner(calls),
    });
    assert.equal(result.executed, false);
    assert.equal(calls.length, 0);
    assert.ok(result.summary.includes('dry-run'));
  });

  it('确认且非空清单：W1 → W2 串行，targetShotIds 精确下发', async () => {
    const calls: Array<{ kind: string; shotIds: string[] }> = [];
    const result = await runIncrementalRecompute({
      projectId: 'proj_test',
      sessionId: 'sess_test',
      plan,
      waves,
      confirmed: true,
      dryRun: false,
      runner: fakeRunner(calls),
    });
    assert.equal(result.executed, true);
    assert.deepEqual(calls.map((c) => c.kind), ['keyframe', 'video']);
    assert.deepEqual(calls[0].shotIds, waves.wave1ShotIds);
    assert.deepEqual(calls[1].shotIds, waves.wave2ShotIds);
  });

  it('W1 失败：W2 绝不执行，避免拿旧首帧图渲出一批废片', async () => {
    const calls: Array<{ kind: string; shotIds: string[] }> = [];
    const result = await runIncrementalRecompute({
      projectId: 'proj_test',
      plan,
      waves,
      confirmed: true,
      dryRun: false,
      runner: async (kind, ctx) => {
        calls.push({ kind, shotIds: [...(ctx?.payload?.targetShotIds || [])] });
        if (kind === 'keyframe') throw new Error('渲染服务不可用');
        return { success: true };
      },
    });
    assert.equal(result.executed, false);
    assert.deepEqual(calls.map((c) => c.kind), ['keyframe']);
    assert.ok(result.summary.includes('中断'));
    assert.ok(result.warnings.some((w) => w.includes('渲染服务不可用')));
  });

  it('空清单即使确认也 no-op', async () => {
    const emptyPlan = buildRecomputePlan(project());
    const calls: Array<{ kind: string; shotIds: string[] }> = [];
    const result = await runIncrementalRecompute({
      projectId: 'proj_test',
      plan: emptyPlan,
      waves: buildRecomputeWaves(emptyPlan),
      confirmed: true,
      dryRun: false,
      runner: fakeRunner(calls),
    });
    assert.equal(result.executed, false);
    assert.equal(calls.length, 0);
  });
});

describe('RecomputeExecutor - 注册执行体的双门禁', () => {
  const plan = buildRecomputePlan(project({ staleAll: true }));

  it('approve 没带 confirmed：只回 dry-run，不触发渲染', async () => {
    const calls: Array<{ kind: string; shotIds: string[] }> = [];
    const execute = createIncrementalRecomputeExecutor(fakeRunner(calls));
    const out = await execute({
      inputData: { projectId: 'proj_test', payload: { recomputePlan: plan } },
    });
    assert.equal(out.toolResult.executed, false);
    assert.equal(calls.length, 0);
  });

  it('approve 带 confirmed 才真执行，且只下发清单内的镜头', async () => {
    const calls: Array<{ kind: string; shotIds: string[] }> = [];
    const execute = createIncrementalRecomputeExecutor(fakeRunner(calls));
    const out = await execute({
      inputData: {
        projectId: 'proj_test',
        payload: { recomputePlan: plan },
        overrideParams: { confirmed: true },
      },
    });
    assert.equal(out.toolResult.executed, true);
    assert.deepEqual(calls.map((c) => c.kind), ['keyframe', 'video']);
    assert.ok(out.lastSummary.includes('增量重算完成'));
  });

  it('审批卡没带清单：安全 no-op', async () => {
    const calls: Array<{ kind: string; shotIds: string[] }> = [];
    const execute = createIncrementalRecomputeExecutor(fakeRunner(calls));
    const out = await execute({
      inputData: { projectId: 'proj_test', payload: {}, overrideParams: { confirmed: true } },
    });
    assert.equal(out.toolResult.executed, false);
    assert.equal(calls.length, 0);
    assert.ok(out.lastSummary.includes('未执行任何渲染'));
  });
});

describe('RecomputeExecutor - 精确 / 回退决策', () => {
  it('尚无媒体资产：回退，沿用原有工序推进', () => {
    const d = decideRecompute(project({ withoutMedia: true }), '把李明改成女性');
    assert.equal(d.mode, 'fallback');
    if (d.mode === 'fallback') assert.ok(d.reason.includes('尚无'));
  });

  it('同句还有下游追加诉求：回退，清单会立刻过期', () => {
    const d = decideRecompute(project({ staleAll: true }), '把李明改成女性', {
      hasFollowUpAsks: true,
    });
    assert.equal(d.mode, 'fallback');
    if (d.mode === 'fallback') assert.ok(d.reason.includes('追加诉求'));
  });

  it('识别不到改动对象：回退，不猜影响面', () => {
    const d = decideRecompute(project({ staleAll: true }), '随便看看');
    assert.equal(d.mode, 'fallback');
    if (d.mode === 'fallback') assert.ok(d.reason.includes('识别不到'));
  });

  it('老数据无历史指纹：回退，宁可全量重渲也不静默漏渲', () => {
    const d = decideRecompute(project({ unknownAll: true }), '把李明改成女性');
    assert.equal(d.mode, 'fallback');
    if (d.mode === 'fallback') assert.ok(d.reason.includes('无历史指纹'));
  });

  it('已有媒体资产却算出空清单：回退，排除影响面算漏', () => {
    // 所有资产指纹都与当前上游一致，改的角色没造成任何陈旧 → 无法排除算漏
    const d = decideRecompute(project(), '把李明改成女性');
    assert.equal(d.mode, 'fallback');
    if (d.mode === 'fallback') assert.ok(d.reason.includes('清单为空'));
  });

  it('指纹齐全且本次改动确实让资产陈旧：走精确模式', () => {
    const d = decideRecompute(project({ staleAll: true }), '把李明改成女性');
    assert.equal(d.mode, 'precise');
    if (d.mode === 'precise') {
      assert.ok(d.plan.items.length > 0);
      assert.ok(d.targets.includes('李明'));
      assert.ok(d.waves.wave1ShotIds.length > 0);
      assert.ok(d.waves.wave2ShotIds.length > 0, '首帧图重做时视频必须跟进');
    }
  });
});

/* ── 只读端点：走完整 HTTP 路由分发，验证不会被前面的 handler 吞掉 ── */

function mockRes(): any {
  const out: any = { statusCode: 0, body: '', headers: {} };
  return {
    setHeader(k: string, v: string) {
      out.headers[k] = v;
    },
    writeHead(code: number, h?: Record<string, string>) {
      out.statusCode = code;
      Object.assign(out.headers, h || {});
    },
    end(chunk?: string) {
      out.body = chunk || '';
    },
    _out: out,
  };
}

describe('GET /api/projects/:id/recompute-plan - 只读 dry-run 端点', () => {
  it('路由可达、返回清单、不改产物、不触发渲染', async () => {
    const original = ProjectStore.getInstance();
    const mem = new MemoryProjectStateStore();
    ProjectStore.setInstance(mem);
    try {
      const artifacts = project({ staleAll: true });
      mem.saveProject({
        projectId: 'proj_route_test',
        stageArtifacts: artifacts,
      } as any);

      const req: any = {
        method: 'GET',
        url: '/api/projects/proj_route_test/recompute-plan',
        headers: { host: 'localhost' },
      };
      const res = mockRes();
      await dispatchHttpRequest(req, res);

      assert.equal(res._out.statusCode, 200, '必须落到 projects 路由而不是被前面的 handler 吞掉');
      const body = JSON.parse(res._out.body);
      assert.equal(body.success, true);
      assert.ok(body.formatted.includes('重算清单（dry-run · 未执行）'));
      assert.ok(body.plan.items.length > 0);
      assert.ok(body.notice.includes('不触发任何渲染'));
      assert.equal(body.decision, undefined, '不传 instruction 时不附带决策');
      assert.deepEqual(
        mem.getProject('proj_route_test')!.stageArtifacts,
        artifacts,
        'GET 端点绝不能改产物'
      );
    } finally {
      ProjectStore.setInstance(original);
    }
  });

  it('带 instruction 时附带精确/回退决策，且项目不存在返回 404', async () => {
    const original = ProjectStore.getInstance();
    const mem = new MemoryProjectStateStore();
    ProjectStore.setInstance(mem);
    try {
      mem.saveProject({
        projectId: 'proj_route_test',
        stageArtifacts: project({ staleAll: true }),
      } as any);

      const res = mockRes();
      await dispatchHttpRequest(
        {
          method: 'GET',
          url: '/api/projects/proj_route_test/recompute-plan?instruction=' + encodeURIComponent('把李明改成女性'),
          headers: { host: 'localhost' },
        } as any,
        res
      );
      assert.equal(res._out.statusCode, 200);
      const body = JSON.parse(res._out.body);
      assert.equal(body.decision.mode, 'precise');

      const missing = mockRes();
      await dispatchHttpRequest(
        {
          method: 'GET',
          url: '/api/projects/proj_not_exist/recompute-plan',
          headers: { host: 'localhost' },
        } as any,
        missing
      );
      assert.equal(missing._out.statusCode, 404);
    } finally {
      ProjectStore.setInstance(original);
    }
  });
});

describe('注册接线', () => {
  it('incremental-recompute 已注册：需人工确认、不挂阶段推进钩子', async () => {
    const { Workflow } = await import('../../src/workflow-engine/index.js');
    const registrations = (Workflow.getInstance() as any).registrations as Map<string, any>;
    const reg = registrations.get('incremental-recompute');
    assert.ok(reg, '重算工作流没注册的话，审批卡 approve 会直接 500');
    assert.equal(reg.requireConfirmation, true);
    assert.equal(typeof reg.execute, 'function');
    assert.equal(reg.onSuccess, undefined, '挂了 onSuccess 就会误推进阶段、误提下一工序');
    assert.equal(reg.validateGate, undefined, '重算不该被质检门禁拦');
  });
});

describe('注册接线', () => {
  it('incremental-recompute 已注册：需人工确认、不挂阶段推进钩子', async () => {
    const { Workflow } = await import('../../src/workflow-engine/index.js');
    const registrations = (Workflow.getInstance() as any).registrations as Map<string, any>;
    const reg = registrations.get('incremental-recompute');
    assert.ok(reg, '重算工作流没注册的话，审批卡 approve 会直接 500');
    assert.equal(reg.requireConfirmation, true);
    assert.equal(typeof reg.execute, 'function');
    assert.equal(reg.onSuccess, undefined, '挂了 onSuccess 就会误推进阶段、误提下一工序');
    assert.equal(reg.validateGate, undefined, '重算不该被质检门禁拦');
  });
});
