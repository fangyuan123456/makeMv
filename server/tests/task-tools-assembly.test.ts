/**
 * tests/task-tools-assembly.test.ts
 * 验证第三阶段游戏打包集成独立任务工具 (GameAssemblyTool)
 * 验证：外层零 schema/prompt 契约、双阶段回调（onTaskId -> onResult）、Mastra 工作流编排、index.html 落盘
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { gameAssemblyTool, GameAssemblyTool } from '../src/tools/game-assembly/index.js';

console.log('🎮 开始验证游戏集成总装任务工具架构 (GameAssemblyTool)...\n');

// 1. 架构红线自检：外层无 schema/prompt & 一步一文件夹高内聚
function testDirectoryArchitecture() {
  console.log('--- 测试 1: 架构红线自检：外层无 schema/prompt & 一步一文件夹高内聚 ---');
  const baseDir = path.resolve(process.cwd(), 'src/tools/game-assembly');
  const fallbackDir = path.resolve(process.cwd(), 'server/src/tools/game-assembly');
  const assemblyDir = fs.existsSync(baseDir) ? baseDir : fallbackDir;

  assert.ok(fs.existsSync(assemblyDir), 'game-assembly 目录应存在');

  const invalidSchema = path.join(assemblyDir, 'schema.ts');
  const invalidPrompt = path.join(assemblyDir, 'prompt.ts');
  assert.strictEqual(
    fs.existsSync(invalidSchema),
    false,
    '[架构违规拦截] game-assembly 外层禁止出现 schema.ts'
  );
  assert.strictEqual(
    fs.existsSync(invalidPrompt),
    false,
    '[架构违规拦截] game-assembly 外层禁止出现 prompt.ts'
  );

  assert.ok(fs.existsSync(path.join(assemblyDir, 'workflow.ts')), '应存在 workflow.ts');
  assert.ok(fs.existsSync(path.join(assemblyDir, 'index.ts')), '应存在 index.ts');
  assert.ok(fs.existsSync(path.join(assemblyDir, 'steps')), '应存在 steps 子目录');

  const stepDirs = ['01-tech-plan', '02-codegen'];
  for (const step of stepDirs) {
    const full = path.join(assemblyDir, 'steps', step);
    assert.ok(fs.existsSync(full), `工序目录应存在: ${step}`);
    assert.ok(fs.existsSync(path.join(full, 'schema.ts')), `${step} 应存在 schema.ts`);
    assert.ok(fs.existsSync(path.join(full, 'step.ts')), `${step} 应存在 step.ts`);
    assert.ok(fs.existsSync(path.join(full, 'index.ts')), `${step} 应存在 index.ts`);
  }

  console.log('✅ 测试 1 通过: game-assembly 目录完全符合外层零 schema/prompt 与一步一文件夹规范！\n');
}

// 2. 验证元数据定义与工作流构造
function testToolDefinitions() {
  console.log('--- 测试 2: GameAssemblyTool 元数据与契约定义校验 ---');
  assert.strictEqual(gameAssemblyTool.toolName, 'game.assembly');
  assert.ok(gameAssemblyTool.description && gameAssemblyTool.description.length > 0);
  const wf = (gameAssemblyTool as any).buildWorkflow();
  assert.ok(wf, 'GameAssemblyTool 内部 workflow 必须能成功构建');
  console.log('✅ 测试 2 通过: GameAssemblyTool 元数据完备合规！\n');
}

// 3. 验证双阶段回调与落地可玩工程 (onTaskId -> onResult)
async function testDualCallbackAndPackaging() {
  console.log('--- 测试 3: 双阶段回调执行机制与静态工程落盘验证 (onTaskId -> onResult) ---');

  const projectId = 'test_assembly_tool_proj_001';
  const store = ProjectStore.getInstance();
  const projectDir = store.getProjectDir(projectId);
  fs.mkdirSync(projectDir, { recursive: true });

  const mockPrd = {
    gameTitle: '深空救赎',
    genre: '科幻互动影游',
    playerIdentity: '领航员',
    startNodeId: 'S1',
    initialState: { energy: 100, oxygen: 80 },
    clips: [
      { id: 'S1', title: '危机警报' },
      { id: 'S2', title: '逃生抉择' },
    ],
  };

  store.setArtifact(projectId, 'universal_prd', mockPrd);

  let receivedTaskId: string | null = null;
  let receivedResult: any = null;
  const sequence: string[] = [];

  const dispatchedTaskId = await gameAssemblyTool.dispatch(
    {
      projectId,
      title: '深空救赎',
      prd: mockPrd,
      scenes: [
        {
          sceneId: 'S1',
          title: '危机警报',
          text: '警报声刺破了寂静，反应堆温度正在急剧上升。',
        },
        {
          sceneId: 'S2',
          title: '逃生抉择',
          text: '逃生舱只剩下最后一组燃料。',
        },
      ],
      script: {
        startSceneId: 'S1',
        initialState: { energy: 100, oxygen: 80 },
        scenes: [
          {
            sceneId: 'S1',
            title: '危机警报',
            choices: [{ text: '检修反应堆', to: 'S2' }],
          },
          {
            sceneId: 'S2',
            title: '逃生抉择',
            ending: { type: 'HE', title: '成功脱险', verdict: '人类的火种得以延续' },
          },
        ],
      },
    },
    {
      onTaskId: (taskId) => {
        receivedTaskId = taskId;
        sequence.push('STAGE_1:onTaskId');
        console.log(`[回调 1] 即刻捕获 taskId: ${taskId}`);
      },
      onResult: (result) => {
        receivedResult = result;
        sequence.push('STAGE_2:onResult');
        console.log(`[回调 2] 异步捕获执行结果，成功状态: ${result.success}`);
      },
    }
  );

  assert.ok(dispatchedTaskId.startsWith('task_game_assembly_'), '必须返回语义化 taskId');
  assert.strictEqual(receivedTaskId, dispatchedTaskId, '第一次回调 taskId 必须与返回值一致');

  // 等待执行完成 (支持真实模型或兜底生成)
  let waitedMs = 0;
  while (!receivedResult && waitedMs < 60000) {
    await new Promise((r) => setTimeout(r, 200));
    waitedMs += 200;
  }

  assert.strictEqual(sequence[0], 'STAGE_1:onTaskId', '第一次必须先回调 onTaskId');
  assert.strictEqual(sequence[1], 'STAGE_2:onResult', '第二次必须后回调 onResult');
  assert.ok(receivedResult, '必须收到结果');
  assert.strictEqual(receivedResult.success, true, '打包总装应成功');
  assert.ok(receivedResult.data.indexPath, '应返回可玩入口 indexPath');

  // 验证磁盘真实物理文件落盘
  const indexHtmlFile = path.resolve(projectDir, receivedResult.data.indexPath);
  assert.ok(fs.existsSync(indexHtmlFile), `index.html 必须已写入物理磁盘: ${indexHtmlFile}`);
  const htmlContent = fs.readFileSync(indexHtmlFile, 'utf-8');
  assert.ok(htmlContent.includes('<div id="app"></div>'), 'index.html 必须包含 #app 挂载点');
  assert.ok(htmlContent.includes('./js/main.js'), 'index.html 必须引入入口脚本');

  // 验证底座已落盘
  const playerJs = path.resolve(projectDir, 'game-assembly/runtime/player.js');
  assert.ok(fs.existsSync(playerJs), '播放底座 player.js 必须已就位');

  console.log('✅ 测试 3 通过: GameAssemblyTool 双阶段回调与静态工程落盘 100% 验证成功！\n');

  // 清理临时测试工程
  try {
    fs.rmSync(projectDir, { recursive: true, force: true });
  } catch {}
}

async function runAllTests() {
  try {
    testDirectoryArchitecture();
    testToolDefinitions();
    await testDualCallbackAndPackaging();
    console.log('🎉 游戏集成总装任务工具 (GameAssemblyTool) 测试 100% 运行通过！');
  } catch (err) {
    console.error('❌ 测试失败:', err);
    process.exit(1);
  }
}

runAllTests();
