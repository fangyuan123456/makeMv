import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { TaskEngine } from '../../tasks/TaskEngine.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { ProposalStore } from '../../project-store/ProposalStore.js';
import { SkillRegistry } from '../../skills/SkillRegistry.js';
import { BaseSkill } from '../../skills/BaseSkill.js';
import { WorkflowStage, SessionStatus } from '../../types/index.js';
import type { SkillManifest, SkillContext } from '../../skills/types.js';

class MockTaskSkill extends BaseSkill<{ duration?: number }, { done: boolean }> {
  public readonly manifest: SkillManifest = {
    name: 'mock-task-skill',
    displayName: '异步任务模拟技能',
    description: '用于测试 TaskEngine 的执行与状态流转',
    category: 'narrative',
    targetStage: WorkflowStage.NARRATIVE_DESIGN,
  };

  protected async run(context: SkillContext<{ duration?: number }>) {
    await this.notifyProgress(context, 50, '执行中...');
    return {
      data: { done: true },
      summary: '模拟工序任务执行完成',
    };
  }
}

class MockCharacterTaskSkill extends BaseSkill<any, any> {
  public readonly manifest: SkillManifest = {
    name: 'mock-char-task-skill',
    displayName: '角色任务模拟技能',
    description: '用于测试阶段跃迁',
    category: 'character',
    targetStage: WorkflowStage.CHARACTER_DESIGN,
  };

  protected async run() {
    return { data: { count: 2 }, summary: '角色任务交付' };
  }
}

describe('TaskEngine 异步工序任务引擎', () => {
  const store = ProjectStore.getInstance();
  const proposalStore = ProposalStore.getInstance();
  const engine = TaskEngine.getInstance();
  const testProjectId = 'test_proj_task_engine';
  const testSessionId = 'test_sess_task_engine';

  before(() => {
    SkillRegistry.getInstance().register(new MockTaskSkill());
    SkillRegistry.getInstance().register(new MockCharacterTaskSkill());

    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '任务引擎测试工程',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.INIT,
      stageArtifacts: {},
      history: [],
      meta: { idea: '测试任务', style: '写实', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    });

    store.saveSession({
      sessionId: testSessionId,
      projectId: testProjectId,
      title: '任务会话',
      currentStage: WorkflowStage.INIT,
      scratchpad: { userConstraints: [], lastUpdatedAt: now },
      createdAt: now,
      updatedAt: now,
    });
  });

  it('任务成功完成时，同时更新 ProposalStore 与会话 messages 中的 actionProposal 为 executed', async () => {
    const actionId = 'act_task_engine_exec_test';
    const proposal = {
      actionId,
      actionType: 'TRIGGER_STAGE',
      skill: 'mock-task-skill',
      label: '推进工序',
      status: 'pending' as const,
      payload: { stage: WorkflowStage.NARRATIVE_DESIGN },
    };

    proposalStore.saveProposal(testProjectId, proposal);
    store.appendMessage(testProjectId, testSessionId, {
      id: 'msg_task_exec_test',
      role: 'assistant',
      content: '请确认推进',
      actionProposal: { ...proposal },
      createdAt: new Date().toISOString(),
    });

    const task = engine.submitTask({
      projectId: testProjectId,
      sessionId: testSessionId,
      skillName: 'mock-task-skill',
      params: {},
      actionId,
    });

    assert.ok(task);
    assert.equal(task.status, 'pending');

    // 等待异步执行收敛 (轮询完成状态)
    let finished = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const current = engine.getTask(testProjectId, task.taskId);
      if (current?.status === 'completed') {
        finished = true;
        break;
      }
    }
    assert.equal(finished, true);

    // 1. 验证 ProposalStore 中的提案状态已变为 executed
    const savedProposal = proposalStore.getProposal(testProjectId, actionId);
    assert.equal(savedProposal?.status, 'executed');
    assert.ok(savedProposal?.executedAt);

    // 2. 验证 ProjectStore messages 中的对应卡片状态必须为 executed (彻底杜绝刷新页面重置回 pending)
    const messages = store.getMessages(testProjectId, testSessionId);
    const msg = messages.find((m) => m.actionProposal?.actionId === actionId);
    assert.ok(msg);
    assert.equal(msg.actionProposal?.status, 'executed');
    assert.ok(msg.actionProposal?.executedAt);
    assert.equal(msg.actionProposal?.resultSummary, '模拟工序任务执行完成');

    // 3. 验证阶段成功从 INIT 跃迁至 NARRATIVE_DESIGN
    const project = store.getProject(testProjectId);
    assert.equal(project?.currentStage, WorkflowStage.NARRATIVE_DESIGN);
  });

  it('阶段单调单向向前跃迁：从 NARRATIVE_DESIGN 跃迁至 CHARACTER_DESIGN', async () => {
    const task = engine.submitTask({
      projectId: testProjectId,
      sessionId: testSessionId,
      skillName: 'mock-char-task-skill',
      params: {},
    });

    let finished = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const current = engine.getTask(testProjectId, task.taskId);
      if (current?.status === 'completed') {
        finished = true;
        break;
      }
    }
    assert.equal(finished, true);

    const project = store.getProject(testProjectId);
    assert.equal(project?.currentStage, WorkflowStage.CHARACTER_DESIGN);
  });

  it('微调重绘自愈任务 (isRefinement: true) 坚决不跃迁项目阶段', async () => {
    const task = engine.submitTask({
      projectId: testProjectId,
      sessionId: testSessionId,
      skillName: 'mock-char-task-skill',
      params: { isRefinement: true },
    });

    let finished = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const current = engine.getTask(testProjectId, task.taskId);
      if (current?.status === 'completed') {
        finished = true;
        break;
      }
    }
    assert.equal(finished, true);

    // 阶段依然停留在 CHARACTER_DESIGN，防误推门禁生效
    const project = store.getProject(testProjectId);
    assert.equal(project?.currentStage, WorkflowStage.CHARACTER_DESIGN);
  });

  it('未提供 sessionId 提交任务时，依然能成功原子回标 ProposalStore 与会话中的提案卡片', async () => {
    const actionId = 'act_no_session_test';
    const proposal = {
      actionId,
      actionType: 'TRIGGER_STAGE',
      skill: 'mock-task-skill',
      label: '无会话推进测试',
      status: 'pending' as const,
      payload: { stage: WorkflowStage.CHARACTER_DESIGN },
    };

    proposalStore.saveProposal(testProjectId, proposal);
    store.appendMessage(testProjectId, testSessionId, {
      id: 'msg_no_session_card',
      role: 'assistant',
      content: '卡片消息',
      actionProposal: { ...proposal },
      createdAt: new Date().toISOString(),
    });

    // 提交任务时不传入 sessionId
    const task = engine.submitTask({
      projectId: testProjectId,
      skillName: 'mock-task-skill',
      params: { actionId },
    });

    let finished = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const current = engine.getTask(testProjectId, task.taskId);
      if (current?.status === 'completed') {
        finished = true;
        break;
      }
    }
    assert.equal(finished, true);

    // 1. ProposalStore 必须被正确更新为 executed
    const savedProposal = proposalStore.getProposal(testProjectId, actionId);
    assert.equal(savedProposal?.status, 'executed');

    // 2. 会话中的卡片状态也必须被遍历找到并回标为 executed
    const msgs = store.getMessages(testProjectId, testSessionId);
    const cardMsg = msgs.find((m) => m.id === 'msg_no_session_card');
    assert.equal(cardMsg?.actionProposal?.status, 'executed');
  });

  it('cancelTask 取消任务：正在排队或执行中的任务被中止为 aborted', async () => {
    class LongRunningSkill extends BaseSkill {
      public readonly manifest: SkillManifest = {
        name: 'long-running-skill',
        displayName: '长耗时任务模拟技能',
        description: '测试取消中断',
        category: 'narrative',
        targetStage: WorkflowStage.CHARACTER_DESIGN,
      };

      protected async run(context: SkillContext) {
        for (let i = 0; i < 10; i++) {
          if (context.abortSignal?.aborted) {
            throw new Error('操作已被中断');
          }
          await new Promise((r) => setTimeout(r, 40));
        }
        return { data: {}, summary: '完成' };
      }
    }

    SkillRegistry.getInstance().register(new LongRunningSkill());

    const task = engine.submitTask({
      projectId: testProjectId,
      sessionId: testSessionId,
      skillName: 'long-running-skill',
      params: {},
    });

    await new Promise((r) => setTimeout(r, 20));
    const cancelled = engine.cancelTask(testProjectId, task.taskId);
    assert.equal(cancelled, true);

    let reachedAborted = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 40));
      const current = engine.getTask(testProjectId, task.taskId);
      if (current?.status === 'aborted') {
        reachedAborted = true;
        break;
      }
    }
    assert.equal(reachedAborted, true);
  });
});
