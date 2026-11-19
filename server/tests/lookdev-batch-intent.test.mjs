import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { LookdevAgent } from '../dist/agents/lookdev/agent.js';
import { lookdevCapabilities } from '../dist/agents/lookdev/capabilities.js';
import { ProjectStore } from '../dist/project-store/ProjectStore.js';

test('all-pending Lookdev proposal expands into atomic operations Plan and approval preserves it', () => {
  const store = ProjectStore.getInstance();
  const getProject = store.getProject;
  const getArtifact = store.getArtifact;
  const entities = {
    characters: [
      { characterId: 'done_char', name: '已完成', imageUrl: '/done.png' },
      { characterId: 'pending_char', name: '待定妆' },
    ],
    locations: [
      { locationId: 'loc_a', name: '场景 A' },
      { locationId: 'loc_b', name: '场景 B' },
    ],
    items: [{ itemId: 'prop_a', name: '道具 A', referenceImageUrl: '/reference.png' }],
  };
  store.getProject = () => ({ meta: { title: '测试' } });
  store.getArtifact = (_projectId, name) => (name === 'lookdev_entities' ? entities : null);

  try {
    const agent = Object.create(LookdevAgent.prototype);
    agent.projectId = 'batch-test';
    agent.getIntentToolSpecs = () => lookdevCapabilities();
    agent.getMessages = () => messages;
    agent.markProposalsResolved = () => {};
    let messages = [];

    // 1. coverage=all_pending 默认展开所有待定妆资产为 operations[] Plan
    const proposal = agent.resolveDirectorIntent({
      action: 'propose',
      targetTool: 'film.lookdev',
      title: '剩余资产定妆',
      description: '完成剩余视觉资产定妆',
      params: {},
      coverage: 'all_pending',
      reply: '准备完成剩余定妆。',
    });
    assert.equal(Array.isArray(proposal.operations), true);
    assert.equal(proposal.operations.length, 4);
    assert.deepEqual(
      proposal.operations.map((op) => [op.tool, op.params.targetKind, op.params.targetId, op.params.force]),
      [
        ['film.lookdev', 'character', 'pending_char', false],
        ['film.lookdev', 'location', 'loc_a', false],
        ['film.lookdev', 'location', 'loc_b', false],
        ['film.lookdev', 'item', 'prop_a', false],
      ]
    );

    // 2. approve 原样保留整个 Plan 的 operations[] 与 coverage
    messages = [{ proposal, proposalResolved: false }];
    const approved = agent.resolveDirectorIntent({ action: 'approve', reply: '开始执行。' });
    assert.deepEqual(approved.operations, proposal.operations);
    assert.equal(approved.coverage, 'all_pending');

    // 3. modify 缩小为单个原子实体时，清除 coverage 且仅保留目标原子参数
    const narrowed = agent.resolveDirectorIntent({
      action: 'modify',
      targetTool: 'film.lookdev',
      description: '只重绘指定角色',
      params: { targetKind: 'character', targetId: 'pending_char', force: true },
      reply: '只处理这个角色。',
    });
    assert.equal(narrowed.coverage, undefined);
    assert.equal(narrowed.tool, 'film.lookdev');
    assert.equal(narrowed.operations, undefined);
    assert.equal(narrowed.params.targetKind, 'character');
    assert.equal(narrowed.params.targetId, 'pending_char');
    assert.equal(narrowed.params.force, true);

    // 4. coverage=all_pending + targetTool=film.image_upscale 仅展开已出图且未超分的实体
    const upscalePlan = agent.resolveDirectorIntent({
      action: 'propose',
      targetTool: 'film.image_upscale',
      description: '提升已出图资产清晰度',
      coverage: 'all_pending',
      params: { multiplier: 2 },
      reply: '对已出图资产执行超分。',
    });
    assert.equal(Array.isArray(upscalePlan.operations), true);
    assert.deepEqual(
      upscalePlan.operations.map((op) => [op.tool, op.params.targetKind, op.params.targetId, op.params.multiplier]),
      [['film.image_upscale', 'character', 'done_char', 2]]
    );
  } finally {
    store.getProject = getProject;
    store.getArtifact = getArtifact;
  }
});

test('asset modification intent accepts deleting an item', async () => {
  const store = ProjectStore.getInstance();
  const getArtifact = store.getArtifact;
  const { assetExtractionTool } = await import('../dist/tools/film-production/asset-extraction-tool/index.js');
  store.getArtifact = (_projectId, name) =>
    name === 'lookdev_entities'
      ? {
          characters: [],
          locations: [],
          items: [{ itemId: 'item_access_card', name: '应急通道门禁卡' }],
        }
      : null;
  try {
    const agent = Object.create(LookdevAgent.prototype);
    agent.projectId = 'delete-item-test';
    agent.getIntentToolSpecs = () => [
      {
        toolName: assetExtractionTool.toolName,
        title: '删除道具',
        description: assetExtractionTool.description,
        schema: assetExtractionTool.inputSchema,
      },
    ];
    agent.getMessages = () => [];
    agent.markProposalsResolved = () => {};
    const proposal = agent.resolveDirectorIntent({
      action: 'propose',
      targetTool: 'film.asset_extraction',
      title: '删除道具',
      description: '删除指定道具资产',
      params: {
        mode: 'modify',
        modifications: [{ operation: 'delete', entityType: 'item', entityId: 'item_access_card' }],
      },
    });
    assert.equal(proposal.tool, 'film.asset_extraction');
    assert.equal(proposal.params.mode, 'modify');
    assert.equal(proposal.params.modifications[0].entityType, 'item');
  } finally {
    store.getArtifact = getArtifact;
  }
});

test('one Plan approval dispatches all operations bound to a single parent message with planSteps', async () => {
  const { dispatchApprovedIntent } = await import('../dist/agents/runtime/task-events.js');
  const { taskDispatcher, taskStore } = await import('../dist/task-engine/index.js');
  const originalDispatch = taskDispatcher.dispatch;
  const originalGetTask = taskStore.getTask;
  const calls = [];
  const messages = [{ id: 'approval', role: 'assistant', content: '开始执行。', metadata: {} }];
  taskDispatcher.dispatch = async (request) => {
    calls.push(request);
    return {
      taskId: `test_task_${calls.length}`,
      toolName: request.toolName,
      status: 'pending',
      projectId: request.projectId,
    };
  };
  taskStore.getTask = () => undefined;

  try {
    const session = {
      projectId: 'batch-test',
      sessionId: 'lookdev',
      getMessages: () => messages,
      appendMessage: (record) => {
        const message = { ...record, id: `message_${messages.length}` };
        messages.push(message);
        return message;
      },
      updateMessage: (id, patch) => Object.assign(messages.find((message) => message.id === id), patch),
      markProposalsResolved: () => {},
    };
    const result = {
      messageId: 'approval',
      cleanText: '开始执行。',
      intent: {
        action: 'approve',
        title: '组合执行计划',
        params: {},
        operations: [
          { tool: 'film.lookdev', title: '角色定妆', params: { targetKind: 'character', targetId: 'char_a' } },
          { tool: 'film.asset_extraction', title: '资产调整', params: { mode: 'modify' } },
          { tool: 'film.storyboard_planning', title: '分镜规划', params: {} },
        ],
      },
    };
    await dispatchApprovedIntent(session, result);
    assert.deepEqual(
      calls.map((call) => call.toolName),
      ['film.lookdev', 'film.asset_extraction', 'film.storyboard_planning']
    );
    // 所有步骤均绑定至同一父消息，避免聊天流刷屏
    assert.equal(new Set(calls.map((call) => call.input.__chatContext.messageId)).size, 1);
    assert.equal(calls[0].input.__chatContext.messageId, 'approval');
    assert.equal(messages.length, 1);
    assert.equal(Array.isArray(messages[0].planSteps), true);
    assert.equal(messages[0].planSteps.length, 3);
    assert.deepEqual(
      messages[0].planSteps.map((s) => s.taskId),
      ['test_task_1', 'test_task_2', 'test_task_3']
    );
    assert.equal(result.dispatchError, undefined);
  } finally {
    taskDispatcher.dispatch = originalDispatch;
    taskStore.getTask = originalGetTask;
  }
});

test('atomic Lookdev tool renders each entity kind individually with proper aspect ratios', async () => {
  const { lookdevTool } = await import('../dist/tools/film-production/lookdev-tool/index.js');
  const { imageGenerateTool } = await import('../dist/tools/image-generate/image-generate.tool.js');
  const store = ProjectStore.getInstance();
  const originalGetArtifact = store.getArtifact;
  const originalGetProjectDir = store.getProjectDir;
  const originalSetArtifact = store.setArtifact;
  const originalGenerate = imageGenerateTool.execute;
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lookdev-module-'));
  const invoked = [];
  store.getArtifact = () => ({
    artStyle: 'test style',
    characters: [{ characterId: 'char_a', name: 'A', appearanceSummary: 'A', promptZh: 'A', versions: [] }],
    locations: [{ locationId: 'loc_a', name: 'B', appearanceSummary: 'B', promptZh: 'B', versions: [] }],
    items: [{ itemId: 'prop_a', name: 'C', appearanceSummary: 'C', promptZh: 'C', versions: [] }],
  });
  store.getProjectDir = () => projectDir;
  store.setArtifact = () => {};
  imageGenerateTool.execute = async ({ context }) => {
    invoked.push(context);
    return { success: true, mediaUrl: `/media/${context.customFilename}.png` };
  };

  try {
    const cases = [
      { targetKind: 'character', targetId: 'char_a', expectedSize: '1536*768' },
      { targetKind: 'location', targetId: 'loc_a', expectedSize: '1280*720' },
      { targetKind: 'item', targetId: 'prop_a', expectedSize: '1024*1024' },
    ];

    for (const c of cases) {
      let finalResult;
      await lookdevTool.execute({
        input: { projectId: 'batch-test', targetKind: c.targetKind, targetId: c.targetId, force: false },
        callbacks: {
          onTaskId: () => {},
          onResult: (result) => {
            finalResult = result;
          },
        },
      });
      assert.equal(finalResult?.success, true, finalResult?.error);
      assert.equal(finalResult.data.renderedCount, 1);
      assert.equal(finalResult.data.targetKind, c.targetKind);
      assert.equal(finalResult.data.targetId, c.targetId);
    }

    assert.deepEqual(
      invoked.map(({ size }) => size),
      ['1536*768', '1280*720', '1024*1024']
    );

    // 角色传入 customPrompt 且已有旧图作参考时，必须依然强制附带三视图排版规范，防止退化为单人像
    invoked.length = 0;
    let customPromptResult;
    await lookdevTool.execute({
      input: {
        projectId: 'batch-test',
        targetKind: 'character',
        targetId: 'char_a',
        customPrompt: '全身自然直立站姿，身穿深酒红高领长裙，双脚自然靠拢',
        force: true,
      },
      callbacks: {
        onTaskId: () => {},
        onResult: (result) => {
          customPromptResult = result;
        },
      },
    });
    assert.equal(customPromptResult?.success, true, customPromptResult?.error);
    assert.equal(invoked.length, 1);
    assert.match(invoked[0].prompt, /横向同框三等分全身三视图排版/);
    assert.match(invoked[0].prompt, /左格正面全身/);
    assert.match(invoked[0].prompt, /右格背面全身/);

    // 不存在的资产 ID 应立即失败且不调用生图工具
    invoked.length = 0;
    let missingResult;
    await lookdevTool.execute({
      input: { projectId: 'batch-test', targetKind: 'item', targetId: 'missing_prop', force: false },
      callbacks: {
        onTaskId: () => {},
        onResult: (result) => {
          missingResult = result;
        },
      },
    });
    assert.equal(missingResult.success, false);
    assert.equal(invoked.length, 0);
  } finally {
    store.getArtifact = originalGetArtifact;
    store.getProjectDir = originalGetProjectDir;
    store.setArtifact = originalSetArtifact;
    imageGenerateTool.execute = originalGenerate;
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('tool catalog exposes only the unified Lookdev renderer', async () => {
  const { taskToolRegistry } = await import('../dist/task-engine/task-registry.js');
  const listed = taskToolRegistry.getAllTools().map((tool) => tool.toolName);
  assert.equal(listed.includes('film.lookdev'), true);
  assert.equal(listed.includes('film.image_upscale'), true);
  for (const name of ['film.character_portrait', 'film.scene_atmosphere', 'film.prop_lookdev']) {
    assert.equal(listed.includes(name), false);
    assert.equal(taskToolRegistry.getTool(name), undefined);
  }
});
