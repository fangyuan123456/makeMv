import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DirectorProposalResolver } from '../../agents/director/DirectorProposalResolver.js';
import { SkillRegistry } from '../../skills/SkillRegistry.js';
import { BaseSkill } from '../../skills/BaseSkill.js';
import { WorkflowStage } from '../../types/index.js';
import type { ReviewReport } from '../../agents/reviewer/types.js';
import type { SkillManifest } from '../../skills/types.js';
import type { ActionProposal } from '../../chat/session/types.js';

describe('DirectorProposalResolver 导演行动提案解析器', () => {
  before(() => {
    const registry = SkillRegistry.getInstance();

    class MockNarrativeSkill extends BaseSkill {
      public readonly manifest: SkillManifest = {
        name: 'story-bible',
        displayName: '故事圣经',
        description: '故事世界观推演',
        category: 'narrative',
        targetStage: WorkflowStage.NARRATIVE_DESIGN,
      };
      protected async run() { return { data: {}, summary: '' }; }
    }

    class MockCharacterSkill extends BaseSkill {
      public readonly manifest: SkillManifest = {
        name: 'character-portrait',
        displayName: '角色定妆',
        description: '角色定妆照生成',
        category: 'character',
        targetStage: WorkflowStage.CHARACTER_DESIGN,
      };
      protected async run() { return { data: {}, summary: '' }; }
    }

    class MockCriticSkill extends BaseSkill {
      public readonly manifest: SkillManifest = {
        name: 'critic-review',
        displayName: '审查官质检',
        description: '独立挑刺质检',
        category: 'critic',
        targetStage: WorkflowStage.NARRATIVE_DESIGN,
      };
      protected async run() { return { data: {}, summary: '' }; }
    }

    registry.register(new MockNarrativeSkill());
    registry.register(new MockCharacterSkill());
    registry.register(new MockCriticSkill());
  });

  const resolver = DirectorProposalResolver.getInstance();

  it('入参无效或非对象时安全返回 undefined', async () => {
    assert.equal(await resolver.resolveFromToolCall(null as any, WorkflowStage.NARRATIVE_DESIGN), undefined);
    assert.equal(await resolver.resolveFromToolCall('bad_input' as any, WorkflowStage.NARRATIVE_DESIGN), undefined);
  });

  it('未知技能标识刚性拦截，拒绝隐式降级', async () => {
    const res = await resolver.resolveFromToolCall(
      { skill: 'unknown-mystery-skill', label: '神秘工序' },
      WorkflowStage.NARRATIVE_DESIGN
    );
    assert.equal(res, undefined);
  });

  it('正常推进工序提案解析成功，状态为 pending 且挂载正确 payload', async () => {
    let capturedCallbackProposal: ActionProposal | undefined;
    const res = await resolver.resolveFromToolCall(
      {
        skill: 'character-portrait',
        label: '一键生成全剧定妆照',
        description: '角色小传已成熟，开始定妆',
        params: { styleOverride: '黑白胶片' },
      },
      WorkflowStage.NARRATIVE_DESIGN,
      null,
      {
        onProposal: async (p) => {
          capturedCallbackProposal = p;
        },
      }
    );

    assert.ok(res);
    assert.equal(res.actionType, 'TRIGGER_STAGE');
    assert.equal(res.skill, 'character-portrait');
    assert.equal(res.label, '一键生成全剧定妆照');
    assert.equal(res.status, 'pending');
    assert.equal(res.payload?.params?.styleOverride, '黑白胶片');
    assert.equal(capturedCallbackProposal?.actionId, res.actionId);
  });

  it('门禁 FAIL 阻断时，自动转化为审查官对辩自愈提案 (CRITIC_DEBATE)', async () => {
    const failReport: ReviewReport = {
      projectName: 'Test',
      stageReviewed: WorkflowStage.NARRATIVE_DESIGN,
      gateStatus: 'FAIL',
      scores: {
        narrativeLogicScore: 40,
        characterDepthScore: 40,
        branchTensionScore: 40,
        visualFeasibilityScore: 40,
        overallScore: 40,
      },
      thoughtChain: '',
      criticalFlaws: [{ severity: 'CRITICAL', dimension: 'LOGIC', location: '起幕', description: '缺少戏剧动因', suggestion: '补充' }],
      polishSuggestions: [],
      verdict: '阻断',
      reviewedAt: new Date().toISOString(),
    };

    // 试图推进到 character-portrait，将被 GateGuard 拦截
    const res = await resolver.resolveFromToolCall(
      {
        skill: 'character-portrait',
        label: '进入角色定妆',
        description: '推进下一阶段',
      },
      WorkflowStage.NARRATIVE_DESIGN,
      failReport
    );

    assert.ok(res);
    assert.equal(res.actionType, 'CRITIC_DEBATE');
    assert.equal(res.skill, 'critic-review');
    assert.equal(res.isGateIntercept, true);
    assert.match(res.label, /🚨 前往解决审查官刚性阻断/);
    assert.equal(res.payload?.interceptedSkill, 'character-portrait');
    assert.equal(res.payload?.targetStage, WorkflowStage.NARRATIVE_DESIGN);
    assert.equal(res.payload?.params?.targetStage, WorkflowStage.NARRATIVE_DESIGN);
    assert.equal(res.payload?.gateStatus, 'FAIL');
    assert.equal(res.payload?.hasHealingIntent, false);
  });

  it('门禁 FAIL 阻断但携带自愈反馈/微调参数时，生成自愈对辩提案', async () => {
    const failReport: ReviewReport = {
      projectName: 'Test',
      stageReviewed: WorkflowStage.NARRATIVE_DESIGN,
      gateStatus: 'FAIL',
      scores: {
        narrativeLogicScore: 40,
        characterDepthScore: 40,
        branchTensionScore: 40,
        visualFeasibilityScore: 40,
        overallScore: 40,
      },
      thoughtChain: '',
      criticalFlaws: [{ severity: 'CRITICAL', dimension: 'LOGIC', location: '起幕', description: '缺少戏剧动因', suggestion: '补充' }],
      polishSuggestions: [],
      verdict: '阻断',
      reviewedAt: new Date().toISOString(),
    };

    const res = await resolver.resolveFromToolCall(
      {
        skill: 'character-portrait',
        label: '进入角色定妆',
        description: '已补充动机并推进',
        params: {
          userFeedback: '修正主角动机为复仇而非偶遇',
          isRefinement: true,
        },
      },
      WorkflowStage.NARRATIVE_DESIGN,
      failReport
    );

    assert.ok(res);
    assert.equal(res.actionType, 'CRITIC_DEBATE');
    assert.equal(res.skill, 'critic-review');
    assert.equal(res.isGateIntercept, true);
    assert.match(res.label, /🛡️ 审查官刚性阻断中 \(已融合最新自愈方案/);
    assert.equal(res.payload?.hasHealingIntent, true);
    assert.equal(res.payload?.userFeedback, '修正主角动机为复仇而非偶遇');
  });
});
