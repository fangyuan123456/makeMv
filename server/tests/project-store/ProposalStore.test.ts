/**
 * tests/project-store/ProposalStore.test.ts
 * 任务持久化仓库 (TaskStore) 契约套件
 *
 * 历史沿革：ProposalStore 已被 TaskStore 取代——「一次生成 / 修改 / 复核 = 一个 Task」，
 * taskId 是唯一身份，状态与产物只归属 Task，对话消息只存 taskId 引用。
 * 原套件的六条不变量一对一迁移如下：
 *
 *   saveProposal / getProposal / listProposals → saveTask / getTask / listTasks
 *   updateProposalStatus                       → setStatus
 *   dismissProposalsForStage                   → cancelGateTasksForStage
 *   projectId 刚性防御                          → 同名不变
 *   只认 payload.stage、不猜 targetStage        → 同名不变
 *   写盘失败 Fail-Fast                         → 同名不变
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { TaskStore } from '../../src/project-store/TaskStore.js';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { config } from '../../src/utils/config.js';
import { WorkflowStage, SessionStatus, type Task, type TaskStatus } from '../../src/types/index.js';

/** 构造一个最小合法任务（只写测试关心的字段，其余给默认值） */
function makeTask(overrides: Partial<Task> & { taskId: string }): Task {
  return {
    projectId: 'test_proj_task_store',
    intent: 'generate',
    skill: 'story-bible',
    title: '推演故事圣经',
    status: 'proposed',
    stages: ['story-bible'],
    approval: { required: true },
    artifacts: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('TaskStore 任务持久化管理 (Task Store SSOT)', () => {
  const store = TaskStore.getInstance();
  const projectStore = ProjectStore.getInstance();
  const testProjectId = 'test_proj_task_store';

  before(() => {
    try {
      projectStore.deleteProject(testProjectId);
    } catch {}
    const now = new Date().toISOString();
    projectStore.saveProject({
      projectId: testProjectId,
      title: '任务仓库测试工程',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: { idea: '', style: '写实', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    } as any);
  });

  after(() => {
    try {
      projectStore.deleteProject(testProjectId);
    } catch {}
  });

  it('1. saveTask 物理真实落盘与 getTask/listTasks 契约读取', () => {
    store.saveTask(
      testProjectId,
      makeTask({
        taskId: 'task_001',
        actionType: 'PROCEED_STAGE',
        title: '推演故事圣经',
        payload: { stage: WorkflowStage.NARRATIVE_DESIGN },
      })
    );

    // 物理落盘断言 (拒绝假收敛)
    const tasksFile = path.join(config.paths.projects, testProjectId, 'tasks.json');
    assert.ok(fs.existsSync(tasksFile), 'tasks.json 必须在物理磁盘真实存在');

    const diskData = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
    assert.ok(Array.isArray(diskData));
    assert.ok(diskData.some((item: any) => item.taskId === 'task_001'));

    // 契约读取断言
    const fetched = store.getTask(testProjectId, 'task_001');
    assert.ok(fetched);
    assert.equal(fetched.taskId, 'task_001');
    assert.equal(fetched.title, '推演故事圣经');

    const proposedList = store.listTasks(testProjectId, { status: 'proposed' });
    assert.ok(proposedList.some((t) => t.taskId === 'task_001'));

    // 状态筛选必须精确：查运行中不应命中待确认
    assert.equal(store.listTasks(testProjectId, { status: 'running' }).length, 0);
  });

  it('2. setStatus 原子流转生命周期，并自动补齐时间戳 (succeeded / failed)', () => {
    // 成功流转
    store.setStatus(testProjectId, 'task_001', 'succeeded', {
      resultSummary: '故事圣经已就绪',
    });
    const done = store.getTask(testProjectId, 'task_001')!;
    assert.equal(done.status, 'succeeded');
    assert.ok(done.finishedAt, '进入终态必须自动打上 finishedAt');
    assert.equal(done.resultSummary, '故事圣经已就绪');

    // 失败流转
    store.saveTask(
      testProjectId,
      makeTask({
        taskId: 'task_fail_002',
        skill: 'character-portrait',
        title: '生成定妆',
        payload: { stage: WorkflowStage.CHARACTER_DESIGN },
      })
    );
    store.setStatus(testProjectId, 'task_fail_002', 'failed', { error: '模型连接超时' });

    const failed = store.getTask(testProjectId, 'task_fail_002')!;
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error, '模型连接超时');
    assert.ok(failed.finishedAt);

    // 启动时间戳同样自动补齐
    store.saveTask(testProjectId, makeTask({ taskId: 'task_running_003', status: 'queued' }));
    store.setStatus(testProjectId, 'task_running_003', 'running');
    assert.ok(store.getTask(testProjectId, 'task_running_003')!.startedAt);
  });

  it('3. cancelGateTasksForStage 契约驱动解除：只解门禁任务，不误杀普通任务，不跨阶段', () => {
    // 1. 当前工序的门禁拦截任务 → 必须被解除
    store.saveTask(
      testProjectId,
      makeTask({
        taskId: 'gate_narrative_001',
        intent: 'review',
        actionType: 'CRITIC_DEBATE',
        skill: 'critic-review',
        isGateIntercept: true,
        title: '圣经门禁拦截',
        payload: { stage: WorkflowStage.NARRATIVE_DESIGN },
      })
    );

    // 2. 普通业务待确认任务 → 严禁被解除
    store.saveTask(
      testProjectId,
      makeTask({
        taskId: 'task_normal_002',
        skill: 'character-portrait',
        title: '定妆生成',
        payload: { stage: WorkflowStage.NARRATIVE_DESIGN },
      })
    );

    // 3. 其他工序门禁任务 → 严禁跨阶段误解除
    store.saveTask(
      testProjectId,
      makeTask({
        taskId: 'gate_scene_003',
        intent: 'review',
        actionType: 'CRITIC_DEBATE',
        skill: 'critic-review',
        isGateIntercept: true,
        title: '分场剧本门禁',
        payload: { stage: WorkflowStage.SCENE_SCRIPT },
      })
    );

    const cancelledCount = store.cancelGateTasksForStage(
      testProjectId,
      WorkflowStage.NARRATIVE_DESIGN,
      '审查官对辩辩护通过'
    );
    assert.equal(cancelledCount, 1, '必须且仅能解除 1 个门禁任务');

    const gate = store.getTask(testProjectId, 'gate_narrative_001')!;
    assert.equal(gate.status, 'cancelled');
    assert.equal(gate.error, '审查官对辩辩护通过');

    assert.equal(
      store.getTask(testProjectId, 'task_normal_002')!.status,
      'proposed',
      '普通任务必须保持待确认'
    );
    assert.equal(
      store.getTask(testProjectId, 'gate_scene_003')!.status,
      'proposed',
      '其他阶段门禁严禁被跨阶段误解除'
    );
  });

  it('4. 终态不可回退：已结束任务禁止取消 (409)，且终态不受二次取消影响', () => {
    store.saveTask(
      testProjectId,
      makeTask({ taskId: 'task_terminal_004', status: 'succeeded' })
    );
    assert.throws(
      () => store.cancelTask(testProjectId, 'task_terminal_004'),
      (err: any) => err?.statusCode === 409,
      '终态任务取消必须抛 409，而不是静默改写'
    );
    assert.equal(store.getTask(testProjectId, 'task_terminal_004')!.status, 'succeeded');

    // 待确认与已排队仍可取消
    store.saveTask(testProjectId, makeTask({ taskId: 'task_open_005', status: 'queued' }));
    const cancelled = store.cancelTask(testProjectId, 'task_open_005', '创作者撤回');
    assert.equal(cancelled!.status, 'cancelled');
    assert.equal(cancelled!.error, '创作者撤回');
  });

  it('5. projectId 刚性防御：空字符串或非法路径穿越时抛出异常', () => {
    const dummy = makeTask({ taskId: 'invalid_pid_task' });

    assert.throws(() => store.saveTask('', dummy), /非法的 projectId/);

    // 真实相对路径穿越 (../../malicious) 刚性拦截，严禁隐式替换为下划线并在磁盘建目录
    assert.throws(() => store.saveTask('../../malicious', dummy), /非法的 projectId/);

    // 含路径分隔符
    assert.throws(() => store.saveTask('nested/project/dir', dummy), /非法的 projectId/);

    // 含空格
    assert.throws(() => store.saveTask('project with space', dummy), /非法的 projectId/);

    // 操作系统保留设备名
    assert.throws(() => store.saveTask('CON', dummy), /非法的 projectId/);

    // 只读查询接口同样刚性阻断
    assert.throws(() => store.getTask('../../malicious', 'invalid_pid_task'), /非法的 projectId/);
    assert.throws(() => store.listTasks('../../malicious'), /非法的 projectId/);
  });

  it('6. SSOT 刚性契约：门禁解除只认 payload.stage，不对 targetStage 做隐式猜测', () => {
    const legacyProjectId = 'test_proj_legacy_task';
    try {
      const now = new Date().toISOString();
      projectStore.saveProject({
        projectId: legacyProjectId,
        title: '旧格式任务工程',
        status: SessionStatus.IDLE,
        currentStage: WorkflowStage.NARRATIVE_DESIGN,
        stageArtifacts: {},
        history: [],
        meta: { idea: '', style: '写实', videoRatio: '16:9', videoResolution: '720P' },
        createdAt: now,
        updatedAt: now,
      } as any);

      // 只有旧别名 targetStage，没有标准 stage
      store.saveTask(
        legacyProjectId,
        makeTask({
          projectId: legacyProjectId,
          taskId: 'legacy_task_target_stage',
          intent: 'review',
          actionType: 'CRITIC_DEBATE',
          skill: 'critic-review',
          isGateIntercept: true,
          title: '旧格式任务',
          payload: { targetStage: WorkflowStage.NARRATIVE_DESIGN },
        })
      );

      const cancelled = store.cancelGateTasksForStage(legacyProjectId, WorkflowStage.NARRATIVE_DESIGN);
      assert.equal(cancelled, 0, '缺失标准 stage 的任务不应被解除');

      assert.equal(
        store.getTask(legacyProjectId, 'legacy_task_target_stage')!.status,
        'proposed',
        '旧格式任务必须维持待确认'
      );
    } finally {
      try {
        projectStore.deleteProject(legacyProjectId);
      } catch {}
    }
  });

  it('7. Fail-Fast 异常刚性冒泡：持久化写盘失败时必须向外 throw，拒绝静默吞错', () => {
    const circular: any = makeTask({ taskId: 'task_circular' });
    circular.self = circular;

    assert.throws(
      () => store.saveTask(testProjectId, circular),
      /(circular|Converting circular structure to JSON)/i,
      'saveTask 写入循环引用必须向外抛出异常'
    );

    // 写盘失败后内存态必须回滚，不得留下半条幽灵任务
    assert.equal(store.getTask(testProjectId, 'task_circular'), undefined);
  });

  it('8. 旧工程兼容：仅存在 proposals.json 时自动迁移为 Task，且不覆盖已有 tasks.json', () => {
    const legacyProjectId = 'test_proj_proposal_migration';
    try {
      const projectDir = path.join(config.paths.projects, legacyProjectId);
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectDir, 'proposals.json'),
        JSON.stringify([
          {
            actionId: 'prop_legacy_001',
            projectId: legacyProjectId,
            actionType: 'TRIGGER_STAGE',
            skill: 'story-bible',
            label: '旧提案：推演故事圣经',
            status: 'executed',
            affectedSteps: ['story-bible'],
            executedAt: '2026-11-01T00:00:00Z',
          },
        ]),
        'utf-8'
      );

      const migrated = store.getTask(legacyProjectId, 'prop_legacy_001');
      assert.ok(migrated, '旧 proposals.json 必须被读成 Task');
      assert.equal(migrated!.intent, 'generate');
      assert.equal(migrated!.title, '旧提案：推演故事圣经');
      // executed → succeeded 的状态映射必须成立，否则旧任务会被当成未完成
      assert.equal(migrated!.status, 'succeeded');
      assert.equal(migrated!.finishedAt, '2026-11-01T00:00:00Z');

      // 迁移是纯读取，不得把旧文件改写成 tasks.json
      assert.equal(
        fs.existsSync(path.join(projectDir, 'tasks.json')),
        false,
        '只读迁移不得产生 tasks.json'
      );
    } finally {
      try {
        projectStore.deleteProject(legacyProjectId);
      } catch {
        fs.rmSync(path.join(config.paths.projects, legacyProjectId), { recursive: true, force: true });
      }
    }
  });
});
