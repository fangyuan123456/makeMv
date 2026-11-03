import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { CriticReviewSkill } from '../../skills/critic-review/CriticReviewSkill.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { LLMRegistry } from '../../llm/LLMRegistry.js';
import { WorkflowStage, SessionStatus } from '../../types/index.js';
import type { LLMService, LLMOptions } from '../../llm/LLMService.js';

class MockCriticReviewSkillLLM implements LLMService {
  hasVisionCapability(): boolean { return true; }
  async generateText(): Promise<string> { return ''; }
  async generateTextWithImages(): Promise<string> { return ''; }
  async generateMultiTurn(): Promise<string> { return ''; }
  async generateMultiTurnStream(): Promise<string> { return ''; }

  async generateObject<T>(_prompt: string, _schema: any, _sys?: string, options?: LLMOptions): Promise<T> {
    if (options?.stage?.startsWith('critic_audit')) {
      return {
        thoughtChain: '因果逻辑连贯，角色动机清晰，无逻辑硬伤。',
        crossStageInsights: {
          characterConsistency: '人物弧光自洽',
          branchValidity: '分支张力充分',
          visualFeasibility: '视听方案具备可行性',
        },
        gateStatus: 'PASS',
        scores: {
          narrativeLogicScore: 88,
          characterDepthScore: 85,
          branchTensionScore: 90,
          visualFeasibilityScore: 82,
          overallScore: 86,
        },
        criticalFlaws: [],
        polishSuggestions: ['分镜景别可以进一步丰富'],
        verdict: '全景交叉审计通过，准许推进后续工序',
      } as T;
    }

    return {} as T;
  }
}

describe('CriticReviewSkill 独立影视审查官质检技能', () => {
  const store = ProjectStore.getInstance();
  const criticSkill = new CriticReviewSkill();
  const mockLLM = new MockCriticReviewSkillLLM();
  const testProjectId = 'test_proj_critic_skill';

  before(() => {
    LLMRegistry.set(mockLLM);

    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '命运齿轮',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: { idea: '蒸汽朋克', style: '复古蒸汽朋克', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    });
  });

  it('执行跨工序审查官审计，产物存入 critic_review 专属槽位且不污染业务工序', async () => {
    // 注入 NARRATIVE_DESIGN 资产
    store.setArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN, {
      title: '命运齿轮',
      theme: '自由意志',
      characters: [{ name: '雷恩', role: '主角' }],
    });

    const res = await criticSkill.execute({
      projectId: testProjectId,
      params: { targetStage: WorkflowStage.NARRATIVE_DESIGN },
    });

    assert.equal(res.success, true);
    if (res.success) {
      const report = res.data;
      assert.equal(report.gateStatus, 'PASS');
      assert.equal(report.scores.overallScore, 86);
      assert.match(res.summary, /🟢【准许放行】/);

      // 验证状态黑板中 critic_review 槽位落盘
      const saved = store.getArtifact<any>(testProjectId, 'critic_review');
      assert.ok(saved);
      assert.equal(saved.gateStatus, 'PASS');

      // 验证 BaseSkill category: 'critic' 绝不覆写业务工序资产 (NARRATIVE_DESIGN 仍然是原始故事圣经)
      const narrative = store.getArtifact<any>(testProjectId, WorkflowStage.NARRATIVE_DESIGN);
      assert.equal(narrative.title, '命运齿轮');
      assert.equal(narrative.theme, '自由意志');
    }
  });
});
