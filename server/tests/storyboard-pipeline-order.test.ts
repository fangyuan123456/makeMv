import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { storyboardRolePrompt } from '../src/agents/storyboard/prompt.js';
import { StoryboardAgent } from '../src/agents/storyboard/agent.js';

describe('Storyboard Pipeline Causal Order SSOT', () => {
  it('角色提示词中必须包含影视工业分镜摄制与推演流水线规范', () => {
    const prompt = storyboardRolePrompt('c1', '第一幕');
    assert.ok(prompt.includes('三大工序阶段权限防火墙'));
    assert.ok(prompt.includes('film.shooting_script'));
    assert.ok(prompt.includes('film.shot_frame_prompt'));
    assert.ok(prompt.includes('film.shot_motion_prompt'));
    assert.ok(prompt.includes('film.shot_keyframe'));
    assert.ok(prompt.includes('film.shot_video'));
  });

  it('StoryboardAgent 必须支持顺次解析首帧 ➔ 超分 ➔ 视频的多步 Plan', () => {
    const agent = new StoryboardAgent({
      projectId: 'test_engine_proj_001',
      clipId: 'c1',
    });

    const parsed = (agent as any).resolveDirectorIntent({
      action: 'propose',
      title: '镜 01 · 重新提取后全套正序制作',
      operations: [
        {
          tool: 'film.shot_keyframe',
          title: 'Step 1: 首帧重绘',
          params: { shotId: 'c1-01', frame: 'first', force: true },
        },
        {
          tool: 'film.image_upscale',
          title: 'Step 2: 首帧超分',
          params: { targetKind: 'shot_keyframe', targetId: 'c1-01', frame: 'first', multiplier: 2 },
        },
        {
          tool: 'film.shot_video',
          title: 'Step 3: 动态视频渲染',
          params: { shotId: 'c1-01', force: true },
        },
      ],
      description: '提示词重新提取后，按因果正序全套执行',
    });

    assert.equal(parsed.action, 'propose');
    assert.equal(parsed.operations.length, 3);
    assert.equal(parsed.operations[0].tool, 'film.shot_keyframe');
    assert.equal(parsed.operations[1].tool, 'film.image_upscale');
    assert.equal(parsed.operations[2].tool, 'film.shot_video');
  });
});
