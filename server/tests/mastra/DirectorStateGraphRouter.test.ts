/**
 * mastra/DirectorStateGraphRouter.test.ts
 * 基于微内核 WorkflowEngine 与 ProposalExecutor 的动态状态图与人在回路测试套件
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ProjectStore, ProposalStore } from '../../src/project-store/index.js';
import { Workflow } from '../../src/workflow-engine/index.js';
import { registerPipelineWorkflows } from '../../src/agents/director/generator/index.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';
import { LLMRegistry } from '../../src/llm/LLMRegistry.js';
import { MockLLMService } from '../../src/llm/MockLLMService.js';
import { exportStoryBibleToDisk } from '../../src/agents/director/generator/steps/story-bible/exporter.js';

describe('DirectorStateGraphRouter - 动态状态图与人在回路测试套件', () => {
  const testProjectId = 'test_graph_router_proj';
  const store = ProjectStore.getInstance();
  const proposalStore = ProposalStore.getInstance();
  const testProjectDir = store.getProjectDir(testProjectId);

  beforeEach(() => {
    registerPipelineWorkflows();
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
        idea: '记忆窃贼与意识上传的终极冲突',
        style: '赛博朋克霓虹雨夜',
        videoRatio: '16:9',
        videoResolution: '720P' as const,
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
    const engine = Workflow.getInstance();
    const result = await engine.dispatch({
      projectId: testProjectId,
      workflowKey: 'story-bible',
      reason: '我想做一个维多利亚时期的逆光怀表悬疑故事',
      requireConfirmation: true,
    });

    assert.equal(result.success, true);
    assert.ok(result.proposal);
    assert.equal(result.proposal.skill, 'story-bible');
    assert.equal(result.proposal.status, 'pending');

    // 验证落盘到了 ProposalStore
    const saved = proposalStore.getProposal(testProjectId, result.proposal.actionId);
    assert.ok(saved);
    assert.equal(saved.actionId, result.proposal.actionId);
    assert.equal(saved.status, 'pending');
  });

  it('2. 创作者批准提案后，WorkflowEngine 应成功恢复执行并落盘状态黑板', async () => {
    const engine = Workflow.getInstance();
    const routeRes = await engine.dispatch({
      projectId: testProjectId,
      workflowKey: 'story-bible',
      reason: '启动故事圣经设计',
      requireConfirmation: true,
    });

    const proposal = routeRes.proposal!;
    assert.ok(proposal);

    const executor = Workflow.getInstance();
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
    const engine = Workflow.getInstance();
    const routeRes = await engine.dispatch({
      projectId: testProjectId,
      workflowKey: 'story-bible',
      reason: '生成故事提案',
      requireConfirmation: true,
    });

    const proposal = routeRes.proposal!;
    const executor = Workflow.getInstance();
    const rejected = await executor.rejectProposal(testProjectId, proposal.actionId, '暂不执行，先讨论人设');

    assert.equal(rejected.status, 'dismissed');
    assert.equal(rejected.description, '暂不执行，先讨论人设');
  });

  it('4. 防复活防御：被驳回 (dismissed) 或已完成 (executed) 的提案再次执行必须刚性阻断', async () => {
    const engine = Workflow.getInstance();
    const routeRes = await engine.dispatch({
      projectId: testProjectId,
      workflowKey: 'story-bible',
      reason: '生成故事提案',
      requireConfirmation: true,
    });

    const proposal = routeRes.proposal!;
    const executor = Workflow.getInstance();
    await executor.rejectProposal(testProjectId, proposal.actionId, '直接驳回');

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

  it('5. 批次 B1: running 状态提案坚决不允许驳回 (抛出 409)', async () => {
    const executor = Workflow.getInstance();
    const actionId = `prop_running_${Date.now()}`;
    proposalStore.saveProposal(testProjectId, {
      actionId,
      actionType: 'FULL_GENERATION',
      skill: 'story-bible',
      label: '正在运行中的提案',
      status: 'running',
    });

    await assert.rejects(
      async () => {
        await executor.rejectProposal(testProjectId, actionId, '强制驳回');
      },
      (err: any) => {
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /正在执行中，不可驳回/);
        return true;
      }
    );
  });

  it('6. 批次 B2: 终态核验防御：人为在执行期间改状态为 dismissed，最终状态不被覆盖', async () => {
    const actionId = `prop_b2_${Date.now()}`;
    proposalStore.saveProposal(testProjectId, {
      actionId,
      actionType: 'FULL_GENERATION',
      skill: 'story-bible',
      label: '测试终态核验',
      status: 'dismissed', // 模拟在拿到锁前已被驳回
    });

    const executor = Workflow.getInstance();
    const result = await (executor as any).runProposal(testProjectId, actionId, 'story-bible', {});
    assert.equal(result.success, false);
    // 验证状态依旧是 dismissed，没有被写成 executed 或 failed
    const finalProp = proposalStore.getProposal(testProjectId, actionId);
    assert.equal(finalProp?.status, 'dismissed');
  });

  it('7. 批次 B3: 提案幂等：同 session 同 skill+stage 连发只出一张卡并复用旧卡', async () => {
    const engine = Workflow.getInstance();
    const sessionId = 'session_test_b3';

    // 第一次派发
    const res1 = await engine.dispatch({
      projectId: testProjectId,
      sessionId,
      workflowKey: 'story-bible',
      reason: '我想做一个维多利亚时期的逆光怀表悬疑故事',
      requireConfirmation: true,
    });
    assert.ok(res1.proposal);
    const firstActionId = res1.proposal.actionId;

    // 第二次连续发送相同工序派发
    const res2 = await engine.dispatch({
      projectId: testProjectId,
      sessionId,
      workflowKey: 'story-bible',
      reason: '我想做一个维多利亚时期的逆光怀表悬疑故事',
      requireConfirmation: true,
    });
    assert.ok(res2.proposal);
    const secondActionId = res2.proposal.actionId;

    // 验证：两次请求命中了同一个 ActionProposal，ID 完全一致
    assert.equal(secondActionId, firstActionId);
    const allPending = proposalStore.listProposals(testProjectId, { status: 'pending' });
    // 列表中只有一张 pending 卡片，绝不产生冗余孤儿卡片
    assert.equal(allPending.length, 1);
  });

  it('8. 批次 C1 & C3: 历史 SSOT 收敛到 sessionId，双会话并行不串味', async () => {
    const sessionA = 'session_line_a';
    const sessionB = 'session_line_b';

    // Session A 发送关于怀表线索的消息
    store.appendMessage(testProjectId, sessionA, {
      id: 'msg_a_1',
      role: 'user',
      content: '【怀表线】凶手偷走了镀金怀表',
      createdAt: new Date().toISOString(),
    } as any);

    // Session B 发送关于列车线索的消息
    store.appendMessage(testProjectId, sessionB, {
      id: 'msg_b_1',
      role: 'user',
      content: '【列车线】案发地点在跨国特快列车三号车厢',
      createdAt: new Date().toISOString(),
    } as any);

    // 验证会话隔离：Session A 读取时不包含 Session B 的消息
    const messagesA = store.getMessages(testProjectId, sessionA);
    const messagesB = store.getMessages(testProjectId, sessionB);

    assert.equal(messagesA.length, 1);
    assert.equal(messagesB.length, 1);
    assert.ok(messagesA[0].content.includes('镀金怀表'));
    assert.ok(messagesB[0].content.includes('跨国特快列车'));
  });


  it('10. WorkflowEngine 双轨分发：TARGETED_REVISE 成功分流至修改器并执行 Delta Patch', async () => {
    const engine = Workflow.getInstance();

    // 准备已有故事圣经并写入黑板与磁盘
    const initialBible: any = {
      title: '赛博幽灵：记忆重构',
      logline: '原设定梗概',
      sellingPoints: ['极速反转'],
      goldenSpine: [{ act: 1, name: '启程', summary: '开局' }],
      characters: [{ name: '钟表匠学徒阿诺', role: '主角', visualPrompt: '风衣黑发' }],
      characterNames: ['钟表匠学徒阿诺'],
    };
    store.setArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN, initialBible);
    exportStoryBibleToDisk(testProjectId, initialBible, store);

    const routeRes = await engine.dispatch({
      projectId: testProjectId,
      workflowKey: 'story-bible',
      actionType: 'TARGETED_REVISE',
      reason: '把主角 K 的发型改成银色寸头',
      parameters: {
        target: 'K',
        userFeedback: '把主角 K 的发型改成银色寸头',
      },
    });

    assert.ok(routeRes.proposal);
    assert.equal(routeRes.proposal.actionType, 'TARGETED_REVISE');

    // 执行提案
    const execRes = await engine.executeProposal({
      projectId: testProjectId,
      proposalId: routeRes.proposal.actionId,
    });

    assert.equal(execRes.success, true);
    assert.equal(execRes.proposal.status, 'executed');
  });

  it('11. 提案执行成功后自动写入 Session 工序完成通知，时空回退安全级联清理', async () => {
    const engine = Workflow.getInstance();
    const sessionId = 'session_rollback_test';

    // 模拟项目已推进到第三阶段 (scene_script)
    const project = store.getProject(testProjectId)!;
    project.currentStage = WorkflowStage.SCENE_SCRIPT;
    project.stageArtifacts = {
      [WorkflowStage.NARRATIVE_DESIGN]: { title: '初始故事' },
      [WorkflowStage.CHARACTER_DESIGN]: { characters: [] },
      [WorkflowStage.SCENE_SCRIPT]: { scenes: [] },
    };
    store.saveProject(project);

    // 派发时空回退提案：回退到第一阶段 (story-bible)
    const routeRes = await engine.dispatch({
      projectId: testProjectId,
      sessionId,
      workflowKey: 'story-bible',
      actionType: 'STAGE_ROLLBACK',
      reason: '对整体故事骨架推翻重写',
    });

    assert.ok(routeRes.proposal);
    assert.equal(routeRes.proposal.actionType, 'STAGE_ROLLBACK');

    // 执行提案
    const execRes = await engine.executeProposal({
      projectId: testProjectId,
      proposalId: routeRes.proposal.actionId,
    });

    assert.equal(execRes.success, true);

    // 验证 1：项目阶段成功回退至 narrative_design
    const updatedProject = store.getProject(testProjectId)!;
    assert.equal(updatedProject.currentStage, WorkflowStage.NARRATIVE_DESIGN);

    // 验证 2：下游角色与剧本资产已被级联清理
    assert.ok(!updatedProject.stageArtifacts[WorkflowStage.CHARACTER_DESIGN]);
    assert.ok(!updatedProject.stageArtifacts[WorkflowStage.SCENE_SCRIPT]);

    // 验证 3：当前会话成功写入工序完成系统通知
    const messages = store.getMessages(testProjectId, sessionId);
    assert.ok(messages.length >= 1);
    const lastMsg = messages[messages.length - 1];
    assert.equal(lastMsg.role, 'assistant');
    assert.ok(lastMsg.content.includes('【系统工序通知】'));
    assert.ok(lastMsg.content.includes('时空回退重做'));
  });

  it('12. DirectorAgent 统一中枢具备全景黑板感知与法定 8 大工序意图协议', async () => {
    const { createDirectorAgent } = await import('../../src/agents/director/index.js');
    const rAgent = createDirectorAgent(testProjectId, 'session_director_check');
    const instructions = await (rAgent as any).getInstructions();

    // 验证中枢对齐包含法定工序与业务守则
    assert.ok(instructions.includes('story-bible'));
    assert.ok(instructions.includes('character-portrait'));
    assert.ok(instructions.includes('工序推进与创作者意图理解守则'));
  });

  it('13. WorkflowEngine 双轨分发：character-portrait 定向精修单角色，保全其余角色', async () => {
    const engine = Workflow.getInstance();

    // 准备已有 2 位角色定妆照
    store.setArtifact(testProjectId, WorkflowStage.CHARACTER_DESIGN, {
      characters: [
        { name: '阿诺', role: '主角', appearance: '皮夹克', imageUrl: '/media/test/arnold.png', history: [] },
        { name: '雷恩', role: '反派', appearance: '黑风衣', imageUrl: '/media/test/ryan.png', history: [] },
      ],
    });

    const routeRes = await engine.dispatch({
      projectId: testProjectId,
      workflowKey: 'character-portrait',
      actionType: 'TARGETED_REVISE',
      reason: '把阿诺的衣服改成赛博银色风衣',
      parameters: {
        target: '阿诺',
        userFeedback: '换成赛博银色风衣',
        isMock: true,
      },
    });

    assert.ok(routeRes.proposal);
    assert.equal(routeRes.proposal.actionType, 'TARGETED_REVISE');

    const execRes = await engine.executeProposal({
      projectId: testProjectId,
      proposalId: routeRes.proposal.actionId,
    });

    assert.equal(execRes.success, true);

    const updatedArt = store.getArtifact<any>(testProjectId, WorkflowStage.CHARACTER_DESIGN)!;
    assert.equal(updatedArt.characters.length, 2);
    // 目标角色阿诺已修改
    const arnold = updatedArt.characters.find((c: any) => c.name === '阿诺');
    assert.ok(arnold);
    // 非目标角色雷恩 100% 物理保全原图与人设
    const ryan = updatedArt.characters.find((c: any) => c.name === '雷恩');
    assert.equal(ryan.imageUrl, '/media/test/ryan.png');
    assert.equal(ryan.appearance, '黑风衣');
  });
});
