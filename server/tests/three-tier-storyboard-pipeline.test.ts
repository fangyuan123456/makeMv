/**
 * tests/three-tier-storyboard-pipeline.test.ts
 * 验证分镜三级正交解耦流水线 (Storyboard Three-Tier Pipeline SSOT)
 * 验证：台本切分、单镜首帧构图分析、单镜视频运镜动力学推演的完全内聚与职责正交
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  StoryboardBreakdownTool,
  buildStoryboardBreakdownPrompt,
  buildStoryboardBreakdownModifyPrompt,
} from '../src/tools/film-production/storyboard-breakdown-tool/index.js';
import {
  ShotPromptTool,
  buildShotPromptPrompt,
  buildShotPromptModifyPrompt,
} from '../src/tools/film-production/shot-prompt-tool/index.js';

describe('Three-Tier Storyboard Pipeline SSOT', () => {
  it('1. StoryboardBreakdownTool 仅负责戏剧切分与文学台本，不包含生图与运镜词', () => {
    const tool = new StoryboardBreakdownTool();
    assert.equal(tool.toolName, 'film.storyboard_breakdown');
    assert.ok(tool.description.includes('戏剧节拍'));

    // 检查 outputSchema 的属性定义中不含 firstFramePrompt 与 videoPrompt
    const shotShape = tool.outputSchema.shape.shots.element.shape;
    assert.equal((shotShape as any).firstFramePrompt, undefined);
    assert.equal((shotShape as any).videoPrompt, undefined);
    assert.ok(shotShape.sceneSubject);
    assert.ok(shotShape.cameraDirective);
  });

  it('2. ShotPromptTool 执行单镜视听一体化推演，挂载独立并发键，包含首帧生图词与同相动态运镜词', () => {
    const tool = new ShotPromptTool();
    assert.equal(tool.toolName, 'film.shot_prompt');
    const concurrencyKey = tool.resolveConcurrencyKey('proj_1', { clipId: 'c1', shotId: 'c1-01' });
    assert.equal(concurrencyKey, 'proj_1:c1:c1-01');

    const outputShape = tool.outputSchema.shape;
    assert.ok(outputShape.firstFramePrompt);
    assert.ok(outputShape.videoPrompt);

    const prompt = buildShotPromptPrompt({
      shot: { shotId: 'c1-01', title: '门前定场', sceneSubject: '陈守夜独身一人在门前' },
      clipTitle: '夜归老宅',
    });
    assert.ok(prompt.includes('100% 纯正向肯定句'));
    assert.ok(prompt.includes('五层公理体系'));
    assert.ok(!prompt.includes('严禁慢放'));
  });

  it('3. 各分镜工具的 modifier 均具备独立的微调提示词与结构化/增量继承机制', () => {
    // 3.1 breakdown modifier prompt
    const breakdownModPrompt = buildStoryboardBreakdownModifyPrompt({
      clipId: 'c1',
      existingShots: [{ shotId: 'c1-01', title: '镜01', sceneSubject: '推门' }],
      instruction: '增加一个手部特写镜头',
    });
    assert.ok(breakdownModPrompt.includes('当前分幕已有镜头序列'));
    assert.ok(breakdownModPrompt.includes('手部特写'));

    // 3.2 shot prompt modifier prompt
    const shotPromptMod = buildShotPromptModifyPrompt({
      shot: {
        shotId: 'c1-01',
        title: '镜01',
        sceneSubject: '推门',
        firstFramePrompt: '五层公理原有生图词',
      },
      clipTitle: '第一幕',
      instruction: '将色温调整为青冷调',
    });
    assert.ok(shotPromptMod.includes('基准底稿'));
    assert.ok(shotPromptMod.includes('五层公理原有生图词'));
    assert.ok(shotPromptMod.includes('将色温调整为青冷调'));
  });

  it('4. 全剧故事因果与前后镜头接戏 (Continuity) 上下文正确注入各级提示词与契约', () => {
    // 4.1 breakdown 支持全剧背景、前序承接与后幕走向
    const breakdownPrompt = buildStoryboardBreakdownPrompt({
      clipId: 'c2',
      clipTitle: '老宅惊魂',
      narrativeText: '陈守夜进入正厅...',
      storyOverview: '民国悬疑古宅探秘之旅',
      previousClipSummary: '上一幕【c1·夜归老宅】：陈守夜推开大门，衣袖被门框铁钉划破',
      nextClipSummary: '下一幕【c3·密室对决】：暗门轰然闭合',
    });
    assert.ok(breakdownPrompt.includes('民国悬疑古宅探秘之旅'));
    assert.ok(breakdownPrompt.includes('衣袖被门框铁钉划破'));
    assert.ok(breakdownPrompt.includes('密室对决'));
    assert.ok(breakdownPrompt.includes('前后因果接戏'));

    // 4.2 shot prompt 支持上一镜头视线轴线与身体姿态接戏
    const shotPrompt = buildShotPromptPrompt({
      shot: { shotId: 'c1-02', title: '近景推门', sceneSubject: '右手握紧门环' },
      clipTitle: '夜归老宅',
      previousShot: {
        shotId: 'c1-01',
        title: '远景定场',
        sceneSubject: '陈守夜快步走向老宅大门',
        firstFramePrompt: '35mm全景，陈守夜背影快步前行',
      },
    });
    assert.ok(shotPrompt.includes('上一镜头接戏基准'));
    assert.ok(shotPrompt.includes('c1-01 · 远景定场'));
    assert.ok(shotPrompt.includes('上一镜首帧不代表末态'));
  });
});
