/**
 * mastra/DirectorStateGraphRouter.test.ts
 * 类 LangGraph 动态状态图意图路由与人在回路执行机测试套件
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ProjectStore, ProposalStore } from '../../src/project-store/index.js';
import { DirectorRouter, ProposalExecutor } from '../../src/mastra/router/index.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';
import { LLMRegistry } from '../../src/llm/LLMRegistry.js';
import { MockLLMService } from '../../src/llm/MockLLMService.js';

describe('DirectorStateGraphRouter - 动态状态图路由与人在回路测试套件', () => {
  const testProjectId = 'test_graph_router_proj';
  const store = ProjectStore.getInstance();
  const proposalStore = ProposalStore.getInstance();
  const testProjectDir = store.getProjectDir(testProjectId);

  beforeEach(() => {
    LLMRegistry.set(new MockLLMService());
    proposalStore.clearCache(testProjectId);

    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '赛博幽灵：记忆重构',
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      status: SessionStatus.IDLE,
      stageArtifacts: {},
      history: [],
      meta: {
        idea: '探索失落的记忆晶片',
        style: '赛博朋克，高对比冷蓝与霓虹光影',
        videoRatio: '16:9',
        videoResolution: '720P',
      },
      createdAt: now,
      updatedAt: now,
    });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testProjectDir)) {
        fs.rmSync(testProjectDir, { recursive: true, force: true });
      }
    } catch {}
    proposalStore.clearCache(testProjectId);
  });

  it('1. 应成功解析创作者意图并生成待审提案 (ActionProposal)', async () => {
    const router = DirectorRouter.getInstance();
    const result = await router.routeMessage({
      projectId: testProjectId,
      userMessage: '我想做一个维多利亚时期的逆光怀表悬疑故事',
    });

    assert.ok(result.reply.length > 0);
    assert.ok(result.thought.length > 0);
    assert.equal(result.intent, 'PROPOSE_ACTION');
    assert.ok(result.proposal);
    assert.equal(result.proposal.skill, 'story-bible');
    assert.equal(result.proposal.status, 'pending');

    // 验证落盘到了 ProposalStore
    const saved = proposalStore.getProposal(testProjectId, result.proposal.actionId);
    assert.ok(saved);
    assert.equal(saved.actionId, result.proposal.actionId);
    assert.equal(saved.status, 'pending');
  });

  it('2. 创作者批准提案后，ProposalExecutor 应成功恢复执行并落盘状态黑板', async () => {
    const router = DirectorRouter.getInstance();
    const routeRes = await router.routeMessage({
      projectId: testProjectId,
      userMessage: '启动故事圣经设计',
    });

    const proposal = routeRes.proposal!;
    assert.ok(proposal);

    const executor = ProposalExecutor.getInstance();
    const execRes = await executor.executeProposal({
      projectId: testProjectId,
      proposalId: proposal.actionId,
    });

    assert.equal(execRes.success, true);
    assert.equal(execRes.proposal.status, 'executed');
    assert.ok(execRes.proposal.executedAt);

    // 验证状态黑板 ProjectStore 已落盘 narrative_design
    const artifact = store.getArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN);
    assert.ok(artifact);
    assert.ok((artifact as any).goldenSpine);
  });

  it('3. 创作者驳回提案后，提案应安全置为 dismissed 状态', async () => {
    const router = DirectorRouter.getInstance();
    const routeRes = await router.routeMessage({
      projectId: testProjectId,
      userMessage: '生成故事提案',
    });

    const proposal = routeRes.proposal!;
    const executor = ProposalExecutor.getInstance();
    const rejected = executor.rejectProposal(testProjectId, proposal.actionId, '暂不执行，先讨论人设');

    assert.equal(rejected.status, 'dismissed');
    assert.equal(rejected.description, '暂不执行，先讨论人设');
  });

  it('4. 防复活防御：被驳回 (dismissed) 或已完成 (executed) 的提案再次执行必须刚性阻断', async () => {
    const router = DirectorRouter.getInstance();
    const routeRes = await router.routeMessage({
      projectId: testProjectId,
      userMessage: '生成故事提案',
    });

    const proposal = routeRes.proposal!;
    const executor = ProposalExecutor.getInstance();
    executor.rejectProposal(testProjectId, proposal.actionId, '直接驳回');

    // 尝试复活被驳回的提案，必须阻断报错
    await assert.rejects(
      async () => {
        await executor.executeProposal({
          projectId: testProjectId,
          proposalId: proposal.actionId,
        });
      },
      /提案处于非可执行状态 \[dismissed\]，禁止执行/
    );
  });
});
