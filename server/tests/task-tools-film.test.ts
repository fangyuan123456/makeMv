/**
 * tests/task-tools-film.test.ts
 * 验证影视制作工坊 7 大细粒度任务工具 (Film Production Task Tools)
 * 验证：目录零外层 schema/prompt 契约、双阶段回调（onTaskId -> onResult）、Mastra 工作流装配
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import {
  assetExtractionTool,
  storyboardPlanningTool,
  characterPortraitTool,
  propLookdevTool,
  sceneAtmosphereTool,
  shotKeyframeTool,
  shotVideoTool,
} from '../src/tools/film-production/index.js';

console.log('🎬 开始验证影视制作工坊 7 大细粒度任务工具架构 (Film Production Task Tools)...\n');

// 1. 架构红线自检：验证 7 个工具目录外层绝无 schema.ts 和 prompt.ts
function testDirectoryArchitecture() {
  console.log('--- 测试 1: 架构红线自检：外层无 schema/prompt & 一步一文件夹高内聚 ---');
  const baseDir = path.resolve(process.cwd(), 'src/tools/film-production');
  const fallbackDir = path.resolve(process.cwd(), 'server/src/tools/film-production');
  const filmDir = fs.existsSync(baseDir) ? baseDir : fallbackDir;

  const toolFolders = [
    '01-asset-extraction-tool',
    '02-storyboard-planning-tool',
    '03-character-portrait-tool',
    '04-prop-lookdev-tool',
    '05-scene-atmosphere-tool',
    '06-shot-keyframe-tool',
    '07-shot-video-tool',
  ];

  for (const folder of toolFolders) {
    const fullFolderPath = path.join(filmDir, folder);
    assert.ok(fs.existsSync(fullFolderPath), `工具目录应存在: ${folder}`);

    // 外层不应该有 schema.ts 和 prompt.ts
    const invalidSchema = path.join(fullFolderPath, 'schema.ts');
    const invalidPrompt = path.join(fullFolderPath, 'prompt.ts');
    assert.strictEqual(
      fs.existsSync(invalidSchema),
      false,
      `[架构违规拦截] 工具外层禁止出现 schema.ts: ${folder}/schema.ts`
    );
    assert.strictEqual(
      fs.existsSync(invalidPrompt),
      false,
      `[架构违规拦截] 工具外层禁止出现 prompt.ts: ${folder}/prompt.ts`
    );

    // 必须有 steps 目录与 workflow.ts, index.ts
    assert.ok(fs.existsSync(path.join(fullFolderPath, 'workflow.ts')), `应存在 workflow.ts: ${folder}`);
    assert.ok(fs.existsSync(path.join(fullFolderPath, 'index.ts')), `应存在 index.ts: ${folder}`);
    assert.ok(fs.existsSync(path.join(fullFolderPath, 'steps')), `应存在 steps 子目录: ${folder}`);
  }

  console.log('✅ 测试 1 通过: 7 个工具目录全部符合一步一文件夹、外层零 schema/prompt 规范！\n');
}

// 2. 验证工具定义与元数据
function testToolDefinitions() {
  console.log('--- 测试 2: 7 大工具元数据与契约定义校验 ---');
  const tools = [
    { tool: assetExtractionTool, expectedId: 'film.asset_extraction' },
    { tool: storyboardPlanningTool, expectedId: 'film.storyboard_planning' },
    { tool: characterPortraitTool, expectedId: 'film.character_portrait' },
    { tool: propLookdevTool, expectedId: 'film.prop_lookdev' },
    { tool: sceneAtmosphereTool, expectedId: 'film.scene_atmosphere' },
    { tool: shotKeyframeTool, expectedId: 'film.shot_keyframe' },
    { tool: shotVideoTool, expectedId: 'film.shot_video' },
  ];

  for (const { tool, expectedId } of tools) {
    assert.strictEqual(tool.toolName, expectedId, `工具 toolName 应为 ${expectedId}`);
    assert.ok(tool.description && tool.description.length > 0, `工具描述不能为空: ${expectedId}`);
    const wf = (tool as any).buildWorkflow();
    assert.ok(wf, `工具内部 workflow 必须能成功构建: ${expectedId}`);
  }

  console.log('✅ 测试 2 通过: 7 个工具元数据定义完备合规！\n');
}

// 3. 验证双阶段回调机制 (onTaskId -> onResult)
async function testDualCallbackOnTools() {
  console.log('--- 测试 3: 双阶段回调执行机制验证 (onTaskId -> onResult) ---');

  const projectId = 'test_film_tool_proj_001';
  const store = ProjectStore.getInstance();
  const projectDir = store.getProjectDir(projectId);
  fs.mkdirSync(projectDir, { recursive: true });

  // 写入 Mock 的 UniversalPrdSpec
  store.setArtifact(projectId, 'universal_prd', {
    projectId,
    theme: '科幻冒险',
    storyBackground: '未来太空站探索危机',
    coreConflict: '人工智能觉醒与人类存亡',
    characters: [
      {
        characterId: 'char_captain',
        name: '林航',
        role: '舰长',
        personality: '冷静果决',
        appearance: '穿深灰防化战术服，短发，眼神深邃',
      },
    ],
    scenes: [
      {
        sceneId: 'loc_bridge',
        name: '指挥舰桥',
        environmentType: '室内空间站',
        atmosphere: '幽蓝冷光，全息全景屏幕微微闪烁',
      },
    ],
    interactiveOutline: [
      {
        actId: 'act_1',
        title: '警报初鸣',
        summary: '空间站发生能源异动',
        location: '指挥舰桥',
        charactersInvolved: ['char_captain'],
        choices: [
          {
            choiceId: 'choice_1',
            text: '启动主发电机紧急自检',
            targetActId: 'act_2',
          },
        ],
      },
    ],
  });

  // 测试 assetExtractionTool 派发
  let receivedTaskId: string | null = null;
  let receivedResult: any = null;
  const sequence: string[] = [];

  const dispatchedTaskId = await assetExtractionTool.dispatch(
    { projectId, force: true },
    {
      onTaskId: (taskId) => {
        receivedTaskId = taskId;
        sequence.push('STAGE_1:onTaskId');
        console.log(`[回调 1] 即刻捕获 taskId: ${taskId}`);
      },
      onResult: (result) => {
        receivedResult = result;
        sequence.push('STAGE_2:onResult');
        console.log(`[回调 2] 异步捕获执行结果完成，状态 success=${result.success}`);
      },
    }
  );

  assert.ok(dispatchedTaskId.startsWith('task_film_asset_extraction_'), '必须返回语义化 taskId');
  assert.strictEqual(receivedTaskId, dispatchedTaskId, '第一次回调 taskId 必须与返回值一致');

  // 等待异步工具执行
  let waitedMs = 0;
  while (!receivedResult && waitedMs < 35000) {
    await new Promise((r) => setTimeout(r, 200));
    waitedMs += 200;
  }

  if (!receivedResult) {
    console.error(`[Test Timeout] 等待 ${waitedMs}ms 后仍未收到 onResult 回调`);
  } else {
    console.log(`[Test Finished] 耗时 ${waitedMs}ms，结果数据结构:`, JSON.stringify(receivedResult.data, null, 2));
  }

  assert.strictEqual(sequence[0], 'STAGE_1:onTaskId', '第一次必须先回调 onTaskId');
  assert.strictEqual(sequence[1], 'STAGE_2:onResult', '第二次必须后回调 onResult');
  assert.ok(receivedResult, '必须收到结果');
  assert.strictEqual(receivedResult.success, true, 'Mock 环境下资产提取应成功');
  assert.ok(receivedResult.data.entities, '应返回提取出的 entities 实体清单');
  assert.ok(receivedResult.data.entities.characters?.length > 0, '应提取出角色');

  // 验证状态黑板中落盘
  const savedEntities = store.getArtifact(projectId, 'lookdev_entities');
  assert.ok(savedEntities, 'lookdev_entities 必须已写入 ProjectStore');

  console.log('✅ 测试 3 通过: assetExtractionTool 双阶段回调机制完美闭环！\n');

  // 清理测试临时工程
  try {
    fs.rmSync(projectDir, { recursive: true, force: true });
  } catch {}
}

async function runAllTests() {
  try {
    testDirectoryArchitecture();
    testToolDefinitions();
    await testDualCallbackOnTools();
    console.log('🎉 所有影视制作工坊 7 大任务工具测试 100% 运行通过！');
  } catch (err) {
    console.error('❌ 测试失败:', err);
    process.exit(1);
  }
}

runAllTests();
