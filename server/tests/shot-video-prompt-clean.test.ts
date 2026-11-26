import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatVideoMotionPrompt,
  buildShotCinematographyPrompt,
} from '../src/tools/film-production/shot-video-tool/steps/01-render/prompt.js';

describe('Shot Video Prompt Hardware Packaging (Decoupled)', () => {
  const pureMotion = '固定机位稳健构图，陈守夜拖着行李箱重心下沉，攥着家书的右手手指逐步收紧。';

  it('formatVideoMotionPrompt 剥离冗余套话并保留纯净动作指令', () => {
    const hardwarePrompt = formatVideoMotionPrompt(pureMotion, false);
    assert.ok(!hardwarePrompt.includes('保持指定风格与动作速率'));
    assert.ok(hardwarePrompt.includes(pureMotion));
  });

  it('buildShotCinematographyPrompt 输出精简高信噪比提示词', () => {
    const shot: any = {
      videoPrompt: pureMotion,
    };
    const { videoPrompt, audioPrompt } = buildShotCinematographyPrompt(shot);
    assert.ok(!videoPrompt.includes('保持指定风格与动作速率'));
    assert.ok(videoPrompt.includes(pureMotion));
    assert.ok(typeof audioPrompt === 'string');
  });

  it('formatVideoMotionPrompt 智能转译客户端 @首帧 与 @资产 语法', () => {
    const clientMotion = '从 @首帧 姿态连贯演进：@沈追 走在 @落阴坳村口山路 的泥泞土路上，迈出最后两步停驻。';
    const hardwarePrompt = formatVideoMotionPrompt(clientMotion, false);
    // 验证 @首帧 被优雅转换为物理起幅
    assert.ok(hardwarePrompt.includes('首帧画面定格状态'));
    // 验证 @ 符号被剥离，保留纯净物理名称
    assert.ok(hardwarePrompt.includes('沈追 走在 落阴坳村口山路'));
    assert.ok(!hardwarePrompt.includes('@沈追'));
    assert.ok(!hardwarePrompt.includes('@落阴坳村口山路'));
  });
});
