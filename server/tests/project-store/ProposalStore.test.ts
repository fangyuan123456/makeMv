import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ProposalStore } from '../../src/project-store/ProposalStore.js';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { config } from '../../src/utils/config.js';
import { WorkflowStage, type ActionProposal } from '../../src/types/index.js';

describe('ProposalStore 独立行动提案持久化管理 (Proposal Store SSOT)', () => {
  const store = ProposalStore.getInstance();
  const projectStore = ProjectStore.getInstance();
  const testProjectId = 'test_proj_proposal_store';

  before(() => {
    try {
      projectStore.deleteProject(testProjectId);
    } catch {}
  });

  after(() => {
    try {
      projectStore.deleteProject(testProjectId);
    } catch {}
  });

  it('1. saveProposal 物理真实落盘与 getProposal/listProposals 契约读取', () => {
    const p1: ActionProposal = {
      actionId: 'prop_001',
      actionType: 'TRIGGER_STAGE',
      skill: 'story-bible',
      label: '推演故事圣经',
      status: 'pending',
      payload: { stage: WorkflowStage.NARRATIVE_DESIGN },
    };

    store.saveProposal(testProjectId, p1);

    // 物理落盘断言 (拒绝假收敛)
    const proposalsFile = path.join(config.paths.projects, testProjectId, 'proposals.json');
    assert.ok(fs.existsSync(proposalsFile), 'proposals.json 必须在物理磁盘真实存在');

    const diskData = JSON.parse(fs.readFileSync(proposalsFile, 'utf-8'));
    assert.ok(Array.isArray(diskData));
    assert.ok(diskData.some((item: any) => item.actionId === 'prop_001'));

    // 契约读取断言
    const fetched = store.getProposal(testProjectId, 'prop_001');
    assert.ok(fetched);
    assert.equal(fetched.actionId, 'prop_001');
    assert.equal(fetched.label, '推演故事圣经');

    const pendingList = store.listProposals(testProjectId, { status: 'pending', stage: WorkflowStage.NARRATIVE_DESIGN });
    assert.ok(pendingList.some((p) => p.actionId === 'prop_001'));
  });

  it('2. updateProposalStatus 原子流转生命周期 (executed / failed)', () => {
    // 成功流转
    const updated = store.updateProposalStatus(testProjectId, 'prop_001', 'executed', {
      executedAt: '2026-11-03T04:00:00Z',
      resultSummary: '故事圣经已就绪',
    });
    assert.ok(updated);
    assert.equal(updated.status, 'executed');
    assert.equal(updated.executedAt, '2026-11-03T04:00:00Z');
    assert.equal(updated.resultSummary, '故事圣经已就绪');

    // 失败流转测试
    const pFailed: ActionProposal = {
      actionId: 'prop_fail_002',
      actionType: 'TRIGGER_STAGE',
      skill: 'character-portrait',
      label: '生成定妆',
      status: 'pending',
      payload: { stage: WorkflowStage.CHARACTER_DESIGN },
    };
    store.saveProposal(testProjectId, pFailed);
    const failedResult = store.updateProposalStatus(testProjectId, 'prop_fail_002', 'failed', {
      failedAt: '2026-11-03T04:05:00Z',
      error: '模型连接超时',
    });
    assert.ok(failedResult);
    assert.equal(failedResult.status, 'failed');
    assert.equal(failedResult.error, '模型连接超时');
  });

  it('3. dismissProposalsForStage 契约驱动解除：基于 isGateIntercept 与 stage 精准解除，不误杀普通提案', () => {
    // 注入 3 个不同状态的提案：
    // 1. 当前工序的门禁提案 (isGateIntercept: true) -> 必须被解除
    const gateProposal: ActionProposal = {
      actionId: 'gate_narrative_001',
      actionType: 'CRITIC_DEBATE',
      skill: 'critic-review',
      isGateIntercept: true,
      label: '圣经门禁拦截',
      status: 'pending',
      payload: { stage: WorkflowStage.NARRATIVE_DESIGN },
    };

    // 2. 普通业务待确认提案 (TRIGGER_STAGE) -> 严禁被解除
    const normalProposal: ActionProposal = {
      actionId: 'prop_normal_002',
      actionType: 'TRIGGER_STAGE',
      skill: 'character-portrait',
      label: '定妆生成',
      status: 'pending',
      payload: { stage: WorkflowStage.NARRATIVE_DESIGN },
    };

    // 3. 其他工序门禁提案 -> 严禁跨阶段误解除
    const otherStageGate: ActionProposal = {
      actionId: 'gate_scene_003',
      actionType: 'CRITIC_DEBATE',
      skill: 'critic-review',
      isGateIntercept: true,
      label: '分场剧本门禁',
      status: 'pending',
      payload: { stage: WorkflowStage.SCENE_SCRIPT },
    };

    store.saveProposal(testProjectId, gateProposal);
    store.saveProposal(testProjectId, normalProposal);
    store.saveProposal(testProjectId, otherStageGate);

    // 执行 NARRATIVE_DESIGN 阶段门禁解除
    const dismissedCount = store.dismissProposalsForStage(
      testProjectId,
      WorkflowStage.NARRATIVE_DESIGN,
      '审查官对辩辩护通过'
    );
    assert.equal(dismissedCount, 1, '必须且仅能解除 1 个门禁提案');

    // 校验状态流转
    const p1 = store.getProposal(testProjectId, 'gate_narrative_001');
    assert.equal(p1?.status, 'dismissed');
    assert.equal(p1?.description, '审查官对辩辩护通过');

    const p2 = store.getProposal(testProjectId, 'prop_normal_002');
    assert.equal(p2?.status, 'pending', '普通提案必须保持 pending');

    const p3 = store.getProposal(testProjectId, 'gate_scene_003');
    assert.equal(p3?.status, 'pending', '其他阶段门禁严禁被跨阶段误解除');
  });

  it('4. projectId 刚性防御：空字符串或非法路径穿越时抛出异常', () => {
    const dummyProposal: ActionProposal = {
      actionId: 'invalid_pid_prop',
      actionType: 'TRIGGER_STAGE',
      label: '非法项目',
      status: 'pending',
    };

    // 1. 空字符串防御
    assert.throws(
      () => store.saveProposal('', dummyProposal),
      /非法的 projectId/
    );

    // 2. 真实相对路径穿越 (../../malicious) 刚性拦截，严禁隐式替换为下划线并在磁盘建目录
    assert.throws(
      () => store.saveProposal('../../malicious', dummyProposal),
      /非法的 projectId/
    );

    // 3. 含路径分隔符 (/) 抛错拦截
    assert.throws(
      () => store.saveProposal('nested/project/dir', dummyProposal),
      /非法的 projectId/
    );

    // 4. 含空格非法字符抛错拦截
    assert.throws(
      () => store.saveProposal('project with space', dummyProposal),
      /非法的 projectId/
    );

    // 5. 校验只读查询接口针对非法路径的刚性阻断
    assert.throws(
      () => store.getProposal('../../malicious', 'invalid_pid_prop'),
      /非法的 projectId/
    );
    assert.throws(
      () => store.listProposals('../../malicious'),
      /非法的 projectId/
    );
  });

  it('5. SSOT 刚性契约：dismissProposalsForStage 仅识别 stage，不再对 targetStage 进行隐式猜测', () => {
    const legacyProjectId = 'test_proj_legacy_proposal';
    try {
      const legacyProposal: ActionProposal = {
        actionId: 'legacy_prop_target_stage',
        actionType: 'CRITIC_DEBATE',
        isGateIntercept: true,
        label: '旧格式提案',
        status: 'pending',
        payload: { targetStage: WorkflowStage.NARRATIVE_DESIGN }, // 只有旧别名 targetStage，没有 stage
      };
      store.saveProposal(legacyProjectId, legacyProposal);

      // 尝试以 NARRATIVE_DESIGN 解除（旧代码中会通过 targetStage === stage 解除，但在新代码中因为彻底拔除 targetStage 且无 stage 属性而不被解除）
      const dismissed = store.dismissProposalsForStage(legacyProjectId, WorkflowStage.NARRATIVE_DESIGN);
      assert.equal(dismissed, 0, '移除 targetStage 别名后，缺失标准 stage 属性的提案不应被解除');

      const fetched = store.getProposal(legacyProjectId, 'legacy_prop_target_stage');
      // 依然维持 pending
      assert.equal(fetched?.status, 'pending');
    } finally {
      try {
        projectStore.deleteProject(legacyProjectId);
      } catch {}
    }
  });

  it('6. Fail-Fast 异常刚性冒泡：持久化写盘失败时必须向外 throw 异常，拒绝静默吞错', () => {
    const circularProposal: any = {
      actionId: 'prop_circular',
      actionType: 'TRIGGER_STAGE',
      label: '循环引用提案',
      status: 'pending',
    };
    circularProposal.self = circularProposal;

    assert.throws(
      () => store.saveProposal(testProjectId, circularProposal),
      /(circular|Converting circular structure to JSON)/i,
      'ProposalStore.saveProposal 写入循环引用必须向外抛出异常'
    );
  });
});
