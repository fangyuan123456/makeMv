import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MockLanguageModelV1, simulateReadableStream } from 'ai/test';
import { AgentRunner } from '../src/agents/runtime/runner.js';
import { createIntentTools } from '../src/agents/runtime/intent-tool.js';
import { LLMProvider } from '../src/llm/provider.js';
import { getProjectDir } from '../src/project-store/artifact-fs.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { getStoryboardContext } from '../src/agents/storyboard/context.js';
import { buildBranchContext } from '../src/project-store/story-context.js';
import { buildSceneAtmospherePrompt } from '../src/tools/film-production/lookdev-tool/location/prompt.js';

const specs = [{ toolName: 'test.tool', title: '测试任务', description: '测试任务', schema: z.object({ value: z.number() }) }];
class TestDirector extends AgentRunner<any> {
  public repairResult: { intent: any; reply?: string } | null = null;
  protected assembleSystemPrompt() { return '测试导演'; }
  public override async buildFullSystemPrompt() { return this.assembleSystemPrompt(); }
  protected override getIntentToolSpecs() { return specs; }
  protected override async repairInvalidIntentCall() { return this.repairResult; }
  public resolve(args: any) { return this.resolveDirectorIntent(args); }
}

function fixture() {
  const projectId = `test_prompt_state_${randomUUID()}`;
  const session = new TestDirector({ projectId, sessionId: 'test' });
  const pending = session.appendMessage({ role: 'assistant', content: '待审方案', proposalResolved: false,
    proposal: { action: 'propose', title: '测试任务', tool: 'test.tool', params: { value: 1 } } });
  return { projectId, session, pending, cleanup: () => fs.rmSync(getProjectDir(projectId), { recursive: true, force: true }) };
}

test('clarification can invalidate the old proposal while ordinary discussion preserves it', () => {
  const f = fixture();
  try {
    f.session.resolve({ action: 'chat_only', reply: '可以再讨论' });
    assert.equal(f.session.getMessages()[0].proposalResolved, false);
    f.session.resolve({ action: 'chat_only', reply: '准备改成哪种风格？', invalidatePendingProposal: true });
    assert.equal(f.session.getMessages()[0].proposalResolved, true);
    assert.throws(() => f.session.approveProposal(f.pending.id), /失效/);
    assert.equal(f.session.resolve({ action: 'approve' }).action, 'chat_only');
  } finally { f.cleanup(); }
});

test('failed replacement invalidates the old card; invalidation cannot accompany approval', () => {
  const f = fixture();
  try {
    assert.throws(() => f.session.resolve({ action: 'approve', invalidatePendingProposal: true }), /不能同时批准/);
    assert.equal(f.session.getMessages()[0].proposalResolved, false);
    assert.throws(() => f.session.resolve({ action: 'propose', tool: 'test.tool', params: {} }), /参数不完整/);
    assert.throws(() => f.session.approveProposal(f.pending.id), /失效/);
  } finally { f.cleanup(); }
});

test('invalidation is exposed only for user turns with a pending proposal', () => {
  const schema = createIntentTools(specs, false, true)!.emit_director_intent.inputSchema;
  assert.equal(schema.safeParse({ action: 'chat_only', reply: '请澄清', invalidatePendingProposal: true }).success, true);
  assert.equal(schema.safeParse({ action: 'approve', reply: '执行', invalidatePendingProposal: true }).success, false);
  const systemSchema = createIntentTools(specs, true, true)!.emit_director_intent.inputSchema;
  assert.equal(systemSchema.parse({ action: 'chat_only', reply: '复盘', invalidatePendingProposal: true }).invalidatePendingProposal, undefined);
});

for (const repaired of [false, true]) test(`failed tool intent corrects execution claims (clarification repair: ${repaired})`, async () => {
  const f = fixture();
  if (repaired) f.session.repairResult = { intent: { action: 'chat_only', reply: '请补充执行参数。' } };
  const args = JSON.stringify({ action: 'propose', reply: '已确认，立即执行。', tool: 'test.tool', params: {} });
  const chunks: string[] = [];
  LLMProvider.setMockModel(new MockLanguageModelV1({ doStream: async () => ({
    stream: simulateReadableStream({ chunks: [
      { type: 'text-delta', textDelta: '已确认，立即执行。' },
      { type: 'tool-call', toolCallType: 'function', toolCallId: 'bad-call', toolName: 'emit_director_intent', args },
      { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 1, completionTokens: 1 } },
    ], initialDelayInMs: null, chunkDelayInMs: null }),
  }) }));
  try {
    const result = await f.session.stream({ message: '改一下方案', onTextChunk: text => chunks.push(text) });
    assert.equal(result.intent, null);
    assert.match(result.cleanText, /本轮操作未启动/);
    assert.doesNotMatch(result.cleanText, /已确认，立即执行/);
    assert.match(chunks.join(''), /更正：本轮操作未启动/);
    assert.equal(f.session.getMessages().at(-1)?.content, result.cleanText);
    assert.throws(() => f.session.approveProposal(f.pending.id), /失效/);
  } finally { LLMProvider.reset(); f.cleanup(); }
});

test('director context uses the same branch graph as the generation tool', () => {
  const f = fixture();
  const graph = { startNodeId: 'start', clips: ['start', 'a', 'b'].map(id => ({ id, title: id, video: '' })),
    interactions: [{ id: 'choice', kind: 'choice', prompt: '', outcomes: [] }],
    wiring: [{ from: 'start', to: 'choice', onOutcome: 'end' }, { from: 'choice', to: 'a', onOutcome: 'A' }, { from: 'choice', to: 'b', onOutcome: 'B' }] };
  try {
    const store = ProjectStore.getInstance();
    store.setArtifact(f.projectId, 'prd', graph);
    store.setArtifact(f.projectId, 'story', '## start｜开篇\n出发\n## a｜左路\n取得钥匙\n## b｜右路\n空手返回');
    const actual = getStoryboardContext(f.projectId, 'b');
    const expected = buildBranchContext(graph, 'b', { start: { narrativeText: '出发' } });
    assert.equal(actual.previousClipSummary, expected.previousClipSummary);
    assert.doesNotMatch(actual.previousClipSummary, /取得钥匙|上一幕【a/);
  } finally { f.cleanup(); }
});

test('scene rendering receives the layout with or without a reference image', () => {
  const location = { promptZh: '水彩庭院', spatialLayout: '入口面向石塔，左侧池塘，右侧回廊。' } as any;
  for (const hasReference of [false, true]) {
    const result = buildSceneAtmospherePrompt(location, '水彩插画', hasReference);
    assert.match(result, /左侧池塘，右侧回廊/);
    assert.match(result, /水彩插画/);
  }
});



function streamIntent(args: any, beforeReply?: () => void) {
  LLMProvider.setMockModel(new MockLanguageModelV1({ doStream: async () => {
    beforeReply?.();
    return { stream: simulateReadableStream({ chunks: [
      { type: 'tool-call', toolCallType: 'function', toolCallId: 'turn-call', toolName: 'emit_director_intent', args: JSON.stringify(args) },
      { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 1, completionTokens: 1 } },
    ], initialDelayInMs: null, chunkDelayInMs: null }) };
  } }));
}

for (const change of ['replace', 'edit', 'resolve'] as const) test(`late natural approval rejects a changed proposal (${change})`, async () => {
  const f = fixture();
  const peer = new TestDirector({ projectId: f.projectId, sessionId: 'test' });
  streamIntent({ action: 'approve', reply: '已确认执行' }, () => {
    if (change === 'replace') peer.appendMessage({ role: 'assistant', content: '新方案B', proposalResolved: false,
      proposal: { action: 'propose', title: '方案B', tool: 'test.tool', params: { value: 2 } } });
    else if (change === 'edit') peer.updateMessage(f.pending.id, {
      proposal: { action: 'propose', title: '修改后的A', tool: 'test.tool', params: { value: 3 } },
    });
    else peer.updateMessage(f.pending.id, { proposalResolved: true });
  });
  try {
    const result = await f.session.stream({ message: '同意' });
    assert.equal(result.intent, null);
    assert.match(result.cleanText, /待审方案已变化/);
    assert.equal(f.session.getMessages().some(m => m.proposal?.action === 'approve'), false);
    if (change !== 'resolve') assert.equal(f.session.getMessages().filter(m => m.proposal && !m.proposalResolved).length, 1);
  } finally { LLMProvider.reset(); f.cleanup(); }
});

test('natural approval closes and binds only the proposal seen at turn start', async () => {
  const f = fixture();
  streamIntent({ action: 'approve', reply: '已确认执行' });
  try {
    const result = await f.session.stream({ message: '同意' });
    assert.equal(result.intent?.action, 'approve');
    assert.equal(result.intent?.params.value, 1);
    assert.equal(f.session.getMessages().find(m => m.id === f.pending.id)?.proposalResolved, true);
    assert.equal(f.session.getMessages().find(m => m.id === result.messageId)?.metadata?.approvedProposalId, f.pending.id);
    assert.equal(f.session.approveProposal(f.pending.id).messageId, result.messageId);
  } finally { LLMProvider.reset(); f.cleanup(); }
});

for (const arrivesDuringStream of [false, true]) test(`automatic summary cannot replace a user proposal (arrives during stream: ${arrivesDuringStream})`, async () => {
  const f = fixture();
  if (arrivesDuringStream) f.session.updateMessage(f.pending.id, { proposalResolved: true });
  const target = f.session.appendMessage({ role: 'assistant', content: '制作任务已完成', metadata: { summaryStatus: 'pending' } });
  streamIntent({ action: 'propose', reply: '自动提出下一步', tool: 'test.tool', params: { value: 9 } }, () => {
    if (arrivesDuringStream) f.session.appendMessage({ role: 'assistant', content: '用户新方案', proposalResolved: false,
      proposal: { action: 'propose', title: '用户新方案', tool: 'test.tool', params: { value: 2 } } });
  });
  try {
    if (arrivesDuringStream) {
      const result = await f.session.stream({ message: '复盘', isSystemTrigger: true, targetMessageId: target.id });
      assert.equal(result.intent, null);
      assert.match(result.cleanText, /不另建或替换/);
    } else {
      // 待审卡片已经存在时，工具 Schema 就禁止系统提出新方案。
      await assert.rejects(f.session.stream({ message: '复盘', isSystemTrigger: true, targetMessageId: target.id }), /复盘或后续提案生成失败/);
    }
    const pending = f.session.getMessages().filter(m => m.proposal && !m.proposalResolved);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].proposal.params.value, arrivesDuringStream ? 2 : 1);
  } finally { LLMProvider.reset(); f.cleanup(); }
});

test('summary failure preserves completed-task facts and records summary failure separately', async () => {
  const f = fixture();
  f.session.updateMessage(f.pending.id, { proposalResolved: true });
  const target = f.session.appendMessage({ role: 'assistant', content: '制作任务已完成', metadata: { summaryStatus: 'pending' } });
  const chunks: string[] = [];
  streamIntent({ action: 'propose', reply: '下一步', tool: 'test.tool', params: {} });
  try {
    await assert.rejects(f.session.stream({ message: '任务已完成，请复盘', isSystemTrigger: true,
      targetMessageId: target.id, onTextChunk: text => chunks.push(text) }), /任务执行结果未改变/);
    const saved = f.session.getMessages().find(m => m.id === target.id)!;
    assert.equal(saved.content, '制作任务已完成');
    assert.equal(saved.metadata?.summaryStatus, 'failed');
    assert.equal(saved.postSummarySpeech, undefined);
    assert.doesNotMatch(chunks.join(''), /本轮操作未启动/);
  } finally { LLMProvider.reset(); f.cleanup(); }
});

test('automatic summary may propose a next step when no user proposal exists', async () => {
  const f = fixture();
  f.session.updateMessage(f.pending.id, { proposalResolved: true });
  const target = f.session.appendMessage({ role: 'assistant', content: '制作任务已完成', metadata: { summaryStatus: 'pending' } });
  streamIntent({ action: 'propose', reply: '建议继续下一步', title: '下一步', tool: 'test.tool', params: { value: 9 } });
  try {
    const result = await f.session.stream({ message: '复盘', isSystemTrigger: true, targetMessageId: target.id });
    assert.equal(result.intent?.action, 'propose');
    assert.equal(f.session.getMessages().filter(m => m.proposal && !m.proposalResolved).length, 1);
  } finally { LLMProvider.reset(); f.cleanup(); }
});
