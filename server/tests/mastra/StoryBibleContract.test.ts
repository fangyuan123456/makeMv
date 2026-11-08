/**
 * __tests__/mastra/StoryBibleContract.test.ts
 * 故事世界观圣经 (StoryBible) 正常推演流与契约保真度单元测试套件
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  storyBibleStep,
  executeStoryBible,
  generateStoryBible,
  StoryBibleArtifactSchema,
  exportStoryBibleToDisk,
} from '../../src/agents/director/generator/steps/story-bible/index.js';
import { modifierWorkflow } from '../../src/agents/director/modifier/index.js';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { LLMRegistry } from '../../src/llm/LLMRegistry.js';
import { MockLLMService } from '../../src/llm/MockLLMService.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';

describe('StoryBibleContract - 故事圣经工序契约与正常推演套件', () => {
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

  it('1.1 Mastra Step 封装属性断言', () => {
    assert.equal(storyBibleStep.id, 'story-bible-step');
  });

  it('1.2 AI 视听总导演纯大脑设计：directorAgent 仅挂载决策工具，0 业务假工具', async () => {
    const { directorAgent } = await import('../../src/agents/director/index.js');
    assert.ok(directorAgent, 'directorAgent 必须存在');
    assert.equal(directorAgent.id, 'director-agent');
    const tools = await (directorAgent as any).listTools();
    assert.ok(tools['emit_director_intent'], '挂载结构化意图决策工具');
    assert.ok(!tools['image-generate-tool'], '0 业务物理算力工具');
  });

  it('1.3 正常推演故事圣经：强类型契约校验与 DAG 骨架生成', async () => {
    const rawInput = {
      projectId: testProjectId,
      sessionId: testSessionId,
      overrideParams: {
        prompt: '钟表匠学徒阿诺在维多利亚时代的伦敦意外发现逆转时间的齿轮怀表',
        style: '电影质感，蒸汽朋克',
      },
    };

    const res = await executeStoryBible(rawInput as any);

    assert.ok(res.toolResult, '执行成功必须返回 toolResult 产物');
    assert.ok(res.lastSummary, '执行成功必须返回 lastSummary 汇报');

    const artifact = res.toolResult;

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

  it('1.4 ProjectStore 状态黑板落盘与增量精修 (Modifier) 验证', async () => {
    const artifact = store.getArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN);
    assert.ok(artifact, '状态黑板必须正确存入 narrative_design 产物');

    // 文本轨通过一次跨文件补丁推演完成修改。MockLLM 默认不产出
    // text_multi_file_patch 的补丁体，这里注入一个「只改主命中文件 logline」的确定性 handler：
    // 补丁必须自带合法 file 归属，且 search 逐字取自原文（含缩进与行尾逗号），
    // 才能验证 apply 阶段的原子替换确实生效，而不是被容错逻辑兜过。
    mockLLM.setStageHandler('text_multi_file_patch', (prompt: string) => {
      const blocks = [...prompt.matchAll(/<<<FILE: (.+?)>>>\n([\s\S]*?)<<<END FILE>>>/g)];
      for (const block of blocks) {
        const fileName = block[1].trim();
        const line = block[2].match(/^(\s*)"logline":\s*"((?:[^"\\]|\\.)*)"(,?)$/m);
        if (!line) continue;
        return {
          patches: [
            {
              file: fileName,
              search: line[0],
              replace: `${line[1]}"logline": "${line[2]}（怀表另有神秘副作用）"${line[3]}`,
            },
          ],
          summary: '微调主角动机，补强怀表副作用',
        };
      }
      throw new Error('测试桩未在提示词中找到 logline 锚点');
    });

    // 触发 Modifier 精修增量更新（唯一入口：按 targetSkill 命中 text 分支）
    const modRes: any = await modifierWorkflow.execute({
      inputData: {
        projectId: testProjectId,
        sessionId: testSessionId,
        targetSkill: 'story-bible',
        actionType: 'TARGETED_REVISE',
        userFeedback: '微调主角动机，增加怀表的神秘副作用',
      },
    });

    assert.ok(modRes, '微调工作流必须返回结果');
    assert.match(modRes.lastSummary, /文本修改完成/, '必须汇报文本修改完成');
    assert.deepEqual(
      modRes.toolResult.changedStages,
      [WorkflowStage.NARRATIVE_DESIGN],
      '本次只改了故事圣经一份产物，changedStages 必须精确'
    );

    // 真实落地断言：磁盘底稿内容确实被改写（不是只在内存里标记成功）
    const jsonPath = path.join(store.getProjectDir(testProjectId), 'narrative', 'story_bible.json');
    const onDisk = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    assert.match(onDisk.logline, /怀表另有神秘副作用/, '磁盘底稿必须被真实改写');

    // 聚合根同步断言：读模型与磁盘不能分叉
    const refreshed = store.getArtifact<any>(testProjectId, WorkflowStage.NARRATIVE_DESIGN);
    assert.match(refreshed.logline, /怀表另有神秘副作用/, '聚合根必须与磁盘底稿同步');

    mockLLM.resetCustomHandlers();
  });

  it('1.5 本地工程 narrative/ 目录物理文件导出验证', () => {
    const projectDir = store.getProjectDir(testProjectId);
    const narrativeDir = path.join(projectDir, 'narrative');
    assert.ok(fs.existsSync(narrativeDir), 'narrative 物理目录必须存在');

    // story_bible.json 验证
    const jsonPath = path.join(narrativeDir, 'story_bible.json');
    assert.ok(fs.existsSync(jsonPath), 'story_bible.json 必须真实存在于磁盘');
    const rawJson = fs.readFileSync(jsonPath, 'utf-8');
    const jsonParsed = JSON.parse(rawJson);
    assert.ok(jsonParsed.title);
    assert.ok(jsonParsed.goldenSpine.length >= 3);

    // story_bible.md 验证
    const mdPath = path.join(narrativeDir, 'story_bible.md');
    assert.ok(fs.existsSync(mdPath), 'story_bible.md 必须真实存在于磁盘');
    const mdContent = fs.readFileSync(mdPath, 'utf-8');
    assert.match(mdContent, /故事世界观圣经/);
    assert.match(mdContent, /## 一句话大纲/);
    assert.match(mdContent, /## 黄金戏剧骨架/);
    assert.match(mdContent, /## 核心登场角色档案/);
  });
});
