import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Agent } from '@mastra/core/agent';
import { MockLanguageModelV1, simulateReadableStream } from 'ai/test';
import { createIntentTools } from '../dist/agents/runtime/intent-tool.js';
import { streamAgentWithCompat } from '../dist/mastra-compat/streamAgent.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { LLMProvider } from '../dist/llm/provider.js';
import { compileVisualEditPrompt } from '../dist/tools/film-production/visual-edit-prompt.js';

test('intent tool exposes required proposal branches to the model gateway', () => {
  const tool = createIntentTools([{ toolName: 'test.tool', title: 'Test', description: 'Test', schema: {} }], false, false, false).emit_director_intent;
  const jsonSchema = zodToJsonSchema(tool.inputSchema);
  const branches = jsonSchema.anyOf || jsonSchema.definitions?.input?.anyOf || [];
  assert.ok(branches.length >= 3);
  const single = branches.find((branch) => branch.required?.includes('targetTool'));
  assert.ok(single?.required?.includes('description'));
  assert.ok(single?.required?.includes('params'));
});

test('Mastra Agent streams a reply through its intent tool', async () => {
  const reply = '测试回复';
  const args = JSON.stringify({ action: 'chat_only', reply });
  const model = new MockLanguageModelV1({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'tool-call-delta', toolCallType: 'function', toolCallId: 'call-1', toolName: 'emit_director_intent', argsTextDelta: args },
          { type: 'tool-call', toolCallType: 'function', toolCallId: 'call-1', toolName: 'emit_director_intent', args },
          { type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 1, completionTokens: 1 } },
        ],
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
    }),
  });
  const agent = new Agent({
    name: 'intent-stream-test',
    instructions: 'Reply through the intent tool.',
    model,
    tools: createIntentTools([{ toolName: 'test.tool', title: 'Test', description: 'Test', schema: {} }], false, false),
  });

  const result = streamAgentWithCompat(agent, [{ role: 'user', content: 'hi' }], {
    maxSteps: 1,
    toolChoice: 'required',
    experimentalToolCallStreaming: true,
  });
  const eventTypes = [];
  for await (const event of result.fullStream) eventTypes.push(event.type);

  assert.ok(eventTypes.includes('tool-call-delta'));
  assert.equal((await result.toolCalls)[0]?.args?.reply, reply);
});

test('visual edit compiler returns a structured stance and rejects an omitted explicit constraint', async () => {
  const response = (poseConstraint) => new MockLanguageModelV1({
    defaultObjectGenerationMode: 'json',
    doGenerate: async () => ({
      text: JSON.stringify({ directedPrompt: '以 <image1> 为基准，双脚并拢，脚踝贴合。', negativePrompt: '双脚分开', poseConstraint }),
      finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 1 },
    }),
  });
  try {
    LLMProvider.setMockModel(response({ stance: 'feet_together' }));
    const result = await compileVisualEditPrompt({ entityType: 'character', name: '测试角色',
      originalDescription: '自然站立', instruction: '双脚并拢' });
    assert.equal(result.poseConstraint?.stance, 'feet_together');
    LLMProvider.setMockModel(response(null));
    await assert.rejects(() => compileVisualEditPrompt({ entityType: 'character', name: '测试角色',
      originalDescription: '自然站立', instruction: '双脚并拢' }), /未保留双脚并拢约束/);
  } finally {
    LLMProvider.reset();
  }
});
