import test from 'node:test';
import assert from 'node:assert/strict';
import { CINEMATIC_FIVE_LAYER_FRAMEWORK, CINEMATIC_KEYFRAME_NEGATIVE_PROMPT, CINEMATIC_CONTINUITY_LOCK, CINEMATIC_TEMPORAL_DYNAMICS_SPEC } from '../src/tools/film-production/shared/cinematography-grammar.js';
import { storyboardRolePrompt } from '../src/agents/storyboard/prompt.js';

test('shared quality constraints do not exclude supported styles or composition', () => {
  for (const style of ['CG感', '3D建模感', '对称构图', '虚幻引擎截图']) {
    assert.ok(!CINEMATIC_KEYFRAME_NEGATIVE_PROMPT.includes(style));
  }
  assert.match(CINEMATIC_KEYFRAME_NEGATIVE_PROMPT, /非预期人物复制/);
  assert.doesNotMatch(CINEMATIC_CONTINUITY_LOCK, /ARRI|Kodak/);
});

test('still-frame guidance is separate from motion and output fields', () => {
  assert.match(CINEMATIC_FIVE_LAYER_FRAMEWORK, /机位视点与透视/);
  assert.match(CINEMATIC_FIVE_LAYER_FRAMEWORK, /重力解剖与着力点/);
  assert.doesNotMatch(CINEMATIC_FIVE_LAYER_FRAMEWORK, /动态表演与运镜规范|videoPrompt/);
  assert.match(CINEMATIC_TEMPORAL_DYNAMICS_SPEC, /景别动能分级/);
  assert.match(storyboardRolePrompt('c1', '第一幕'), /首帧视觉生图/);
});
