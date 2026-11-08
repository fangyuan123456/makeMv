/**
 * tests/mastra/ProposalExecutorPipeline.test.ts
 * 任务执行管线与工序阶段推进回归套件 (Zero Test Regression SSOT)
 *
 * 历史沿革：本套件原围绕 ActionProposal / startProposal / executeProposal /
 * recoverOrphanProposals 展开。Task 架构收口后统一为 Task 载体：
 *
 *   executeProposal          → executeTask
 *   startProposal            → startTask
 *   rejectProposal           → TaskStore.cancelTask
 *   recoverOrphanProposals   → recoverOrphanTasks
 *
 * 八条业务不变量原样保留：锁自动清理、上下文装配、阶段推进 SSOT、审查阶段隔离、
 * 工具失败不提前进终态、会话记忆继承、防覆水难收 + 产物消毒、异步任务化 + 孤儿自愈。
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { Workflow } from '../../src/workflow-engine/index.js';
import { registerPipelineWorkflows } from '../../src/agents/director/orchestration/index.js';
import { ContextAssembler } from '../../src/project-store/index.js';
import { ProjectStore, TaskStore } from '../../src/project-store/index.js';
import { ProjectLockManager } from '../../src/utils/projectLock.js';
import { WorkflowStage, SessionStatus, type ProjectEntity, type Task } from '../../src/types/index.js';

describe('Workflow & Mastra Workflow 自动化回归实证套件', () => {
  const store = ProjectStore.getInstance();
  const taskStore = TaskStore.getInstance();
  const engine = Workflow.getInstance();
  const lock = ProjectLockManager.getInstance();

  const testProjectId = 'test_pipeline_proj_' + Date.now();
  let projectDir: string;
  /** 用例 3 产出的任务 id，供用例 7 做「已执行不可驳回」验证 */
  let storyBibleTaskId = '';

  const makeTask = (overrides: Partial<Task> & { taskId: string }): Task => ({
    projectId: testProjectId,
    intent: 'generate',
    title: '未命名任务',
    status: 'proposed',
    stages: [],
    approval: { required: true },
    artifacts: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  before(() => {
    registerPipelineWorkflows();
    projectDir = store.getProjectDir(testProjectId);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    const initialProject: ProjectEntity = {
      projectId: testProjectId,
      title: '赛博纪元：暗夜黎明',
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      status: SessionStatus.IDLE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stageArtifacts: {},
      history: [],
      meta: {
        idea: '赛博朋克悬疑互动影游',
        style: '电影质感，写实光影',
        videoRatio: '16:9',
        videoResolution: '720P',
      },
    };
    store.saveProject(initialProject);
  });

  after(() => {
    try {
      store.deleteProject(testProjectId);
    } catch {
      try {
        if (fs.existsSync(projectDir)) fs.rmSync(projectDir, { recursive: true, force: true });
      } catch {}
    }
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

  it('2. ContextAssembler 上下文装配实证 (P1-1 & P1-3)', () => {
    const assembler = ContextAssembler.getInstance();
    const assembled = assembler.assemble(testProjectId);
    assert.equal(assembled.projectId, testProjectId);
    assert.ok(assembled.assetsSummary.includes('叙事架构'));
    assert.ok(assembled.criticGatesSummary.length > 0);
  });

  it('3. WorkflowEngine 真正走 Mastra run 并自动推进阶段至下一工序 (P0-4 阶段推进 SSOT)', async () => {
    const routeRes = await engine.dispatch({
      projectId: testProjectId,
      workflowKey: 'story-bible',
      actionType: 'PROCEED_STAGE',
      title: '推演故事世界观圣经',
      reason: '生成故事大纲与网状互动拓扑',
      parameters: { idea: '赛博纪元AI觉醒与底层侦探的抉择' },
      requireConfirmation: true,
    });

    assert.ok(routeRes.task, '派发必须产生 Task');
    storyBibleTaskId = routeRes.task.taskId;

    const execResult: any = await engine.executeTask({
      projectId: testProjectId,
      taskId: storyBibleTaskId,
    });

    assert.equal(execResult.success, true, `任务执行应成功: ${execResult.error || ''}`);
    assert.equal(execResult.task.status, 'succeeded', '任务状态应更新为 succeeded');

    // 权威断言：project.currentStage 必须从 narrative_design 推进到 character_design！
    const updatedProject = store.getProject(testProjectId);
    assert.equal(
      updatedProject?.currentStage,
      WorkflowStage.CHARACTER_DESIGN,
      '工序成功后必须将 currentStage 权威推进至 character_design'
    );
  });

  it('4. Critic 阶段隔离实证：明确指定 stage 时审计报告严格归档于该阶段 (P0-3 阶段隔离)', async () => {
    const routeRes = await engine.dispatch({
      projectId: testProjectId,
      workflowKey: 'critic-review',
      actionType: 'CRITIC_REVIEW',
      title: '针对故事圣经工序进行剧本医生挑刺审计',
      reason: '挑刺因果律与人物动机',
      parameters: {
        stage: WorkflowStage.NARRATIVE_DESIGN,
        userFeedback: '重点检查主角动机是否可信',
      },
      requireConfirmation: true,
    });

    const execResult: any = await engine.executeTask({
      projectId: testProjectId,
      taskId: routeRes.task!.taskId,
    });

    assert.equal(execResult.success, true, `审查执行应成功: ${execResult.error || ''}`);

    // 审计结果必须落盘为 critic_review_narrative_design
    const stageReport = store.getArtifact(testProjectId, `critic_review_${WorkflowStage.NARRATIVE_DESIGN}`);
    assert.ok(stageReport, '必须生成指定 stage 的阶段隔离审查报告');

    // 审查官不推进阶段，currentStage 应维持在 character_design
    const project = store.getProject(testProjectId);
    assert.equal(project?.currentStage, WorkflowStage.CHARACTER_DESIGN);
  });

  it('5. 判定顺序保真验证：工具报错时项目状态机绝不提前进入终态 (P0-2 防判定颠倒)', async () => {
    // 在未生成视频切片的前提下直接调用 fmv-packaging，底层工具必失败
    const routeRes = await engine.dispatch({
      projectId: testProjectId,
      workflowKey: 'fmv-packaging',
      actionType: 'PACKAGE_FMV',
      title: '非法打包测试',
      reason: '在无视频资产时尝试母带装配',
      requireConfirmation: true,
    });

    const execResult: any = await engine.executeTask({
      projectId: testProjectId,
      taskId: routeRes.task!.taskId,
    });

    // 必须失败
    assert.equal(execResult.success, false, '无视频切片时打包应判定失败');
    assert.equal(execResult.task.status, 'failed', '任务状态必须为 failed');
    assert.ok(execResult.task.error, '失败必须带可读原因，不得静默');

    // 核心安全断言：项目绝对不能被置为 COMPLETED！
    const project = store.getProject(testProjectId);
    assert.notEqual(project?.status, SessionStatus.COMPLETED, '工具失败时状态机绝不可置为 COMPLETED 终态');
    assert.notEqual(project?.currentStage, WorkflowStage.COMPLETED, '工具失败时阶段绝不可置为 COMPLETED');
  });

  it('6. 对话记忆实证：服务端黑板 history 完好保全并正常累积 (消灭对话失忆)', () => {
    const project = store.getProject(testProjectId)!;
    project.history = [
      { role: 'user', content: '我希望把主角命名为阿诺，职业是钟表匠学徒', timestamp: new Date().toISOString() },
      { role: 'assistant', content: '收到！主角已确认为阿诺，钟表工匠人设极具悬疑张力。', timestamp: new Date().toISOString() },
    ] as any;
    store.saveProject(project);

    const reloaded = store.getProject(testProjectId)!;
    assert.ok(Array.isArray(reloaded.history));
    assert.ok(reloaded.history.length >= 2, '前序记忆完好保全，消灭失忆');
  });

  it('7. 综合安全实证：已结束任务防覆水难收 + JsonSanitizer 产物自动消毒 (P0/P1 防御)', () => {
    // 1. 已结束任务禁止取消（等价于旧「已执行提案禁止驳回」）
    assert.throws(
      () => taskStore.cancelTask(testProjectId, storyBibleTaskId, '强行覆水难收'),
      (err: any) => {
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /不可取消/);
        return true;
      },
      '已结束的任务绝对不能被篡改为 cancelled'
    );
    assert.equal(taskStore.getTask(testProjectId, storyBibleTaskId)!.status, 'succeeded');

    // 2. JsonSanitizer 自动消毒：写入零宽字符与 BOM，读取时必须被自动剥离
    const dirtyText = '赛博\u200B纪元\uFEFF侦探';
    store.setArtifact(testProjectId, 'test_sanitized_stage', { title: dirtyText });
    const cleaned = store.getArtifact<any>(testProjectId, 'test_sanitized_stage');
    assert.equal(cleaned.title, '赛博纪元侦探', 'setArtifact 必须经由 JsonSanitizer 自动剥离零宽字符与 BOM');
  });

  it('8. 异步任务化与孤儿自愈实证：startTask 毫秒级返回 running + 重启恢复 (P0/P1)', async () => {
    const asyncTaskId = 'task_async_test_1';
    taskStore.saveTask(
      testProjectId,
      makeTask({
        taskId: asyncTaskId,
        skill: 'story-bible',
        actionType: 'PROCEED_STAGE',
        title: '异步任务化测试',
        payload: { idea: '探索未来虚拟都市' },
      })
    );

    const startRes = await engine.startTask({ projectId: testProjectId, taskId: asyncTaskId });

    assert.equal(startRes.accepted, true);
    assert.equal(startRes.task.status, 'running', 'startTask 必须立即将任务置为 running 态');

    // 等后台执行收尾，避免污染后续断言
    await engine.executeTask({ projectId: testProjectId, taskId: asyncTaskId });

    // 2. 模拟进程异常中断遗留的孤儿任务，验证 recoverOrphanTasks 自动将其自愈为 failed
    const orphanTaskId = 'task_orphan_test_1';
    taskStore.saveTask(
      testProjectId,
      makeTask({
        taskId: orphanTaskId,
        skill: 'story-bible',
        actionType: 'PROCEED_STAGE',
        title: '孤儿任务测试',
        status: 'running',
      })
    );

    engine.recoverOrphanTasks();

    const orphanRecovered = taskStore.getTask(testProjectId, orphanTaskId)!;
    assert.equal(orphanRecovered.status, 'failed', '孤儿任务必须自愈翻转为 failed');
    assert.ok(orphanRecovered.error?.includes('重启'), '必须写清失败原因是进程重启');
  });
});
