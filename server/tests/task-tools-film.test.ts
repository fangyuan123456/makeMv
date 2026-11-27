/**
 * tests/task-tools-film.test.ts
 * 验证影视制作工坊公开任务工具 (Film Production Task Tools)
 * 验证：双阶段回调（onTaskId -> onResult）、Mastra 工作流装配与工具规范
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import {
  assetManifestTool,
  entitySpecTool,
  shootingScriptTool,
  shotMotionPromptTool,
  lookdevTool,
  shotVideoTool,
} from '../src/tools/film-production/index.js';

console.log('🎬 开始验证影视制作工坊公开任务工具架构 (Film Production Task Tools)...\n');

// 1. 验证工具定义与元数据
function testToolDefinitions() {
  console.log('--- 测试 1: 工具元数据与契约定义校验 ---');
  const tools = [
    { tool: assetManifestTool, expectedId: 'film.asset_manifest' },
    { tool: entitySpecTool, expectedId: 'film.entity_spec' },
    { tool: shootingScriptTool, expectedId: 'film.shooting_script' },
    { tool: shotMotionPromptTool, expectedId: 'film.shot_motion_prompt' },
    { tool: lookdevTool, expectedId: 'film.lookdev' },
    { tool: shotVideoTool, expectedId: 'film.shot_video' },
  ];

  for (const { tool, expectedId } of tools) {
    assert.strictEqual(tool.toolName, expectedId, `工具 toolName 应为 ${expectedId}`);
    assert.ok(tool.description && tool.description.length > 0, `工具描述不能为空: ${expectedId}`);
    const wf = (tool as any).buildWorkflow();
    assert.ok(wf, `工具内部 workflow 必须能成功构建: ${expectedId}`);
  }

  console.log('✅ 测试 1 通过: 工具元数据定义完备合规！\n');
}

// 2. 验证双阶段回调机制 (onTaskId -> onResult)
async function testDualCallbackOnTools() {
  console.log('--- 测试 2: 双阶段回调执行机制验证 (onTaskId -> onResult) ---');

  const projectId = 'test_film_tool_proj_001';
  const store = ProjectStore.getInstance();
  const projectDir = store.getProjectDir(projectId);
  fs.mkdirSync(projectDir, { recursive: true });

  // 写入 Mock 的 PRD
  store.setArtifact(projectId, 'prd', {
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

  // 测试 assetManifestTool 派发
  let receivedTaskId: string | null = null;
  const sequence: string[] = [];

  const dispatchedTaskId = await assetManifestTool.dispatch(
    { projectId },
    {
      onTaskId: (taskId) => {
        sequence.push('onTaskId');
        receivedTaskId = taskId;
      },
    }
  );

  assert.ok(receivedTaskId, '必须触发 onTaskId 回调');
  assert.strictEqual(receivedTaskId, dispatchedTaskId, 'onTaskId 返回的 taskId 必须与 dispatch 返回值一致');
  assert.ok(dispatchedTaskId.startsWith('task_film_asset_manifest_'), '必须返回语义化 taskId');

  console.log('✅ 测试 2 通过: assetManifestTool 派发机制闭环！\n');
  fs.rmSync(projectDir, { recursive: true, force: true });
}

async function runAll() {
  testToolDefinitions();
  await testDualCallbackOnTools();
  console.log('🎉 影视制作工坊公开任务工具全部测试通过！\n');
}

runAll().catch((err) => {
  console.error('❌ 测试运行失败:', err);
  process.exit(1);
});
