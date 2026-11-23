import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StoryboardAgent } from '../src/agents/storyboard/agent.js';

test('StoryboardAgent stream capability verification', async () => {
  const agent = new StoryboardAgent({
    projectId: 'test_engine_proj_001',
    clipId: 'c1',
  });
  assert.equal(agent.clipId, 'c1');
  assert.ok(typeof (agent as any).assembleSystemPrompt === 'function');
});
