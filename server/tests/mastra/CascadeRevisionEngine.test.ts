/**
 * tests/mastra/CascadeRevisionEngine.test.ts
 * 改动源头后的「下游失效与清退」回归套件
 *
 * 历史沿革：本文件原测 CascadeRevisionEngine（ASSET_DEPENDENCY_MATRIX /
 * resolveAffectedSteps / findDirtyShotsForEntity / executeCascadeRevision）。
 * 该引擎已被两条更简单的机制取代，本套件随之迁移：
 *
 *   1. 改哪一份产物 —— 由 source-resolver 按「属性类别」裁决，不再按实体；
 *   2. 下游怎么办 —— 由引擎 onSuccess 按「本次真实改动的阶段」清退，不再自动重推。
 *
 * 因此旧的四条不变量对应关系如下：
 *   依赖矩阵完整性      → 阶段序列是唯一真相（catalog 与 types 必须一致）
 *   按当前阶段截断      → cascadeStages 只含「已落盘」的下游阶段
 *   反查受实体波及的镜头 → 局部精修改「只动目标角色」，其余角色 100% 原样
 *   端到端自动重推      → 端到端清退：下游产物与旧门禁一并失效，阶段回退
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { LLMRegistry } from '../../src/llm/LLMRegistry.js';
import { MockLLMService } from '../../src/llm/MockLLMService.js';
import { WorkflowStage, STAGE_SEQUENCE, SessionStatus } from '../../src/types/index.js';
import { resolveModifySource, modifierWorkflow } from '../../src/agents/director/modifier/index.js';
import { DERIVED_STAGE_SEQUENCE } from '../../src/agents/director/catalog.js';
import { registerPipelineWorkflows } from '../../src/agents/director/generator/index.js';
import { Workflow } from '../../src/workflow-engine/index.js';

describe('CascadeRevision - 改动源头后的下游失效与清退', () => {
  const store = ProjectStore.getInstance();
  const testProjectId = 'test_proj_cascade_revision_engine';
  const testSessionId = 'test_sess_cascade_revision';
  let mockLLM: MockLLMService;

  before(() => {
    registerPipelineWorkflows();
    mockLLM = new MockLLMService();
    LLMRegistry.set(mockLLM);

    try {
      store.deleteProject(testProjectId);
    } catch {}

    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '因果级联测试工程',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.KEYFRAME_REFERENCE,
      stageArtifacts: {
        // 角色事实唯一来源：故事圣经。定妆产物只存视觉派生（name 为关联键）。
        [WorkflowStage.NARRATIVE_DESIGN]: {
          title: '末日回响',
          logline: '特工阿诺在废墟都市追查记忆黑市',
          style: '赛博朋克，暗冷影调',
          goldenSpine: [{ act: 1, name: '启程', summary: '阿诺接下委托', targetDurationSec: 60 }],
          characters: [
            {
              name: '阿诺',
              role: '主角',
              gender: '男',
              age: 35,
              appearance: '硬朗短发，灰色夹克',
              personality: '冷峻寡言',
              motivation: '找回被抹除的记忆',
            },
            {
              name: '艾米',
              role: '女主',
              gender: '女',
              age: 28,
              appearance: '干练马尾，白大褂',
              personality: '理性克制',
              motivation: '完成神经接口实验',
            },
          ],
          characterNames: ['阿诺', '艾米'],
        },
        [WorkflowStage.CHARACTER_DESIGN]: {
          characters: [
            {
              name: '阿诺',
              visualPrompt: '硬朗短发，灰色夹克，特工神情',
              imageUrl: 'http://mock.media/char_arnold_v1.png',
              history: [],
            },
            {
              name: '艾米',
              visualPrompt: '干练马尾，白大褂，研究员',
              imageUrl: 'http://mock.media/char_amy_v1.png',
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
              characterNames: ['阿诺'],
            },
            {
              shotId: 'shot_2',
              nodeId: 'node_1',
              shotNumber: 2,
              shotScale: '中景',
              cameraMovement: '移',
              visualComposition: '艾米在实验室操作控制台',
              characterNames: ['艾米'],
            },
          ],
          totalShots: 2,
          estimatedTotalDurationSec: 8,
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
              status: 'ready',
            },
            {
              shotId: 'shot_2',
              shotNumber: 2,
              subjectAppearance: '干练马尾，白大褂',
              sceneEnvironment: '明亮实验室',
              prompt: '中景镜头，艾米在实验室，干练马尾',
              imageUrl: 'http://mock.media/shot_2_v1.png',
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
    } as any);

    store.createSession(testProjectId, '测试会话', WorkflowStage.KEYFRAME_REFERENCE, testSessionId);
  });

  after(() => {
    try {
      store.deleteProject(testProjectId);
    } catch {}
    LLMRegistry.reset();
  });

  it('1. 工序依赖链只有一份真相：目录派生序列必须与阶段枚举逐项一致', () => {
    assert.deepEqual(
      DERIVED_STAGE_SEQUENCE,
      STAGE_SEQUENCE,
      'catalog 派生的阶段序列与 types.STAGE_SEQUENCE 必须完全一致，杜绝第二份依赖矩阵'
    );

    // 语义链：叙事设定是一切之下游的事实来源，视频在关键帧之后
    const order = (s: WorkflowStage) => STAGE_SEQUENCE.indexOf(s);
    assert.ok(order(WorkflowStage.NARRATIVE_DESIGN) < order(WorkflowStage.CHARACTER_DESIGN));
    assert.ok(order(WorkflowStage.CHARACTER_DESIGN) < order(WorkflowStage.STORYBOARD));
    assert.ok(order(WorkflowStage.STORYBOARD) < order(WorkflowStage.KEYFRAME_REFERENCE));
    assert.ok(order(WorkflowStage.KEYFRAME_REFERENCE) < order(WorkflowStage.VIDEO_PRODUCTION));
  });

  it('2. 级联波及范围只含已落盘的下游阶段，绝不跨越尚未生成的工序', () => {
    // 改的是角色客观外观 → 属设定事实，源头必须是故事圣经（不是定妆照）
    const plan = resolveModifySource(testProjectId, {
      target: '阿诺',
      content: '改成身穿黑色长风衣，戴防风护目镜',
      currentStage: WorkflowStage.KEYFRAME_REFERENCE,
      skillHint: 'character-portrait',
    });

    assert.equal(plan.sourceSkill, 'story-bible', '外观是角色事实，必须回事实源头改');
    assert.equal(plan.sourceStage, WorkflowStage.NARRATIVE_DESIGN);

    // 已落盘的下游：定妆、分镜、关键帧
    assert.deepEqual(
      plan.cascadeStages,
      [WorkflowStage.CHARACTER_DESIGN, WorkflowStage.STORYBOARD, WorkflowStage.KEYFRAME_REFERENCE],
      '波及范围必须是「源头之后且已有产物」的阶段，按阶段序排列'
    );
    // 未生成的工序不得被波及：场景剧本与视频都还没有产物
    assert.ok(!plan.cascadeStages.includes(WorkflowStage.SCENE_SCRIPT), '无产物的工序不进波及范围');
    assert.ok(!plan.cascadeStages.includes(WorkflowStage.VIDEO_PRODUCTION), '未生成的未来工序绝不能被波及');
  });

  it('3. 局部精修只动目标角色，其余角色 100% 物理原样', async () => {
    mockLLM.setStageHandler('character_refine', () => ({
      refinedVisualPrompt: '硬朗短发，灰色夹克，眼神如刀，冷峻特工',
    }));

    const res: any = await modifierWorkflow.execute({
      inputData: {
        projectId: testProjectId,
        targetSkill: 'character-portrait',
        actionType: 'TARGETED_REVISE',
        target: '阿诺',
        userFeedback: '让他的眼神更冷峻一点',
        payload: { isMock: true, target: '阿诺' },
      },
    });

    const chars = res.toolResult.characters;
    const arnold = chars.find((c: any) => c.name === '阿诺');
    const amy = chars.find((c: any) => c.name === '艾米');

    assert.match(arnold.visualPrompt, /眼神如刀/, '目标角色的视觉提示词必须被重写');
    assert.equal(amy.visualPrompt, '干练马尾，白大褂，研究员', '旁的角色视觉提示词 100% 原样');
    assert.equal(amy.imageUrl, 'http://mock.media/char_amy_v1.png', '旁的角色定妆照 100% 原样');
    assert.match(res.lastSummary, /其余 1 位角色 100% 物理保持原状/);

    // 重绘前的旧版必须压栈，可回溯
    assert.ok(arnold.history.length >= 1, '旧版定妆必须压入版本历史');
    assert.equal(arnold.history[0].imageUrl, 'http://mock.media/char_arnold_v1.png');

    // 定妆条目不得回写角色事实（唯一来源是故事圣经）
    assert.equal(arnold.appearance, undefined, '定妆产物不得携带 appearance 事实副本');
    assert.equal(arnold.age, undefined, '定妆产物不得携带 age 事实副本');

    mockLLM.resetCustomHandlers();
  });

  it('4. 端到端：微调成功的下游产物与旧门禁一并清退，阶段回退到最新有效起点', async () => {
    mockLLM.setStageHandler('character_refine', () => ({
      refinedVisualPrompt: '硬朗短发，灰色夹克，雨夜逆光剪影',
    }));

    const engine = Workflow.getInstance();
    const dispatchRes = await engine.dispatch({
      projectId: testProjectId,
      sessionId: testSessionId,
      workflowKey: 'character-portrait',
      actionType: 'TARGETED_REVISE',
      reason: '把阿诺的定妆改成雨夜逆光剪影',
      userPrompt: '把阿诺的定妆改成雨夜逆光剪影',
      parameters: { target: '阿诺', isMock: true },
    });

    assert.equal(dispatchRes.success, true);
    assert.ok(dispatchRes.task);

    const exec: any = await engine.executeTask({
      projectId: testProjectId,
      taskId: dispatchRes.task.taskId,
    });
    assert.equal(exec.success, true, `任务必须执行成功: ${exec.error || ''}`);
    assert.equal(exec.task.status, 'succeeded');

    const project = store.getProject(testProjectId)!;
    const artifacts: any = project.stageArtifacts || {};

    // 源头产物仍在，且已更新
    assert.ok(artifacts[WorkflowStage.CHARACTER_DESIGN], '改动源头本身必须保留');
    const arnold = artifacts[WorkflowStage.CHARACTER_DESIGN].characters.find(
      (c: any) => c.name === '阿诺'
    );
    assert.match(arnold.visualPrompt, /雨夜逆光剪影/, '源头产物必须已写入新结果');

    // 下游产物整体清退：不做「部分镜头保留」的局部拼接，避免新旧混排
    assert.equal(artifacts[WorkflowStage.STORYBOARD], undefined, '下游分镜必须失效');
    assert.equal(artifacts[WorkflowStage.KEYFRAME_REFERENCE], undefined, '下游关键帧必须失效');

    // 下游旧门禁必须一并清除，否则新产物会被旧 PASS 放行
    assert.equal(
      artifacts[`critic_review_${WorkflowStage.KEYFRAME_REFERENCE}`],
      undefined,
      '下游旧质检门禁必须清除'
    );

    // 阶段回退到本次改动所在阶段，客户端才能正确高亮「最新有效起点」
    assert.equal(project.currentStage, WorkflowStage.CHARACTER_DESIGN);

    mockLLM.resetCustomHandlers();
  });
});
