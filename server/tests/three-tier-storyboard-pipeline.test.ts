/**
 * tests/three-tier-storyboard-pipeline.test.ts
 * 验证分镜两级正交解耦流水线 (Storyboard Pipeline SSOT)
 * 验证：台本镜头切分、单镜首帧构图分析与动态运镜推演的完全内聚与职责正交
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ShootingScriptTool,
  buildShootingScriptPrompt,
  buildShootingScriptModifyPrompt,
} from '../src/tools/film-production/shooting-script-tool/index.js';
import {
  ShotPromptTool,
  buildShotPromptPrompt,
  buildShotPromptModifyPrompt,
} from '../src/tools/film-production/shot-prompt-tool/index.js';

describe('Storyboard Pipeline SSOT (Shooting Script & Shot Prompt)', () => {
  it('1. ShootingScriptTool 一步到位生成时空环境锁与全量原子镜头台本', () => {
    const tool = new ShootingScriptTool();
    assert.equal(tool.toolName, 'film.shooting_script');
    assert.ok(tool.description.includes('演绎剧本') || tool.description.includes('摄制台本'));

    // 检查 outputSchema 的属性定义包含 environmentLock 与 actionBeats
    const outputShape = tool.outputSchema.shape;
    assert.ok(outputShape.environmentLock);
    assert.ok(outputShape.actionBeats);

    const beatShape = outputShape.actionBeats.element.shape;
    assert.ok(beatShape.space);
    assert.ok(beatShape.beatTitle);
    assert.ok(beatShape.actionDescription);
    assert.ok(beatShape.cinematicIntent);
    assert.ok(beatShape.dialogue);
    assert.ok(beatShape.audioAmbience);
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
      shot: { shotId: 'c1-01', title: '门前定场', sceneSubject: '独身一人在门前' },
      clipTitle: '夜归老宅',
    });
    assert.ok(prompt.includes('100% 纯正向肯定句'));
    assert.ok(prompt.includes('五层公理体系'));
    assert.ok(!prompt.includes('严禁慢放'));
  });

  it('3. 各分镜工具的 modifier 均具备独立的微调提示词与结构化/增量继承机制', () => {
    // 3.1 shooting script modifier prompt
    const scriptModPrompt = buildShootingScriptModifyPrompt({
      clipId: 'c1',
      clipTitle: '村口初探',
      existingEnvironmentLock: {
        timeOfDay: '黄昏',
        weatherDirective: { label: '黄昏薄雾', instruction: '深秋黄昏，薄雾笼罩' },
        lightingDirective: { label: '暗橙余晖', instruction: '低角度暖橙余晖斜射' },
      },
      existingActionBeats: [
        {
          beatId: 'b1',
          beatTitle: '停在界碑前戒备',
          actionDescription: '在风化界碑前驻足收步',
          cinematicIntent: '全景推镜头',
        },
      ],
      instruction: '将天气改为暴雨夜，主角动作更激烈警惕',
    });
    assert.ok(scriptModPrompt.includes('当前已有场景时空与光影环境锁'));
    assert.ok(scriptModPrompt.includes('黄昏薄雾'));
    assert.ok(scriptModPrompt.includes('将天气改为暴雨夜'));
    assert.ok(scriptModPrompt.includes('锁死保留未受影响内容'));

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
    // 4.1 shooting script 支持全剧背景、前序承接与后幕走向
    const shootingPrompt = buildShootingScriptPrompt({
      clipId: 'c2',
      clipTitle: '老宅惊魂',
      narrativeText: '进入正厅探索...',
      storyOverview: '民国悬疑古宅探秘之旅',
      previousClipSummary: '上一幕【c1·夜归老宅】：推开大门，衣袖被门框铁钉划破',
      nextClipSummary: '下一幕【c3·密室对决】：暗门轰然闭合',
    });
    assert.ok(shootingPrompt.includes('民国悬疑古宅探秘之旅'));
    assert.ok(shootingPrompt.includes('衣袖被门框铁钉划破'));
    assert.ok(shootingPrompt.includes('密室对决'));

    // 4.2 shot prompt 支持上一镜头视线轴线与身体姿态接戏
    const shotPrompt = buildShotPromptPrompt({
      shot: { shotId: 'c1-02', title: '近景推门', sceneSubject: '右手握紧门环' },
      clipTitle: '夜归老宅',
      previousShot: {
        shotId: 'c1-01',
        title: '远景定场',
        sceneSubject: '快步走向老宅大门',
        firstFramePrompt: '35mm全景，背影快步前行',
      },
    });
    assert.ok(shotPrompt.includes('上一镜头接戏基准'));
    assert.ok(shotPrompt.includes('c1-01 · 远景定场'));
    assert.ok(shotPrompt.includes('上一镜首帧不代表末态'));
  });

  it('5. ShootingScriptTool 专门深化纯物理动作表演流与时空环境锁', () => {
    const shootingTool = new ShootingScriptTool();
    const shootingShape = shootingTool.outputSchema.shape;
    assert.ok(shootingShape.environmentLock);
    assert.ok(shootingShape.actionBeats);

    const shootingPrompt = buildShootingScriptPrompt({
      clipId: 'c1',
      clipTitle: '村口初探',
      narrativeText: '黄昏来到封门村村口，薄雾弥漫...',
    });
    assert.ok(shootingPrompt.includes('时空与光影环境锁'));
    assert.ok(shootingPrompt.includes('严禁文学心理与抒情修辞'));
    assert.ok(shootingPrompt.includes('专注纯粹物理表演与肢体细节'));

    // 验证推演工具成功接收 weatherDirective
    const shotPromptWithWeather = buildShotPromptPrompt({
      shot: {
        shotId: 'c1-01',
        title: '界碑定场',
        sceneSubject: '在界碑前停步',
        weatherDirective: { label: '黄昏薄雾', instruction: '深秋黄昏，薄雾笼罩' },
      },
      clipTitle: '村口初探',
    });
    assert.ok(shotPromptWithWeather.includes('既定天气与环境光影硬约束'));
    assert.ok(shotPromptWithWeather.includes('黄昏薄雾'));
    assert.ok(shotPromptWithWeather.includes('杜绝白昼漂移'));
  });
});
