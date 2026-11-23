import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { storyboardBreakdownModifierStep } from '../src/tools/film-production/storyboard-breakdown-tool/index.js';
import { shotPromptModifierStep } from '../src/tools/film-production/shot-prompt-tool/index.js';
import { shotMotionModifierStep } from '../src/tools/film-production/shot-motion-tool/index.js';
import type { FilmAdapterArtifact } from '../src/project-store/contracts/film-production/film-spec.js';

test('🎬 验证分镜解耦三工具定向微调模式 (Breakdown/Prompt/Motion Modifier)', async (t) => {
  const projectId = 'test_modify_shot_proj_001';
  const store = ProjectStore.getInstance();

  // 1. 初始化模拟的 film_spec
  const mockFilmSpec: FilmAdapterArtifact = {
    projectId,
    schemaVersion: '2.0.0',
    projectTitle: '测试分镜修改短剧',
    clips: [
      {
        clipId: 'c1',
        sourceNodeId: 'c1',
        targetDurationSec: 8,
        shots: [
          {
            shotId: 'c1-01',
            clipId: 'c1',
            shotIndex: 0,
            durationSec: 4,
            shotType: 'WIDE_SHOT',
            cameraMovement: 'locked-off',
            generationMode: 'first_frame',
            characters: ['char_lin'],
            items: [],
            firstFramePrompt: '原版旧首帧提示词：全景，林航站在控制台前',
            videoPrompt: '原版旧视频词：林航不动',
            audioPrompt: '警报声',
            dialogue: '',
            transitionAnchor: '锚点1',
          },
          {
            shotId: 'c1-02',
            clipId: 'c1',
            shotIndex: 1,
            durationSec: 4,
            shotType: 'CLOSE_UP',
            cameraMovement: 'dolly in',
            generationMode: 'first_frame',
            characters: ['char_lin'],
            items: [],
            firstFramePrompt: '原版第二镜提示词',
            videoPrompt: '原版第二镜视频词',
            audioPrompt: '心跳声',
            dialogue: '',
            transitionAnchor: '锚点2',
          },
        ],
      },
    ],
  };

  store.setArtifact(projectId, 'film_spec', mockFilmSpec);
  store.setArtifact(projectId, 'universal_prd', {
    gameTitle: '测试短剧',
    clips: [{ id: 'c1', title: '第1幕', narrativeText: '舰桥爆发警报，林航查看屏幕' }],
  });

  await t.test('1. StoryboardBreakdownModifier 执行镜头结构化更新 (0 LLM 开销)', async () => {
    const res = await storyboardBreakdownModifierStep.execute({
      context: {
        projectId,
        clipId: 'c1',
        modifications: [
          {
            action: 'update',
            shotId: 'c1-01',
            shot: {
              durationSec: 5,
              sceneSubject: '林航紧急按下闭锁阀',
            },
          },
        ],
      },
    } as any);

    assert.equal(res.shots.length, 2);
    const updatedShot = res.shots.find((s: any) => s.shotId === 'c1-01');
    assert.equal(updatedShot?.durationSec, 5);
    assert.equal(updatedShot?.sceneSubject, '林航紧急按下闭锁阀');
  });

  await t.test('2. ShotPromptModifier 执行单镜首帧词自定义极速覆盖 (0 LLM 开销)', async () => {
    const customFirstFrame = '35mm变形宽银幕微仰拍，冷蓝屏幕光映照，林航双手撑在控制台上面向画右紧盯生命红线';
    const res = await shotPromptModifierStep.execute({
      context: {
        projectId,
        clipId: 'c1',
        shotId: 'c1-01',
        customPrompt: customFirstFrame,
      },
    } as any);

    assert.equal(res.firstFramePrompt, customFirstFrame);
  });

  await t.test('3. ShotMotionModifier 执行单镜视频运镜词自定义极速覆盖 (0 LLM 开销)', async () => {
    const customVideo = '0~1.5s 镜头微推 ➔ 1.5~3.5s 林航猛按闭锁阀 ➔ 3.5~5s 警报红光扫射定势';
    const res = await shotMotionModifierStep.execute({
      context: {
        projectId,
        clipId: 'c1',
        shotId: 'c1-01',
        customPrompt: customVideo,
      },
    } as any);

    assert.equal(res.videoPrompt, customVideo);
  });
});
