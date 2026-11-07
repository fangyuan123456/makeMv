import assert from 'assert';
import { mergeTaskSnapshot } from '../../client/src/lib/taskSnapshot.js';

const base = (over: any = {}) => ({
  taskId: 't1',
  projectId: 'p1',
  intent: 'generate',
  title: '生成叙事架构',
  status: 'running',
  stages: ['narrative_design'],
  approval: { required: true },
  artifacts: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const progress = (percent: number) => ({ current: percent, total: 100, percent, note: `step ${percent}` });

// 1. 迟到的轮询响应不能把已结算任务拉回执行中
{
  const current = { t1: base({ status: 'succeeded', artifacts: [{ stage: 'narrative_design', url: '/a.json' }], finishedAt: 'x' }) };
  const incoming = [base({ status: 'running', progress: progress(60) })];
  const merged = mergeTaskSnapshot(current, incoming);
  assert.equal(merged, current, '内容未变时应复用原引用');
  assert.equal(merged.t1.status, 'succeeded', '终态不可回退');
  assert.equal(merged.t1.artifacts.length, 1, '产物不可被清空');
}

// 2. 进度不回退
{
  const current = { t1: base({ status: 'running', progress: progress(70) }) };
  const incoming = [base({ status: 'running', progress: progress(30) })];
  const merged = mergeTaskSnapshot(current, incoming);
  assert.equal(merged, current);
  assert.equal(merged.t1.progress!.percent, 70, '进度不得倒退');
}

// 3. 正常推进要生效，且状态推进优先于进度保护
{
  const current = { t1: base({ status: 'running', progress: progress(70) }) };
  const incoming = [base({ status: 'running', progress: progress(80) })];
  incoming[0].status = 'running';
  const merged = mergeTaskSnapshot(current, incoming);
  assert.notEqual(merged, current);
  assert.equal(merged.t1.progress!.percent, 80);

  const toDone = mergeTaskSnapshot(merged, [
    base({ status: 'succeeded', progress: progress(100), resultSummary: 'ok', finishedAt: 'y' }),
  ]);
  assert.equal(toDone.t1.status, 'succeeded');
  assert.equal(toDone.t1.resultSummary, 'ok');
}

// 4. 失败重试的复位（running -> queued）必须允许
{
  const current = { t1: base({ status: 'failed', error: 'boom', progress: progress(40) }) };
  const merged = mergeTaskSnapshot(current, [base({ status: 'queued' })]);
  assert.equal(merged.t1.status, 'queued', 'failed 是终态，但重试复位应显式放行');
}

// 5. 新增任务 / 被服务端裁剪的任务
{
  const current = { t1: base({ status: 'running' }) };
  const added = mergeTaskSnapshot(current, [base({ status: 'running' }), base({ taskId: 't2', status: 'proposed' })]);
  assert.equal(Object.keys(added).length, 2);
  const pruned = mergeTaskSnapshot(added, [base({ status: 'running' })]);
  assert.equal(Object.keys(pruned).length, 1);
  assert.equal(pruned.t2, undefined);
}

console.log('taskSnapshot: 全部用例通过');
