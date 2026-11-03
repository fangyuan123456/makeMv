import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { GateGuard } from '../../agents/reviewer/GateGuard.js';
import { SkillRegistry } from '../../skills/SkillRegistry.js';
import { WorkflowStage } from '../../types/index.js';
import { BaseSkill } from '../../skills/BaseSkill.js';
import type { ReviewReport } from '../../agents/reviewer/types.js';
import type { SkillManifest } from '../../skills/types.js';

describe('GateGuard 统一工序门禁判定器', () => {
  before(() => {
    // 注册测试用技能
    const registry = SkillRegistry.getInstance();

    class MockStoryBibleSkill extends BaseSkill {
      public readonly manifest: SkillManifest = {
        name: 'story-bible',
        displayName: '故事圣经',
        description: '故事世界观推演',
        category: 'narrative',
        targetStage: WorkflowStage.NARRATIVE_DESIGN,
      };
      protected async run() {
        return { data: {}, summary: '' };
      }
    }

    class MockCharacterSkill extends BaseSkill {
      public readonly manifest: SkillManifest = {
        name: 'character-portrait',
        displayName: '角色定妆',
        description: '角色定妆照生成',
        category: 'character',
        targetStage: WorkflowStage.CHARACTER_DESIGN,
      };
      protected async run() {
        return { data: {}, summary: '' };
      }
    }

    class MockCriticSkill extends BaseSkill {
      public readonly manifest: SkillManifest = {
        name: 'critic-review',
        displayName: '审查官质检',
        description: '独立挑刺质检',
        category: 'critic',
        targetStage: WorkflowStage.NARRATIVE_DESIGN,
      };
      protected async run() {
        return { data: {}, summary: '' };
      }
    }

    registry.register(new MockStoryBibleSkill());
    registry.register(new MockCharacterSkill());
    registry.register(new MockCriticSkill());
  });

  it('无质检报告时直接放行', () => {
    const res = GateGuard.check('character-portrait', WorkflowStage.NARRATIVE_DESIGN, null);
    assert.equal(res.passed, true);
  });

  it('质检报告状态为 PASS 或 WARN 时直接放行', () => {
    const passReport: ReviewReport = {
      projectName: 'Test',
      stageReviewed: WorkflowStage.NARRATIVE_DESIGN,
      gateStatus: 'PASS',
      scores: {
        narrativeLogicScore: 90,
        characterDepthScore: 90,
        branchTensionScore: 90,
        visualFeasibilityScore: 90,
        overallScore: 90,
      },
      thoughtChain: '',
      criticalFlaws: [],
      polishSuggestions: [],
      verdict: '通过',
      reviewedAt: new Date().toISOString(),
    };

    const warnReport: ReviewReport = {
      ...passReport,
      gateStatus: 'WARN',
      scores: { ...passReport.scores, overallScore: 70 },
    };

    assert.equal(GateGuard.check('character-portrait', WorkflowStage.NARRATIVE_DESIGN, passReport).passed, true);
    assert.equal(GateGuard.check('character-portrait', WorkflowStage.NARRATIVE_DESIGN, warnReport).passed, true);
  });

  it('质检报告标记为 STALE 时直接放行（旧报告已失效）', () => {
    const staleReport: ReviewReport = {
      projectName: 'Test',
      stageReviewed: WorkflowStage.NARRATIVE_DESIGN,
      gateStatus: 'STALE',
      isStale: true,
      scores: {
        narrativeLogicScore: 50,
        characterDepthScore: 50,
        branchTensionScore: 50,
        visualFeasibilityScore: 50,
        overallScore: 50,
      },
      thoughtChain: '',
      criticalFlaws: [{ severity: 'CRITICAL', dimension: 'LOGIC', location: '1', description: 'err', suggestion: 'fix' }],
      polishSuggestions: [],
      verdict: '已失效',
      reviewedAt: new Date().toISOString(),
    };

    const res = GateGuard.check('character-portrait', WorkflowStage.NARRATIVE_DESIGN, staleReport);
    assert.equal(res.passed, true);
  });

  it('报告属于其他工序时不产生跨工序误伤，直接放行', () => {
    const otherStageReport: ReviewReport = {
      projectName: 'Test',
      stageReviewed: WorkflowStage.SCENE_SCRIPT, // 属于分场剧本，而非当前叙事设计
      gateStatus: 'FAIL',
      scores: {
        narrativeLogicScore: 40,
        characterDepthScore: 40,
        branchTensionScore: 40,
        visualFeasibilityScore: 40,
        overallScore: 40,
      },
      thoughtChain: '',
      criticalFlaws: [{ severity: 'CRITICAL', dimension: 'LOGIC', location: '1', description: 'err', suggestion: 'fix' }],
      polishSuggestions: [],
      verdict: '严重缺陷',
      reviewedAt: new Date().toISOString(),
    };

    const res = GateGuard.check('character-portrait', WorkflowStage.NARRATIVE_DESIGN, otherStageReport);
    assert.equal(res.passed, true);
  });

  it('当前工序处于 FAIL 阻断时，刚性拦截推进下一工序技能', () => {
    const failReport: ReviewReport = {
      projectName: 'Test',
      stageReviewed: WorkflowStage.NARRATIVE_DESIGN,
      gateStatus: 'FAIL',
      scores: {
        narrativeLogicScore: 45,
        characterDepthScore: 45,
        branchTensionScore: 45,
        visualFeasibilityScore: 45,
        overallScore: 45,
      },
      thoughtChain: '存在逻辑崩塌',
      criticalFlaws: [{ severity: 'CRITICAL', dimension: 'LOGIC', location: '第1幕', description: '动机不成立', suggestion: '修改' }],
      polishSuggestions: [],
      verdict: '拦截',
      reviewedAt: new Date().toISOString(),
    };

    // character-portrait 属于 CHARACTER_DESIGN，下一阶段，必须被拦截
    const res = GateGuard.check('character-portrait', WorkflowStage.NARRATIVE_DESIGN, failReport);
    assert.equal(res.passed, false);
    assert.equal(res.gateStatus, 'FAIL');
    assert.match(res.reason || '', /CRITICAL 核心缺陷/);
  });

  it('当前工序处于 FAIL 阻断时，允许当前工序技能自愈重推或审查官质检', () => {
    const failReport: ReviewReport = {
      projectName: 'Test',
      stageReviewed: WorkflowStage.NARRATIVE_DESIGN,
      gateStatus: 'FAIL',
      scores: {
        narrativeLogicScore: 45,
        characterDepthScore: 45,
        branchTensionScore: 45,
        visualFeasibilityScore: 45,
        overallScore: 45,
      },
      thoughtChain: '',
      criticalFlaws: [{ severity: 'CRITICAL', dimension: 'LOGIC', location: '1', description: 'err', suggestion: 'fix' }],
      polishSuggestions: [],
      verdict: '拦截',
      reviewedAt: new Date().toISOString(),
    };

    // story-bible 属于 NARRATIVE_DESIGN（当前阶段自愈），允许放行
    const healingRes = GateGuard.check('story-bible', WorkflowStage.NARRATIVE_DESIGN, failReport);
    assert.equal(healingRes.passed, true);

    // critic-review 属于审查官质检技能，允许放行
    const criticRes = GateGuard.check('critic-review', WorkflowStage.NARRATIVE_DESIGN, failReport);
    assert.equal(criticRes.passed, true);
  });
});
