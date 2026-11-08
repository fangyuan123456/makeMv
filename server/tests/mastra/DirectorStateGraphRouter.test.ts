/**
 * mastra/DirectorStateGraphRouter.test.ts
 * 微内核 WorkflowEngine 动态状态图与人在回路测试套件
 *
 * 历史沿革：本套件原基于 ActionProposal（提案卡）。Task 架构收口后，
 * 「一次生成 / 修改 / 复核 = 一个 Task」，taskId 是唯一身份，状态与产物只归属 Task。
 * 原接口与新接口的对应关系：
 *
 *   dispatch → result.proposal (ActionProposal)
 *              → result.task (Task)
 *   executeProposal → executeTask
 *   rejectProposal  → TaskStore.cancelTask
 *   ProposalStore   → TaskStore
 *
 * 断言口径同步调整：除状态载体换名外，本套件保住了全部业务不变量
 * （防复活、running 不可驳回、终态核验、派发幂等、双轨分流、时空回退与级联清理）。
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ProjectStore, TaskStore } from '../../src/project-store/index.js';
import { Workflow } from '../../src/workflow-engine/index.js';
import { registerPipelineWorkflows } from '../../src/agents/director/generator/index.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';
import { LLMRegistry } from '../../src/llm/LLMRegistry.js';
import { MockLLMService } from '../../src/llm/MockLLMService.js';
import { exportStoryBibleToDisk } from '../../src/agents/director/generator/steps/story-bible/exporter.js';
import { STORY_BIBLE_JSON_PATH } from '../../src/artifacts/story-bible.js';

describe('DirectorStateGraphRouter - 动态状态图与人在回路测试套件', () => {
  const testProjectId = 'test_graph_router_proj';
  const store = ProjectStore.getInstance();
  const taskStore = TaskStore.getInstance();

  const freshProject = () => {
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
  };

  beforeEach(() => {
    registerPipelineWorkflows();
    LLMRegistry.set(new MockLLMService());
    try {
      store.deleteProject(testProjectId);
    } catch {}
    taskStore.invalidate(testProjectId);
    freshProject();
  });

  afterEach(() => {
    try {
      store.deleteProject(testProjectId);
    } catch {}
    taskStore.invalidate(testProjectId);
  });

  it('1. 应成功解析创作者意图并生成待审任务 (Task)', async () => {
    const engine = Workflow.getInstance();
    const result = await engine.dispatch({
      projectId: testProjectId,
      workflowKey: 'story-bible',
      reason: '我想做一个维多利亚时期的逆光怀表悬疑故事',
      requireConfirmation: true,
    });

    assert.equal(result.success, true);
    assert.ok(result.task, '必须返回唯一状态载体 Task');
    assert.equal(result.task.skill, 'story-bible');
    assert.equal(result.task.status, 'proposed');
    assert.equal(result.task.intent, 'generate');
    assert.equal(result.autoStarted, false, '需审批任务不得自动启动');

    // 验证落盘到了 TaskStore
    const saved = taskStore.getTask(testProjectId, result.task.taskId);
    assert.ok(saved, '任务必须物理落盘');
    assert.equal(saved!.taskId, result.task.taskId);
    assert.equal(saved!.status, 'proposed');
  });

  it('2. 创作者批准任务后，WorkflowEngine 应成功执行、落盘产物并写入完成通知', async () => {
    const engine = Workflow.getInstance();
    const sessionId = 'session_approve_flow';
    const routeRes = await engine.dispatch({
      projectId: testProjectId,
      sessionId,
      workflowKey: 'story-bible',
      reason: '启动故事圣经设计',
      requireConfirmation: true,
    });

    const task = routeRes.task!;
    assert.ok(task);

    const execRes: any = await engine.executeTask({
      projectId: testProjectId,
      taskId: task.taskId,
    });

    assert.equal(execRes.success, true, `任务必须执行成功: ${execRes.error || ''}`);
    assert.equal(execRes.task.status, 'succeeded');
    assert.ok(execRes.task.finishedAt, '终态必须带 finishedAt');

    // 验证状态黑板 ProjectStore 已落盘 narrative_design
    const artifact = store.getArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN);
    assert.ok(artifact);
    assert.ok((artifact as any).goldenSpine);

    // 任务产物链接必须挂到 Task 上（对话消息只引用 taskId，不再内嵌快照）
    assert.ok(
      execRes.task.artifacts.some((a: any) => a.stage === WorkflowStage.NARRATIVE_DESIGN),
      '产物链接必须挂到任务上'
    );

    // 完成后应向该会话写入「已完成 + 下一工序」的衔接通知
    const messages = store.getMessages(testProjectId, sessionId);
    const notice = messages.find((m) => m.role === 'assistant' && m.content.includes('已完成'));
    assert.ok(notice, '会话中必须出现工序完成通知');
    assert.ok(notice!.content.includes('下一工序'), '通知必须引导下一工序');
  });

  it('3. 创作者驳回任务后，任务应安全置为 cancelled 状态', async () => {
    const engine = Workflow.getInstance();
    const routeRes = await engine.dispatch({
      projectId: testProjectId,
      workflowKey: 'story-bible',
      reason: '生成故事任务',
      requireConfirmation: true,
    });

    const cancelled = taskStore.cancelTask(
      testProjectId,
      routeRes.task!.taskId,
      '暂不执行，先讨论人设'
    );

    assert.equal(cancelled!.status, 'cancelled');
    assert.equal(cancelled!.error, '暂不执行，先讨论人设');
    assert.ok(cancelled!.finishedAt, '驳回即终态，必须带 finishedAt');
  });

  it('4. 防复活防御：已结束 (cancelled / succeeded) 的任务再次执行必须刚性阻断', async () => {
    const engine = Workflow.getInstance();
    const routeRes = await engine.dispatch({
      projectId: testProjectId,
      workflowKey: 'story-bible',
      reason: '生成故事任务',
      requireConfirmation: true,
    });

    const taskId = routeRes.task!.taskId;
    taskStore.cancelTask(testProjectId, taskId, '直接驳回');

    // 尝试复活被驳回的任务，必须阻断报错
    await assert.rejects(
      async () => {
        await engine.executeTask({ projectId: testProjectId, taskId });
      },
      /任务处于非可执行状态 \[cancelled\]，禁止执行/
    );

    // 已完成的任务同样不可复活
    await engine.dispatch({
      projectId: testProjectId,
      workflowKey: 'story-bible',
      reason: '再生成一份',
      requireConfirmation: true,
    });
    const done = taskStore.listTasks(testProjectId, { status: 'proposed' })[0];
    await engine.executeTask({ projectId: testProjectId, taskId: done.taskId });
    await assert.rejects(
      async () => {
        await engine.executeTask({ projectId: testProjectId, taskId: done.taskId });
      },
      /任务处于非可执行状态 \[succeeded\]，禁止执行/
    );
  });

  it('5. 批次 B1: running 状态任务坚决不允许驳回 (抛出 409)', () => {
    const taskId = `task_running_${Date.now()}`;
    taskStore.saveTask(testProjectId, {
      taskId,
      projectId: testProjectId,
      intent: 'generate',
      skill: 'story-bible',
      title: '正在运行中的任务',
      status: 'running',
      stages: ['story-bible'],
      approval: { required: true },
      artifacts: [],
      createdAt: new Date().toISOString(),
    });

    assert.throws(
      () => taskStore.cancelTask(testProjectId, taskId, '强制驳回'),
      (err: any) => {
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /不可取消/);
        return true;
      }
    );
    assert.equal(taskStore.getTask(testProjectId, taskId)!.status, 'running');
  });

  it('6. 批次 B2: 终态核验防御：人为在执行期间取消，最终状态不被覆盖', async () => {
    const taskId = `task_b2_${Date.now()}`;
    taskStore.saveTask(testProjectId, {
      taskId,
      projectId: testProjectId,
      intent: 'generate',
      skill: 'story-bible',
      title: '测试终态核验',
      status: 'cancelled', // 模拟在拿到锁前已被取消
      stages: ['story-bible'],
      approval: { required: true },
      artifacts: [],
      createdAt: new Date().toISOString(),
    });

    const engine = Workflow.getInstance();
    const result = await (engine as any).runTask(testProjectId, taskId);
    assert.equal(result.success, false);

    // 验证状态依旧是 cancelled，没有被写成 succeeded 或 failed
    assert.equal(taskStore.getTask(testProjectId, taskId)!.status, 'cancelled');
  });

  it('7. 批次 B3: 任务幂等：同 session 同 skill 连发只出一张卡并复用旧卡', async () => {
    const engine = Workflow.getInstance();
    const sessionId = 'session_test_b3';

    const res1 = await engine.dispatch({
      projectId: testProjectId,
      sessionId,
      workflowKey: 'story-bible',
      reason: '我想做一个维多利亚时期的逆光怀表悬疑故事',
      requireConfirmation: true,
    });
    assert.ok(res1.task);
    assert.ok(!res1.isReused, '首次派发是新建，不得标记为复用');

    const res2 = await engine.dispatch({
      projectId: testProjectId,
      sessionId,
      workflowKey: 'story-bible',
      reason: '我想做一个维多利亚时期的逆光怀表悬疑故事',
      requireConfirmation: true,
    });

    assert.equal(res2.isReused, true, '第二次同意图派发必须复用');
    assert.equal(res2.taskId, res1.taskId, '复用必须是同一张卡，而不是再造一张');

    const allProposed = taskStore.listTasks(testProjectId, { status: 'proposed' });
    assert.equal(allProposed.length, 1, '列表中只允许存在一张待确认任务');
  });

  it('8. 批次 C1 & C3: 历史 SSOT 收敛到 sessionId，双会话并行不串味', () => {
    const sessionA = 'session_line_a';
    const sessionB = 'session_line_b';

    store.appendMessage(testProjectId, sessionA, {
      id: 'msg_a_1',
      role: 'user',
      content: '【怀表线】凶手偷走了镀金怀表',
      createdAt: new Date().toISOString(),
    } as any);

    store.appendMessage(testProjectId, sessionB, {
      id: 'msg_b_1',
      role: 'user',
      content: '【列车线】案发地点在跨国特快列车三号车厢',
      createdAt: new Date().toISOString(),
    } as any);

    const messagesA = store.getMessages(testProjectId, sessionA);
    const messagesB = store.getMessages(testProjectId, sessionB);

    assert.equal(messagesA.length, 1);
    assert.equal(messagesB.length, 1);
    assert.ok(messagesA[0].content.includes('镀金怀表'));
    assert.ok(messagesB[0].content.includes('列车线') || messagesB[0].content.includes('跨国特快列车'));
  });

  it('9. 意图一致性：同 session 下 actionType 不同必须新建任务，绝不把微调灌进待审生成卡', async () => {
    const engine = Workflow.getInstance();
    const sessionId = 'session_intent_switch';

    const gen = await engine.dispatch({
      projectId: testProjectId,
      sessionId,
      workflowKey: 'story-bible',
      actionType: 'PROCEED_STAGE',
      reason: '推进故事圣经',
      requireConfirmation: true,
    });

    const revise = await engine.dispatch({
      projectId: testProjectId,
      sessionId,
      workflowKey: 'story-bible',
      actionType: 'TARGETED_REVISE',
      reason: '把主角名字改掉',
      parameters: { target: '阿诺', userFeedback: '把主角名字改掉' },
      requireConfirmation: true,
    });

    assert.notEqual(revise.taskId, gen.taskId, '意图不同必须新建任务');
    assert.equal(revise.task.actionType, 'TARGETED_REVISE');
    assert.ok(!revise.isReused, '意图变更必须新建，不能复用旧卡');
    assert.equal(revise.task.payload?.target, '阿诺');
  });

  it('10. WorkflowEngine 双轨分发：TARGETED_REVISE 成功分流至修改器并执行 Delta Patch', async () => {
    const engine = Workflow.getInstance();
    const mockLLM = LLMRegistry.get() as any;

    // 准备已有故事圣经并写入黑板与磁盘
    const initialBible: any = {
      title: '赛博幽灵：记忆重构',
      logline: '原设定梗概',
      sellingPoints: ['极速反转'],
      goldenSpine: [{ act: 1, name: '启程', summary: '开局', targetDurationSec: 60 }],
      characters: [{ name: '钟表匠学徒阿诺', role: '主角', appearance: '风衣黑发' }],
      characterNames: ['钟表匠学徒阿诺'],
    };
    store.setArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN, initialBible);
    exportStoryBibleToDisk(testProjectId, initialBible, store);

    // 补丁桩：只改 logline，且 search 逐字取自原文（含缩进与行尾逗号）
    mockLLM.setStageHandler('text_multi_file_patch', (prompt: string) => {
      const blocks = [...prompt.matchAll(/<<<FILE: (.+?)>>>\n([\s\S]*?)<<<END FILE>>>/g)];
      for (const block of blocks) {
        const line = block[2].match(/^(\s*)"logline":\s*"((?:[^"\\]|\\.)*)"(,?)$/m);
        if (!line) continue;
        return {
          patches: [
            {
              file: block[1].trim(),
              search: line[0],
              replace: `${line[1]}"logline": "${line[2]}·银色寸头版"${line[3]}`,
            },
          ],
          summary: '改成银色寸头',
        };
      }
      throw new Error('测试桩未找到 logline 锚点');
    });

    const routeRes = await engine.dispatch({
      projectId: testProjectId,
      workflowKey: 'story-bible',
      actionType: 'TARGETED_REVISE',
      reason: '把主角阿诺的发型改成银色寸头',
      parameters: {
        target: '钟表匠学徒阿诺',
        userFeedback: '把主角阿诺的发型改成银色寸头',
      },
      requireConfirmation: true,
    });

    assert.ok(routeRes.task);
    assert.equal(routeRes.task.actionType, 'TARGETED_REVISE');

    const execRes: any = await engine.executeTask({
      projectId: testProjectId,
      taskId: routeRes.task.taskId,
    });

    assert.equal(execRes.success, true, `微调必须成功: ${execRes.error || ''}`);
    assert.equal(execRes.task.status, 'succeeded');
    assert.equal(execRes.task.intent, 'revise', '意图必须被导出为 revise');

    // Delta Patch 真实落地：磁盘底稿被改写，而非只在内存里标记成功
    const jsonPath = path.join(store.getProjectDir(testProjectId), STORY_BIBLE_JSON_PATH);
    const onDisk = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    assert.match(onDisk.logline, /银色寸头版/);
  });

  it('11. 任务执行成功后时空回退：阶段退回源头并级联清理下游资产与旧门禁', async () => {
    const engine = Workflow.getInstance();
    const sessionId = 'session_rollback_test';

    // 模拟项目已推进到第三阶段 (scene_script)
    const project = store.getProject(testProjectId)!;
    project.currentStage = WorkflowStage.SCENE_SCRIPT;
    project.stageArtifacts = {
      [WorkflowStage.NARRATIVE_DESIGN]: { title: '初始故事' },
      [WorkflowStage.CHARACTER_DESIGN]: { characters: [] },
      [WorkflowStage.SCENE_SCRIPT]: { scenes: [] },
      [`critic_review_${WorkflowStage.CHARACTER_DESIGN}`]: { gateStatus: 'PASS' },
    };
    store.saveProject(project);

    const routeRes = await engine.dispatch({
      projectId: testProjectId,
      sessionId,
      workflowKey: 'story-bible',
      actionType: 'STAGE_ROLLBACK',
      reason: '对整体故事骨架推翻重写',
      requireConfirmation: true,
    });

    assert.ok(routeRes.task);
    assert.equal(routeRes.task.actionType, 'STAGE_ROLLBACK');

    const execRes: any = await engine.executeTask({
      projectId: testProjectId,
      taskId: routeRes.task.taskId,
    });
    assert.equal(execRes.success, true, `回退执行必须成功: ${execRes.error || ''}`);

    // 验证 1：项目阶段成功回退至 narrative_design
    const updatedProject = store.getProject(testProjectId)!;
    assert.equal(updatedProject.currentStage, WorkflowStage.NARRATIVE_DESIGN);

    // 验证 2：下游角色与剧本资产已被级联清理，旧门禁一并失效
    assert.ok(!updatedProject.stageArtifacts[WorkflowStage.CHARACTER_DESIGN], '下游定妆必须清除');
    assert.ok(!updatedProject.stageArtifacts[WorkflowStage.SCENE_SCRIPT], '下游剧本必须清除');
    assert.equal(
      updatedProject.stageArtifacts[`critic_review_${WorkflowStage.CHARACTER_DESIGN}`],
      undefined,
      '下游旧门禁必须清除，否则新产物会被旧 PASS 放行'
    );

    // 验证 3：回退不产生「下一工序」循环提示（当前阶段刚被重做，不应立刻再推一遍）
    const messages = store.getMessages(testProjectId, sessionId);
    const loopNotice = messages.find(
      (m) => m.role === 'assistant' && m.content.includes('请在输入框旁确认后授权启动')
    );
    assert.equal(loopNotice, undefined, '回退后不得自动提议下一工序，避免「改完又让你改」的循环');
  });

  it('12. DirectorAgent 统一中枢具备全景黑板感知与法定 8 大工序意图协议', async () => {
    const { createDirectorAgent } = await import('../../src/agents/director/index.js');
    const rAgent = createDirectorAgent(testProjectId, 'session_director_check');
    const instructions = await (rAgent as any).getInstructions();

    assert.ok(instructions.includes('story-bible'));
    assert.ok(instructions.includes('character-portrait'));
    assert.ok(instructions.includes('工序推进与创作者意图理解守则'));
  });

  it('13. WorkflowEngine 双轨分发：character-portrait 定向精修单角色，保全其余角色', async () => {
    const engine = Workflow.getInstance();
    const mockLLM = LLMRegistry.get() as any;
    mockLLM.setStageHandler('character_refine', () => ({
      refinedVisualPrompt: '赛博银色长风衣，霓虹反光，冷峻侧脸',
    }));

    const initialBible: any = {
      title: '赛博幽灵：记忆重构',
      logline: '记忆黑市',
      style: '赛博朋克',
      goldenSpine: [{ act: 1, name: '启程', summary: '开局', targetDurationSec: 60 }],
      characters: [
        { name: '阿诺', role: '主角', gender: '男', age: 30, appearance: '皮夹克' },
        { name: '雷恩', role: '反派', gender: '男', age: 35, appearance: '黑风衣' },
      ],
      characterNames: ['阿诺', '雷恩'],
    };
    store.setArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN, initialBible);

    // 定妆产物只存视觉派生，事实由故事圣经现查
    store.setArtifact(testProjectId, WorkflowStage.CHARACTER_DESIGN, {
      characters: [
        { name: '阿诺', visualPrompt: '皮夹克，短发', imageUrl: '/media/test/arnold.png', history: [] },
        { name: '雷恩', visualPrompt: '黑风衣，长发', imageUrl: '/media/test/ryan.png', history: [] },
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
      requireConfirmation: true,
    });

    assert.ok(routeRes.task);
    assert.equal(routeRes.task.actionType, 'TARGETED_REVISE');

    const execRes: any = await engine.executeTask({
      projectId: testProjectId,
      taskId: routeRes.task.taskId,
    });
    assert.equal(execRes.success, true, `精修必须成功: ${execRes.error || ''}`);

    const updatedArt = store.getArtifact<any>(testProjectId, WorkflowStage.CHARACTER_DESIGN)!;
    assert.equal(updatedArt.characters.length, 2);

    const arnold = updatedArt.characters.find((c: any) => c.name === '阿诺');
    assert.match(arnold.visualPrompt, /赛博银色长风衣/, '目标角色必须被重写');
    assert.ok(arnold.history.length >= 1, '旧版必须压栈可回溯');

    // 非目标角色雷恩 100% 物理保全原图与提示词
    const ryan = updatedArt.characters.find((c: any) => c.name === '雷恩');
    assert.equal(ryan.imageUrl, '/media/test/ryan.png');
    assert.equal(ryan.visualPrompt, '黑风衣，长发');
  });
});
