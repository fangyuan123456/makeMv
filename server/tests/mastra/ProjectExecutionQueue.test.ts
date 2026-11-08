/**
 * tests/mastra/ProjectExecutionQueue.test.ts
 * 项目级串行执行队列回归套件
 *
 * 背景：同一项目的两个任务曾可以并发执行。两支微调在 load 段各读一份旧底稿，
 * commit 段整表回写，后写覆盖前写，两条任务却都标 succeeded——用户改的第一处
 * 被静默吃掉，且没有任何报错可循。queued 状态当时也没有任何消费方，
 * 只会让客户端对着「排队中」无限轮询。
 *
 * 本套件锁住四条不变量：
 *   1. 同一项目任何时刻只有一个任务处于 running，后者排队且最终按序落地；
 *   2. 排队任务可被驳回，驳回后不得再执行、不得覆盖任何产物；
 *   3. 重复批准同一任务不得重复执行（幂等）；
 *   4. 不同项目互不排队（串行粒度是项目，不是全局）。
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { TaskStore } from '../../src/project-store/TaskStore.js';
import { LLMRegistry } from '../../src/llm/LLMRegistry.js';
import { MockLLMService } from '../../src/llm/MockLLMService.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';
import { registerPipelineWorkflows } from '../../src/agents/director/orchestration/index.js';
import { Workflow } from '../../src/workflow-engine/index.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('ProjectExecutionQueue - 项目级串行执行队列', () => {
  const store = ProjectStore.getInstance();
  const taskStore = TaskStore.getInstance();
  const engine = Workflow.getInstance();
  let mockLLM: MockLLMService;

  /** 造一个「故事圣经 + 定妆照」齐备的项目（定妆只持视觉派生，事实在故事圣经） */
  function seedProject(projectId: string, characters: string[]): void {
    try {
      store.deleteProject(projectId);
    } catch {}
    store.saveProject({
      projectId,
      title: `队列测试工程 ${projectId}`,
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.CHARACTER_DESIGN,
      stageArtifacts: {
        [WorkflowStage.NARRATIVE_DESIGN]: {
          title: '末日回响',
          logline: '特工在废墟都市追查记忆黑市',
          style: '赛博朋克，暗冷影调',
          goldenSpine: [{ act: 1, name: '启程', summary: '接下委托', targetDurationSec: 60 }],
          characters: characters.map((name) => ({
            name,
            role: '配角',
            gender: '男',
            age: 30,
            appearance: `${name}的原始外貌`,
            personality: '沉默',
            motivation: '活下去',
          })),
          characterNames: characters,
        },
        [WorkflowStage.CHARACTER_DESIGN]: {
          characters: characters.map((name) => ({
            name,
            visualPrompt: `${name}的原始视觉提示词`,
            imageUrl: `http://mock.media/${encodeURIComponent(name)}_v1.png`,
            history: [],
          })),
        },
      },
    } as any);
  }

  before(() => {
    registerPipelineWorkflows();
    mockLLM = new MockLLMService();
    LLMRegistry.set(mockLLM);
  });

  it('1. 同项目连下两条修改：后者排队，两处改动都必须落地', async () => {
    mockLLM.resetCustomHandlers();
    const pid = 'test_proj_queue_serial';
    seedProject(pid, ['阿诺', '艾米', '卡尔']);

    const refined: string[] = [];
    mockLLM.setStageHandler('character_refine', async (prompt: string) => {
      if (prompt.includes('姓名：阿诺')) {
        refined.push('阿诺');
        // 制造「先读底稿、后回写」的时间窗：旧实现下后一条会在窗口内读到旧稿并覆盖它
        await delay(120);
        return { refinedVisualPrompt: '阿诺 · 雨夜逆光剪影，湿发贴额' };
      }
      refined.push('艾米');
      return { refinedVisualPrompt: '艾米 · 晨雾柔光，白大褂沾露' };
    });

    const first = await engine.dispatch({
      projectId: pid,
      sessionId: 'sess_queue_1',
      workflowKey: 'character-portrait',
      actionType: 'TARGETED_REVISE',
      reason: '把阿诺改成雨夜逆光剪影',
      userPrompt: '把阿诺改成雨夜逆光剪影',
      parameters: { target: '阿诺', isMock: true },
    });
    assert.equal(first.success, true);
    assert.equal(first.task?.status, 'running', '项目空闲时第一条直接进入执行');

    const second = await engine.dispatch({
      projectId: pid,
      sessionId: 'sess_queue_1',
      workflowKey: 'character-portrait',
      actionType: 'TARGETED_REVISE',
      reason: '把艾米改成晨雾柔光',
      userPrompt: '把艾米改成晨雾柔光',
      parameters: { target: '艾米', isMock: true },
    });
    assert.equal(second.success, true);
    assert.equal(second.task?.status, 'queued', '项目内有任务在跑时，第二条必须排队而不是并发');
    assert.equal(second.autoStarted, false, '排队不等于已启动');
    assert.match(second.summary || '', /排队|队列/, '文案必须说清是排队，不能谎称已启动');

    const runningNow = taskStore.listTasks(pid, { status: 'running' });
    assert.equal(runningNow.length, 1, '同一项目任何时刻只允许一个任务处于执行中');

    const [resA, resB] = await Promise.all([
      engine.executeTask({ projectId: pid, taskId: first.task!.taskId }),
      engine.executeTask({ projectId: pid, taskId: second.task!.taskId }),
    ]);
    assert.equal(resA.success, true, `第一条应成功: ${resA.error || ''}`);
    assert.equal(resB.success, true, `排队任务应成功: ${resB.error || ''}`);

    const art: any = store.getArtifact(pid, WorkflowStage.CHARACTER_DESIGN);
    const arnold = art.characters.find((c: any) => c.name === '阿诺');
    const amy = art.characters.find((c: any) => c.name === '艾米');
    const karl = art.characters.find((c: any) => c.name === '卡尔');
    assert.match(arnold.visualPrompt, /雨夜逆光剪影/, '第一条的改动不得被后一条覆盖');
    assert.match(amy.visualPrompt, /晨雾柔光/, '排队任务必须读到前一条已提交的底稿再改');
    assert.equal(karl.visualPrompt, '卡尔的原始视觉提示词', '未涉及的必须原样');

    // 执行顺序必须是「先到先执行」，否则排队就失去意义
    assert.deepEqual(refined, ['阿诺', '艾米']);
  });

  it('2. 排队中的任务可被驳回：驳回后不得执行，也不得覆盖产物', async () => {
    mockLLM.resetCustomHandlers();
    const pid = 'test_proj_queue_cancel';
    seedProject(pid, ['阿诺', '艾米']);

    const refined: string[] = [];
    mockLLM.setStageHandler('character_refine', async (prompt: string) => {
      const name = prompt.includes('姓名：阿诺') ? '阿诺' : '艾米';
      refined.push(name);
      await delay(120);
      return { refinedVisualPrompt: `${name} · 新造型` };
    });

    const first = await engine.dispatch({
      projectId: pid,
      sessionId: 'sess_queue_2',
      workflowKey: 'character-portrait',
      actionType: 'TARGETED_REVISE',
      userPrompt: '改阿诺',
      parameters: { target: '阿诺', isMock: true },
    });
    const second = await engine.dispatch({
      projectId: pid,
      sessionId: 'sess_queue_2',
      workflowKey: 'character-portrait',
      actionType: 'TARGETED_REVISE',
      userPrompt: '改艾米',
      parameters: { target: '艾米', isMock: true },
    });
    assert.equal(second.task?.status, 'queued');

    const cancelled = await engine.cancelTask(pid, second.task!.taskId, '创作者改主意了');
    assert.equal(cancelled.status, 'cancelled', '排队中的任务必须可驳回（不能像 running 一样锁死）');

    await engine.executeTask({ projectId: pid, taskId: first.task!.taskId });
    await delay(30); // 让被驳回任务在链上走到「跳过」那一步

    const art: any = store.getArtifact(pid, WorkflowStage.CHARACTER_DESIGN);
    const amy = art.characters.find((c: any) => c.name === '艾米');
    assert.equal(amy.visualPrompt, '艾米的原始视觉提示词', '驳回后绝不允许产出覆盖');
    assert.deepEqual(refined, ['阿诺'], '被驳回的任务不得产生任何一次 LLM 调用');

    const finalTask = taskStore.getTask(pid, second.task!.taskId);
    assert.equal(finalTask?.status, 'cancelled', '被驳回的任务不得被状态机改写');
  });

  it('3. 重复批准同一排队任务：幂等，只执行一次', async () => {
    mockLLM.resetCustomHandlers();
    const pid = 'test_proj_queue_idempotent';
    seedProject(pid, ['阿诺', '艾米']);

    const refined: string[] = [];
    mockLLM.setStageHandler('character_refine', async (prompt: string) => {
      const name = prompt.includes('姓名：阿诺') ? '阿诺' : '艾米';
      refined.push(name);
      await delay(100);
      return { refinedVisualPrompt: `${name} · 新造型` };
    });

    const first = await engine.dispatch({
      projectId: pid,
      sessionId: 'sess_queue_3',
      workflowKey: 'character-portrait',
      actionType: 'TARGETED_REVISE',
      userPrompt: '改阿诺',
      parameters: { target: '阿诺', isMock: true },
    });
    const second = await engine.dispatch({
      projectId: pid,
      sessionId: 'sess_queue_3',
      workflowKey: 'character-portrait',
      actionType: 'TARGETED_REVISE',
      userPrompt: '改艾米',
      parameters: { target: '艾米', isMock: true },
    });

    // 模拟前端连点两次「批准」
    const r1 = await engine.startTask({ projectId: pid, taskId: second.task!.taskId });
    const r2 = await engine.startTask({ projectId: pid, taskId: second.task!.taskId });
    assert.equal(r1.accepted, true);
    assert.equal(r2.accepted, true);

    await engine.executeTask({ projectId: pid, taskId: first.task!.taskId });
    await engine.executeTask({ projectId: pid, taskId: second.task!.taskId });

    assert.deepEqual(refined, ['阿诺', '艾米'], '重复批准不得把同一任务执行两次');
  });

  it('4. 不同项目互不排队：串行粒度是项目而非全局', async () => {
    mockLLM.resetCustomHandlers();
    const pidA = 'test_proj_queue_scope_a';
    const pidB = 'test_proj_queue_scope_b';
    seedProject(pidA, ['阿诺']);
    seedProject(pidB, ['艾米']);

    mockLLM.setStageHandler('character_refine', async () => {
      await delay(150);
      return { refinedVisualPrompt: '新造型' };
    });

    const a = await engine.dispatch({
      projectId: pidA,
      sessionId: 'sess_scope_a',
      workflowKey: 'character-portrait',
      actionType: 'TARGETED_REVISE',
      userPrompt: '改阿诺',
      parameters: { target: '阿诺', isMock: true },
    });
    const b = await engine.dispatch({
      projectId: pidB,
      sessionId: 'sess_scope_b',
      workflowKey: 'character-portrait',
      actionType: 'TARGETED_REVISE',
      userPrompt: '改艾米',
      parameters: { target: '艾米', isMock: true },
    });

    assert.equal(a.task?.status, 'running');
    assert.equal(b.task?.status, 'running', '不同项目必须能同时执行，不能被全局锁串起来');

    await Promise.all([
      engine.executeTask({ projectId: pidA, taskId: a.task!.taskId }),
      engine.executeTask({ projectId: pidB, taskId: b.task!.taskId }),
    ]);
  });

  it('5. 进程重启后的 queued 孤儿必须收口为 failed，不能留在排队中', () => {
    const pid = 'test_proj_queue_orphan';
    seedProject(pid, ['阿诺']);

    const now = new Date().toISOString();
    taskStore.saveTask(pid, {
      taskId: 'task_orphan_queued',
      projectId: pid,
      intent: 'revise',
      skill: 'character-portrait',
      actionType: 'TARGETED_REVISE',
      title: '重启前批准但未轮到的任务',
      status: 'queued',
      stages: ['character-portrait'],
      approval: { required: true, approvedAt: now },
      payload: { target: '阿诺' },
      artifacts: [],
      createdAt: now,
    });

    engine.recoverOrphanTasks();

    const orphan = taskStore.getTask(pid, 'task_orphan_queued');
    assert.equal(orphan?.status, 'failed', '执行队列只存在于内存，重启后 queued 永远等不到执行');
    assert.match(orphan?.error || '', /重启/, '错误信息要给出可操作的线索');
    assert.ok(orphan?.finishedAt, '收口时必须补齐结束时间');
  });
});
