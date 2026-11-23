import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShotCinematographyPrompt, formatVideoMotionPrompt } from '../src/tools/film-production/shot-video-tool/steps/01-render/prompt.js';
import { ComfyUIMediaProvider } from '../src/media/providers/ComfyUIMediaProvider.js';

test('🎬 验证镜头视频工序工业级契约与多角色首帧连续性规范', async (t) => {
  await t.test('1. 提示词装配：单首帧生成纯净写实电影物理动能流', () => {
    const shot: any = {
      shotId: 'c1-01',
      cameraMovement: 'locked-off',
      videoPrompt: '画面左侧双手紧扣控制台边缘的军官重心急迫前倾；侧后方短发女性神情焦急冲向前。',
      audioPrompt: '警报声循环，控制台急促蜂鸣',
    };

    const res = buildShotCinematographyPrompt(shot);

    assert.equal(typeof res.videoPrompt, 'string');
    assert.equal(typeof res.audioPrompt, 'string');
    assert.match(res.videoPrompt, /画面左侧双手紧扣控制台边缘的军官/, '必须精准保留角色的空间方位与动作锚点');
    assert.match(res.videoPrompt, /写实电影物理速率，光影与动作自然连贯/, '必须附带自然物理速率与光影连贯');
    assert.doesNotMatch(res.videoPrompt, /\[object Object\]/, '绝对严禁将对象字符串化为 [object Object]');
  });

  await t.test('2. 提示词装配：首尾双帧自动升级为首尾双向连贯演进', () => {
    const shotWithLast: any = {
      shotId: 'c1-02',
      videoPrompt: '摄影机平缓后拉，人物从起始姿态自然过渡到警惕站姿',
      lastFrameImageUrl: '/media/test/c1-02_last.png',
    };

    const res = buildShotCinematographyPrompt(shotWithLast);
    assert.match(res.videoPrompt, /从首帧姿态连贯演进至尾帧/);
    assert.match(res.videoPrompt, /写实电影物理速率，光影自然流转/, '首尾双帧运镜词必须包含平稳自然流转');
  });

  await t.test('3. 刚性拦截 (Fail-Fast)：图生视频缺失首帧参考图时坚决阻断抛错，禁止隐式画假图', async () => {
    const provider = new ComfyUIMediaProvider();
    await assert.rejects(
      async () => {
        await provider.generateVideo('运镜测试', {} as any);
      },
      /图生视频缺少首帧关键帧参考图 \(referenceImageUrl\)，禁止无底图脱节生成/,
      '缺失首帧必须刚性抛错阻断，绝不允许私自偷偷调用文生图'
    );
  });
});
