/**
 * tests/mastra/ModifySourceMediaGuard.test.ts
 * 媒体轨二次校验 + 多源头附加诉求检测的回归套件
 *
 * 两个洞：
 *   1. 规则只要命中一个画面词就派发媒体轨，而媒体轨的收尾是重新出图——整条链路
 *      上唯一花真钱的动作。规则是闭集、表达是开集，「她看着有点憔悴」里命中的是
 *      「看着」，真正要改的可能是角色外观。花一次生图钱买一张要扔的图，比多花
 *      1.5s 问一句贵得多。
 *   2. 一句话里两个跨源头诉求（「台词压短，镜头换中景」）只有一个裁决结果，
 *      后半句静默消失——创作者以为改了两处，实际只改了一处。
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { LLMRegistry } from '../../src/llm/LLMRegistry.js';
import { MockLLMService } from '../../src/llm/MockLLMService.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';
import { resolveModifySource } from '../../src/agents/director/modifier/index.js';
import { clearAttributeClassifierCache } from '../../src/agents/director/modifier/attribute-classifier.js';
import { registerPipelineWorkflows } from '../../src/agents/director/orchestration/index.js';

describe('ModifySourceMediaGuard - 派发媒体轨前复核，附加源头不得静默丢弃', () => {
  const store = ProjectStore.getInstance();
  const projectId = 'test_proj_media_guard';
  const stage = WorkflowStage.KEYFRAME_REFERENCE;
  let mockLLM: MockLLMService;

  before(() => {
    registerPipelineWorkflows();
    mockLLM = new MockLLMService();
    LLMRegistry.set(mockLLM);

    try {
      store.deleteProject(projectId);
    } catch {
      /* 首次运行无旧项目 */
    }

    store.saveProject({
      projectId,
      title: '媒体轨复核',
      status: SessionStatus.IDLE,
      currentStage: stage,
      stageArtifacts: {
        [WorkflowStage.NARRATIVE_DESIGN]: {
          title: '钟表工坊',
          characters: [{ name: '张明', characterId: 'char_zhangming', role: '主角', age: 40 }],
          characterNames: ['张明'],
        },
        [WorkflowStage.SCENE_SCRIPT]: {
          scenes: [{ sceneId: 'scene_2', sceneTitle: '第二场 钟表工坊', dialogues: [] }],
        },
        [WorkflowStage.STORYBOARD]: {
          shots: [{ shotId: 'shot_1', shotScale: '特写' }],
        },
        [WorkflowStage.CHARACTER_DESIGN]: {
          portraits: [{ characterName: '张明', imagePath: '/tmp/zm.png' }],
        },
        [WorkflowStage.KEYFRAME_REFERENCE]: {
          shots: [{ shotId: 'shot_1', keyImageUrl: 'http://mock/kf1.png' }],
        },
      },
    } as any);
  });

  beforeEach(() => {
    clearAttributeClassifierCache();
    mockLLM.resetCustomHandlers();
  });

  after(() => {
    clearAttributeClassifierCache();
    mockLLM.resetCustomHandlers();
    try {
      store.deleteProject(projectId);
    } catch {
      /* 清理无旧项目 */
    }
  });

  /** 模糊画面词：「看着」命中观感副词，但没点名任何媒体资产 */
  const VAGUE_VISUAL = '她看着有点憔悴';

  it('1. 已点名媒体资产时不做二次校验（不添延迟、不改判）', async () => {
    let calls = 0;
    const plan = await resolveModifySource(projectId, {
      target: '张明',
      content: '这张定妆照的光影再柔一点',
      currentStage: stage,
      classify: async () => {
        calls += 1;
        return { attribute: 'appearance', confidence: 0.95 };
      },
    });
    assert.equal(calls, 0, '创作者已点名「定妆照」，无需复核');
    assert.equal(plan.sourceSkill, 'character-portrait');
    assert.equal(plan.basis, 'media-asset');
  });

  it('2. 复核发现是外观诉求：改判到故事圣经，不花生图钱', async () => {
    const plan = await resolveModifySource(projectId, {
      target: '张明',
      content: VAGUE_VISUAL,
      currentStage: stage,
      classify: async () => ({ attribute: 'appearance', confidence: 0.85 }),
    });
    assert.equal(plan.sourceSkill, 'story-bible', '外观是角色事实，源头在故事圣经');
    assert.equal(plan.attribute, 'appearance');
    assert.equal(plan.basis, 'text-source');
    assert.match(plan.reason, /媒体轨复核改判/, '理由里必须写清这次改判来自复核');
  });

  it('3. 复核同意画面诉求时保持媒体轨', async () => {
    const plan = await resolveModifySource(projectId, {
      target: '张明',
      content: VAGUE_VISUAL,
      currentStage: stage,
      classify: async () => ({ attribute: 'visual', confidence: 0.9 }),
    });
    assert.equal(plan.sourceSkill, 'character-portrait');
    assert.equal(plan.basis, 'media-asset');
  });

  it('4. 置信度不高于 0.7 不改判（改判门槛高于补判 unknown）', async () => {
    const plan = await resolveModifySource(projectId, {
      target: '张明',
      content: VAGUE_VISUAL,
      currentStage: stage,
      classify: async () => ({ attribute: 'appearance', confidence: 0.7 }),
    });
    assert.equal(plan.sourceSkill, 'character-portrait', '0.7 不够：误改判会「改了但画面没变」');
    assert.equal(plan.basis, 'media-asset');
  });

  it('5. 复核抛错或弃权时保持原裁决，不阻塞修改', async () => {
    const broken = await resolveModifySource(projectId, {
      target: '张明',
      content: VAGUE_VISUAL,
      currentStage: stage,
      classify: async () => {
        throw new Error('模型超时');
      },
    });
    assert.equal(broken.sourceSkill, 'character-portrait');

    const abstained = await resolveModifySource(projectId, {
      target: '张明',
      content: VAGUE_VISUAL,
      currentStage: stage,
      classify: async () => ({ attribute: 'unknown', confidence: 0.95 }),
    });
    assert.equal(abstained.sourceSkill, 'character-portrait');
  });

  it('6. classify=null 时复核完全不发生', async () => {
    const plan = await resolveModifySource(projectId, {
      target: '张明',
      content: VAGUE_VISUAL,
      currentStage: stage,
      classify: null,
    });
    assert.equal(plan.sourceSkill, 'character-portrait');
    assert.equal(plan.basis, 'media-asset');
  });

  it('7. 跨源头双诉求：主裁决不变，第二个源头必须记录在案', async () => {
    const plan = await resolveModifySource(projectId, {
      target: '',
      content: '台词压短，镜头换中景',
      currentStage: stage,
      classify: null,
    });
    assert.equal(plan.sourceSkill, 'scene-script', '主裁决仍是先命中的台词');
    assert.ok(plan.additionalAsks && plan.additionalAsks.length === 1, '不得丢掉镜头那半句');
    assert.equal(plan.additionalAsks![0].sourceSkill, 'storyboard');
    assert.equal(plan.additionalAsks![0].attribute, 'shot');
    assert.equal(plan.additionalAsks![0].relation, 'merged', '同为文本轨：主单的跨文件补丁会一并改到');
    assert.match(plan.additionalAsks![0].clause, /镜头/);
  });

  it('7.1 上游诉求只能记录：追加会把主单产物清退', async () => {
    const plan = await resolveModifySource(projectId, {
      target: '张明',
      content: '让她显得年轻些，另外发型换成寸头',
      currentStage: stage,
      classify: null,
    });
    assert.equal(plan.sourceSkill, 'character-portrait', '观感词先命中，落定妆');
    const ask = plan.additionalAsks?.[0];
    assert.equal(ask?.sourceSkill, 'story-bible', '发型是角色事实');
    assert.equal(ask?.relation, 'upstream', '故事圣经在定妆上游，改它会清掉刚出的定妆');
  });

  it('7.2 下游诉求可追加：等主单落地后再接', async () => {
    const plan = await resolveModifySource(projectId, {
      target: '',
      content: '台词再压短些，另外关键帧的光影调暗一点',
      currentStage: stage,
      classify: null,
    });
    assert.equal(plan.sourceSkill, 'scene-script');
    const ask = plan.additionalAsks?.find((a) => a.sourceSkill === 'keyframe-reference');
    assert.equal(ask?.relation, 'downstream', '关键帧在剧本下游，可以等主单完成后接单');
  });

  it('8. 画面诉求藏在第二个分句里：主裁决改台词，画面那头也必须记录', async () => {
    const plan = await resolveModifySource(projectId, {
      target: '张明',
      content: '台词再压短些，另外这张定妆照的光影调暗一点',
      currentStage: stage,
      classify: null,
    });
    assert.equal(plan.sourceSkill, 'scene-script', '主裁决仍是先命中的台词');
    assert.ok(
      plan.additionalAsks?.some((a) => a.sourceSkill === 'character-portrait'),
      '媒体轨诉求不得因为排在第二个分句就被吞掉'
    );
  });

  it('9. 不误报：否定从句与无属性分句都不算附加诉求', async () => {
    const negated = await resolveModifySource(projectId, {
      target: '张明',
      content: '这张定妆照的光影调暗一点，别改设定',
      currentStage: stage,
      classify: null,
    });
    assert.deepEqual(negated.additionalAsks, [], '「别改设定」是约束不是诉求');

    const noAttribute = await resolveModifySource(projectId, {
      target: '',
      content: '这张关键帧的光影调暗一点，符合剧情氛围',
      currentStage: stage,
      classify: null,
    });
    assert.deepEqual(noAttribute.additionalAsks, []);
  });

  it('10. 单句诉求不会凭空多出附加源头', async () => {
    const plan = await resolveModifySource(projectId, {
      target: '张明',
      content: '把张明在第二场的台词改得凶狠一点',
      currentStage: stage,
      classify: null,
    });
    assert.equal(plan.sourceSkill, 'scene-script');
    assert.deepEqual(plan.additionalAsks, []);
  });
});
