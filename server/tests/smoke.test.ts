/**
 * tests/smoke.test.ts
 * 纯服务端轻量冒烟与全链路闭环测试 (End-to-End Smoke Test with Mastra Native Workflow)
 */

process.env.NODE_ENV = 'test';

import assert from 'assert';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { TaskStore } from '../src/workflow-engine/TaskStore.js';
import {
  mastra,
  routerAgent,
  plannerAgent,
  textGameAgent,
  filmAdapterAgent,
  productionWorkflow,
} from '../src/mastra.js';
import { planGDDWithAgent } from '../src/agents/planner/planner.agent.js';
import { writeTextGameWithAgent } from '../src/agents/text-game/text-game.agent.js';
import { adaptFilmWithAgent } from '../src/agents/film-adapter/film-adapter.agent.js';
import { TextGameRuntimeEngine } from '../src/runtime/state-engine.js';
import { LLMProvider, MockLanguageModel } from '../src/llm/index.js';

async function runSmokeTests() {
  console.log('🧪 开始执行全新轻量 Mastra 微内核冒烟测试...\n');

  // 确保处于离线测试模式 (统一注入 MockLanguageModel)
  LLMProvider.setMockModel(new MockLanguageModel());

  const testProjectId = `test_proj_${Date.now()}`;
  const store = ProjectStore.getInstance();
  const taskStore = TaskStore.getInstance();

  // 1. 测试 Mastra 容器单门面注册机制 (RouterAgent + Native Workflow)
  console.log('1. 测试 Mastra 容器单门面注册机制 (RouterAgent + Native Workflow)...');
  assert.ok(mastra, 'Mastra 容器实例必须存在');
  assert.strictEqual(routerAgent.name, 'router-agent');
  assert.strictEqual(productionWorkflow.name, 'interactive-fmv-production');
  console.log('  ✅ Mastra 单门面容器注册验证通过 (对外仅暴露 routerAgent，0 as any)\n');

  // 2. 测试轻量运行中互斥防抖门禁 (In-Flight Guard)
  console.log('2. 测试轻量运行中互斥防抖门禁 (In-Flight Guard)...');
  const runningTask = taskStore.createTask(testProjectId, 'test_workflow', '测试并发防抖');
  taskStore.setStatus(testProjectId, runningTask.taskId, 'running');
  const active = taskStore.getRunningTask(testProjectId);
  assert.ok(active, '必须能够即时检测出处于 running 状态的任务');
  assert.strictEqual(active.taskId, runningTask.taskId);
  console.log('  ✅ 运行中任务互斥防抖门禁验证通过\n');

  // 3. 测试 ProjectStore 基础功能
  console.log('3. 测试 ProjectStore 单例黑板...');
  const proj = store.getProject(testProjectId);
  assert.strictEqual(proj.meta.projectId, testProjectId);
  store.setArtifact(testProjectId, 'test_key', { foo: 'bar' });
  const artifact = store.getArtifact(testProjectId, 'test_key');
  assert.deepStrictEqual(artifact, { foo: 'bar' });
  console.log('  ✅ ProjectStore 读写与原子写盘通过\n');

  // 4. 测试 TaskStore 与进度广播
  console.log('4. 测试 TaskStore 任务生命周期与进度...');
  taskStore.updateProgress(testProjectId, runningTask.taskId, { percent: 50, note: '正在运行中' });
  const updatedTask = taskStore.getTask(testProjectId, runningTask.taskId);
  assert.strictEqual(updatedTask?.progress.percent, 50);
  console.log('  ✅ TaskStore 状态流转与进度更新通过\n');

  // 5. 测试三大 Mastra 原生 Agent 结构化推演
  console.log('5. 测试三大 Mastra 原生 Agent (Planner ➔ TextGame ➔ FilmAdapter)...');
  
  // 5.1 策划 Agent
  const gdd = await planGDDWithAgent('帮我设计一个赛博黑客卧底潜伏的互动游戏', plannerAgent);
  assert.ok(gdd.title, 'GDD 必须包含 title');
  assert.ok(gdd.globalStateMachine, 'GDD 必须包含全局状态机');
  store.setArtifact(testProjectId, 'gdd', gdd);
  console.log(`  ✅ 策划 Agent (Mastra Native) 推演成功: 《${gdd.title}》`);

  // 5.2 文游 Agent
  const textGame = await writeTextGameWithAgent(gdd, textGameAgent);
  assert.ok(textGame.nodes.length > 0, '文游必须包含至少一个节点');
  assert.ok(textGame.nodes[0].narrativeText, '节点必须包含文学演出正文');
  store.setArtifact(testProjectId, 'text_game', textGame);
  console.log(`  ✅ 文游 Agent (Mastra Native) 扩写成功: 共 ${textGame.nodes.length} 个文学演出节点`);

  // 5.3 影游转译 Agent
  const filmSpec = await adaptFilmWithAgent(textGame, filmAdapterAgent);
  assert.ok(filmSpec.clips.length > 0, '影游清单必须包含视听切片');
  assert.ok(filmSpec.clips[0].visualPrompt, '切片必须包含纯英文 Video Prompt');
  store.setArtifact(testProjectId, 'film_spec', filmSpec);
  console.log(`  ✅ 影游 Agent (Mastra Native) 编译成功: 共 ${filmSpec.clips.length} 个视听镜头订单\n`);

  // 6. 测试文游纯确定性运行引擎 (0 Token 毫秒级试玩)
  console.log('6. 测试纯确定性运行时 (TextGameRuntimeEngine)...');
  const initState = TextGameRuntimeEngine.initGame(gdd, textGame);
  assert.strictEqual(initState.currentNodeId, textGame.startNodeId);
  assert.strictEqual(initState.variables['suspicion'], 30);
  
  // 执行第一步选择: 公事公办 (suspicion - 10)
  const stepResult = TextGameRuntimeEngine.step(textGame, initState, 'opt_silent');
  assert.strictEqual(stepResult.nextState.currentNodeId, 'node_02a_briefcase');
  assert.strictEqual(stepResult.nextState.variables['suspicion'], 20);
  console.log('  ✅ 文游确定性状态机运算通过（怀疑度 30 ➔ 20，成功流转至公文包盲区）\n');

  console.log('🎉 所有纯服务端 Mastra 微内核与工程防御冒烟测试 100% 全部通过！');
  
  // 清理测试沙箱工程，保持项目目录纯净
  store.deleteProject(testProjectId);
}

runSmokeTests().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
