/**
 * tests/mastra/DirectorAgentArchitecture.test.ts
 * 现代微内核与多智能体架构 (Router / Pipeline / Modifier Agents) 自动化测试套件
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { directorAgent, createDirectorAgent } from '../../src/agents/director/index.js';
import { resolveTargetToSkill } from '../../src/agents/director/modifier/index.js';
import { Workflow } from '../../src/workflow-engine/index.js';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { ProposalStore } from '../../src/project-store/ProposalStore.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';
import { registerPipelineWorkflows } from '../../src/agents/director/generator/index.js';
import { exportStoryBibleToDisk } from '../../src/agents/director/generator/steps/story-bible/index.js';
import { ContextAssembler } from '../../src/project-store/index.js';

describe('DirectorArchitecture - AI 视听总导演单跳直出与解耦双轨架构测试', () => {
  const projectStore = ProjectStore.getInstance();
  const proposalStore = ProposalStore.getInstance();
  const testProjectId = 'test_proj_director_agent_arch';
  const testSessionId = 'test_sess_director_agent_arch';

  before(() => {
    registerPipelineWorkflows();
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
      proposalStore.clearCache(testProjectId);
    } catch {}
  });

  it('1. DirectorAgent 统一作为唯一总导演交互中枢，单跳直出无伪工具套娃', async () => {
    assert.ok(directorAgent, 'directorAgent 必须存在');
    assert.equal(directorAgent.id, 'director-agent');
    const tools = await (directorAgent as any).listTools();
    assert.ok(tools['emit_director_intent'], 'directorAgent 挂载原生结构化意图决策工具');
  });

  it('1.1 实体反查器 entity-resolver 基于源头契约优先与黑板真实数据动态反查，零题材死字典硬编码', () => {
    // 1. 源头求真第一法则：上游大模型显式指定 skill 时，直接采信，零猜测
    const explicitRes = resolveTargetToSkill(testProjectId, '任意未知实体', WorkflowStage.STORYBOARD, 'character-portrait');
    assert.equal(explicitRes, 'character-portrait', '显式传入 skill 必须 100% 直接采信');

    // 2. 源头求真契约测试：大模型针对台词精修直出 skill="scene-script"，100% 直通采纳
    const scriptRes = resolveTargetToSkill(testProjectId, '把主角K的台词改一下', WorkflowStage.STORYBOARD, 'scene-script');
    assert.equal(scriptRes, 'scene-script', '大模型源头指定 scene-script 必须 100% 直接采信');

    // 2.1 源头求真契约测试：大模型针对运镜重拍直出 skill="video-production"，100% 直通采纳
    const videoRes = resolveTargetToSkill(testProjectId, '主角K第二场的运镜重新拍一下', WorkflowStage.STORYBOARD, 'video-production');
    assert.equal(videoRes, 'video-production', '大模型源头指定 video-production 必须 100% 直接采信');

    // 2.2 动态黑板比对：黑板中已有角色 K，目标指名角色实体 K 动态反查锁定 character-portrait
    const charSkill = resolveTargetToSkill(testProjectId, 'K', WorkflowStage.STORYBOARD);
    assert.equal(charSkill, 'character-portrait', '通过黑板真实 characters 列表比对，必须动态反查到 character-portrait');

    // 3. 动态黑板比对：黑板中已有故事金线戏剧幕名“深入下层”，目标提及该幕名必须动态反查到 story-bible
    const bibleSkill = resolveTargetToSkill(testProjectId, '深入下层', WorkflowStage.KEYFRAME_REFERENCE);
    assert.equal(bibleSkill, 'story-bible', '通过黑板真实 goldenSpine 列表比对，必须动态反查到 story-bible');

    // 4. 无匹配兜底：若目标不在黑板任何已有资产中，安全兜底当前阶段工序
    const fallbackSkill = resolveTargetToSkill(testProjectId, '未知异次元产物', WorkflowStage.STORYBOARD);
    assert.equal(fallbackSkill, 'storyboard', '无匹配项时安全兜底当前阶段对应工序');
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

  it('4. WorkflowEngine 能基于业务意图动态生成工序提案并落盘 ProposalStore', async () => {
    const engine = Workflow.getInstance();
    const res = await engine.dispatch({
      projectId: testProjectId,
      workflowKey: 'character-portrait',
      reason: '叙事架构已就绪，向创作者提议开启主角 K 的定妆照渲染',
      requireConfirmation: true,
    });

    assert.equal(res.success, true);
    assert.ok(res.proposal);
    assert.equal(res.proposal.skill, 'character-portrait');
    assert.equal(res.proposal.status, 'pending');

    const saved = proposalStore.getProposal(testProjectId, res.proposal.actionId);
    assert.ok(saved, '提案必须落盘 ProposalStore');
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

    // 验证经过状态机派发转化为真实的 ActionProposal
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
    assert.ok(dispatchRes.proposal);
    assert.equal(dispatchRes.proposal.status, 'pending');
    assert.equal(dispatchRes.proposal.skill, 'character-portrait');

    // 验证落盘黑板持久化
    const saved = proposalStore.getProposal(testProjectId, dispatchRes.proposal.actionId);
    assert.ok(saved, '提案必须已物理落盘至 ProposalStore');
    assert.equal(saved?.actionId, dispatchRes.proposal.actionId);
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
    // 立即执行该提案，验证级联清理效果
    const execRes = await engine.executeProposal({ projectId: testProjectId, proposalId: res.proposal!.actionId });
    assert.equal(execRes.success, true, '提案必须成功执行');

    // 3. 验证因果闭环：下游资产必须被全量清退，下游门禁也必须被清除
    const afterProject = projectStore.getProject(testProjectId)!;
    assert.equal(afterProject.stageArtifacts[WorkflowStage.SCENE_SCRIPT], undefined, '下游剧本资产必须被级联清理');
    assert.equal(afterProject.stageArtifacts[WorkflowStage.STORYBOARD], undefined, '下游分镜资产必须被级联清理');
    assert.equal(afterProject.stageArtifacts[WorkflowStage.VIDEO_PRODUCTION], undefined, '下游视频资产必须被级联清理');
    assert.equal(afterProject.stageArtifacts[`critic_review_${WorkflowStage.SCENE_SCRIPT}`], undefined, '下游审查门禁必须被级联清理');
    assert.equal(afterProject.stageArtifacts[`critic_review_${WorkflowStage.VIDEO_PRODUCTION}`], undefined, '下游审查门禁必须被级联清理');
    assert.equal(afterProject.stageArtifacts['criticReports'], undefined, '全链路总质检必须被级联重置');
    assert.equal(afterProject.currentStage, WorkflowStage.NARRATIVE_DESIGN, '项目当前阶段必须重置对齐至微调的上游阶段');
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
    assert.ok(dispatchRes.proposal);
    assert.equal(dispatchRes.proposal.payload?.userPrompt, '赛博朋克深海潜艇侦探探案');
  });
});
