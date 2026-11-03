/**
 * __tests__/mastra/StoryBibleContract.test.ts
 * 故事世界观圣经 (StoryBible) 正常推演流与契约保真度单元测试套件
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { storyBibleTool } from '../../src/mastra/tools/story-bible/story-bible.tool.js';
import { directorAgent } from '../../src/mastra/agents/director.agent.js';
import {
  StoryBibleInputSchema,
  StoryBibleArtifactSchema,
} from '../../src/mastra/tools/story-bible/schema.js';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { LLMRegistry } from '../../src/llm/LLMRegistry.js';
import { MockLLMService } from '../../src/llm/MockLLMService.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';

describe('StoryBibleContract - 故事圣经契约与正常推演套件', () => {
  const store = ProjectStore.getInstance();
  const testProjectId = 'test_proj_story_bible_contract';
  const testSessionId = 'test_sess_story_bible_contract';
  let mockLLM: MockLLMService;

  before(() => {
    mockLLM = new MockLLMService();
    LLMRegistry.set(mockLLM);

    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '未命名项目',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: {
        idea: '',
        style: '蒸汽朋克，复古机械光影',
        videoRatio: '16:9',
        videoResolution: '720P',
      },
      createdAt: now,
      updatedAt: now,
    });

    store.createSession(testProjectId, '故事世界观研讨', WorkflowStage.NARRATIVE_DESIGN, testSessionId);
  });

  after(() => {
    try {
      store.destroy(testProjectId);
    } catch {}
    LLMRegistry.reset();
  });

  it('1.1 Mastra Tool 封装属性与人在回路审批断言', () => {
    assert.equal(storyBibleTool.id, 'story-bible-generator');
    assert.equal(storyBibleTool.requireApproval, true, '必须强制设置 requireApproval: true 保证人在回路');
    assert.ok(storyBibleTool.description.length > 0);
  });

  it('1.2 DirectorAgent 成功挂载 storyBibleTool', async () => {
    const tools = await (directorAgent as any).listTools();
    assert.ok(tools, 'directorAgent.listTools 必须返回工具列表');
    const registeredTool = tools.storyBibleTool;
    assert.ok(registeredTool, 'directorAgent 必须挂载 storyBibleTool');
    assert.equal(registeredTool.id, 'story-bible-generator');
    assert.equal(registeredTool.requireApproval, true);
  });

  it('1.3 正常推演故事圣经：入参与出参强类型契约校验', async () => {
    const rawInput = {
      projectId: testProjectId,
      sessionId: testSessionId,
      idea: '钟表匠学徒阿诺在维多利亚时代的伦敦意外发现逆转时间的齿轮怀表',
      style: '电影质感，蒸汽朋克',
    };

    // 校验输入契约
    const parsedInput = StoryBibleInputSchema.safeParse(rawInput);
    assert.equal(parsedInput.success, true);

    const res = await (storyBibleTool.execute as any)(rawInput);

    assert.equal(res.success, true);
    assert.ok(res.data, '执行成功必须返回 data 产物');
    assert.ok(res.summary, '执行成功必须返回 summary 汇报');

    const artifact = res.data;

    // 校验产物完全符合 StoryBibleArtifactSchema 契约
    const parsedArtifact = StoryBibleArtifactSchema.safeParse(artifact);
    assert.equal(parsedArtifact.success, true, '产物必须 100% 符合 StoryBibleArtifactSchema 契约');

    // 黄金三幕断言
    assert.ok(artifact.goldenSpine.length >= 3, '黄金三幕必须 >= 3 幕');
    for (const act of artifact.goldenSpine) {
      assert.ok(act.act >= 1);
      assert.ok(act.name.length > 0);
      assert.ok(act.summary.length > 0);
      assert.ok((act.targetDurationSec ?? 0) > 0);
      assert.ok(typeof act.cliffhanger === 'string');
    }

    // 互动抉择矩阵断言
    assert.ok(artifact.pivotPoints.macroPivotPoints.length >= 1);
    for (const p of artifact.pivotPoints.macroPivotPoints) {
      assert.ok(p.choices.length >= 2, '宏观抉择点必须至少包含 2 个选项');
    }

    // DAG 拓扑图断言
    assert.ok(artifact.storyGraph.nodes.length >= 3);
    assert.ok(artifact.storyGraph.rootNodeId);
    const rootNode = artifact.storyGraph.nodes.find((n: any) => n.id === artifact.storyGraph.rootNodeId);
    assert.ok(rootNode, 'rootNodeId 必须存在于 nodes 列表中');
    const endingNode = artifact.storyGraph.nodes.find((n: any) => n.isEnding);
    assert.ok(endingNode, '拓扑图必须包含至少一个终局收束节点');

    // 角色小传断言
    assert.ok(artifact.characters.length >= 1);
    assert.deepEqual(
      artifact.characterNames,
      artifact.characters.map((c: any) => c.name),
      'characterNames 必须由 characters.map 严格派生'
    );
  });

  it('1.4 ProjectStore 状态黑板落盘与项目聚合根同步验证', async () => {
    const artifact = store.getArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN);
    assert.ok(artifact, '状态黑板必须正确存入 narrative_design 产物');
    assert.equal(artifact.title, '命运齿轮');

    // 聚合根更新
    const project = store.getProject(testProjectId);
    assert.ok(project);
    assert.equal(project.title, '命运齿轮', '项目聚合根 title 必须与故事圣经标题同步');

    // 触发二次更新以验证历史快照自动归档
    const res2 = await (storyBibleTool.execute as any)({
      projectId: testProjectId,
      idea: '二次微调故事圣经，深化宿命两难抉择',
    });
    assert.equal(res2.success, true);

    // 历史快照归档验证
    const projectDir = store.getProjectDir(testProjectId);
    const artifactsDir = path.join(projectDir, 'artifacts');
    assert.ok(fs.existsSync(artifactsDir), 'artifacts 快照目录必须存在');
    const snapshotFiles = fs.readdirSync(artifactsDir).filter((f) => f.startsWith('narrative_design.'));
    assert.ok(snapshotFiles.length > 0, '必须自动归档生成 narrative_design.<timestamp>.json 快照');
  });

  it('1.5 会话双轨备忘录 (Scratchpad Memory) 反向同步验证', () => {
    const scratchpad = store.getScratchpad(testProjectId, testSessionId);
    assert.ok(scratchpad);
    assert.match(scratchpad.themeAndStyle || '', /自由意志与宿命抉择/);
    assert.match(scratchpad.logline || '', /钟表匠学徒阿诺/);
    assert.match(scratchpad.charactersSummary || '', /学徒阿诺/);
    assert.match(scratchpad.storySpine || '', /怀表/);
  });

  it('1.6 本地工程 narrative/ 目录物理文件导出验证', () => {
    const projectDir = store.getProjectDir(testProjectId);
    const narrativeDir = path.join(projectDir, 'narrative');
    assert.ok(fs.existsSync(narrativeDir), 'narrative 物理目录必须存在');

    // story_bible.json 验证
    const jsonPath = path.join(narrativeDir, 'story_bible.json');
    assert.ok(fs.existsSync(jsonPath), 'story_bible.json 必须真实存在于磁盘');
    const rawJson = fs.readFileSync(jsonPath, 'utf-8');
    const jsonParsed = JSON.parse(rawJson);
    assert.equal(jsonParsed.title, '命运齿轮');
    assert.equal(jsonParsed.goldenSpine.length, 3);

    // story_bible.md 验证
    const mdPath = path.join(narrativeDir, 'story_bible.md');
    assert.ok(fs.existsSync(mdPath), 'story_bible.md 必须真实存在于磁盘');
    const mdContent = fs.readFileSync(mdPath, 'utf-8');
    assert.match(mdContent, /# 《命运齿轮》故事世界观圣经/);
    assert.match(mdContent, /## 一句话大纲/);
    assert.match(mdContent, /## 核心商业看点与卖点/);
    assert.match(mdContent, /## 黄金戏剧骨架/);
    assert.match(mdContent, /## 核心角色小传档案/);
    assert.match(mdContent, /## 互动网状拓扑图概览/);
  });
});
