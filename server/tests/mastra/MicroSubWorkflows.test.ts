/**
 * tests/mastra/MicroSubWorkflows.test.ts
 * 角色定妆与关键帧微观子工作流断点恢复 (Resume) 与单项靶向回退 (Rollback) 回归实证套件
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../src/project-store/index.js';
import { characterPortraitTool, characterPortraitSubWorkflow } from '../../src/tools/character-portrait/index.js';
import { keyframeReferenceTool, keyframeReferenceSubWorkflow } from '../../src/tools/keyframe-reference/index.js';
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
      status: SessionStatus.ACTIVE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      meta: {
        idea: '时空跃迁与赛博侦探',
        style: '电影质感，冷调霓虹光影',
        videoRatio: '16:9',
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
      const res: any = await (characterPortraitTool.execute as any)({
        projectId: testProjectId,
        isMock: true,
      });

      assert.equal(res.success, true);
      assert.ok(res.data);
      assert.equal(res.data.characters.length, 2);
      assert.equal(res.data.completedCharacters, 2);

      // 验证本地物理落盘
      const charJsonPath = path.join(projectDir, 'characters', 'character_sheets.json');
      assert.equal(fs.existsSync(charJsonPath), true);
    });

    it('2. 细粒度断点恢复 (Resume & Skip)：无回退诉求时再次执行自动秒级全复用', async () => {
      // 记录初次生成的林澈图片地址
      const initialArtifact = store.getArtifact<any>(testProjectId, WorkflowStage.CHARACTER_DESIGN);
      const linBefore = initialArtifact.characters.find((c: any) => c.name === '林澈');

      const res: any = await (characterPortraitTool.execute as any)({
        projectId: testProjectId,
        isMock: true,
      });

      assert.equal(res.success, true);
      assert.ok(res.data);
      assert.equal(res.data.characters.length, 2);
      // 校验摘要触发断点恢复秒级复用
      assert.match(res.summary, /断点恢复/);

      const afterArtifact = store.getArtifact<any>(testProjectId, WorkflowStage.CHARACTER_DESIGN);
      const linAfter = afterArtifact.characters.find((c: any) => c.name === '林澈');
      assert.equal(linAfter.imageUrl, linBefore.imageUrl);
    });

    it('3. 单角色靶向回退 (Single-Character Rollback)：仅重绘林澈，陆离安全复用', async () => {
      const artifactBefore = store.getArtifact<any>(testProjectId, WorkflowStage.CHARACTER_DESIGN);
      const luLiBefore = artifactBefore.characters.find((c: any) => c.name === '陆离');

      const res: any = await (characterPortraitTool.execute as any)({
        projectId: testProjectId,
        targetCharacterNames: ['林澈'],
        userFeedback: '增加雨滴打在脸庞的质感与高光',
        isMock: true,
      });

      assert.equal(res.success, true);
      assert.ok(res.data);
      assert.equal(res.data.characters.length, 2);
      assert.match(res.summary, /林澈/);

      const artifactAfter = store.getArtifact<any>(testProjectId, WorkflowStage.CHARACTER_DESIGN);
      const luLiAfter = artifactAfter.characters.find((c: any) => c.name === '陆离');
      // 陆离未被回退，数据保持原样
      assert.equal(luLiAfter.imageUrl, luLiBefore.imageUrl);
    });

    it('4. 微内核验证：Mastra 容器已按 SSOT 规范正确挂载 subwf-character-portrait', async () => {
      const wf = mastra.getWorkflow('subwf-character-portrait');
      assert.ok(wf, 'Mastra 容器中必须能够通过规范 ID 索引到角色定妆子工作流');
    });
  });

  describe('关键帧首帧基准图微观子工作流 (KeyframeReferenceSubWorkflow)', () => {
    it('1. 首次全量执行：成功并发渲染 2 个分镜首帧关键帧并落盘', async () => {
      const res: any = await (keyframeReferenceTool.execute as any)({
        projectId: testProjectId,
        isMock: true,
      });

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

      const res: any = await (keyframeReferenceTool.execute as any)({
        projectId: testProjectId,
        isMock: true,
      });

      assert.equal(res.success, true);
      assert.ok(res.data);
      assert.equal(res.data.shots.length, 2);
      assert.match(res.summary, /断点恢复/);

      const afterArtifact = store.getArtifact<any>(testProjectId, WorkflowStage.KEYFRAME_REFERENCE);
      const shot2After = afterArtifact.shots.find((s: any) => s.shotId === 'shot_2');
      assert.equal(shot2After.imageUrl, shot2Before.imageUrl);
    });

    it('3. 单镜靶向回退 (Single-Shot Rollback)：指定 targetShotId 仅重做指定镜头，其他镜头安全复用', async () => {
      const artifactBefore = store.getArtifact<any>(testProjectId, WorkflowStage.KEYFRAME_REFERENCE);
      const shot2Before = artifactBefore.shots.find((s: any) => s.shotId === 'shot_2');

      const res: any = await (keyframeReferenceTool.execute as any)({
        projectId: testProjectId,
        targetShotId: 'shot_1',
        userFeedback: '加强背景霓虹广告牌的倒影',
        isMock: true,
      });

      assert.equal(res.success, true);
      assert.ok(res.data);
      assert.equal(res.data.shots.length, 2);
      assert.match(res.summary, /shot_1/);

      const artifactAfter = store.getArtifact<any>(testProjectId, WorkflowStage.KEYFRAME_REFERENCE);
      const shot2After = artifactAfter.shots.find((s: any) => s.shotId === 'shot_2');
      assert.equal(shot2After.imageUrl, shot2Before.imageUrl);
    });

    it('4. 微内核验证：Mastra 容器已按 SSOT 规范正确挂载 subwf-keyframe-reference', async () => {
      const wf = mastra.getWorkflow('subwf-keyframe-reference');
      assert.ok(wf, 'Mastra 容器中必须能够通过规范 ID 索引到关键帧子工作流');
    });
  });
});
