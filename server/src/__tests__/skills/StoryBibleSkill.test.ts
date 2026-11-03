import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { StoryBibleSkill } from '../../skills/story-bible/StoryBibleSkill.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { LLMRegistry } from '../../llm/LLMRegistry.js';
import { WorkflowStage, SessionStatus } from '../../types/index.js';
import type { LLMService, LLMOptions } from '../../llm/LLMService.js';

class MockStoryBibleLLM implements LLMService {
  hasVisionCapability(): boolean { return true; }
  async generateText(): Promise<string> { return ''; }
  async generateTextWithImages(): Promise<string> { return ''; }
  async generateMultiTurn(): Promise<string> { return ''; }
  async generateMultiTurnStream(): Promise<string> { return ''; }

  async generateObject<T>(_prompt: string, _schema: any, _sys?: string, options?: LLMOptions): Promise<T> {
    if (options?.stage === 'story_spine') {
      return {
        title: '命运齿轮',
        theme: '自由意志与宿命',
        style: '蒸汽朋克',
        logline: '钟表匠学徒发现时间倒流的怀表。',
        sellingPoints: ['时空循环解谜'],
        goldenSpine: [
          { act: 1, name: '怀表失窃', summary: '师傅被刺，怀表被盗', targetDurationSec: 60, cliffhanger: '怀表在主角口袋中' },
          { act: 2, name: '时间回溯', summary: '主角回到一天前', targetDurationSec: 60, cliffhanger: '凶手竟是未来的自己' },
          { act: 3, name: '打破轮回', summary: '牺牲怀表拯救师傅', targetDurationSec: 60, cliffhanger: '时间恢复流逝' },
        ],
      } as T;
    }

    if (options?.stage === 'pivot_points') {
      return {
        macroPivotPoints: [
          {
            id: 'pivot_1',
            act: 1,
            decisionMoment: '追击凶手还是保护怀表',
            choices: [
              { choiceId: 'c1', text: '追击凶手', dramaticImpact: '得知未来线索' },
              { choiceId: 'c2', text: '护送怀表', dramaticImpact: '解密怀表构造' },
            ],
          },
        ],
        microPivotPoints: [],
      } as T;
    }

    if (options?.stage === 'story_graph') {
      return {
        rootNodeId: 'node_1',
        endingsCount: 2,
        estimatedBranches: 3,
        nodes: [
          {
            id: 'node_1',
            act: 1,
            title: '钟表店清晨',
            summary: '平静的开始',
            location: '钟表店',
            characterNames: ['学徒阿诺'],
            isEnding: false,
            choices: [{ targetNodeId: 'node_2', text: '开门营业' }],
          },
          {
            id: 'node_2',
            act: 2,
            title: '结局',
            summary: '真相大白',
            location: '钟楼顶层',
            characterNames: ['学徒阿诺'],
            isEnding: true,
            choices: [],
          },
        ],
      } as T;
    }

    if (options?.stage === 'character_profiles') {
      return {
        characters: [
          {
            name: '学徒阿诺',
            role: '男主角',
            appearance: '戴单目放大镜，棕色工装皮围裙',
            personality: '心细执着',
            motivation: '探寻时钟跳动的终极奥秘',
          },
        ],
      } as T;
    }

    return {} as T;
  }
}

describe('StoryBibleSkill 故事圣经推演技能', () => {
  const store = ProjectStore.getInstance();
  const skill = new StoryBibleSkill();
  const testProjectId = 'test_proj_story_bible';
  const testSessionId = 'test_sess_story_bible';

  before(() => {
    LLMRegistry.set(new MockStoryBibleLLM());

    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '未命名项目',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: { idea: '', style: '蒸汽朋克', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    });

    store.createSession(testProjectId, '创作讨论', WorkflowStage.NARRATIVE_DESIGN, testSessionId);
  });

  it('缺少 idea 构思时刚性 Fail-Fast 阻断，拒绝空跑', async () => {
    const res = await skill.execute({
      projectId: testProjectId,
      params: { idea: '' },
    });

    assert.equal(res.success, false);
    if (!res.success) {
      assert.match(res.error, /推演故事圣经必须提供明确的故事构思/);
    }
  });

  it('完整推演故事圣经：落盘黑板、更新项目标题并同步白板', async () => {
    const res = await skill.execute({
      projectId: testProjectId,
      sessionId: testSessionId,
      params: {
        idea: '钟表匠学徒穿越时间',
        style: '蒸汽朋克',
      },
    });

    assert.equal(res.success, true);
    if (res.success) {
      const artifact = res.data;
      assert.equal(artifact.title, '命运齿轮');
      assert.equal(artifact.goldenSpine.length, 3);
      assert.equal(artifact.characters.length, 1);
      assert.equal(artifact.characters[0].name, '学徒阿诺');

      // 项目标题自动被更新为故事标题
      const updatedProj = store.getProject(testProjectId);
      assert.equal(updatedProj?.title, '命运齿轮');

      // 白板已同步
      const scratchpad = store.getScratchpad(testProjectId, testSessionId);
      assert.match(scratchpad.logline || '', /钟表匠学徒/);
      assert.match(scratchpad.charactersSummary || '', /学徒阿诺/);
    }
  });
});
