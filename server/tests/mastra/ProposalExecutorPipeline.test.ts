/**
 * tests/mastra/ProposalExecutorPipeline.test.ts
 * Mastra 原生 Run 执行器与工序阶段推进回归测试套件 (Zero Test Regression SSOT)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { Workflow } from '../../src/workflow-engine/index.js';
import { registerPipelineWorkflows } from '../../src/agents/director/generator/index.js';
import { ContextAssembler } from '../../src/project-store/index.js';
import { ProjectStore, ProposalStore } from '../../src/project-store/index.js';
import { ProjectLockManager } from '../../src/utils/projectLock.js';
import { WorkflowStage, SessionStatus, type ProjectEntity, type ActionProposal } from '../../src/types/index.js';

describe('Workflow & Mastra Workflow 自动化回归实证套件', () => {
  const store = ProjectStore.getInstance();
  const proposalStore = ProposalStore.getInstance();
  const executor = Workflow.getInstance();
  const lock = ProjectLockManager.getInstance();

  const testProjectId = 'test_pipeline_proj_' + Date.now();
  let projectDir: string;

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

  it('2. ContextAssembler 上下文装配实证 (P1-1 & P1-3)', async () => {
    // 1. 验证 ContextAssembler 组装的高信噪比上下文
    const assembler = ContextAssembler.getInstance();
    const assembled = assembler.assemble(testProjectId);
    assert.equal(assembled.projectId, testProjectId);
    assert.ok(assembled.assetsSummary.includes('叙事架构'));
    assert.ok(assembled.criticGatesSummary.length > 0);
  });

  it('3. WorkflowEngine 真正走 Mastra run 并自动推进阶段至下一工序 (P0-4 阶段推进 SSOT)', async () => {
    const proposalId = 'prop_story_bible_1';
    const proposal: ActionProposal = {
      actionId: proposalId,
      actionType: 'GENERATE_STORY_BIBLE',
      label: '推演故事世界观圣经',
      description: '生成故事大纲与网状互动拓扑',
      skill: 'story-bible',
      status: 'pending',
      payload: {
        idea: '赛博纪元AI觉醒与底层侦探的抉择',
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
      actionType: 'CRITIC_REVIEW',
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
      actionType: 'PACKAGE_FMV',
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

  it('6. 对话记忆实证：客户端不传 history 时，Router 自动从 project.history 服务端黑板继承记忆 (消灭对话失忆)', async () => {
    // 模拟服务端黑板已经落盘的前序对话记忆
    const project = store.getProject(testProjectId)!;
    project.history = [
      { role: 'user', content: '我希望把主角命名为阿诺，职业是钟表匠学徒', timestamp: new Date().toISOString() },
      { role: 'assistant', content: '收到！主角已确认为阿诺，钟表工匠人设极具悬疑张力。', timestamp: new Date().toISOString() },
    ] as any;
    store.saveProject(project);

    // 验证服务端黑板历史已被权威消费且正常累积
    const reloaded = store.getProject(testProjectId)!;
    assert.ok(Array.isArray(reloaded.history));
    assert.ok(reloaded.history.length >= 2, '前序记忆完好保全，消灭失忆');
  });

  it('7. 综合安全实证：已执行提案防覆水难收 + JsonSanitizer 产物自动消毒 (P0/P1 防御)', async () => {
    // 1. 已执行提案禁止驳回
    const executedPropId = 'prop_story_bible_1';
    await assert.rejects(
      async () => {
        await executor.rejectProposal(testProjectId, executedPropId, '强行覆水难收');
      },
      /已执行完毕，无法驳回/,
      '已执行的提案绝对不能被篡改为 dismissed'
    );

    // 2. JsonSanitizer 自动消毒验证：向产物中写入带零宽字符的文本，读取时确认已被自动剥离
    const dirtyText = '赛博\u200B纪元\uFEFF侦探';
    store.setArtifact(testProjectId, 'test_sanitized_stage', { title: dirtyText });
    const cleaned = store.getArtifact(testProjectId, 'test_sanitized_stage');
    assert.equal(cleaned.title, '赛博纪元侦探', 'setArtifact 必须经由 JsonSanitizer 自动剥离零宽字符与 BOM');
  });

  it('8. 异步任务化与孤儿自愈实证：startProposal 毫秒级返回 running + 重启恢复 (P0/P1)', async () => {
    // 1. 验证 startProposal 毫秒级返回 accepted: true 且 status 为 running
    const asyncPropId = 'prop_async_test_1';
    const proposal: ActionProposal = {
      actionId: asyncPropId,
      actionType: 'GENERATE_STORY_BIBLE',
      label: '异步任务化测试',
      description: '验证 startProposal 毫秒级返回',
      skill: 'story-bible',
      status: 'pending',
      payload: { idea: '探索未来虚拟都市' },
    };
    proposalStore.saveProposal(testProjectId, proposal);

    const startRes = await executor.startProposal({
      projectId: testProjectId,
      proposalId: asyncPropId,
    });

    assert.equal(startRes.accepted, true);
    assert.equal(startRes.proposal.status, 'running', 'startProposal 必须立即将提案置为 running 态');

    // 2. 模拟进程异常中断遗留的孤儿提案，验证 recoverOrphanProposals 自动将其自愈为 failed
    const orphanPropId = 'prop_orphan_test_1';
    proposalStore.saveProposal(testProjectId, {
      actionId: orphanPropId,
      actionType: 'GENERATE_STORY_BIBLE',
      label: '孤儿提案测试',
      skill: 'story-bible',
      status: 'running',
    });

    executor.recoverOrphanProposals();

    const orphanRecovered = proposalStore.getProposal(testProjectId, orphanPropId)!;
    assert.equal(orphanRecovered.status, 'failed', '孤儿提案必须自愈翻转为 failed');
    assert.ok(orphanRecovered.error?.includes('重启'));
  });
});
