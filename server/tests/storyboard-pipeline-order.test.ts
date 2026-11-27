import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { storyboardRolePrompt } from '../src/agents/storyboard/prompt.js';

describe('Storyboard Pipeline Causal Order SSOT', () => {
  it('角色提示词中必须包含影视工业分镜摄制与推演流水线规范', () => {
    const prompt = storyboardRolePrompt('c1', '第一幕');
    assert.ok(prompt.includes('三大工序阶段权限防火墙'));
    assert.ok(prompt.includes('film.shooting_script'));
    assert.ok(prompt.includes('film.shot_motion_prompt'));
    assert.ok(prompt.includes('film.shot_video'));
  });
});