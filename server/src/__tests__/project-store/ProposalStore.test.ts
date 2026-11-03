import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProposalStore } from '../../project-store/ProposalStore.js';
import { WorkflowStage } from '../../types/index.js';
import type { ActionProposal } from '../../chat/session/types.js';

describe('ProposalStore 行动提案独立存储与契约检索', () => {
  const store = ProposalStore.getInstance();
  const testProjectId = 'test_proj_proposal_store';

  it('saveProposal 与 getProposal / listProposals 正常持久化存取', () => {
    const p1: ActionProposal = {
      actionId: 'prop_001',
      actionType: 'TRIGGER_STAGE',
      skill: 'story-bible',
      label: '推演故事圣经',
      status: 'pending',
      payload: { stage: WorkflowStage.NARRATIVE_DESIGN },
    };

    store.saveProposal(testProjectId, p1);

    const fetched = store.getProposal(testProjectId, 'prop_001');
    assert.ok(fetched);
    assert.equal(fetched.actionId, 'prop_001');
    assert.equal(fetched.label, '推演故事圣经');

    const pendingList = store.listProposals(testProjectId, { status: 'pending' });
    assert.ok(pendingList.some((p) => p.actionId === 'prop_001'));
  });

  it('updateProposalStatus 原子更新提案生命周期状态与执行报告', () => {
    const updated = store.updateProposalStatus(testProjectId, 'prop_001', 'executed', {
      executedAt: '2026-02-01T10:00:00Z',
      resultSummary: '工序执行完成',
    });

    assert.ok(updated);
    assert.equal(updated.status, 'executed');
    assert.equal(updated.executedAt, '2026-02-01T10:00:00Z');
    assert.equal(updated.resultSummary, '工序执行完成');
  });

  it('dismissProposalsForStage 契约驱动解除：无需脆弱ID字符串前缀匹配，基于isGateIntercept与CRITIC_DEBATE解除', () => {
    // 注入3个不同形态的提案：
    // 1. 自定义 ID 的门禁拦截提案 (isGateIntercept: true) -> 必须被解除
    const gateInterceptProposal: ActionProposal = {
      actionId: 'custom_intercept_uuid_999', // 不带 act_gate_intercept_ 前缀！
      actionType: 'CRITIC_DEBATE',
      skill: 'critic-review',
      isGateIntercept: true,
      label: '审查官门禁拦截',
      status: 'pending',
      payload: { stage: WorkflowStage.NARRATIVE_DESIGN },
    };

    // 2. 普通业务待确认提案 (TRIGGER_STAGE) -> 绝不被误伤解除
    const normalProposal: ActionProposal = {
      actionId: 'prop_normal_888',
      actionType: 'TRIGGER_STAGE',
      skill: 'character-portrait',
      label: '生成定妆照',
      status: 'pending',
      payload: { stage: WorkflowStage.NARRATIVE_DESIGN },
    };

    // 3. 其他工序的门禁提案 -> 绝不跨阶段解除
    const otherStageGateProposal: ActionProposal = {
      actionId: 'gate_other_777',
      actionType: 'CRITIC_DEBATE',
      skill: 'critic-review',
      isGateIntercept: true,
      label: '分场剧本门禁',
      status: 'pending',
      payload: { stage: WorkflowStage.SCENE_SCRIPT },
    };

    store.saveProposal(testProjectId, gateInterceptProposal);
    store.saveProposal(testProjectId, normalProposal);
    store.saveProposal(testProjectId, otherStageGateProposal);

    // 解除 NARRATIVE_DESIGN 阶段的门禁提案
    const dismissedCount = store.dismissProposalsForStage(
      testProjectId,
      WorkflowStage.NARRATIVE_DESIGN,
      '辩护成功解除阻断'
    );

    assert.equal(dismissedCount, 1);

    // 校验 1 号被成功解除
    const p1 = store.getProposal(testProjectId, 'custom_intercept_uuid_999');
    assert.equal(p1?.status, 'dismissed');
    assert.equal(p1?.description, '辩护成功解除阻断');

    // 校验 2 号普通提案保持 pending，未被误杀
    const p2 = store.getProposal(testProjectId, 'prop_normal_888');
    assert.equal(p2?.status, 'pending');

    // 校验 3 号其他阶段门禁保持 pending，未被跨阶段误伤
    const p3 = store.getProposal(testProjectId, 'gate_other_777');
    assert.equal(p3?.status, 'pending');
  });
});
