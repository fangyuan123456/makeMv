import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/taskUtils.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { isConversationTaskRunning, isEntityTaskRunning } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);

test('an agent is blocked only by its own active task', () => {
  const tasks = [
    { status: 'running', input: { __chatContext: { sessionId: 'lookdev' } } },
    { status: 'pending', input: { __chatContext: { sessionId: 'storyboard_clip1' } } },
    { status: 'running', input: {} },
  ];
  assert.equal(isConversationTaskRunning(tasks, 'planner'), false);
  assert.equal(isConversationTaskRunning(tasks, 'lookdev'), true);
  assert.equal(isConversationTaskRunning(tasks, 'storyboard_clip1'), true);
  assert.equal(isConversationTaskRunning([{ status: 'completed', input: { __chatContext: { sessionId: 'planner' } } }], 'planner'), false);
});

test('unified Lookdev loading matches only targeted assets', () => {
  const tasks = [{
    toolName: 'film.lookdev', status: 'running', createdAt: Date.now() - 600000,
    input: { targets: [
      { type: 'character', ids: ['char_a'] },
      { type: 'location', ids: ['loc_b'] },
    ] },
  }];
  assert.equal(isEntityTaskRunning(tasks, 'film.lookdev', { characterId: 'char_a' }), true);
  assert.equal(isEntityTaskRunning(tasks, 'film.lookdev', { characterId: 'char_b' }), false);
  assert.equal(isEntityTaskRunning(tasks, 'film.lookdev', { locationId: 'loc_b' }), true);
  assert.equal(isEntityTaskRunning(tasks, 'film.lookdev', { itemId: 'loc_b' }), false);
});
