import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { CharacterPortraitSkill } from '../../skills/character-portrait/CharacterPortraitSkill.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { LLMRegistry } from '../../llm/LLMRegistry.js';
import { WorkflowStage, SessionStatus } from '../../types/index.js';
import type { LLMService, LLMOptions } from '../../llm/LLMService.js';

class MockCharacterPortraitLLM implements LLMService {
  hasVisionCapability(): boolean { return true; }
  async generateText(): Promise<string> { return ''; }
  async generateTextWithImages(): Promise<string> { return ''; }
  async generateMultiTurn(): Promise<string> { return ''; }
  async generateMultiTurnStream(): Promise<string> { return ''; }

  async generateObject<T>(_prompt: string, _schema: any, _sys?: string, options?: LLMOptions): Promise<T> {
    if (options?.stage === 'character_visual_spec') {
      return {
        specs: [
          { name: '雷恩', visualPrompt: '青年钟表匠，深棕色凌乱短发，穿着黄铜护目镜与工匠皮围裙，高精度电影质感' },
          { name: '艾莉亚', visualPrompt: '冷峻侦探，黑色风衣，银质怀表，高冷眼神，大师级光影' },
        ],
      } as T;
    }

    if (options?.stage === 'character_refine') {
      return {
        refinedVisualPrompt: '雷恩，眼神更坚定，脸上带着齿轮机油痕迹，蒸汽朋克皮革装束强化',
        designNotes: '增强了角色的工匠属性与眼神戏剧张力',
      } as T;
    }

    return {} as T;
  }
}

describe('CharacterPortraitSkill 角色定妆照生成技能', () => {
  const store = ProjectStore.getInstance();
  const portraitSkill = new CharacterPortraitSkill();
  const mockLLM = new MockCharacterPortraitLLM();
  const testProjectId = 'test_proj_char_portrait';

  before(() => {
    LLMRegistry.set(mockLLM);

    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '命运齿轮',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.CHARACTER_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: { idea: '蒸汽朋克钟表匠', style: '复古蒸汽朋克', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    });
  });

  it('缺少前序故事圣经角色小传时刚性 Fail-Fast 阻断', async () => {
    const res = await portraitSkill.execute({
      projectId: testProjectId,
      params: { isMock: true },
    });

    assert.equal(res.success, false);
    assert.match(res.error || '', /缺少前序故事圣经角色数据/);
  });

  it('全量推演并渲染角色定妆照，成功落盘黑板与本地清单', async () => {
    // 注入前序 NARRATIVE_DESIGN 资产
    store.setArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN, {
      title: '命运齿轮',
      style: '复古蒸汽朋克',
      characters: [
        { name: '雷恩', role: '主角', appearance: '年轻工匠', motivation: '探寻真相' },
        { name: '艾莉亚', role: '女主角', appearance: '高挑侦探', motivation: '破获迷案' },
      ],
    });

    const res = await portraitSkill.execute({
      projectId: testProjectId,
      params: { isMock: true },
    });

    assert.equal(res.success, true);
    if (res.success) {
      const artifact = res.data;
      assert.equal(artifact.totalCharacters, 2);
      assert.equal(artifact.characters.length, 2);
      assert.equal(artifact.characters[0].name, '雷恩');
      assert.ok(artifact.characters[0].visualPrompt.includes('青年钟表匠'));
      assert.ok(artifact.characters[0].imageUrl);
      assert.equal(artifact.characters[1].name, '艾莉亚');

      // 验证状态黑板落盘
      const saved = store.getArtifact<any>(testProjectId, WorkflowStage.CHARACTER_DESIGN);
      assert.ok(saved);
      assert.equal(saved.characters.length, 2);
    }
  });

  it('单角色微调自愈分支：针对指定角色定向重塑提示词并增量更新既有资产', async () => {
    const res = await portraitSkill.execute({
      projectId: testProjectId,
      params: {
        targetCharacterNames: ['雷恩'],
        userFeedback: '增加机油污渍与坚定眼神',
        isMock: true,
      },
    });

    assert.equal(res.success, true);
    if (res.success) {
      const artifact = res.data;
      assert.equal(artifact.characters.length, 2);
      const reyn = artifact.characters.find((c) => c.name === '雷恩');
      const arya = artifact.characters.find((c) => c.name === '艾莉亚');

      assert.ok(reyn);
      assert.ok(reyn.visualPrompt.includes('机油痕迹'));
      // 另一个角色必须完整保留，绝不能被冲刷清空
      assert.ok(arya);
      assert.equal(arya.name, '艾莉亚');

      // 验证自愈微调元数据
      assert.equal(artifact.isRefinement, true);
      assert.deepEqual(artifact.targetCharacterNames, ['雷恩']);
      assert.ok(artifact.updatedAt);
    }
  });

  it('指定不存在的 targetCharacterNames 时刚性报错拦截', async () => {
    const res = await portraitSkill.execute({
      projectId: testProjectId,
      params: {
        targetCharacterNames: ['不存在的神秘角色'],
        isMock: true,
      },
    });

    assert.equal(res.success, false);
    assert.match(res.error || '', /未在既有定妆资产中找到指定微调的目标角色/);
  });

  it('无既有定妆资产时指定 targetCharacterNames 刚性 Fail-Fast 报错', async () => {
    const emptyProjId = 'test_proj_char_empty_artifact';
    store.saveProject({
      projectId: emptyProjId,
      title: '空定妆资产项目',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.CHARACTER_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: { idea: '测试', style: '写实', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    store.setArtifact(emptyProjId, WorkflowStage.NARRATIVE_DESIGN, {
      title: '空项目',
      characters: [{ name: '雷恩', role: '主角' }],
    });

    const res = await portraitSkill.execute({
      projectId: emptyProjId,
      params: {
        targetCharacterNames: ['雷恩'],
        isMock: true,
      },
    });

    assert.equal(res.success, false);
    assert.match(res.error || '', /当前项目尚无既有角色定妆资产/);
  });
});
