import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CriticReviewerAgent } from '../../agents/reviewer/CriticReviewerAgent.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { LLMRegistry } from '../../llm/LLMRegistry.js';
import { WorkflowStage } from '../../types/index.js';
import type { LLMService, LLMOptions } from '../../llm/LLMService.js';
import type { ReviewReport } from '../../agents/reviewer/types.js';

class MockReviewerLLM implements LLMService {
  public mockGenerateObjectResponse: any = {};

  hasVisionCapability(): boolean { return true; }
  async generateText(): Promise<string> { return ''; }
  async generateTextWithImages(): Promise<string> { return ''; }
  async generateMultiTurn(): Promise<string> { return ''; }
  async generateMultiTurnStream(): Promise<string> { return ''; }

  async generateObject<T>(_prompt: string, _schema: any, _sys?: string, _opts?: LLMOptions): Promise<T> {
    return this.mockGenerateObjectResponse as T;
  }
}

describe('CriticReviewerAgent 独立影视审查官智能体', () => {
  const store = ProjectStore.getInstance();
  const reviewer = CriticReviewerAgent.getInstance();
  const mockLLM = new MockReviewerLLM();
  const testProjectId = 'test_proj_critic_agent';

  before(() => {
    LLMRegistry.set(mockLLM);
    store.deleteProject(testProjectId);

    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '深海潜航',
      status: 'idle' as any,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: { idea: '深海惊悚', style: '压抑幽闭', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    });
  });

  after(() => {
    store.deleteProject(testProjectId);
  });

  it('getEffectiveReport 刚性工序隔离：指定工序无报告时绝不跨工序回退泄露', () => {
    // 写入一个只属于 NARRATIVE_DESIGN 的报告
    const narrativeReport: ReviewReport = {
      projectName: '深海潜航',
      stageReviewed: WorkflowStage.NARRATIVE_DESIGN,
      gateStatus: 'FAIL',
      scores: { narrativeLogicScore: 50, characterDepthScore: 50, branchTensionScore: 50, visualFeasibilityScore: 50, overallScore: 50 },
      thoughtChain: '',
      criticalFlaws: [],
      polishSuggestions: [],
      verdict: '未收敛',
      reviewedAt: new Date().toISOString(),
    };
    store.setArtifact(testProjectId, `critic_review_${WorkflowStage.NARRATIVE_DESIGN}`, narrativeReport);
    store.setArtifact(testProjectId, 'critic_review', narrativeReport);

    // 查询 NARRATIVE_DESIGN 能正常查到
    const rep1 = reviewer.getEffectiveReport(testProjectId, WorkflowStage.NARRATIVE_DESIGN);
    assert.ok(rep1);
    assert.equal(rep1.stageReviewed, WorkflowStage.NARRATIVE_DESIGN);

    // 查询未曾审查过的 CHARACTER_DESIGN，必须返回 null，拒绝跨工序泄露！
    const rep2 = reviewer.getEffectiveReport(testProjectId, WorkflowStage.CHARACTER_DESIGN);
    assert.equal(rep2, null);
  });

  it('getEffectiveReport 时效性自愈检测：工序产物重新生成后旧质检报告自动失效 (STALE)', () => {
    const reportTime = new Date(Date.now() - 5000).toISOString();
    const artifactTime = new Date(Date.now() - 1000).toISOString();

    const report: ReviewReport = {
      projectName: '深海潜航',
      stageReviewed: WorkflowStage.NARRATIVE_DESIGN,
      gateStatus: 'FAIL',
      scores: { narrativeLogicScore: 50, characterDepthScore: 50, branchTensionScore: 50, visualFeasibilityScore: 50, overallScore: 50 },
      thoughtChain: '',
      criticalFlaws: [],
      polishSuggestions: [],
      verdict: '未收敛',
      reviewedAt: reportTime,
    };
    store.setArtifact(testProjectId, `critic_review_${WorkflowStage.NARRATIVE_DESIGN}`, report);

    // 模拟前序产物在报告评审之后被重新修改生成
    store.setArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN, {
      title: '新版深海潜航',
      updatedAt: artifactTime,
    });

    const effective = reviewer.getEffectiveReport(testProjectId, WorkflowStage.NARRATIVE_DESIGN);
    assert.ok(effective);
    assert.equal(effective.gateStatus, 'STALE');
    assert.equal(effective.isStale, true);
    assert.match(effective.staleReason || '', /旧质检告诫已自动失效/);

    // 清理该阶段临时产物，防止污染后续测试用例的时间戳比对
    store.setArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN, null);
  });

  it('review 全景穿透审计：根据多维打分与CRITICAL硬伤刚性计算门禁放行决策', async () => {
    // 模拟大模型生成有致命漏洞的审查报告
    mockLLM.mockGenerateObjectResponse = {
      thoughtChain: '主角在深海无氧环境中存活违反常理。',
      crossStageInsights: {
        characterConsistency: '人物动机断裂',
        branchValidity: '伪选择',
        visualFeasibility: '水下光影较难还原',
      },
      gateStatus: 'FAIL',
      scores: {
        narrativeLogicScore: 40,
        characterDepthScore: 45,
        branchTensionScore: 50,
        visualFeasibilityScore: 55,
        overallScore: 48,
      },
      criticalFlaws: [
        {
          severity: 'CRITICAL',
          dimension: 'LOGIC',
          location: '第2幕水下破裂',
          description: '无氧存活',
          suggestion: '增加备用微型氧气鳃设定',
        },
      ],
      polishSuggestions: ['增加水下幽闭音效'],
      verdict: '存在CRITICAL硬伤，阻断推进',
    };

    const res = await reviewer.review({
      projectId: testProjectId,
      targetStage: WorkflowStage.NARRATIVE_DESIGN,
    });

    assert.equal(res.gateStatus, 'FAIL');
    assert.equal(res.criticalFlaws.length, 1);
    assert.equal(res.criticalFlaws[0].severity, 'CRITICAL');
    assert.equal(res.scores.overallScore, 48);

    // 状态黑板已同步落盘
    const saved = store.getArtifact<ReviewReport>(testProjectId, `critic_review_${WorkflowStage.NARRATIVE_DESIGN}`);
    assert.equal(saved?.gateStatus, 'FAIL');
  });

  it('chat 对辩质询：若辩护被审查官驳回，坚决保持 FAIL 门禁（防模型幻觉越权）', async () => {
    // 模拟大模型驳回创作者辩护，但幻觉返回 reassessedGateStatus: PASS
    mockLLM.mockGenerateObjectResponse = {
      reply: '您提出的理由在物理定律上完全不成立，属于强行机械降神，无法被采纳。',
      isDefenseAccepted: false,
      reassessedGateStatus: 'PASS', // 幻觉字段！必须被刚性守卫强制纠正为 FAIL
      adjustedFlaws: [],
    };

    const reply = await reviewer.chat({
      projectId: testProjectId,
      targetStage: WorkflowStage.NARRATIVE_DESIGN,
      userMessage: '主角是变种人，不需要氧气',
    });

    assert.equal(reply.isDefenseAccepted, false);

    // 校验状态黑板中的实际更新报告门禁状态必须为 FAIL
    const updated = reviewer.getEffectiveReport(testProjectId, WorkflowStage.NARRATIVE_DESIGN);
    assert.equal(updated?.gateStatus, 'FAIL');
    // 关键缺陷必须得到保全，绝不能因辩护被拒而被模型幻觉清空
    assert.equal(updated?.criticalFlaws.length, 1);
    assert.equal(updated?.criticalFlaws[0].severity, 'CRITICAL');
    // 对辩日志已落盘
    assert.ok(updated?.debateLogs && updated.debateLogs.length > 0);
    assert.equal(updated?.debateLogs[updated.debateLogs.length - 1].isDefenseAccepted, false);
  });

  it('chat 对辩质询：若辩护成立，审查官裁决放行 PASS 并原子解除门禁阻断', async () => {
    mockLLM.mockGenerateObjectResponse = {
      reply: '设定第1幕已植入纳米仿生鳃的伏笔，因果律自洽，辩护成立。',
      isDefenseAccepted: true,
      reassessedGateStatus: 'PASS',
      adjustedFlaws: [
        {
          location: '第2幕水下破裂',
          severity: 'MINOR',
          dimension: 'LOGIC',
          description: '[辩护已澄清] 纳米鳃设定自洽',
          suggestion: '在第1幕增加特写交代',
        },
      ],
    };

    const reply = await reviewer.chat({
      projectId: testProjectId,
      targetStage: WorkflowStage.NARRATIVE_DESIGN,
      userMessage: '主角在第1幕就已交代植入了纳米仿生鳃',
    });

    assert.equal(reply.isDefenseAccepted, true);

    const updated = reviewer.getEffectiveReport(testProjectId, WorkflowStage.NARRATIVE_DESIGN);
    assert.equal(updated?.gateStatus, 'PASS');
    assert.ok(updated?.scores.overallScore! >= 80);
  });

  it('review 全景质检放行：当 gateStatus 裁决为 PASS 时，自动解除挂起的门禁拦截卡片与提案', async () => {
    const { ProposalStore } = await import('../../project-store/ProposalStore.js');
    const proposalStore = ProposalStore.getInstance();
    const sessionId = 'sess_critic_dismiss_test';

    store.saveSession({
      sessionId,
      projectId: testProjectId,
      title: '对辩会话',
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      scratchpad: { userConstraints: [], lastUpdatedAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    store.saveMessages(testProjectId, sessionId, []);

    const gateProposal = {
      actionId: 'act_intercept_review_dismiss',
      actionType: 'CRITIC_DEBATE',
      skill: 'critic-review',
      isGateIntercept: true,
      label: '门禁阻断卡片',
      status: 'pending' as const,
      payload: { stage: WorkflowStage.NARRATIVE_DESIGN },
    };
    proposalStore.saveProposal(testProjectId, gateProposal);

    store.appendMessage(testProjectId, sessionId, {
      id: 'msg_gate_test',
      role: 'assistant',
      content: '门禁阻断中',
      actionProposal: { ...gateProposal },
      createdAt: new Date().toISOString(),
    });

    mockLLM.mockGenerateObjectResponse = {
      thoughtChain: '全片逻辑经修正后严密自洽。',
      crossStageInsights: '角色动机充分。',
      scores: {
        narrativeLogicScore: 90,
        characterDepthScore: 90,
        branchTensionScore: 90,
        visualFeasibilityScore: 90,
      },
      criticalFlaws: [],
      polishSuggestions: ['保持节奏'],
      verdict: '准许进入角色定妆工序',
    };

    const report = await reviewer.review({
      projectId: testProjectId,
      targetStage: WorkflowStage.NARRATIVE_DESIGN,
    });

    assert.equal(report.gateStatus, 'PASS');

    // 验证独立提案库中的卡片已被置标为 dismissed
    const savedProposal = proposalStore.getProposal(testProjectId, 'act_intercept_review_dismiss');
    assert.equal(savedProposal?.status, 'dismissed');
    assert.match(savedProposal?.description || '', /门禁已通过质检放行解除/);

    // 验证会话消息流中的卡片也已被置标为 dismissed
    const messages = store.getMessages(testProjectId, sessionId);
    const msg = messages.find((m) => m.actionProposal?.actionId === 'act_intercept_review_dismiss');
    assert.equal(msg?.actionProposal?.status, 'dismissed');
    assert.match(msg?.actionProposal?.description || '', /门禁已通过质检放行解除/);
  });

  it('review 缺少 projectId 或 chat 缺少 userMessage 时刚性 Fail-Fast 阻断', async () => {
    await assert.rejects(
      async () => {
        await reviewer.review({ projectId: '' });
      },
      /projectId 不能为空/
    );

    await assert.rejects(
      async () => {
        await reviewer.chat({ projectId: '', userMessage: 'test' });
      },
      /projectId 不能为空/
    );

    await assert.rejects(
      async () => {
        await reviewer.chat({ projectId: testProjectId, userMessage: '   ' });
      },
      /质询辩解内容不能为空/
    );
  });

  it('review 评分 60~79 且无致命缺陷时门禁刚性计算为 WARN (杜绝模型幻觉直接给 PASS)', async () => {
    // 模拟大模型给分 72 (低于80分)，却幻觉返回 gateStatus: 'PASS'
    mockLLM.mockGenerateObjectResponse = {
      thoughtChain: '因果逻辑尚可，但张力欠佳。',
      gateStatus: 'PASS', // 幻觉字段！应被代码级刚性门禁纠正为 WARN
      scores: {
        narrativeLogicScore: 72,
        characterDepthScore: 72,
        branchTensionScore: 72,
        visualFeasibilityScore: 72,
        overallScore: 72,
      },
      criticalFlaws: [
        {
          severity: 'MAJOR',
          dimension: 'PACING',
          location: '第2幕中段',
          description: '节奏平淡',
          suggestion: '增加冲突',
        },
      ],
      polishSuggestions: [],
      verdict: '建议优化细节',
    };

    const report = await reviewer.review({
      projectId: testProjectId,
      targetStage: WorkflowStage.NARRATIVE_DESIGN,
    });

    assert.equal(report.gateStatus, 'WARN');
    assert.equal(report.scores.overallScore, 72);
  });

  it('chat 对辩质询：若辩护声称被采纳但调整后仍存在 CRITICAL 缺陷，刚性守卫坚决保持 FAIL 且不解除门禁', async () => {
    const { ProposalStore } = await import('../../project-store/ProposalStore.js');
    const proposalStore = ProposalStore.getInstance();
    const sessionId = 'sess_critic_partial_defense_test';

    store.saveSession({
      sessionId,
      projectId: testProjectId,
      title: '部分辩护会话',
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      scratchpad: { userConstraints: [], lastUpdatedAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    store.saveMessages(testProjectId, sessionId, []);

    const gateProposal = {
      actionId: 'act_intercept_partial_defense',
      actionType: 'CRITIC_DEBATE' as const,
      skill: 'critic-review',
      isGateIntercept: true,
      label: '门禁阻断待解决',
      status: 'pending' as const,
      payload: { stage: WorkflowStage.NARRATIVE_DESIGN },
    };
    proposalStore.saveProposal(testProjectId, gateProposal);

    store.appendMessage(testProjectId, sessionId, {
      id: 'msg_gate_partial',
      role: 'assistant',
      content: '门禁阻断中',
      actionProposal: { ...gateProposal },
      createdAt: new Date().toISOString(),
    });

    // 基础报告包含 2 处 CRITICAL 缺陷
    const baseReport: ReviewReport = {
      projectName: '深海潜航',
      stageReviewed: WorkflowStage.NARRATIVE_DESIGN,
      gateStatus: 'FAIL',
      scores: { narrativeLogicScore: 40, characterDepthScore: 40, branchTensionScore: 40, visualFeasibilityScore: 40, overallScore: 40 },
      thoughtChain: '因果断裂',
      criticalFlaws: [
        { severity: 'CRITICAL', dimension: 'LOGIC', location: '第2幕水下破裂', description: '无氧存活', suggestion: '微型氧气鳃' },
        { severity: 'CRITICAL', dimension: 'LOGIC', location: '第3幕主角瞬移', description: '凭空瞬移违反逻辑', suggestion: '删除瞬移' },
      ],
      polishSuggestions: [],
      verdict: '严重阻断',
      reviewedAt: new Date().toISOString(),
    };
    store.setArtifact(testProjectId, `critic_review_${WorkflowStage.NARRATIVE_DESIGN}`, baseReport);
    store.setArtifact(testProjectId, 'critic_review', baseReport);

    // 模拟大模型采纳了第 1 处辩解，但第 2 处仍为 CRITICAL，却幻觉返回 reassessedGateStatus: PASS
    mockLLM.mockGenerateObjectResponse = {
      reply: '氧气鳃辩解成立，但第3幕瞬移仍未合理解释。',
      isDefenseAccepted: true,
      reassessedGateStatus: 'PASS', // 幻觉字段！应被代码级刚性守卫强行压制为 FAIL
      adjustedFlaws: [
        { location: '第2幕水下破裂', severity: 'MINOR', dimension: 'LOGIC', description: '[辩护已澄清] 纳米鳃设定自洽', suggestion: '' },
        { location: '第3幕主角瞬移', severity: 'CRITICAL', dimension: 'LOGIC', description: '凭空瞬移依旧属于硬伤', suggestion: '必须删改' },
      ],
    };

    const reply = await reviewer.chat({
      projectId: testProjectId,
      sessionId,
      targetStage: WorkflowStage.NARRATIVE_DESIGN,
      userMessage: '主角在第1幕就植入了纳米鳃',
    });

    assert.equal(reply.isDefenseAccepted, true);

    // 门禁状态必须坚决为 FAIL，绝不放行
    const updated = reviewer.getEffectiveReport(testProjectId, WorkflowStage.NARRATIVE_DESIGN);
    assert.equal(updated?.gateStatus, 'FAIL');
    const criticalFlaw = updated?.criticalFlaws.find((f) => f.location === '第3幕主角瞬移');
    assert.ok(criticalFlaw);
    assert.equal(criticalFlaw?.severity, 'CRITICAL');

    // 门禁阻断提案卡片必须保持 pending，绝不能被提前解开
    const savedProposal = proposalStore.getProposal(testProjectId, 'act_intercept_partial_defense');
    assert.equal(savedProposal?.status, 'pending');

    const messages = store.getMessages(testProjectId, sessionId);
    const msg = messages.find((m) => m.actionProposal?.actionId === 'act_intercept_partial_defense');
    assert.equal(msg?.actionProposal?.status, 'pending');
  });
});
