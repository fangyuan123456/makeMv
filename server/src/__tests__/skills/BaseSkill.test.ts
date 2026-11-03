import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { BaseSkill } from '../../skills/BaseSkill.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { WorkflowStage, SessionStatus } from '../../types/index.js';
import type { SkillManifest, SkillContext } from '../../skills/types.js';

describe('BaseSkill 技能微内核基类', () => {
  const store = ProjectStore.getInstance();
  const testProjectId = 'test_proj_base_skill';

  before(() => {
    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '测试微内核工程',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: { idea: '测试', style: '写实', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    });
  });

  class NormalCalculationSkill extends BaseSkill<{ multiplier: number }, { result: number }> {
    public readonly manifest: SkillManifest = {
      name: 'calc-skill',
      displayName: '测试计算技能',
      description: '数值推演算子',
      category: 'narrative',
      targetStage: WorkflowStage.NARRATIVE_DESIGN,
    };

    protected async run(context: SkillContext<{ multiplier: number }>) {
      await this.notifyProgress(context, 50, '正在运算...');
      return {
        data: { result: 42 * context.params.multiplier },
        summary: '计算完成',
      };
    }
  }

  class FaultySkill extends BaseSkill {
    public readonly manifest: SkillManifest = {
      name: 'faulty-skill',
      displayName: '异常测试技能',
      description: '必然抛错算子',
      category: 'script',
      targetStage: WorkflowStage.SCENE_SCRIPT,
    };

    protected async run(): Promise<{ data: any; summary: string }> {
      throw new Error('模拟核心计算崩溃');
    }
  }

  it('execute 正常执行：自动计时、流式进度通知与产物沉淀至状态黑板', async () => {
    const skill = new NormalCalculationSkill();
    const progressList: Array<{ percent: number; message: string }> = [];

    const res = await skill.execute({
      projectId: testProjectId,
      params: { multiplier: 2 },
      onProgress: async (percent, message) => {
        progressList.push({ percent, message });
      },
    });

    assert.equal(res.success, true);
    if (res.success) {
      assert.equal(res.data.result, 84);
      assert.equal(res.summary, '计算完成');
      assert.ok(res.durationMs >= 0);
    }

    // 进度回调已被触发 (0%, 50%, 100%)
    assert.ok(progressList.length >= 3);
    assert.equal(progressList[0].percent, 0);
    assert.equal(progressList[progressList.length - 1].percent, 100);

    // 状态黑板已被自动统一沉淀落盘 (BaseSkill 模板方法托管)
    const saved = store.getArtifact<any>(testProjectId, WorkflowStage.NARRATIVE_DESIGN);
    assert.equal(saved?.result, 84);
  });

  it('execute 异常沙箱：执行失败时安全捕获并返回标准失败结构', async () => {
    const faulty = new FaultySkill();
    const res = await faulty.execute({
      projectId: testProjectId,
      params: {},
    });

    assert.equal(res.success, false);
    if (!res.success) {
      assert.match(res.error, /模拟核心计算崩溃/);
      assert.match(res.summary, /技能执行失败/);
      assert.ok(res.durationMs >= 0);
    }
  });

  it('executeOrThrow 门禁：成功返回纯数据，失败直接抛错', async () => {
    const skill = new NormalCalculationSkill();
    const okRes = await skill.executeOrThrow({
      projectId: testProjectId,
      params: { multiplier: 3 },
    });
    assert.equal(okRes.data.result, 126);

    const faulty = new FaultySkill();
    await assert.rejects(
      async () => {
        await faulty.executeOrThrow({
          projectId: testProjectId,
          params: {},
        });
      },
      /模拟核心计算崩溃/
    );
  });

  it('abortSignal 中断响应：若已被提前中断，拒绝执行并报错', async () => {
    const skill = new NormalCalculationSkill();
    const ac = new AbortController();
    ac.abort();

    const res = await skill.execute({
      projectId: testProjectId,
      params: { multiplier: 1 },
      abortSignal: ac.signal,
    });

    assert.equal(res.success, false);
    if (!res.success) {
      assert.match(res.error, /执行被提前取消/);
    }
  });

  it('工序产物执行成功后，自动解除该阶段挂起的旧门禁拦截提案 (ProposalStore 与会话 messages 双向原子解除)', async () => {
    const { ProposalStore } = await import('../../project-store/ProposalStore.js');
    const proposalStore = ProposalStore.getInstance();

    const testSession = store.createSession(testProjectId, '门禁测试会话');
    const gateProposal = {
      actionId: 'act_intercept_baseskill_test',
      actionType: 'CRITIC_DEBATE' as const,
      skill: 'critic-review',
      isGateIntercept: true,
      label: '旧门禁拦截',
      status: 'pending' as const,
      payload: { stage: WorkflowStage.NARRATIVE_DESIGN },
    };
    proposalStore.saveProposal(testProjectId, gateProposal);

    store.appendMessage(testProjectId, testSession.sessionId, {
      id: 'msg_gate_test_card',
      role: 'assistant',
      content: '门禁阻断卡片消息',
      actionProposal: { ...gateProposal },
      createdAt: new Date().toISOString(),
    });

    const skill = new NormalCalculationSkill();
    const res = await skill.execute({
      projectId: testProjectId,
      params: { multiplier: 1 },
    });

    assert.equal(res.success, true);

    // 1. ProposalStore 中的提案状态已置为 dismissed
    const saved = proposalStore.getProposal(testProjectId, 'act_intercept_baseskill_test');
    assert.equal(saved?.status, 'dismissed');
    assert.match(saved?.description || '', /门禁已由产物重新生成解除/);

    // 2. 会话消息中的卡片状态同步置为 dismissed (杜绝前端刷新后残留显示)
    const msgs = store.getMessages(testProjectId, testSession.sessionId);
    const cardMsg = msgs.find((m) => m.id === 'msg_gate_test_card');
    assert.equal(cardMsg?.actionProposal?.status, 'dismissed');
  });

  it('params 为 undefined 时的入参鲁棒性：自动规范化为空对象，防止解构崩溃', async () => {
    class SafeSkill extends BaseSkill {
      public readonly manifest: SkillManifest = {
        name: 'safe-param-skill',
        displayName: '安全入参技能',
        description: '验证无入参容错',
        category: 'narrative',
        targetStage: WorkflowStage.NARRATIVE_DESIGN,
      };

      protected async run(context: SkillContext) {
        // 解构不会抛出 TypeError: Cannot destructure property of undefined
        const { multiplier = 1 } = context.params;
        return {
          data: { val: multiplier * 10 },
          summary: '安全完成',
        };
      }
    }

    const safeSkill = new SafeSkill();
    const res = await safeSkill.execute({
      projectId: testProjectId,
    } as any);

    assert.equal(res.success, true);
    assert.equal(res.data.val, 10);
  });

  it('缺少 projectId 时刚性 Fail-Fast 阻断', async () => {
    const skill = new NormalCalculationSkill();
    const res = await skill.execute({
      projectId: '',
      params: { multiplier: 1 },
    });

    assert.equal(res.success, false);
    assert.match(res.error || '', /缺少 projectId 参数/);
  });
});
