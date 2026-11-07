import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { TaskStore } from '../src/project-store/TaskStore.js';
import { config } from '../src/utils/config.js';
import type { Task } from '../src/types/task.js';

const PROJECT_ID = 'test_retry_reset_tmp';
const TASK_ID = 'task_retry_reset';

const store = TaskStore.getInstance();
const projectDir = path.join(path.resolve(config.paths.projects), PROJECT_ID);

const failedTask: Task = {
  taskId: TASK_ID,
  projectId: PROJECT_ID,
  intent: 'generate',
  title: '生成分镜',
  status: 'failed',
  stages: ['storyboard'],
  approval: { required: true, approvedAt: '2026-01-01T00:00:00.000Z' },
  progress: { current: 3, total: 12, percent: 25, note: '第 3/12 步' },
  artifacts: [
    { stage: 'narrative_design', url: '/api/projects/p/artifacts/narrative_design', summary: '上一轮残留' },
  ],
  resultSummary: '上一轮的结论',
  error: '模型超时',
  createdAt: '2026-01-01T00:00:00.000Z',
  startedAt: '2026-01-01T00:01:00.000Z',
  finishedAt: '2026-01-01T00:02:00.000Z',
};

try {
  store.saveTask(PROJECT_ID, failedTask);

  const reset = store.resetForRetry(PROJECT_ID, TASK_ID)!;
  assert.equal(reset.status, 'queued', '状态应回到 queued');
  assert.deepEqual(reset.artifacts, [], '产物必须清空，否则重试后气泡混入旧 chips');
  assert.equal(reset.progress, undefined, '进度必须清空，否则重试后进度条停在上一次');
  assert.equal(reset.resultSummary, undefined, '上一轮结论必须清空');
  assert.equal(reset.error, undefined, '错误必须清空');
  assert.equal(reset.startedAt, undefined, '开始时间必须清空');
  assert.equal(reset.finishedAt, undefined, '结束时间必须清空');
  // 身份与意图保留
  assert.equal(reset.title, '生成分镜');
  assert.equal(reset.payload ?? undefined, undefined);
  assert.equal(reset.approval.approvedAt, '2026-01-01T00:00:00.000Z', '审批记录保留');

  // 落盘也要干净（undefined 字段不应残留）
  const onDisk = JSON.parse(fs.readFileSync(path.join(projectDir, 'tasks.json'), 'utf-8')) as Task[];
  const persisted = onDisk.find((t) => t.taskId === TASK_ID)!;
  assert.equal(persisted.status, 'queued');
  assert.equal(persisted.progress, undefined);
  assert.deepEqual(persisted.artifacts, []);

  console.log('taskRetryReset: 全部断言通过');
} finally {
  fs.rmSync(projectDir, { recursive: true, force: true });
}
