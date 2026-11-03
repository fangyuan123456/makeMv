/**
 * __tests__/mastra/StoryBibleFailFast.test.ts
 * 故事世界观圣经 (StoryBible) 异常流与刚性阻断守卫单元测试套件
 *
 * 核心验证：
 * 1. 基础入参缺失与非法 projectId 刚性拦截；
 * 2. 核心构思 (idea) 缺失时的源头治理防御（坚决拒绝“未命名故事构想”假收敛）；
 * 3. P1-1 DAG 拓扑主键唯一性、悬空指针与终局收束守卫；
 * 4. 黄金三幕、角色档案等核心产物维度缺失拦截。
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { storyBibleTool } from '../../src/mastra/tools/story-bible/story-bible.tool.js';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { LLMRegistry } from '../../src/llm/LLMRegistry.js';
import { MockLLMService } from '../../src/llm/MockLLMService.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';

describe('StoryBibleFailFast - 刚性阻断与源头防御测试套件', () => {
  const store = ProjectStore.getInstance();
  const testProjectId = 'test_proj_story_bible_failfast';
  let mockLLM: MockLLMService;

  before(() => {
    mockLLM = new MockLLMService();
    LLMRegistry.set(mockLLM);

    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '测试待推演项目',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: {
        idea: '',
        style: '写实光影',
        videoRatio: '16:9',
        videoResolution: '720P',
      },
      createdAt: now,
      updatedAt: now,
    });
  });

  after(() => {
    try {
      store.destroy(testProjectId);
    } catch {}
    LLMRegistry.reset();
  });

  beforeEach(() => {
    mockLLM.resetCustomHandlers();
  });

  it('2.1 传入空 projectId 或非法格式时刚性拦截', async () => {
    // 空字符串
    const resEmpty = await (storyBibleTool.execute as any)({
      projectId: '',
      idea: '有构思的故事',
    });
    const isFailedEmpty = resEmpty.success === false || resEmpty.error === true || Boolean(resEmpty.error);
    assert.ok(isFailedEmpty, '空 projectId 必须拦截失败');
    const errEmpty = resEmpty.error === true ? resEmpty.message : (resEmpty.error || resEmpty.message);
    assert.match(errEmpty, /projectId/);

    // 路径穿越非法字符
    const resMalicious = await (storyBibleTool.execute as any)({
      projectId: '../../malicious_path',
      idea: '有构思的故事',
    });
    const isFailedMalicious = resMalicious.success === false || resMalicious.error === true || Boolean(resMalicious.error);
    assert.ok(isFailedMalicious, '路径穿越 projectId 必须拦截失败');
    const errMalicious = resMalicious.error === true ? resMalicious.message : (resMalicious.error || resMalicious.message);
    assert.match(errMalicious, /非法的 projectId|validation/i);

    // 含有空格等非法字符
    const resSpace = await (storyBibleTool.execute as any)({
      projectId: 'bad project id with space',
      idea: '有构思的故事',
    });
    const isFailedSpace = resSpace.success === false || resSpace.error === true || Boolean(resSpace.error);
    assert.ok(isFailedSpace, '包含空格的 projectId 必须拦截失败');
    const errSpace = resSpace.error === true ? resSpace.message : (resSpace.error || resSpace.message);
    assert.match(errSpace, /非法的 projectId|validation/i);
  });

  it('2.2 传入不存在的 projectId 时刚性拦截，拒绝凭空执行', async () => {
    const res = await (storyBibleTool.execute as any)({
      projectId: 'non_existent_project_99999',
      idea: '有构思的故事',
    });
    assert.equal(res.success, false);
    assert.match(res.error || '', /未找到项目/);
  });

  it('2.3 核心构思 (idea) 缺失时刚性阻断，彻底拒绝假收敛 (法典 0.4 专属)', async () => {
    // 确保 project.meta.idea 为空
    const proj = store.getProject(testProjectId);
    assert.ok(proj);
    proj.meta.idea = '';
    store.saveProject(proj);

    const res = await (storyBibleTool.execute as any)({
      projectId: testProjectId,
      idea: '   ', // 全空格
    });

    assert.equal(res.success, false, '必须返回执行失败');
    assert.match(res.error || '', /推演故事圣经必须提供明确的故事构思.*严禁空参数假跑/);

    // 刚性断言：黑板绝无假收敛产物写入
    const artifact = store.getArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN);
    assert.equal(artifact, undefined, '失败时状态黑板 narrative_design 必须为空，绝不假收敛');
  });

  it('2.4 DAG 拓扑节点 ID 重复冲突拦截 (P1-1 唯一主键守卫)', async () => {
    mockLLM.setStageData('story_graph', {
      rootNodeId: 'node_1',
      endingsCount: 1,
      estimatedBranches: 1,
      nodes: [
        {
          id: 'node_1',
          act: 1,
          title: '节点1',
          summary: '开始',
          location: '工坊',
          characterNames: ['阿诺'],
          isEnding: false,
          choices: [{ targetNodeId: 'node_dup', text: '走向重复节点' }],
        },
        {
          id: 'node_dup',
          act: 2,
          title: '重复节点A',
          summary: '冲突A',
          location: '街道',
          characterNames: ['阿诺'],
          isEnding: false,
          choices: [],
        },
        {
          id: 'node_dup', // 故意模拟重复的 node.id
          act: 3,
          title: '重复节点B',
          summary: '冲突B',
          location: '广场',
          characterNames: ['阿诺'],
          isEnding: true,
          choices: [],
        },
      ],
    });

    const res = await (storyBibleTool.execute as any)({
      projectId: testProjectId,
      idea: '钟表穿越冒险',
    });

    assert.equal(res.success, false);
    assert.match(res.error || '', /拓扑节点 ID 重复冲突: \[node_dup\]/);
  });

  it('2.5 DAG 拓扑分支悬空指针拦截 (P1-1 悬空引用守卫)', async () => {
    mockLLM.setStageData('story_graph', {
      rootNodeId: 'node_1',
      endingsCount: 1,
      estimatedBranches: 1,
      nodes: [
        {
          id: 'node_1',
          act: 1,
          title: '起点',
          summary: '测试起点',
          location: '工坊',
          characterNames: ['阿诺'],
          isEnding: false,
          choices: [
            {
              targetNodeId: 'ghost_node_999', // 故意指向不存在的幽灵节点
              text: '前往不存在的幽灵节点',
            },
          ],
        },
        {
          id: 'node_2',
          act: 2,
          title: '终局',
          summary: '正常终局',
          location: '钟楼',
          characterNames: ['阿诺'],
          isEnding: true,
          choices: [],
        },
        {
          id: 'node_3',
          act: 2,
          title: '分支',
          summary: '正常分支',
          location: '暗巷',
          characterNames: ['阿诺'],
          isEnding: false,
          choices: [],
        },
      ],
    });

    const res = await (storyBibleTool.execute as any)({
      projectId: testProjectId,
      idea: '钟表穿越冒险',
    });

    assert.equal(res.success, false);
    assert.match(res.error || '', /分支选项指向了不存在的悬空目标节点: \[ghost_node_999\]/);
  });

  it('2.6 DAG 拓扑根节点不存在于节点列表中时刚性拦截', async () => {
    mockLLM.setStageData('story_graph', {
      rootNodeId: 'ghost_root_node', // 根节点不存在
      endingsCount: 1,
      estimatedBranches: 1,
      nodes: [
        {
          id: 'node_1',
          act: 1,
          title: '节点1',
          summary: '测试',
          location: '工坊',
          characterNames: ['阿诺'],
          isEnding: false,
          choices: [{ targetNodeId: 'node_2', text: '前往结局' }],
        },
        {
          id: 'node_2',
          act: 2,
          title: '节点2',
          summary: '结局',
          location: '钟楼',
          characterNames: ['阿诺'],
          isEnding: true,
          choices: [],
        },
        {
          id: 'node_3',
          act: 2,
          title: '节点3',
          summary: '支线',
          location: '天台',
          characterNames: ['阿诺'],
          isEnding: false,
          choices: [],
        },
      ],
    });

    const res = await (storyBibleTool.execute as any)({
      projectId: testProjectId,
      idea: '钟表穿越冒险',
    });

    assert.equal(res.success, false);
    assert.match(res.error || '', /根节点 rootNodeId \[ghost_root_node\] 不存在于拓扑节点清单中/);
  });

  it('2.7 DAG 拓扑全图无终局节点时刚性拦截', async () => {
    mockLLM.setStageData('story_graph', {
      rootNodeId: 'node_1',
      endingsCount: 0,
      estimatedBranches: 1,
      nodes: [
        {
          id: 'node_1',
          act: 1,
          title: '节点1',
          summary: '测试',
          location: '工坊',
          characterNames: ['阿诺'],
          isEnding: false,
          choices: [{ targetNodeId: 'node_2', text: '继续' }],
        },
        {
          id: 'node_2',
          act: 2,
          title: '节点2',
          summary: '测试2',
          location: '钟楼',
          characterNames: ['阿诺'],
          isEnding: false, // 全图无 ending
          choices: [{ targetNodeId: 'node_3', text: '继续' }],
        },
        {
          id: 'node_3',
          act: 3,
          title: '节点3',
          summary: '测试3',
          location: '天台',
          characterNames: ['阿诺'],
          isEnding: false, // 全图无 ending
          choices: [],
        },
      ],
    });

    const res = await (storyBibleTool.execute as any)({
      projectId: testProjectId,
      idea: '钟表穿越冒险',
    });

    assert.equal(res.success, false);
    assert.match(res.error || '', /网状剧情拓扑缺少终局收束/);
  });

  it('2.8 黄金三幕少于 3 幕时刚性拦截', async () => {
    mockLLM.setStageData('story_spine', {
      title: '残缺三幕',
      theme: '测试主题',
      style: '测试风格',
      logline: '一句话大纲',
      sellingPoints: ['卖点'],
      goldenSpine: [
        { act: 1, name: '只有开端', summary: '开端概要', targetDurationSec: 60 },
        { act: 2, name: '只有中段', summary: '中段概要', targetDurationSec: 60 },
      ],
    });

    const res = await (storyBibleTool.execute as any)({
      projectId: testProjectId,
      idea: '钟表穿越冒险',
    });

    assert.equal(res.success, false);
    assert.match(res.error || '', /故事黄金三幕骨架推演失败.*幕次数量必须 >= 3 幕/);
  });

  it('2.9 角色小传为空时刚性拦截', async () => {
    mockLLM.setStageData('character_profiles', {
      characters: [], // 故意返回空数组
    });

    const res = await (storyBibleTool.execute as any)({
      projectId: testProjectId,
      idea: '钟表穿越冒险',
    });

    assert.equal(res.success, false);
    assert.match(res.error || '', /核心角色档案推演失败.*未产生有效角色数据/);
  });
});
