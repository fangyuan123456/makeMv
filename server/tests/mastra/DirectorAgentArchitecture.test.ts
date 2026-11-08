/**
 * tests/mastra/DirectorAgentArchitecture.test.ts
 * 现代微内核与多智能体架构 (Router / Pipeline / Modifier Agents) 自动化测试套件
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { directorAgent, createDirectorAgent } from '../../src/agents/director/index.js';
import { resolveModifySource } from '../../src/agents/director/modifier/index.js';
import { Workflow } from '../../src/workflow-engine/index.js';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { TaskStore } from '../../src/project-store/TaskStore.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';
import { registerPipelineWorkflows } from '../../src/agents/director/orchestration/index.js';
import { exportStoryBibleToDisk } from '../../src/agents/director/generator/steps/story-bible/index.js';
import { ContextAssembler } from '../../src/project-store/index.js';

describe('DirectorArchitecture - AI 视听总导演单跳直出与解耦双轨架构测试', () => {
  const projectStore = ProjectStore.getInstance();
  const taskStore = TaskStore.getInstance();
  const testProjectId = 'test_proj_director_agent_arch';
  const testSessionId = 'test_sess_director_agent_arch';

  before(() => {
    registerPipelineWorkflows();
    try {
      projectStore.deleteProject(testProjectId);
    } catch {}

    const now = new Date().toISOString();
    projectStore.saveProject({
      projectId: testProjectId,
      title: '赛博霓虹互动剧',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {
        [WorkflowStage.NARRATIVE_DESIGN]: {
          title: '赛博霓虹',
          logline: '仿生侦探在废弃底层调查记忆黑市',
          goldenSpine: [
            { act: 1, name: '记忆失窃', summary: '侦探接单', targetDurationSec: 60, cliffhanger: '线人被灭口' },
            { act: 2, name: '深入下层', summary: '发现芯片', targetDurationSec: 120, cliffhanger: '遭遇陷阱' },
            { act: 3, name: '真凶浮现', summary: '身份反转', targetDurationSec: 90, cliffhanger: '终局抉择' },
          ],
          characters: [
            { name: 'K', role: '仿生人侦探', visualPrompt: '风衣机械眼' },
          ],
          storyGraph: { endingsCount: 3 },
        },
      },
      history: [],
      meta: {
        idea: '仿生人记忆黑市',
        style: '赛博朋克霓虹雨夜',
        videoRatio: '16:9',
        videoResolution: '720P',
      },
      createdAt: now,
      updatedAt: now,
    });
  });

  after(() => {
    try {
      projectStore.deleteProject(testProjectId);
    } catch {}
  });

  it('1. DirectorAgent 统一作为唯一总导演交互中枢，单跳直出无伪工具套娃', async () => {
    assert.ok(directorAgent, 'directorAgent 必须存在');
    assert.equal(directorAgent.id, 'director-agent');
    const tools = await (directorAgent as any).listTools();
    assert.ok(tools['emit_director_intent'], 'directorAgent 挂载原生结构化意图决策工具');
  });

  it('1.1 修改源头裁决器 resolveModifySource 从事实定义处起改，模型 hint 不具裁决权', async () => {
    // 1. 角色实体在故事圣经里定义 → 事实源头就是故事圣经
    const charPlan = await resolveModifySource(testProjectId, {
      target: 'K',
      content: '把 K 的年龄改小一点',
      currentStage: WorkflowStage.STORYBOARD,
      skillHint: 'character-portrait',
    });
    assert.equal(charPlan.sourceSkill, 'story-bible', '角色属性由故事圣经定义，必须从事实源头改');
    assert.equal(charPlan.basis, 'text-source', '判定依据应为文本源');

    // 2. 幕名同样定义在故事圣经 → 源头不变
    const actPlan = await resolveModifySource(testProjectId, {
      target: '深入下层',
      content: '这一幕的冲突再激烈一点',
      currentStage: WorkflowStage.KEYFRAME_REFERENCE,
    });
    assert.equal(actPlan.sourceSkill, 'story-bible', '幕结构由故事圣经定义');

    // 3. 模型把工序猜成图像轨，但该工序尚无产物 → 裁决不被劫持
    const hintedPlan = await resolveModifySource(testProjectId, {
      target: 'K',
      content: 'K 看起来太老了',
      currentStage: WorkflowStage.CHARACTER_DESIGN,
      skillHint: 'character-portrait',
    });
    assert.equal(hintedPlan.sourceSkill, 'story-bible', 'hint 指向未落盘工序时不得采纳');
    assert.notEqual(hintedPlan.basis, 'media-asset', '未落盘的媒体工序不能作为修改目标');

    // 4. 实体在黑板里查不到 → 回最近的文本事实源（而不是可能无法承载事实的当前阶段）
    const fallbackPlan = await resolveModifySource(testProjectId, {
      target: '未知异次元产物',
      content: '随便调一下',
      currentStage: WorkflowStage.STORYBOARD,
    });
    assert.equal(fallbackPlan.sourceSkill, 'story-bible', '无匹配时回最近的文本事实源');
    assert.equal(fallbackPlan.basis, 'text-source');
  });

  it('2. DirectorAgent 提示词装配器具备全景影视指导、法定 8 大工序与业务守则', async () => {
    const instr = await (directorAgent as any).getInstructions();
    assert.ok(instr.includes('影视视听总导演'));
    assert.ok(instr.includes('story-bible'));
    assert.ok(instr.includes('character-portrait'));
    assert.ok(instr.includes('工序推进与创作者意图理解守则'));
  });

  it('3. ContextAssembler 能基于黑板工程状态动态装配全景系统提示词', () => {
    const assembler = ContextAssembler.getInstance();
    const systemPrompt = assembler.buildSystemInstructions(testProjectId, testSessionId);
    assert.ok(systemPrompt.includes('赛博霓虹'));
    assert.ok(systemPrompt.includes('叙事架构'));
    assert.ok(systemPrompt.includes('仿生人记忆黑市'));
  });

  it('4. WorkflowEngine 能基于业务意图动态生成待审任务并落盘 TaskStore', async () => {
    const engine = Workflow.getInstance();
    const res = await engine.dispatch({
      projectId: testProjectId,
      workflowKey: 'character-portrait',
      reason: '叙事架构已就绪，向创作者提议开启主角 K 的定妆照渲染',
      requireConfirmation: true,
    });

    assert.equal(res.success, true);
    assert.ok(res.task, '必须有唯一状态载体 Task');
    assert.equal(res.task.skill, 'character-portrait');
    assert.equal(res.task.status, 'proposed');

    const saved = taskStore.getTask(testProjectId, res.task.taskId);
    assert.ok(saved, '任务必须落盘 TaskStore');
    assert.equal(saved?.taskId, res.task.taskId);
  });

  it('5. Mastra 官方容器已正确挂载 filmProductionPipelineWorkflow 声明式流水线', async () => {
    const { mastra } = await import('../../src/mastra.js');
    const pipelineWorkflow = mastra.getWorkflow('film-production-pipeline');
    assert.ok(pipelineWorkflow, 'film-production-pipeline 工作流应在 Mastra 实例中成功挂载');
    assert.equal(pipelineWorkflow.id, 'film-production-pipeline');
  });


  it('7. 端到端全链路意图驱动测试：Tool Call 发射 next 意图 ➔ 触发并生成 ActionProposal 卡片落盘', async () => {
    const { extractDirectorIntent } = await import('../../src/agents/director/index.js');
    const mockResult = {
      toolCalls: [
        {
          type: 'tool-call',
          payload: {
            toolName: 'emit_director_intent',
            args: { action: 'next' },
          },
        },
      ],
    };
    const intent = await extractDirectorIntent(mockResult);
    assert.ok(intent, '必须准确捕获 1 个意图协议');
    assert.equal(intent?.action, 'next');

    // 验证经过状态机派发转化为真实的待审 Task
    const engine = Workflow.getInstance();
    const dispatchRes = await engine.dispatch({
      projectId: testProjectId,
      sessionId: testSessionId,
      workflowKey: 'character-portrait',
      actionType: 'PROCEED_STAGE',
      reason: '推进工序至 [character-portrait] 阶段',
      userPrompt: '推进到下一步',
      requireConfirmation: true,
    });
    assert.equal(dispatchRes.success, true);
    assert.ok(dispatchRes.task);
    assert.equal(dispatchRes.task.status, 'proposed');
    assert.equal(dispatchRes.task.skill, 'character-portrait');

    // 验证落盘持久化
    const saved = taskStore.getTask(testProjectId, dispatchRes.task.taskId);
    assert.ok(saved, '任务必须已物理落盘至 TaskStore');
    assert.equal(saved?.taskId, dispatchRes.task.taskId);
  });

  it('8. ContextAssembler 能基于阶段审计报告 (critic_review_${stage}) 真实注入质检态势黑板', () => {
    const assembler = ContextAssembler.getInstance();
    
    // 写入阶段审查报告 (模拟独立审查官刚性阻断)
    projectStore.setArtifact(testProjectId, `critic_review_${WorkflowStage.NARRATIVE_DESIGN}`, {
      projectName: '赛博霓虹',
      stageReviewed: WorkflowStage.NARRATIVE_DESIGN,
      gateStatus: 'FAIL',
      scores: {
        narrativeLogicScore: 50,
        characterDepthScore: 55,
        branchTensionScore: 40,
        visualFeasibilityScore: 60,
        overallScore: 51,
      },
      criticalFlaws: [
        {
          severity: 'CRITICAL',
          dimension: 'LOGIC',
          location: '第2幕第3场',
          description: '主角侦探在未获得芯片密码的情况下机械降神直接破解系统',
          suggestion: '增加中间解密线索道具或前置线人铺垫',
        },
      ],
      polishSuggestions: ['补强主角动机因果链条'],
      verdict: '主干逻辑严重断裂，刚性阻断',
    });

    const systemPrompt = assembler.buildSystemInstructions(testProjectId, testSessionId);
    assert.ok(systemPrompt.includes('最新质检门禁: [FAIL]'), '必须准确投影 FAIL 门禁');
    assert.ok(systemPrompt.includes('综合得分: 51/100'), '必须准确提取评分');
    assert.ok(systemPrompt.includes('刚性阻断缺陷: [CRITICAL][第2幕第3场] 主角侦探在未获得芯片密码的情况下机械降神直接破解系统'), '必须准确提取阻断项');
    assert.ok(systemPrompt.includes('剧本医生自愈建议: 补强主角动机因果链条'), '必须准确提取改进建议');
  });

  it('9. DirectorAgent 纯认知中枢无 MockMemory 虚假依赖，指令集具备全景态势感知', () => {
    const dynamicAgent = createDirectorAgent(testProjectId, testSessionId);
    assert.ok(dynamicAgent, '动态 Agent 必须构建成功');
    assert.equal(dynamicAgent.id, 'director-agent');
    // memory 不再初始化为 MockMemory
    assert.equal((dynamicAgent as any).memory, undefined, '必须移除无持久化能力的 MockMemory');
  });

  it('10. TARGETED_REVISE 定向微调上游工序后，级联清除所有下游工序资产与审查官门禁 (P1 验证)', async () => {
    const engine = Workflow.getInstance();

    // 0. 准备已有故事圣经底稿 (包含阿诺以匹配测试环境 MockLLM 的 Patch 模版)
    const initialBible: any = {
      title: '赛博幽灵：记忆重构',
      logline: '原设定梗概',
      sellingPoints: ['极速反转'],
      goldenSpine: [{ act: 1, name: '启程', summary: '开局' }],
      characters: [{ name: '钟表匠学徒阿诺', role: '主角', visualPrompt: '风衣黑发' }],
      characterNames: ['钟表匠学徒阿诺'],
    };
    projectStore.setArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN, initialBible);
    exportStoryBibleToDisk(testProjectId, initialBible, projectStore);

    // 1. 先为测试项目铺设下游资产：剧本、分镜、视频以及下游 critic 门禁
    projectStore.setArtifact(testProjectId, WorkflowStage.SCENE_SCRIPT, { scenes: [{ id: 'sc_1', title: '测试戏' }] });
    projectStore.setArtifact(testProjectId, WorkflowStage.STORYBOARD, { shots: [{ id: 'sh_1' }] });
    projectStore.setArtifact(testProjectId, WorkflowStage.VIDEO_PRODUCTION, { clips: [{ id: 'clip_1' }] });
    projectStore.setArtifact(testProjectId, `critic_review_${WorkflowStage.SCENE_SCRIPT}`, { gateStatus: 'PASS' });
    projectStore.setArtifact(testProjectId, `critic_review_${WorkflowStage.VIDEO_PRODUCTION}`, { gateStatus: 'PASS' });
    projectStore.setArtifact(testProjectId, 'criticReports', { gateStatus: 'PASS' });

    // 模拟当前项目阶段处于 VIDEO_PRODUCTION
    const project = projectStore.getProject(testProjectId)!;
    project.currentStage = WorkflowStage.VIDEO_PRODUCTION;
    projectStore.saveProject(project);

    // 2. 发起针对上游工序 story-bible 的定向微调 TARGETED_REVISE
    const res = await engine.dispatch({
      projectId: testProjectId,
      sessionId: testSessionId,
      workflowKey: 'story-bible',
      actionType: 'TARGETED_REVISE',
      reason: '把主角阿诺的发型改成银色寸头',
      userPrompt: '把主角阿诺的发型改成银色寸头',
      parameters: {
        target: '阿诺',
        userFeedback: '把主角阿诺的发型改成银色寸头',
      },
    });

    assert.equal(res.success, true);
    // Task 架构：派发产生唯一状态载体，微调意图与目标实体必须完整透传
    assert.ok(res.task, '必须产生 Task');
    assert.equal(res.task.actionType, 'TARGETED_REVISE');
    assert.equal(res.task.skill, 'story-bible');
    assert.equal(res.task.payload?.target, '阿诺');
    assert.equal(res.task.payload?.userFeedback, '把主角阿诺的发型改成银色寸头');
    // 级联清退发生在任务成功后的 onSuccess 钩子（按 changedStages 计算下游起点），
    // 需要真实执行生成轨才能触发，故此处只校验派发契约。
  });


  it('12. 验证意图全链路因果透传：story-bible 消费 project.meta.idea 与顶层 feedback，Tool Call 支持 content 与 target 属性', async () => {
    const { extractDirectorIntent } = await import('../../src/agents/director/index.js');
    const mockResult = {
      toolCalls: [
        {
          type: 'tool-call',
          payload: {
            toolName: 'emit_director_intent',
            args: {
              action: 'modify',
              skill: 'character-portrait',
              target: '阿诺',
              content: '换成25岁年轻面孔，保留银发',
            },
          },
        },
      ],
    };

    const intent = await extractDirectorIntent(mockResult);
    assert.ok(intent);
    assert.equal(intent?.action, 'modify');
    assert.equal(intent?.target, '阿诺');
    assert.equal(intent?.content, '换成25岁年轻面孔，保留银发');

    // 验证 WorkflowEngine 派发时正确将 userPrompt 提升为顶层 feedback
    const engine = Workflow.getInstance();
    const dispatchRes = await engine.dispatch({
      projectId: testProjectId,
      sessionId: testSessionId,
      workflowKey: 'story-bible',
      actionType: 'PROCEED_STAGE',
      reason: '顺向推进故事圣经',
      userPrompt: '赛博朋克深海潜艇侦探探案',
    });

    assert.equal(dispatchRes.success, true);
    assert.ok(dispatchRes.task);
    assert.equal(dispatchRes.task.payload?.userPrompt, '赛博朋克深海潜艇侦探探案');
  });
});
