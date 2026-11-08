/**
 * tests/mastra/ModifyAttributeClassifier.test.ts
 * 修改诉求属性补判（模型只补 WHAT，且有权弃权）的回归套件
 *
 * 这套断言锁的是三个曾经把「一句抱怨变成一次重新生图」的漏洞：
 *
 *   1. 强制执行七选一的旧 schema 逼模型硬猜，「这个不行，换一个」被归到 media，
 *      随后真实派发媒体轨 TARGETED_REVISE —— 用户只是在表达不满，却扣了生图费用；
 *   2. 采纳阈值写成 `confidence < 0.5`，而模型自评「只能猜测」恰好给 0.5，
 *      于是最该被拒绝的那一档被放行了；
 *   3. 补判只拿到本轮一句话，「再短一点」无从知道短的是台词还是镜头时长——
 *      而这些省略句恰恰是最容易落 unknown、最需要补判的输入。
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { LLMRegistry } from '../../src/llm/LLMRegistry.js';
import { MockLLMService } from '../../src/llm/MockLLMService.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';
import { resolveModifySource } from '../../src/agents/director/modifier/index.js';
import {
  classifyModifyAttribute,
  clearAttributeClassifierCache,
} from '../../src/agents/director/modifier/attribute-classifier.js';
import { registerPipelineWorkflows } from '../../src/agents/director/generator/index.js';

describe('ModifyAttributeClassifier - 补判只补类别，且必须允许弃权', () => {
  const store = ProjectStore.getInstance();
  const projectId = 'test_proj_attribute_classifier';
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
      title: '补判回归',
      status: SessionStatus.IDLE,
      currentStage: stage,
      stageArtifacts: {
        [WorkflowStage.NARRATIVE_DESIGN]: {
          title: '钟表工坊',
          logline: '修表匠追查师傅之死',
          style: '赛博民国',
          characters: [
            { name: '张明', characterId: 'char_zhangming', role: '主角', gender: '男', age: 40 },
          ],
          characterNames: ['张明'],
          goldenSpine: [{ act: 1, name: '启程', summary: '师傅遇害', targetDurationSec: 60 }],
        },
        [WorkflowStage.SCENE_SCRIPT]: {
          scenes: [{ sceneId: 'scene_2', sceneTitle: '第二场 钟表工坊', dialogues: [] }],
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

  /** 词表全不命中的诉求，确保一定走到补判分支 */
  const UNKNOWN_LINE = '把他弄得沧桑一点';

  it('1. 模型弃权时不得改判：一句抱怨不能变成媒体轨重新生图', async () => {
    const plan = await resolveModifySource(projectId, {
      target: '',
      content: '这个不行，换一个',
      currentStage: stage,
      classify: async () => ({ attribute: 'unknown', confidence: 0.9 }),
    });
    assert.equal(plan.sourceSkill, 'keyframe-reference', '弃权后必须回落当前工作面');
    assert.equal(plan.attribute, 'unknown', '弃权后不得声称已判出属性');
    assert.notEqual(plan.basis, 'media-asset', '弃权绝不能走媒体轨');
  });

  it('2. 置信度恰好 0.5（模型自评在猜）不予采纳，0.6 才采纳', async () => {
    const guessing = await resolveModifySource(projectId, {
      target: '',
      content: '把它改回来',
      currentStage: stage,
      classify: async () => ({ attribute: 'media', confidence: 0.5 }),
    });
    assert.equal(guessing.sourceSkill, 'keyframe-reference', '0.5 属于「在猜」，必须拒绝');
    assert.notEqual(guessing.basis, 'media-asset');

    const sure = await resolveModifySource(projectId, {
      target: '张明',
      content: UNKNOWN_LINE,
      currentStage: stage,
      classify: async () => ({ attribute: 'appearance', confidence: 0.6 }),
    });
    assert.equal(sure.sourceSkill, 'story-bible', '0.6 视为有效判断');
    assert.equal(sure.attribute, 'appearance');
    assert.match(sure.reason, /模型补判/, '说明里必须标注这是模型补判');
  });

  it('3. 历史诉求透传给补判器，省略句才有上下文可依', async () => {
    let received: { content: string; history?: string[] } | undefined;
    const plan = await resolveModifySource(projectId, {
      target: '',
      content: '再短一点',
      currentStage: stage,
      history: ['第二场张明的台词太长了', '收一收'],
      classify: async (req) => {
        received = req;
        return { attribute: 'dialogue', confidence: 0.8 };
      },
    });
    assert.deepEqual(received?.history, ['第二场张明的台词太长了', '收一收']);
    assert.equal(received?.content, '再短一点');
    assert.equal(plan.sourceSkill, 'scene-script', '有上下文时「再短一点」应落到分场剧本');
  });

  it('4. 分类器抛错只降级、不影响裁决', async () => {
    const plan = await resolveModifySource(projectId, {
      target: '',
      content: UNKNOWN_LINE,
      currentStage: stage,
      classify: async () => {
        throw new Error('模型超时');
      },
    });
    assert.equal(plan.sourceSkill, 'keyframe-reference');
  });

  it('5. classify=null 时完全不调用模型（确定性脚本与单测的逃生口）', async () => {
    const plan = await resolveModifySource(projectId, {
      target: '',
      content: UNKNOWN_LINE,
      currentStage: stage,
      classify: null,
    });
    assert.equal(plan.attribute, 'unknown');
    assert.equal(plan.sourceSkill, 'keyframe-reference');
  });

  it('6. 同一句话重复补判命中缓存，不重复付费；历史不同则重新判', async () => {
    let calls = 0;
    mockLLM.setStageHandler('modify_attribute_classify', () => {
      calls += 1;
      return { attribute: 'appearance', confidence: 0.85, reason: '外观' };
    });

    const first = await classifyModifyAttribute({ content: UNKNOWN_LINE });
    assert.equal(first?.attribute, 'appearance');
    assert.equal(calls, 1);

    const second = await classifyModifyAttribute({ content: UNKNOWN_LINE });
    assert.equal(second?.attribute, 'appearance');
    assert.equal(calls, 1, '同一句话必须命中缓存');

    await classifyModifyAttribute({
      content: UNKNOWN_LINE,
      history: ['第二场台词要更狠'],
    });
    assert.equal(calls, 2, '历史变了就是另一种上下文，必须重新判');
  });

  it('7. 模型返回越界类别时按失败处理（不抛、不猜）', async () => {
    mockLLM.setStageHandler('modify_attribute_classify', () => ({
      attribute: 'haircut',
      confidence: 0.99,
    }));
    const res = await classifyModifyAttribute({ content: '把头发弄短' });
    assert.equal(res, undefined, '越界类别必须整体作废，而不是透传给调用方');
  });
});
