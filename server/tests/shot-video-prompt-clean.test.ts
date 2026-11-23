import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatVideoMotionPrompt,
  buildShotCinematographyPrompt,
} from '../src/tools/film-production/shot-video-tool/steps/01-render/prompt.js';

describe('Shot Video Prompt Hardware Packaging (Decoupled)', () => {
  const pureMotion = '固定机位稳健构图，陈守夜拖着行李箱重心下沉，攥着家书的右手手指逐步收紧。';

  it('formatVideoMotionPrompt 仅用于向底层算力组装硬件前缀', () => {
    const hardwarePrompt = formatVideoMotionPrompt(pureMotion, false);
    assert.ok(hardwarePrompt.includes('保持指定风格与动作速率，光影与动作自然连贯'));
    assert.ok(hardwarePrompt.includes(pureMotion));
  });

  it('buildShotCinematographyPrompt 输出底层硬件装配提示词', () => {
    const shot: any = {
      videoPrompt: pureMotion,
    };
    const { videoPrompt, audioPrompt } = buildShotCinematographyPrompt(shot);
    assert.ok(videoPrompt.includes('保持指定风格与动作速率，光影与动作自然连贯'));
    assert.ok(videoPrompt.includes(pureMotion));
    assert.ok(typeof audioPrompt === 'string');
  });
});
