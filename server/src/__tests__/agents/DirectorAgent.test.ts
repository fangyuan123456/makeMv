import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DirectorAgent } from '../../agents/director/DirectorAgent.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { ProposalStore } from '../../project-store/ProposalStore.js';
import { SkillRegistry } from '../../skills/SkillRegistry.js';
import { LLMRegistry } from '../../llm/LLMRegistry.js';
import { WorkflowStage, SessionStatus } from '../../types/index.js';
import type { LLMService, LLMOptions } from '../../llm/LLMService.js';
import type { ActionProposal } from '../../chat/session/types.js';

class MockDirectorLLM implements LLMService {
  hasVisionCapability(): boolean { return true; }
  async generateText(): Promise<string> { return ''; }
  async generateTextWithImages(): Promise<string> { return ''; }
  async generateMultiTurn(): Promise<string> { return ''; }
  async generateObject<T>(): Promise<T> { return {} as T; }

  async generateMultiTurnStream(
    _sys: string,
    _history: any,
    onToken: (t: string) => Promise<void> | void,
    options?: LLMOptions
  ): Promise<string> {
    if (options?.abortSignal?.aborted) {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }

    const token1 = '我们来推敲第一阶段的世界观设定。';
    await onToken(token1);

    if (options?.onThought) {
      await options.onThought('推演戏剧黄金主干与主题');
    }

    // 触发 propose_stage_action 工具调用
    if (options?.onToolCall) {
      await options.onToolCall({
        toolCallId: 'call_1',
        toolName: 'propose_stage_action',
        args: {
          skill: 'story-bible',
          label: '推进故事世界观圣经推演',
          description: '与创作者探讨充分，立项推进',
          params: { isRefinement: false },
        },
      });
    }

    return token1;
  }
}

describe('DirectorAgent AI导演副手对话智能体', () => {
  const store = ProjectStore.getInstance();
  const director = DirectorAgent.getInstance();
  const testProjectId = 'test_proj_director_agent';
  const testSessionId = 'test_sess_director_agent';

  before(() => {
    LLMRegistry.set(new MockDirectorLLM());

    // 注册 story-bible 技能支撑提案解析
    SkillRegistry.getInstance().register({
      manifest: {
        name: 'story-bible',
        displayName: '故事圣经推演',
        description: '世界观推演',
        category: 'narrative',
        targetStage: WorkflowStage.NARRATIVE_DESIGN,
      },
      execute: async () => ({ success: true, data: {}, summary: '', durationMs: 0 }),
      executeOrThrow: async () => ({ data: {}, summary: '', durationMs: 0 }),
    });

    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '赛博纪元',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: { idea: '未来机甲', style: '写实', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    });

    store.createSession(testProjectId, '导演主线', WorkflowStage.NARRATIVE_DESIGN, testSessionId);
  });

  it('chatStream 流式对话：正常流式推送 token、thought 并将提案结构化保存至 ProposalStore', async () => {
    const tokens: string[] = [];
    const thoughts: string[] = [];
    let receivedProposal: ActionProposal | undefined;

    const result = await director.chatStream(
      testProjectId,
      testSessionId,
      '我想要一个关于未来机甲的硬核科幻故事。',
      {
        onToken: async (t) => { tokens.push(t); },
        onThought: async (th) => { thoughts.push(th); },
        onProposal: async (p) => { receivedProposal = p; },
      }
    );

    assert.ok(tokens.length > 0);
    assert.match(tokens.join(''), /我们来推敲第一阶段的世界观设定/);
    assert.ok(thoughts.length > 0);
    assert.match(thoughts.join(''), /推演戏剧黄金主干/);

    // 校验 Assistant 消息持久化
    assert.ok(result.replyMessage);
    assert.equal(result.replyMessage.role, 'assistant');
    assert.match(result.replyMessage.content, /我们来推敲第一阶段的世界观设定/);

    // 校验行动提案已生成并挂载
    assert.ok(result.proposal);
    assert.equal(result.proposal.skill, 'story-bible');
    assert.equal(result.proposal.status, 'pending');
    assert.equal(result.proposal.label, '推进故事世界观圣经推演');
    assert.equal(receivedProposal?.actionId, result.proposal.actionId);

    // 校验 ProposalStore 中已持久化该提案
    const savedProposal = ProposalStore.getInstance().getProposal(testProjectId, result.proposal.actionId);
    assert.ok(savedProposal);
    assert.equal(savedProposal.actionId, result.proposal.actionId);
  });

  it('chatStream 中断截断保全：创作者主动中断时保存中断占位消息并标记 isAborted', async () => {
    const ac = new AbortController();
    ac.abort();

    await assert.rejects(
      async () => {
        await director.chatStream(
          testProjectId,
          testSessionId,
          '请继续生成细节...',
          {},
          ac.signal
        );
      },
      /The operation was aborted|aborted/
    );

    // 检查消息历史记录：中断消息已入库且被标记为 isAborted
    const messages = store.getMessages(testProjectId, testSessionId);
    const lastMsg = messages[messages.length - 1];
    assert.equal(lastMsg.role, 'assistant');
    assert.equal(lastMsg.isAborted, true);
    assert.match(lastMsg.content, /创作者已主动中断本次生成/);
  });

  it('缺少 projectId、sessionId 或 userContent 为空时刚性 Fail-Fast 阻断', async () => {
    await assert.rejects(
      async () => {
        await director.chatStream('', testSessionId, 'hello');
      },
      /projectId 与 sessionId 不能为空/
    );

    await assert.rejects(
      async () => {
        await director.chatStream(testProjectId, '', 'hello');
      },
      /projectId 与 sessionId 不能为空/
    );

    await assert.rejects(
      async () => {
        await director.chatStream(testProjectId, testSessionId, '   ');
      },
      /对话内容不能为空/
    );
  });
});
