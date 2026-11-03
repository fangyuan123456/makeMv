/**
 * tests/mastra/ProposalExecutorPipeline.test.ts
 * Mastra 原生 Run 执行器与工序阶段推进回归测试套件 (Zero Test Regression SSOT)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ProposalExecutor } from '../../src/mastra/router/proposal-executor.js';
import { WorkflowManager } from '../../src/mastra/workflows/workflow-manager.js';
import { ProjectStore, ProposalStore } from '../../src/project-store/index.js';
import { ProjectLockManager } from '../../src/utils/projectLock.js';
import { WorkflowStage, SessionStatus, type ProjectState, type ActionProposal } from '../../src/types/index.js';

describe('ProposalExecutor & Mastra Workflow 自动化回归实证套件', () => {
  const store = ProjectStore.getInstance();
  const proposalStore = ProposalStore.getInstance();
  const executor = ProposalExecutor.getInstance();
  const lock = ProjectLockManager.getInstance();
  const workflowManager = WorkflowManager.getInstance();

  const testProjectId = 'test_pipeline_proj_' + Date.now();
  let projectDir: string;

  before(() => {
    projectDir = store.getProjectDir(testProjectId);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    const initialProject: ProjectState = {
      projectId: testProjectId,
      title: '赛博纪元：暗夜黎明',
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      status: SessionStatus.ACTIVE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      meta: {
        theme: '赛博朋克悬疑互动影游',
        targetDurationMinutes: 30,
      },
    };
    store.saveProject(initialProject);
  });

  after(() => {
    try {
      if (fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('1. ProjectLockManager 锁自动清理与 isLocked 探针保真性实证 (P2-1 防内存泄漏)', async () => {
    const lockTestId = 'test_lock_clean_' + Date.now();
    assert.equal(lock.isLocked(lockTestId), false, '初始状态应未加锁');

    let insideRunning = false;
    const taskPromise = lock.withLock(lockTestId, async () => {
      insideRunning = true;
      assert.equal(lock.isLocked(lockTestId), true, '执行期间 isLocked 应为 true');
      await new Promise((r) => setTimeout(r, 20));
      return 'done';
    });

    const res = await taskPromise;
    assert.equal(res, 'done');
    assert.equal(insideRunning, true);
    assert.equal(lock.isLocked(lockTestId), false, '执行完毕后锁条目必须彻底清理，isLocked 恢复为 false');
  });

  it('2. WorkflowManager resumeWorkflow 无内存 Run 时 fallback 不死锁实证 (P0-1 防死锁)', async () => {
    const dlTestId = 'test_deadlock_' + Date.now();
    const pDir = store.getProjectDir(dlTestId);
    fs.mkdirSync(pDir, { recursive: true });

    store.saveProject({
      projectId: dlTestId,
      title: '防死锁测试项目',
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      status: SessionStatus.ACTIVE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      meta: { theme: '科幻' },
    });

    try {
      // 内存中没有 activeRun，调用 resumeWorkflow 会走 fallback startWorkflowInternal
      // 若有锁嵌套，将永久死锁超时；在此断言 3 秒内平稳完成或挂起
      const runPromise = workflowManager.resumeWorkflow(dlTestId, undefined, { feedback: '测试启动' });
      const timerPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('死锁超时！')), 3000));
      
      const status: any = await Promise.race([runPromise, timerPromise]);
      assert.ok(status, '应正常返回 Run 状态，绝不死锁');
      assert.ok(['running', 'suspended', 'success'].includes(status.status));
      assert.equal(lock.isLocked(dlTestId), false, '调用完成后锁必须彻底释放');
    } finally {
      try {
        fs.rmSync(pDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('3. ProposalExecutor 真正走 Mastra run 并自动推进阶段至下一工序 (P0-4 阶段推进 SSOT)', async () => {
    const proposalId = 'prop_story_bible_1';
    const proposal: ActionProposal = {
      actionId: proposalId,
      label: '推演故事世界观圣经',
      description: '生成故事大纲与网状互动拓扑',
      skill: 'story-bible',
      status: 'pending',
      payload: {
        initialPrompt: '赛博纪元AI觉醒与底层侦探的抉择',
      },
    };
    proposalStore.saveProposal(testProjectId, proposal);

    const execResult = await executor.executeProposal({
      projectId: testProjectId,
      proposalId,
    });

    assert.equal(execResult.success, true, '提案执行应成功');
    assert.equal(execResult.proposal.status, 'executed', '提案状态应更新为 executed');

    // 权威断言：project.currentStage 必须从 narrative_design 推进到 character_design！
    const updatedProject = store.getProject(testProjectId);
    assert.equal(
      updatedProject?.currentStage,
      WorkflowStage.CHARACTER_DESIGN,
      '工序成功后必须将 currentStage 权威推进至 character_design'
    );
  });

  it('4. Critic 阶段隔离实证：明确指定 targetStage 时审计报告严格归档于该阶段 (P0-3 阶段隔离)', async () => {
    const criticPropId = 'prop_critic_review_1';
    const proposal: ActionProposal = {
      actionId: criticPropId,
      label: '针对故事圣经工序进行剧本医生挑刺审计',
      description: '挑刺因果律与人物动机',
      skill: 'critic-review',
      status: 'pending',
      payload: {
        stage: WorkflowStage.NARRATIVE_DESIGN, // 传入 stage，执行器应规范映射为 targetStage
        userFeedback: '重点检查主角动机是否可信',
      },
    };
    proposalStore.saveProposal(testProjectId, proposal);

    const execResult = await executor.executeProposal({
      projectId: testProjectId,
      proposalId: criticPropId,
    });

    assert.equal(execResult.success, true);
    
    // 审计结果必须落盘为 critic_review_narrative_design
    const stageReport = store.getArtifact(testProjectId, `critic_review_${WorkflowStage.NARRATIVE_DESIGN}`);
    assert.ok(stageReport, '必须生成指定 targetStage 的阶段隔离审查报告');

    // 审查官不推进阶段，currentStage 应维持在 character_design
    const project = store.getProject(testProjectId);
    assert.equal(project?.currentStage, WorkflowStage.CHARACTER_DESIGN);
  });

  it('5. 判定顺序保真验证：工具报错时项目状态机绝不提前进入终态 (P0-2 防判定颠倒)', async () => {
    const failPropId = 'prop_fmv_fail_1';
    // 在未生成视频切片的前提下直接调用 fmv-packaging，底层工具必失败
    const proposal: ActionProposal = {
      actionId: failPropId,
      label: '非法打包测试',
      description: '在无视频资产时尝试母带装配',
      skill: 'fmv-packaging',
      status: 'pending',
      payload: {},
    };
    proposalStore.saveProposal(testProjectId, proposal);

    const execResult = await executor.executeProposal({
      projectId: testProjectId,
      proposalId: failPropId,
    });

    // 必须失败
    assert.equal(execResult.success, false, '无视频切片时打包应判定失败');
    assert.equal(execResult.proposal.status, 'failed', '提案状态必须为 failed');

    // 核心安全断言：项目绝对不能被置为 COMPLETED！
    const project = store.getProject(testProjectId);
    assert.notEqual(project?.status, SessionStatus.COMPLETED, '工具失败时状态机绝不可置为 COMPLETED 终态');
    assert.notEqual(project?.currentStage, WorkflowStage.COMPLETED, '工具失败时阶段绝不可置为 COMPLETED');
  });
});
