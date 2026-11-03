import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DirectorContextAssembler } from '../../agents/director/DirectorContextAssembler.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { CriticReviewerAgent } from '../../agents/reviewer/CriticReviewerAgent.js';
import { WorkflowStage } from '../../types/index.js';
import type { StoryBibleArtifact } from '../../skills/story-bible/schema.js';
import type { StoryboardArtifact } from '../../skills/storyboard/schema.js';
import type { ReviewReport } from '../../agents/reviewer/types.js';
import type { ChatMessage } from '../../chat/session/types.js';

describe('DirectorContextAssembler 导演上下文装配器', () => {
  const store = ProjectStore.getInstance();
  const assembler = DirectorContextAssembler.getInstance();
  const testProjectId = 'test_proj_assembler';
  const testSessionId = 'test_sess_assembler';

  before(() => {
    // 初始化测试工程和会话
    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '迷雾侦探',
      status: 'idle' as any,
      currentStage: WorkflowStage.STORYBOARD,
      stageArtifacts: {},
      history: [],
      meta: {
        idea: '赛博朋克侦探故事',
        style: '黑白胶片影视质感',
        videoRatio: '16:9',
        videoResolution: '720P',
      },
      createdAt: now,
      updatedAt: now,
    });

    store.createSession(testProjectId, '主线探讨', WorkflowStage.STORYBOARD, testSessionId);
  });

  it('装配视听工序交付物全景 (SSOT)：精准提取 StoryBible 与 Storyboard 标准契约字段', () => {
    const bible: StoryBibleArtifact = {
      title: '迷雾侦探',
      theme: '人性与仿生人边界',
      style: '霓虹冷色调',
      logline: '退役警探在雨夜追查仿生人谋杀案。',
      sellingPoints: ['双重视角叙事', '硬汉派侦探'],
      goldenSpine: [
        { act: 1, name: '危机初现', summary: '雨夜废弃工厂发现仿生人残骸', targetDurationSec: 60, cliffhanger: '死者留下了主角的警号' },
      ],
      pivotPoints: { macroPivotPoints: [], microPivotPoints: [] },
      characters: [
        { name: '李默', role: '男主角', appearance: '沧桑胡茬，灰色风衣', personality: '冷峻孤僻', motivation: '寻找搭档死因真相' },
      ],
      characterNames: ['李默'],
      storyGraph: { rootNodeId: 'node_1', nodes: [], endingsCount: 2, estimatedBranches: 3 },
      createdAt: new Date().toISOString(),
    };

    const storyboard: StoryboardArtifact = {
      title: '迷雾侦探分镜表',
      shots: [
        {
          shotId: 'shot_1',
          nodeId: 'node_1',
          shotNumber: 1,
          shotScale: '特写',
          cameraMovement: '缓慢推镜头',
          durationSec: 4,
          visualComposition: '雨滴滑落风衣领口，霓虹招牌反光映在眼眸',
          audioPrompt: '远处警笛与低沉大提琴',
        },
      ],
      totalShots: 1,
      estimatedTotalDurationSec: 4,
      createdAt: new Date().toISOString(),
    };

    store.setArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN, bible);
    store.setArtifact(testProjectId, WorkflowStage.STORYBOARD, storyboard);

    const context = assembler.assemble(testProjectId, testSessionId);

    // 验证 StoryBible 契约解析
    assert.match(context.systemPromptWithScratchpad, /Stage 1: 故事世界观圣经/);
    assert.match(context.systemPromptWithScratchpad, /《迷雾侦探》/);
    assert.match(context.systemPromptWithScratchpad, /人性与仿生人边界/);
    assert.match(context.systemPromptWithScratchpad, /李默/);

    // 验证 Storyboard 契约解析（包含 durationSec, visualComposition 与 audioPrompt 提取）
    assert.match(context.systemPromptWithScratchpad, /Stage 4: 导演视听分镜镜头索引/);
    assert.match(context.systemPromptWithScratchpad, /\[镜头 #shot_1\]/);
    assert.match(context.systemPromptWithScratchpad, /\[特写·4s·缓慢推镜头\]/);
    assert.match(context.systemPromptWithScratchpad, /雨滴滑落风衣领口/);
    assert.match(context.systemPromptWithScratchpad, /远处警笛与低沉大提琴/);
  });

  it('多轮对话交替状态机：确保 user/assistant 严格数学级交替且首条必为 user', () => {
    // 模拟脏数据消息流：
    // 1. 开头为 assistant（应被过滤掉）
    // 2. 连续两条 user 消息（应被合并）
    // 3. 错误消息与中断消息（应被剔除）
    // 4. 带 proposal 的 assistant 消息（应被附加上状态描述）
    const dirtyMessages: ChatMessage[] = [
      { id: 'm1', role: 'assistant', content: '我能帮您什么？', createdAt: '2026-01-01' },
      { id: 'm2', role: 'user', content: '我想修改第一镜。', createdAt: '2026-01-02' },
      { id: 'm3', role: 'user', content: '把光线调得更暗一些。', createdAt: '2026-01-03' },
      { id: 'm4', role: 'assistant', content: '生成遇到网络波动', isError: true, createdAt: '2026-01-04' },
      { id: 'm5', role: 'assistant', content: '用户主动中止', isAborted: true, createdAt: '2026-01-05' },
      {
        id: 'm6',
        role: 'assistant',
        content: '好的，已为您重新构想。',
        actionProposal: {
          actionId: 'act_1',
          actionType: 'TRIGGER_STAGE',
          label: '重画第一镜关键帧',
          status: 'pending',
        },
        createdAt: '2026-01-06',
      },
    ];

    store.saveMessages(testProjectId, testSessionId, dirtyMessages);

    const context = assembler.assemble(testProjectId, testSessionId);

    // 首条不能是 assistant
    assert.equal(context.turns[0].role, 'user');
    // 连续两条 user 应被合并为一条
    assert.equal(context.turns.length, 2);
    assert.equal(context.turns[0].content, '我想修改第一镜。\n\n把光线调得更暗一些。');
    // 第二条为 assistant
    assert.equal(context.turns[1].role, 'assistant');
    assert.match(context.turns[1].content, /好的，已为您重新构想。/);
    assert.match(context.turns[1].content, /《重画第一镜关键帧》/);
    assert.match(context.turns[1].content, /待创作者确认/);
  });

  it('双核博弈门禁告诫隔离：属于当前工序的 FAIL 注入告诫，属于其他工序或已失效的不注入', () => {
    // 1. 设置属于 SCENE_SCRIPT 的 FAIL 报告（当前项目在 STORYBOARD 阶段）
    const otherStageReport: ReviewReport = {
      projectName: '迷雾侦探',
      stageReviewed: WorkflowStage.SCENE_SCRIPT,
      gateStatus: 'FAIL',
      scores: { narrativeLogicScore: 40, characterDepthScore: 40, branchTensionScore: 40, visualFeasibilityScore: 40, overallScore: 40 },
      thoughtChain: '',
      criticalFlaws: [{ severity: 'CRITICAL', dimension: 'LOGIC', location: '场次1', description: '严重破绽', suggestion: '改' }],
      polishSuggestions: [],
      verdict: '阻断',
      reviewedAt: new Date().toISOString(),
    };

    store.setArtifact(testProjectId, `critic_review_${WorkflowStage.SCENE_SCRIPT}`, otherStageReport);
    store.setArtifact(testProjectId, 'critic_review', otherStageReport);

    const ctxOther = assembler.assemble(testProjectId, testSessionId);
    // 不应渗透跨工序拦截告诫
    assert.ok(!ctxOther.systemPromptWithScratchpad.includes('独立影视审查官与剧本医生门禁拦截告诫'));

    // 2. 设置属于当前工序 STORYBOARD 的 FAIL 报告
    const currentStageFailReport: ReviewReport = {
      projectName: '迷雾侦探',
      stageReviewed: WorkflowStage.STORYBOARD,
      gateStatus: 'FAIL',
      scores: { narrativeLogicScore: 50, characterDepthScore: 50, branchTensionScore: 50, visualFeasibilityScore: 50, overallScore: 50 },
      thoughtChain: '',
      criticalFlaws: [{ severity: 'CRITICAL', dimension: 'VISUAL', location: '镜头1', description: '景别过于死板缺乏动感', suggestion: '改为摇臂俯拍' }],
      polishSuggestions: [],
      verdict: '视听落地受阻',
      reviewedAt: new Date().toISOString(),
    };

    store.setArtifact(testProjectId, `critic_review_${WorkflowStage.STORYBOARD}`, currentStageFailReport);
    store.setArtifact(testProjectId, 'critic_review', currentStageFailReport);

    const ctxCurrent = assembler.assemble(testProjectId, testSessionId);
    assert.ok(ctxCurrent.systemPromptWithScratchpad.includes('独立影视审查官与剧本医生门禁拦截告诫'));
    assert.ok(ctxCurrent.systemPromptWithScratchpad.includes('景别过于死板缺乏动感'));
  });
});
