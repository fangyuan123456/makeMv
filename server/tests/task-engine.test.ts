/**
 * tests/task-engine.test.ts
 * 任务工具调度微内核 (Task Engine) 核心测试矩阵
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  taskToolRegistry,
  taskStore,
  taskDispatcher,
} from '../src/task-engine/index.js';
import { BaseTaskTool } from '../src/tools/base/task-tool.js';
import { getProjectDir } from '../src/project-store/artifact-fs.js';
import { AgentSessionStore } from '../src/agents/runtime/session-store.js';

// 用于测试的轻量模拟工具
class MockTool extends BaseTaskTool<{ value: number }, { result: number }> {
  public readonly toolName = 'test.mock_calculator';
  public readonly description = '测试计算器工具';

  protected buildWorkflow(): any {
    return {
      createRun: () => ({
        start: async (args: any) => {
          return {
            results: {
              step_calc: {
                status: 'success',
                output: { result: (args.triggerData?.value || 0) * 10 },
              },
            },
          };
        },
      }),
    };
  }
}

console.log('🚀 开始验证现代 Tool-First 任务调度微内核 (Task Engine)...');

// 测试 1: 工具注册表与元数据
console.log('\n--- 测试 1: 验证任务工具注册表完整性 ---');
const allTools = taskToolRegistry.getAllTools();
console.log(`已注册工具总数: ${allTools.length}`);
assert.ok(allTools.length >= 8, '应当至少注册 8 个标准任务工具');

const expectedToolNames = [
  'planner.screenplay_writer',
  'planner.script_to_prd',
  'film.asset_manifest',
  'film.entity_spec',
  'film.storyboard_breakdown',
  'film.shot_prompt',
  'film.lookdev',
  'film.shot_keyframe',
  'film.shot_video',
  'game.assembly',
];

for (const name of expectedToolNames) {
  const meta = allTools.find((t) => t.toolName === name);
  assert.ok(meta, `必须在注册表中找到工具元数据: ${name}`);
  const toolInstance = taskToolRegistry.getTool(name);
  assert.ok(toolInstance, `必须能成功获取工具实例: ${name}`);
}
console.log('✅ 测试 1 通过: 8 大标准任务工具全部成功注册并可查！');

// 测试 2: 任务派发与双阶段生命周期
console.log('\n--- 测试 2: 任务派发同步响应与异步状态流转 (TaskDispatcher & SSE 事件) ---');
const mockTool = new MockTool();
taskToolRegistry.register(mockTool);

const testProjectId = 'test_engine_proj_001';
let eventCapturedCount = 0;

const unsubscribe = taskStore.onTaskEvent((event) => {
  if (event.projectId === testProjectId) {
    eventCapturedCount++;
    console.log(`[SSE 事件捕获] taskId: ${event.taskId}, status: ${event.status}`);
  }
});

// 派发任务
const initialTask = await taskDispatcher.dispatch({
  projectId: testProjectId,
  toolName: 'test.mock_calculator',
  input: { value: 7 },
});

console.log(`[同步返回] taskId: ${initialTask.taskId}, status: ${initialTask.status}`);
assert.strictEqual(initialTask.status, 'pending', '派发必须立即返回 pending 状态');
assert.strictEqual(initialTask.projectId, testProjectId);

// 轮询等待后台异步完成（模拟工具执行很快）
let completedTask: any = null;
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 50));
  const t = taskStore.getTask(initialTask.taskId);
  if (t && (t.status === 'completed' || t.status === 'failed')) {
    completedTask = t;
    break;
  }
}

assert.ok(completedTask, '任务应当在限定时间内执行结束');
assert.strictEqual(completedTask.status, 'completed', '测试计算任务应当成功完成');
assert.strictEqual(completedTask.output.result, 70, '产物计算结果应当正确 (7 * 10 = 70)');
assert.ok(completedTask.durationMs >= 0, '执行耗时必须被记录');
assert.ok(eventCapturedCount >= 2, '应当至少捕获到 running 和 completed 两个阶段的 SSE 事件');
unsubscribe();
console.log('✅ 测试 2 通过: 同步响应与异步生命周期流转验证成功！');

// 重试时，聊天消息必须改绑新任务，旧任务事件不得再覆盖卡片状态。
const retrySessionId = `test_retry_binding_${Date.now()}`;
const retryMessageId = 'msg_retry_binding';
const retryChatDir = path.join(getProjectDir(testProjectId), 'chat');
fs.mkdirSync(retryChatDir, { recursive: true });
const retryChatPath = path.join(retryChatDir, `${retrySessionId}.json`);
fs.writeFileSync(retryChatPath, JSON.stringify([{ id: retryMessageId, role: 'assistant', content: '任务失败', taskId: initialTask.taskId }]));
taskStore.saveTask({
  ...completedTask,
  status: 'failed',
  input: { value: 7, __chatContext: { sessionId: retrySessionId, messageId: retryMessageId } },
  error: '模拟失败',
});
const retriedTask = await taskDispatcher.retry(initialTask.taskId);
let retryMessage = JSON.parse(fs.readFileSync(retryChatPath, 'utf-8'))[0];
assert.strictEqual(retryMessage.taskId, initialTask.taskId, '会话文件保持原始任务绑定');
assert.strictEqual(new AgentSessionStore(testProjectId, retrySessionId).getMessages()[0].taskId,
  retriedTask.taskId, '聊天卡片读取时必须解析到重试任务');
assert.strictEqual(retryMessage.taskError, undefined, '重试时必须清除旧错误');
for (let i = 0; i < 20 && taskStore.getTask(retriedTask.taskId)?.status !== 'completed'; i++) {
  await new Promise((r) => setTimeout(r, 50));
}
retryMessage = JSON.parse(fs.readFileSync(retryChatPath, 'utf-8'))[0];
assert.strictEqual(retryMessage.taskStatus, undefined, '会话文件不应存储任务状态快照');
assert.strictEqual(new AgentSessionStore(testProjectId, retrySessionId).getMessages()[0].taskStatus,
  'completed', '新任务完成后读取卡片必须投影真实状态');
fs.unlinkSync(retryChatPath);

// 测试 3: 任务状态磁盘落盘与恢复机制 (tasks.json)
console.log('\n--- 测试 3: 任务状态物理落盘与离线恢复验证 (tasks.json) ---');
const projectDir = getProjectDir(testProjectId);
const tasksFilePath = path.join(projectDir, 'tasks.json');
assert.ok(fs.existsSync(tasksFilePath), `任务列表必须已在磁盘落盘: ${tasksFilePath}`);

const fileRaw = fs.readFileSync(tasksFilePath, 'utf-8');
const persistedList = JSON.parse(fileRaw);
assert.ok(Array.isArray(persistedList), '磁盘 tasks.json 必须是任务数组');
assert.ok(
  persistedList.some((t: any) => t.taskId === initialTask.taskId),
  '磁盘文件中必须记录有刚才完成的任务'
);

// 重置内存验证从磁盘重新装载
taskStore._resetForTest();
const reloadedTasks = taskStore.getTasksByProject(testProjectId);
assert.ok(
  reloadedTasks.some((t) => t.taskId === initialTask.taskId),
  '清空内存后重新查询项目任务必须能从磁盘自动预加载'
);
console.log('✅ 测试 3 通过: 任务状态物理落盘与离线自动恢复机制 100% 验证成功！');

// 测试 4: 任务主动取消机制验证 (Task Cancellation)
console.log('\n--- 测试 4: 任务主动取消与 AbortSignal 状态迁移验证 ---');
const cancelTestTask = await taskDispatcher.dispatch({
  projectId: testProjectId,
  toolName: 'test.mock_calculator',
  input: { value: 99 },
});

const isCancelled = taskDispatcher.cancel(cancelTestTask.taskId);
assert.ok(isCancelled, '应当能够成功取消未完成的任务');

const cancelledRecord = taskStore.getTask(cancelTestTask.taskId);
assert.strictEqual(cancelledRecord?.status, 'cancelled', '任务状态必须更新为 cancelled');
console.log('✅ 测试 4 通过: 任务主动取消机制与状态流转 100% 验证成功！');

console.log('\n🎉 所有任务调度微内核 (Task Engine) 测试全部通过！\n');
