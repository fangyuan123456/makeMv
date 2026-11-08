/**
 * tests/mastra/ModifyFollowUp.test.ts
 * 跨源头追加诉求的接单判据
 *
 * 锁的是三条：
 *   1. 产物还在 → 按「修改」接单；产物已被上游清退 → 按「指令重新生成」接单
 *      （此时没有底稿可改，只能把这句话带进生成轨的 feedback）；
 *   2. 只接 downstream：merged 由主单的跨文件补丁覆盖，upstream 会把主单产物清退；
 *   3. 一律派发成 proposed（待确认）——追加可能触发一次真金白银的重生成。
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore, TaskStore } from '../../src/project-store/index.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';
import { registerPipelineWorkflows } from '../../src/agents/director/generator/index.js';
import { planFollowUpTasks, scheduleFollowUpAsks } from '../../src/agents/director/modifier/follow-up.js';
import {
  peekStageDirectives,
  clearStageDirectives,
} from '../../src/agents/director/modifier/stage-directives.js';

describe('ModifyFollowUp - 追加诉求只在主单落地后接单', () => {
  const store = ProjectStore.getInstance();
  const taskStore = TaskStore.getInstance();
  const projectId = 'test_proj_modify_followup';

  before(() => {
    registerPipelineWorkflows();
    try {
      store.deleteProject(projectId);
    } catch {
      /* 首次运行无旧项目 */
    }
    store.saveProject({
      projectId,
      title: '追加诉求',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.SCENE_SCRIPT,
      stageArtifacts: {
        [WorkflowStage.NARRATIVE_DESIGN]: { characters: [{ name: '张明' }] },
        [WorkflowStage.SCENE_SCRIPT]: { scenes: [{ sceneId: 'scene_1' }] },
        [WorkflowStage.STORYBOARD]: { shots: [{ shotId: 'shot_1' }] },
        // 关键帧刻意不落盘：模拟「被主单清退」
        [WorkflowStage.CHARACTER_DESIGN]: { portraits: [{ characterName: '张明' }] },
      },
    } as any);
  });

  beforeEach(() => {
    // TaskStore 没有删除接口：把上一轮的待确认任务取消掉，让每条用例从干净状态开始
    for (const t of taskStore.listTasks(projectId, { status: 'proposed' })) {
      taskStore.cancelTask(projectId, t.taskId, '用例清理');
    }
  });

  after(() => {
    try {
      store.deleteProject(projectId);
    } catch {
      /* 清理无旧项目 */
    }
  });

  const ask = (over: Partial<any> = {}) => ({
    clause: '关键帧的光影调暗一点',
    sourceSkill: 'keyframe-reference',
    attribute: 'visual',
    relation: 'downstream',
    ...over,
  });

  it('1. 产物还在 → 按修改接单', () => {
    const [plan] = planFollowUpTasks(
      { [WorkflowStage.KEYFRAME_REFERENCE]: { frames: [] } },
      [ask()]
    );
    assert.equal(plan.skill, 'keyframe-reference');
    assert.equal(plan.actionType, 'TARGETED_REVISE', '有底稿就只改底稿');
    assert.match(plan.reason, /按修改执行/);
  });

  it('2. 产物已被清退 → 挂到该工序上，等它重新生成时执行', () => {
    const [plan] = planFollowUpTasks({}, [ask()]);
    assert.equal(plan.actionType, 'DEFER', '没有底稿可改，立刻生成又缺上游，只能挂着');
    assert.match(plan.reason, /重新生成时一并执行/);
    assert.equal(plan.feedback, '关键帧的光影调暗一点', '传给执行体的必须是分句本身');
  });

  it('3. 只接 downstream：merged 已由主单覆盖，upstream 会清退主单产物', () => {
    const plans = planFollowUpTasks(
      {
        [WorkflowStage.NARRATIVE_DESIGN]: {},
        [WorkflowStage.KEYFRAME_REFERENCE]: {},
      },
      [
        ask({ relation: 'merged', clause: '镜头换中景', sourceSkill: 'storyboard' }),
        ask({ relation: 'upstream', clause: '发型换寸头', sourceSkill: 'story-bible' }),
        ask(),
      ]
    );
    assert.equal(plans.length, 1);
    assert.equal(plans[0].skill, 'keyframe-reference');
  });

  it('4. 按阶段升序排列，同阶段只接一次', () => {
    const plans = planFollowUpTasks(
      { [WorkflowStage.STORYBOARD]: {}, [WorkflowStage.VIDEO_PRODUCTION]: {} },
      [
        ask({ sourceSkill: 'video-production', clause: '节奏剪快一点', attribute: 'visual' }),
        ask({ sourceSkill: 'storyboard', clause: '镜头换中景', attribute: 'shot' }),
        ask({ sourceSkill: 'storyboard', clause: '镜头再紧一点', attribute: 'shot' }),
      ]
    );
    assert.deepEqual(
      plans.map((p) => p.skill),
      ['storyboard', 'video-production'],
      '下游先接单没有意义：它依赖的产物刚被上游改过'
    );
  });

  it('5. 没有 followUpAsks 时什么都不做', async () => {
    await scheduleFollowUpAsks({ projectId, sessionId: 's1', payload: {} });
    assert.equal(taskStore.listTasks(projectId, { status: 'proposed' }).length, 0);
  });

  it('6. 产物不在时只挂待办，不立任务（不替创作者提前花钱）', async () => {
    clearStageDirectives(projectId, WorkflowStage.KEYFRAME_REFERENCE);
    await scheduleFollowUpAsks({
      projectId,
      sessionId: 's1',
      payload: { taskId: 'task_prev', followUpAsks: [ask()] },
    });

    assert.equal(taskStore.listTasks(projectId, { status: 'proposed' }).length, 0);
    const directives = peekStageDirectives(projectId, WorkflowStage.KEYFRAME_REFERENCE);
    assert.equal(directives.length, 1);
    assert.equal(directives[0].text, '关键帧的光影调暗一点');
  });

  it('7. 产物还在时立待确认任务，原话进 userPrompt', async () => {
    const [plan] = planFollowUpTasks({ [WorkflowStage.STORYBOARD]: {} }, [
      ask({ sourceSkill: 'storyboard', clause: '镜头换中景', attribute: 'shot' }),
    ]);
    assert.equal(plan.actionType, 'TARGETED_REVISE');

    await scheduleFollowUpAsks({
      projectId,
      sessionId: 's1',
      payload: {
        taskId: 'task_prev',
        followUpAsks: [ask({ sourceSkill: 'storyboard', clause: '镜头换中景', attribute: 'shot' })],
      },
    });

    const proposed = taskStore.listTasks(projectId, { status: 'proposed' });
    assert.equal(proposed.length, 1, '追加动作必须等创作者确认，不能自动排队');
    assert.equal(proposed[0].skill, 'storyboard');
    assert.equal(proposed[0].actionType, 'TARGETED_REVISE');
    assert.equal(proposed[0].payload?.userPrompt, '镜头换中景');
    assert.match(String(proposed[0].description || ''), /补充诉求/);
  });

  it('8. 同一阶段同一句话只挂一条待办', async () => {
    clearStageDirectives(projectId, WorkflowStage.KEYFRAME_REFERENCE);
    const payload = { taskId: 'task_prev', followUpAsks: [ask()] };
    await scheduleFollowUpAsks({ projectId, sessionId: 's1', payload });
    await scheduleFollowUpAsks({ projectId, sessionId: 's1', payload });
    assert.equal(peekStageDirectives(projectId, WorkflowStage.KEYFRAME_REFERENCE).length, 1);
  });
});
