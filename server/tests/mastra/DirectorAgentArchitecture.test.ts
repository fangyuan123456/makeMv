/**
 * tests/mastra/DirectorAgentArchitecture.test.ts
 * AI 总导演智能体 (Director Agent) 高阶调度架构与解耦重构测试套件
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { directorAgent } from '../../src/agents/director/director.agent.js';
import { proposeStageActionTool } from '../../src/agents/director/tools/propose-stage-action.tool.js';
import { inspectProjectStateTool } from '../../src/agents/director/tools/inspect-project-state.tool.js';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { ProposalStore } from '../../src/project-store/ProposalStore.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';

describe('DirectorAgentArchitecture - 总导演智能体架构分层与高阶调度测试', () => {
  const projectStore = ProjectStore.getInstance();
  const proposalStore = ProposalStore.getInstance();
  const testProjectId = 'test_proj_director_agent_arch';
  const testSessionId = 'test_sess_director_agent_arch';

  before(() => {
    try {
      projectStore.deleteProject(testProjectId);
      proposalStore.clearCache(testProjectId);
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
        whiteboard: {
          premise: '记忆可以被篡改的未来城市',
          visual_tone: '冷色调青蓝加品红霓虹',
          protagonist: '侦探 K',
          taboos: '严禁出现穿越元素',
        },
      },
      createdAt: now,
      updatedAt: now,
    });
  });

  after(() => {
    try {
      projectStore.deleteProject(testProjectId);
      proposalStore.clearCache(testProjectId);
    } catch {}
  });

  it('1. directorAgent 仅挂载高阶调度工具，底层 8 大视听工具完全解耦', async () => {
    const tools = await (directorAgent as any).listTools();
    assert.ok(tools, '必须返回工具集');

    // 核心高阶调度工具必须存在
    assert.ok(tools.proposeStageActionTool, '必须挂载 proposeStageActionTool');
    assert.ok(tools.inspectProjectStateTool, '必须挂载 inspectProjectStateTool');

    // 底层原子生成工具必须被彻底剥离（保证 Level 1 与 Level 3 正交隔离）
    assert.equal(tools.storyBibleTool, undefined, '绝不挂载 storyBibleTool');
    assert.equal(tools.characterPortraitTool, undefined, '绝不挂载 characterPortraitTool');
    assert.equal(tools.sceneScriptTool, undefined, '绝不挂载 sceneScriptTool');
    assert.equal(tools.storyboardTool, undefined, '绝不挂载 storyboardTool');
    assert.equal(tools.keyframeReferenceTool, undefined, '绝不挂载 keyframeReferenceTool');
    assert.equal(tools.videoProductionTool, undefined, '绝不挂载 videoProductionTool');
    assert.equal(tools.criticReviewTool, undefined, '绝不挂载 criticReviewTool');
    assert.equal(tools.fmvPackagingTool, undefined, '绝不挂载 fmvPackagingTool');
  });

  it('2. proposeStageActionTool 能够生成强类型 ActionProposal 实体并持久化落盘', async () => {
    const res: any = await (proposeStageActionTool.execute as any)({
      projectId: testProjectId,
      sessionId: testSessionId,
      skill: 'character-portrait',
      actionType: 'PROCEED_STAGE',
      reason: '叙事架构已就绪，向创作者提议开启主角 K 的定妆照渲染',
      userPrompt: '赛博朋克风衣侦探，义眼发微光',
      parameters: { style: '赛博朋克' },
    });

    assert.equal(res.success, true);
    assert.ok(res.proposalId);
    assert.equal(res.isReused, false);
    assert.match(res.summary, /生成待审核提案/);

    const saved = proposalStore.getProposal(testProjectId, res.proposalId);
    assert.ok(saved, '提案必须落盘 ProposalStore');
    assert.equal(saved.status, 'pending');
    assert.equal(saved.skill, 'character-portrait');
    assert.equal(saved.payload?.stage, WorkflowStage.CHARACTER_DESIGN);
  });

  it('3. proposeStageActionTool 提案幂等性防重复发卡', async () => {
    // 再次提交相同 session 下相同 skill 和 stage 的请求
    const resAgain: any = await (proposeStageActionTool.execute as any)({
      projectId: testProjectId,
      sessionId: testSessionId,
      skill: 'character-portrait',
      actionType: 'PROCEED_STAGE',
      reason: '用户再次点击或大模型重复提议',
    });

    assert.equal(resAgain.success, true);
    assert.equal(resAgain.isReused, true, '命中同 session 相同工序必须复用旧卡');
    assert.match(resAgain.summary, /已复用待确认提案/);
  });

  it('4. inspectProjectStateTool 能按需准确查阅 overview、whiteboard 与 narrative 资产', async () => {
    // 查阅概览
    const overviewRes: any = await (inspectProjectStateTool.execute as any)({
      projectId: testProjectId,
      scope: 'overview',
    });
    assert.equal(overviewRes.success, true);
    assert.match(overviewRes.content, /赛博霓虹/);
    assert.match(overviewRes.content, /叙事架构/);

    // 查阅白板事实
    const wbRes: any = await (inspectProjectStateTool.execute as any)({
      projectId: testProjectId,
      scope: 'whiteboard',
    });
    assert.equal(wbRes.success, true);
    assert.match(wbRes.content, /仿生人记忆黑市/);
    assert.match(wbRes.content, /侦探 K/);
    assert.match(wbRes.content, /严禁出现穿越元素/);

    // 查阅剧本大纲
    const narrativeRes: any = await (inspectProjectStateTool.execute as any)({
      projectId: testProjectId,
      scope: 'narrative',
    });
    assert.equal(narrativeRes.success, true);
    assert.match(narrativeRes.content, /仿生侦探在废弃底层调查记忆黑市/);
    assert.match(narrativeRes.content, /记忆失窃/);
  });

  it('5. 能够自动感知跨阶段逆向调用并标记 STAGE_ROLLBACK 时空回退', async () => {
    // 将项目当前阶段显式设置为第 2 步: CHARACTER_DESIGN
    const project = projectStore.getProject(testProjectId)!;
    project.currentStage = WorkflowStage.CHARACTER_DESIGN;
    projectStore.saveProject(project);

    // 创作者在第 2 步要求修改第 1 步 (story-bible)
    const res: any = await (proposeStageActionTool.execute as any)({
      projectId: testProjectId,
      sessionId: 'sess_rollback_test',
      skill: 'story-bible',
      reason: '发现主角大纲设定有问题，回退到大纲阶段重推',
      userPrompt: '主角修改为热血青年',
    });

    assert.equal(res.success, true);
    assert.ok(res.proposal);
    assert.equal(res.proposal.actionType, 'STAGE_ROLLBACK');
    assert.equal(res.proposal.payload?.isRollback, true);
  });

  it('6. 验证 Mastra 官方容器已正确挂载 filmProductionPipelineWorkflow 声明式流水线', async () => {
    const { mastra } = await import('../../src/mastra.js');
    const pipelineWorkflow = mastra.getWorkflow('film-production-pipeline');
    assert.ok(pipelineWorkflow, 'film-production-pipeline 工作流应在 Mastra 实例中成功挂载');
    assert.equal(pipelineWorkflow.id, 'film-production-pipeline');
  });

  it('7. StreamTagParser 抗碎片测试：跨 chunk 切分的 <think> 思考链被 100% 拦截隔离', async () => {
    const { StreamTagParser } = await import('../../src/utils/StreamTagParser.js');
    const parser = new StreamTagParser();

    // 模拟碎片的流式 chunks: "<th" + "ink>这是思考" + "内幕</thi" + "nk>这是正常回复"
    const c1 = parser.feed('你好，');
    const c2 = parser.feed('<th');
    const c3 = parser.feed('ink>这是内部思考分析');
    const c4 = parser.feed('与导演推演</thi');
    const c5 = parser.feed('nk>这是给创作者的正文回复。');
    const flushed = parser.flush();

    const fullReply = c1.replyText + c2.replyText + c3.replyText + c4.replyText + c5.replyText + flushed.replyText;
    const fullThought = c1.thoughtText + c2.thoughtText + c3.thoughtText + c4.thoughtText + c5.thoughtText + flushed.thoughtText;

    assert.equal(fullReply, '你好，这是给创作者的正文回复。');
    assert.equal(fullThought, '这是内部思考分析与导演推演');
    assert.ok(!fullReply.includes('think'), '正文绝不能包含 think 标签或思考内容');
  });

  it('8. proposeStageActionTool 自愈测试：若缺少 projectId 自动从当前活跃项目补齐，不抛未捕获异常', async () => {
    const res: any = await (proposeStageActionTool.execute as any)({
      skill: 'story-bible',
      reason: '未显式传入 projectId 的自愈测试',
    });

    assert.equal(res.success, true);
    assert.ok(res.proposal);
    assert.equal(res.proposal.projectId, testProjectId, '自动回退补齐为活跃工程 ID');
  });

  it('9. directorAgent 具备多轮对话 Turns 感知能力（消灭单轮失忆）', async () => {
    const multiTurnMessages = [
      { role: 'user' as const, content: '我希望把主角的名字定为【雷恩】' },
      { role: 'assistant' as const, content: '收到，主角定名为【雷恩】。' },
      { role: 'user' as const, content: '请问主角的名字叫什么？' },
    ];

    const response = await (directorAgent as any).generate(multiTurnMessages);
    assert.ok(response && response.text, '必须生成文本回复');
    assert.match(response.text, /雷恩/, '在多轮历史输入下必须能够精准识别前文设定的主角名字');
  });

  it('10. 时空回退成功后级联清除所有下游过时阶段资产与审查门禁', async () => {
    const { WorkflowEngine } = await import('../../src/workflow-engine/index.js');
    const engine = WorkflowEngine.getInstance();

    // 先为项目注入下游各阶段已生成的模拟资产
    const project = projectStore.getProject(testProjectId)!;
    project.currentStage = WorkflowStage.STORYBOARD;
    project.stageArtifacts = {
      ...(project.stageArtifacts || {}),
      [WorkflowStage.NARRATIVE_DESIGN]: {
        title: '旧大纲',
        characters: [
          {
            name: '主角K',
            role: '核心主角',
            appearance: '身穿深灰色高领防尘风衣，右眼为发光义眼',
            visualPrompt: '身穿深灰色高领防尘风衣，右眼为发光义眼',
          },
        ],
      },
      [WorkflowStage.CHARACTER_DESIGN]: { characters: [{ name: '旧角色' }] },
      [WorkflowStage.SCENE_SCRIPT]: { scenes: [{ sceneId: 'scene_old_1' }] },
      [WorkflowStage.STORYBOARD]: { shots: [{ shotId: 'shot_old_1' }] },
    };
    projectStore.saveProject(project);

    projectStore.setArtifact(testProjectId, `critic_review_${WorkflowStage.SCENE_SCRIPT}`, { gateStatus: 'PASS' });
    projectStore.setArtifact(testProjectId, `critic_review_${WorkflowStage.STORYBOARD}`, { gateStatus: 'WARN' });

    // 触发回退至角色定妆阶段 (CHARACTER_DESIGN) 提案
    const rollbackRes = await engine.dispatch({
      projectId: testProjectId,
      workflowKey: 'character-portrait',
      actionType: 'STAGE_ROLLBACK',
      reason: '发现角色人设需要重构，回退至定妆工序',
      requireConfirmation: true,
    });

    assert.equal(rollbackRes.success, true);
    assert.ok(rollbackRes.proposalId);

    // 同步执行该回退提案，等待 successHandler 闭环触发
    const execRes = await engine.executeProposal({
      projectId: testProjectId,
      proposalId: rollbackRes.proposalId,
    });
    assert.equal(execRes.success, true);

    // 验证项目当前阶段已回退
    const updatedProject = projectStore.getProject(testProjectId)!;
    assert.equal(updatedProject.currentStage, WorkflowStage.CHARACTER_DESIGN);

    // 验证上游大纲与本工序资产被妥善保留
    assert.ok(updatedProject.stageArtifacts?.[WorkflowStage.NARRATIVE_DESIGN], '上游大纲应保留');

    // 验证下游分场剧本与分镜头资产被级联清除 (已为 null 或 undefined)
    assert.ok(!updatedProject.stageArtifacts?.[WorkflowStage.SCENE_SCRIPT], '下游分场剧本资产必须被级联清理');
    assert.ok(!updatedProject.stageArtifacts?.[WorkflowStage.STORYBOARD], '下游分镜头资产必须被级联清理');

    // 验证下游审查报告被级联清除
    const sceneGate = projectStore.getArtifact(testProjectId, `critic_review_${WorkflowStage.SCENE_SCRIPT}`);
    const shotGate = projectStore.getArtifact(testProjectId, `critic_review_${WorkflowStage.STORYBOARD}`);
    assert.equal(sceneGate, null, '下游分场剧本审查报告必须被清理');
    assert.equal(shotGate, null, '下游分镜头审查报告必须被清理');
  });

  it('11. 权限与防脱轨护栏测试：系统指令与工程上下文必须注入防脱轨与防闲聊铁律', async () => {
    const { ContextAssembler } = await import('../../src/agents/director/context-assembler.js');
    const { DIRECTOR_AGENT_BASE_INSTRUCTIONS, createDirectorAgent } = await import('../../src/agents/director/director.agent.js');

    // 断言基座 instructions 必须包含核心权限与防脱轨防闲聊约束
    assert.ok(DIRECTOR_AGENT_BASE_INSTRUCTIONS.includes('防脱轨护栏'), '基座指令必须包含防脱轨护栏');
    assert.ok(DIRECTOR_AGENT_BASE_INSTRUCTIONS.includes('严禁脱轨闲聊与越权任务'), '基座指令必须严禁脱轨闲聊');
    assert.ok(DIRECTOR_AGENT_BASE_INSTRUCTIONS.includes('严禁误触发调度工具'), '脱轨输入严禁调用 propose-stage-action 工具');

    // 断言 ContextAssembler 组装的动态感知中包含权限红线警示
    const assembledPrompt = ContextAssembler.getInstance().buildSystemInstructions(testProjectId, testSessionId);
    assert.ok(assembledPrompt.includes('总导演权限与防脱轨防闲聊刚性警示'), '动态全景上下文必须包含总导演权限与防脱轨刚性警示');
    assert.ok(assembledPrompt.includes('权限红线'), '全景上下文必须包含权限红线说明');

    // 实例验证：createDirectorAgent 实例必须挂载完整的防脱轨 instructions
    const customAgent = createDirectorAgent(testProjectId, testSessionId);
    const instructionsStr = typeof (customAgent as any).getInstructions === 'function'
      ? (customAgent as any).getInstructions()
      : (customAgent.instructions || '');
    assert.ok(instructionsStr.includes('防脱轨护栏'), '生成的 Agent 实例必须挂载防脱轨护栏');
    assert.ok(instructionsStr.includes('严禁脱轨闲聊与越权任务'), '生成的 Agent 实例必须包含严禁脱轨闲聊');
  });
});
