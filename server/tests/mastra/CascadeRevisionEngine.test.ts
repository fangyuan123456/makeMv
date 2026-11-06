/**
 * tests/mastra/CascadeRevisionEngine.test.ts
 * 影视工序资产因果依赖图与级联精修自愈引擎单元测试套件
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { LLMRegistry } from '../../src/llm/LLMRegistry.js';
import { MockLLMService } from '../../src/llm/MockLLMService.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';
import {
  resolveAffectedSteps,
  findDirtyShotsForEntity,
  executeCascadeRevision,
  ASSET_DEPENDENCY_MATRIX,
} from '../../src/agents/director/modifier/index.js';

describe('CascadeRevisionEngine - 影视工序因果依赖图与级联自愈引擎', () => {
  const store = ProjectStore.getInstance();
  const testProjectId = 'test_proj_cascade_revision_engine';
  const testSessionId = 'test_sess_cascade_revision';
  let mockLLM: MockLLMService;

  before(() => {
    mockLLM = new MockLLMService();
    LLMRegistry.set(mockLLM);

    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '因果级联测试工程',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.KEYFRAME_REFERENCE,
      stageArtifacts: {
        [WorkflowStage.CHARACTER_DESIGN]: {
          characters: [
            {
              name: '阿诺',
              role: '主角',
              gender: '男',
              age: '35',
              appearance: '硬朗短发，灰色夹克',
              visualPrompt: '硬朗短发，灰色夹克，特工神情',
              imageUrl: 'http://mock.media/char_arnold_v1.png',
              referenceImageUrl: 'http://mock.media/char_arnold_v1.png',
              history: [],
            },
            {
              name: '艾米',
              role: '女主',
              gender: '女',
              age: '28',
              appearance: '干练马尾，白大褂',
              visualPrompt: '干练马尾，白大褂，研究员',
              imageUrl: 'http://mock.media/char_amy_v1.png',
              referenceImageUrl: 'http://mock.media/char_amy_v1.png',
              history: [],
            },
          ],
        },
        [WorkflowStage.STORYBOARD]: {
          title: '测试分镜表',
          shots: [
            {
              shotId: 'shot_1',
              nodeId: 'node_1',
              shotNumber: 1,
              shotScale: '特写',
              cameraMovement: '推',
              visualComposition: '特写镜头，阿诺神情凝重注视前方',
              subjectMotion: '阿诺眼神微移',
              characterNames: ['阿诺'],
            },
            {
              shotId: 'shot_2',
              nodeId: 'node_1',
              shotNumber: 2,
              shotScale: '中景',
              cameraMovement: '移',
              visualComposition: '艾米在实验室操作控制台',
              subjectMotion: '艾米快速输入指令',
              characterNames: ['艾米'],
            },
            {
              shotId: 'shot_3',
              nodeId: 'node_1',
              shotNumber: 3,
              shotScale: '大远景',
              cameraMovement: '固定',
              visualComposition: '废弃实验室全景，天空乌云密布',
              subjectMotion: '闪电划破天际',
              characterNames: [],
            },
            {
              shotId: 'shot_4',
              nodeId: 'node_1',
              shotNumber: 4,
              shotScale: '全景',
              cameraMovement: '跟',
              visualComposition: '阿诺在雨夜走廊中飞奔',
              subjectMotion: '阿诺持枪奔跑',
              characterNames: ['阿诺'],
            },
          ],
          totalShots: 4,
          estimatedTotalDurationSec: 16,
          createdAt: now,
        },
        [WorkflowStage.KEYFRAME_REFERENCE]: {
          title: '测试关键帧列表',
          shots: [
            {
              shotId: 'shot_1',
              shotNumber: 1,
              subjectAppearance: '硬朗短发，灰色夹克',
              sceneEnvironment: '昏暗地下室',
              prompt: '特写镜头，阿诺神情凝重，硬朗短发，灰色夹克',
              imageUrl: 'http://mock.media/shot_1_v1.png',
              aspectRatio: '16:9',
              status: 'ready',
            },
            {
              shotId: 'shot_2',
              shotNumber: 2,
              subjectAppearance: '干练马尾，白大褂',
              sceneEnvironment: '明亮实验室',
              prompt: '中景镜头，艾米在实验室，干练马尾',
              imageUrl: 'http://mock.media/shot_2_v1.png',
              aspectRatio: '16:9',
              status: 'ready',
            },
            {
              shotId: 'shot_3',
              shotNumber: 3,
              sceneEnvironment: '废墟外景',
              prompt: '大远景，废弃实验室全景',
              imageUrl: 'http://mock.media/shot_3_v1.png',
              aspectRatio: '16:9',
              status: 'ready',
            },
            {
              shotId: 'shot_4',
              shotNumber: 4,
              subjectAppearance: '硬朗短发，灰色夹克',
              sceneEnvironment: '雨夜走廊',
              prompt: '全景镜头，阿诺在雨夜走廊奔跑',
              imageUrl: 'http://mock.media/shot_4_v1.png',
              aspectRatio: '16:9',
              status: 'ready',
            },
          ],
        },
        [`critic_review_${WorkflowStage.KEYFRAME_REFERENCE}`]: {
          gateStatus: 'PASS',
          score: 85,
        },
      },
      history: [],
      meta: {
        idea: '末日科幻',
        style: '赛博朋克，暗冷影调',
        videoRatio: '16:9',
        videoResolution: '720P',
      },
      createdAt: now,
      updatedAt: now,
    });

    store.createSession(testProjectId, '测试会话', WorkflowStage.KEYFRAME_REFERENCE, testSessionId);
  });

  after(() => {
    try {
      store.destroy(testProjectId);
    } catch {}
    LLMRegistry.reset();
  });

  it('1. 依赖拓扑矩阵完整性校验', () => {
    assert.ok(ASSET_DEPENDENCY_MATRIX['character-portrait']);
    assert.deepEqual(ASSET_DEPENDENCY_MATRIX['character-portrait'], [
      'character-portrait',
      'storyboard',
      'keyframe-reference',
      'video-production',
    ]);
  });

  it('2. 结合项目当前阶段动态截断波及范围 (resolveAffectedSteps)', () => {
    // 当前阶段为 KEYFRAME_REFERENCE，未到达 VIDEO_PRODUCTION
    const affected = resolveAffectedSteps(testProjectId, 'character-portrait', '阿诺');
    assert.deepEqual(affected, [
      'character-portrait',
      'storyboard',
      'keyframe-reference',
    ]);
    // 验证 video-production 被正确截断过滤，杜绝跨越未来工序
    assert.ok(!affected.includes('video-production'));
  });

  it('3. 精准反查受实体波及的 Dirty 镜头列表 (findDirtyShotsForEntity)', () => {
    const dirtyShots = findDirtyShotsForEntity(testProjectId, '阿诺');
    // shot_1 和 shot_4 涉及阿诺，shot_2（艾米）和 shot_3（空镜）绝不应被标记为 dirty
    assert.equal(dirtyShots.length, 2);
    assert.ok(dirtyShots.includes('shot_1'));
    assert.ok(dirtyShots.includes('shot_4'));
    assert.ok(!dirtyShots.includes('shot_2'));
    assert.ok(!dirtyShots.includes('shot_3'));
  });

  it('4. 端到端级联精修自愈执行 (executeCascadeRevision)', async () => {
    const cascadeRes = await executeCascadeRevision({
      projectId: testProjectId,
      sessionId: testSessionId,
      rootSkill: 'character-portrait',
      target: '阿诺',
      userFeedback: '改成身穿黑色长风衣，戴防风护目镜',
      llm: mockLLM,
      isMock: true,
    });

    assert.equal(cascadeRes.success, true);
    assert.equal(cascadeRes.rootSkill, 'character-portrait');
    assert.deepEqual(cascadeRes.dirtyShotIds, ['shot_1', 'shot_4']);
    assert.ok(cascadeRes.executedSteps.includes('character-portrait'));
    assert.ok(cascadeRes.executedSteps.includes('storyboard'));
    assert.ok(cascadeRes.executedSteps.includes('keyframe-reference'));

    // 验证 1：定妆照中阿诺已更新，艾米 100% 保持原状
    const charArtifact = store.getArtifact<any>(testProjectId, WorkflowStage.CHARACTER_DESIGN);
    const updatedArnold = charArtifact.characters.find((c: any) => c.name === '阿诺');
    const untouchedAmy = charArtifact.characters.find((c: any) => c.name === '艾米');
    assert.ok(updatedArnold);
    assert.ok(untouchedAmy);
    assert.equal(untouchedAmy.appearance, '干练马尾，白大褂');

    // 验证 2：分镜表中 shot_1 描述已热同步更新定妆，shot_2 未受污染
    const sbArtifact = store.getArtifact<any>(testProjectId, WorkflowStage.STORYBOARD);
    const shot1 = sbArtifact.shots.find((s: any) => s.shotId === 'shot_1');
    const shot2 = sbArtifact.shots.find((s: any) => s.shotId === 'shot_2');
    assert.ok(shot1.visualComposition.includes('定妆更新'));
    assert.ok(!shot2.visualComposition.includes('定妆更新'));

    // 验证 3：关键帧表中 shot_1 已重绘，未波及的 shot_2 与 shot_3 100% 保持原状
    const kfArtifact = store.getArtifact<any>(testProjectId, WorkflowStage.KEYFRAME_REFERENCE);
    const kfShot1 = kfArtifact.shots.find((s: any) => s.shotId === 'shot_1');
    const kfShot2 = kfArtifact.shots.find((s: any) => s.shotId === 'shot_2');
    const kfShot3 = kfArtifact.shots.find((s: any) => s.shotId === 'shot_3');
    assert.ok(kfShot1);
    assert.ok(kfShot2);
    assert.ok(kfShot3);
    assert.equal(kfShot2.prompt, '中景镜头，艾米在实验室，干练马尾');
    assert.equal(kfShot3.prompt, '大远景，废弃实验室全景');

    // 验证 4：历史旧门禁已重置自愈
    const project = store.getProject(testProjectId);
    assert.equal(project?.stageArtifacts?.[`critic_review_${WorkflowStage.KEYFRAME_REFERENCE}`], undefined);
  });
});
