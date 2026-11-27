/**
 * tests/three-tier-storyboard-pipeline.test.ts
 * 验证分镜两级正交解耦流水线 (Storyboard Pipeline SSOT)
 * 验证：台本镜头切分、单镜动态运镜推演的完全内聚与职责正交
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ShootingScriptTool,
  buildShootingScriptPrompt,
  buildShootingScriptModifyPrompt,
} from '../src/tools/film-production/shooting-script-tool/index.js';
import {
  ShotMotionPromptTool,
  buildShotMotionPromptPrompt,
  buildShotMotionModifierPrompt,
} from '../src/tools/film-production/shot-motion-prompt-tool/index.js';

describe('Storyboard Pipeline SSOT (Shooting Script & Shot Motion Prompt)', () => {
  it('1. ShootingScriptTool 一步到位生成时空环境锁与全量原子镜头台本', () => {
    const tool = new ShootingScriptTool();
    assert.equal(tool.toolName, 'film.shooting_script');
    assert.ok(tool.description.includes('演绎剧本') || tool.description.includes('摄制台本'));

    const outputShape = tool.outputSchema.shape;
    assert.ok(outputShape.environmentLock);
    assert.ok(outputShape.actionBeats);

    const beatShape = outputShape.actionBeats.element.shape;
    assert.ok(beatShape.space);
    assert.ok(beatShape.beatTitle);
    assert.ok(beatShape.actionDescription);
  });

  it('2. ShotMotionPromptTool 生成 Ref2V 视频提示词', () => {
    const motionTool = new ShotMotionPromptTool();
    assert.equal(motionTool.toolName, 'film.shot_motion_prompt');
    const motionKey = motionTool.resolveConcurrencyKey('proj_1', { clipId: 'c1', shotId: 'c1-01' });
    assert.equal(motionKey, 'proj_1:c1:c1-01');

    const motionOutputShape = motionTool.outputSchema.shape;
    assert.ok(motionOutputShape.videoPrompt);

    const motionPrompt = buildShotMotionPromptPrompt({
      shot: {
        shotId: 'c1-01',
        title: '门前定场',
        sceneSubject: '独身一人在门前',
      },
      clipTitle: '夜归老宅',
    });
    assert.ok(motionPrompt.includes('Ref2V'));
    assert.ok(motionPrompt.includes('人物站位：'));
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
        },
      ],
      instruction: '将天气改为暴雨夜，主角动作更激烈警惕',
    });
    assert.ok(scriptModPrompt.includes('当前已有场景时空与光影环境锁'));
    assert.ok(scriptModPrompt.includes('黄昏薄雾'));
    assert.ok(scriptModPrompt.includes('将天气改为暴雨夜'));
    assert.ok(scriptModPrompt.includes('锁定保留未受影响内容'));

    // 3.2 shot motion modifier prompt
    const motionModPrompt = buildShotMotionModifierPrompt({
      shot: {
        shotId: 'c1-01',
        title: '镜01',
        videoPrompt: '原有视频动作流...',
      },
      instruction: '让主角手部动作放慢一倍，配角视线同步下移',
    });
    assert.ok(motionModPrompt.includes('既有视频提示词基底'));
    assert.ok(motionModPrompt.includes('原有视频动作流'));
    assert.ok(motionModPrompt.includes('配角视线同步下移'));
    assert.ok(motionModPrompt.includes('Ref2V'));
  });

  it('4. 全剧故事因果与前后镜头接戏上下文正确注入各级提示词', () => {
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
    assert.ok(shootingPrompt.includes('专业电影文学语言与法定标准名称'));
    assert.ok(shootingPrompt.includes('专注客观可视的物理表演与场面调度'));
  });
});