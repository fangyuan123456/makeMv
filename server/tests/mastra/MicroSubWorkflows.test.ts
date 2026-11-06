/**
 * tests/mastra/MicroSubWorkflows.test.ts
 * 角色定妆与关键帧微观子工作流断点恢复 (Resume) 与单项靶向回退 (Rollback) 回归实证套件
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../src/project-store/index.js';
import {
  characterPortraitSubWorkflow,
  keyframeReferenceSubWorkflow,
} from '../../src/agents/director/generator/steps/index.js';
import { mastra } from '../../src/mastra.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';

describe('MicroSubWorkflows (角色定妆与关键帧) 断点恢复与靶向回退套件', () => {
  const store = ProjectStore.getInstance();
  const testProjectId = 'test_micro_subwfs_' + Date.now();
  let projectDir: string;

  before(() => {
    projectDir = store.getProjectDir(testProjectId);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    // 初始化测试工程
    store.saveProject({
      projectId: testProjectId,
      title: '赛博纪元：微观子工作流验证项目',
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      status: SessionStatus.RUNNING,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stageArtifacts: {},
      history: [],
      meta: {
        idea: '时空跃迁与赛博侦探',
        style: '电影质感，冷调霓虹光影',
        videoRatio: '16:9',
        videoResolution: '720P',
      },
    });

    // 挂载前置第一阶段故事圣经资产 (2 位角色)
    store.setArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN, {
      title: '赛博纪元',
      logline: '流亡侦探在霓虹深渊中追查数字幽灵',
      style: '电影质感，冷调霓虹光影',
      characters: [
        {
          name: '林澈',
          role: '主角',
          gender: '男',
          age: 28,
          appearance: '黑色风衣，短发凌乱，眼神冷峻',
          personality: '沉稳冷静',
          motivation: '追寻身世真相',
        },
        {
          name: '陆离',
          role: '核心配角',
          gender: '女',
          age: 24,
          appearance: '银白短发，佩戴赛博义眼与全息目镜',
          personality: '古灵精怪',
          motivation: '破解底层矩阵',
        },
      ],
    });

    // 挂载前置第三阶段分镜头资产 (2 个分镜)
    store.setArtifact(testProjectId, WorkflowStage.STORYBOARD, {
      shots: [
        {
          shotId: 'shot_1',
          shotNumber: 1,
          visualComposition: '林澈在暴雨中的霓虹街头伫立，远景',
          actionDescription: '拉低风衣兜帽',
        },
        {
          shotId: 'shot_2',
          shotNumber: 2,
          visualComposition: '陆离在全息控制台前快速敲击代码，特写',
          actionDescription: '赛博义眼蓝光闪烁',
        },
      ],
      style: '电影质感，冷调霓虹光影',
    });
  });

  after(() => {
    try {
      if (fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    } catch {}
  });

  describe('角色定妆微观子工作流 (CharacterPortraitSubWorkflow)', () => {
    it('1. 首次全量执行：成功并发推演与渲染 2 位角色定妆并落盘', async () => {
      const run = await (characterPortraitSubWorkflow as any).createRun();
      const runResult = await run.start({
        inputData: {
          projectId: testProjectId,
          isMock: true,
        },
      });
      const res = runResult?.result || runResult;

      assert.equal(res.success, true);
      assert.ok(res.data);
      assert.equal(res.data.characters.length, 2);
      assert.equal(res.data.completedCharacters, 2);

      // 验证本地物理落盘
      const charJsonPath = path.join(projectDir, 'characters', 'character_sheets.json');
      assert.equal(fs.existsSync(charJsonPath), true);
    });

    it('2. 细粒度断点恢复 (Resume & Skip)：无回退诉求时再次执行自动秒级全复用', async () => {
      const initialArtifact = store.getArtifact<any>(testProjectId, WorkflowStage.CHARACTER_DESIGN);
      const linBefore = initialArtifact.characters.find((c: any) => c.name === '林澈');

      const run = await (characterPortraitSubWorkflow as any).createRun();
      const runResult = await run.start({
        inputData: {
          projectId: testProjectId,
          isMock: true,
        },
      });
      const res = runResult?.result || runResult;

      assert.equal(res.success, true);
      assert.ok(res.data);
      assert.equal(res.data.characters.length, 2);
      assert.match(res.summary, /断点恢复/);

      const afterArtifact = store.getArtifact<any>(testProjectId, WorkflowStage.CHARACTER_DESIGN);
      const linAfter = afterArtifact.characters.find((c: any) => c.name === '林澈');
      assert.equal(linAfter.imageUrl, linBefore.imageUrl);
    });

    it('3. 微内核验证：Mastra 容器已按 SSOT 规范正确挂载 subwf-character-portrait', async () => {
      const wf = mastra.getWorkflow('subwf-character-portrait');
      assert.ok(wf, 'Mastra 容器中必须能够通过规范 ID 索引到角色定妆子工作流');
    });
  });

  describe('关键帧首帧基准图微观子工作流 (KeyframeReferenceSubWorkflow)', () => {
    it('1. 首次全量执行：成功并发渲染 2 个分镜首帧关键帧并落盘', async () => {
      const run = await (keyframeReferenceSubWorkflow as any).createRun();
      const runResult = await run.start({
        inputData: {
          projectId: testProjectId,
          isMock: true,
        },
      });
      const res = runResult?.result || runResult;

      assert.equal(res.success, true);
      assert.ok(res.data);
      assert.equal(res.data.shots.length, 2);
      assert.equal(res.data.completedKeyframes, 2);

      // 验证本地物理文件落盘
      const kfJsonPath = path.join(projectDir, 'keyframes', 'keyframe_references.json');
      assert.equal(fs.existsSync(kfJsonPath), true);
    });

    it('2. 细粒度断点恢复 (Resume & Skip)：无回退诉求时再次执行自动秒级全复用', async () => {
      const initialArtifact = store.getArtifact<any>(testProjectId, WorkflowStage.KEYFRAME_REFERENCE);
      const shot2Before = initialArtifact.shots.find((s: any) => s.shotId === 'shot_2');

      const run = await (keyframeReferenceSubWorkflow as any).createRun();
      const runResult = await run.start({
        inputData: {
          projectId: testProjectId,
          isMock: true,
        },
      });
      const res = runResult?.result || runResult;

      assert.equal(res.success, true);
      assert.ok(res.data);
      assert.equal(res.data.shots.length, 2);
      assert.match(res.summary, /断点恢复/);

      const afterArtifact = store.getArtifact<any>(testProjectId, WorkflowStage.KEYFRAME_REFERENCE);
      const shot2After = afterArtifact.shots.find((s: any) => s.shotId === 'shot_2');
      assert.equal(shot2After.imageUrl, shot2Before.imageUrl);
    });

    it('3. 微内核验证：Mastra 容器已按 SSOT 规范正确挂载 subwf-keyframe-reference', async () => {
      const wf = mastra.getWorkflow('subwf-keyframe-reference');
      assert.ok(wf, 'Mastra 容器中必须能够通过规范 ID 索引到关键帧子工作流');
    });
  });
});
