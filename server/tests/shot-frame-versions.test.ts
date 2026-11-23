import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShotMediaFileName,
  appendFrameVersion,
  readFrameVersions,
  applyFrameVersion,
  appendVideoVersion,
  readVideoVersions,
  applyVideoVersion,
  activeFrameUrl,
  activeVideoUrl,
} from '../src/project-store/shot-frame-versions.js';

describe('Shot Media Version Ledger SSOT', () => {
  it('应当遵循工业影视标准资产命名规范 (buildShotMediaFileName)', () => {
    const firstShot = buildShotMediaFileName({
      shotId: 'shot_1',
      kind: 'first',
      versionSeq: 1,
    });
    assert.equal(firstShot.fileName, 'shot_01_first_v1.png');

    const lastShot = buildShotMediaFileName({
      shotId: 's04',
      kind: 'last',
      versionSeq: 2,
    });
    assert.equal(lastShot.fileName, 'shot_04_last_v2.png');

    const videoShot = buildShotMediaFileName({
      shotId: '12',
      kind: 'video',
      versionSeq: 3,
    });
    assert.equal(videoShot.fileName, 'shot_12_video_v3.mp4');
  });

  it('应当正确追加首帧版本并生效到镜头状态 (appendFrameVersion & activeFrameUrl)', () => {
    const shot: any = {
      shotId: 'shot_01',
      title: '镜头1',
    };

    const v1 = appendFrameVersion(shot, 'first', {
      imageUrl: 'http://localhost:3000/media/proj/shot_01_first_v1.png',
      prompt: '晨光下的赛博都市全景',
      source: 'generate',
    });

    assert.equal(shot.firstFrameImageUrl, 'http://localhost:3000/media/proj/shot_01_first_v1.png');
    assert.equal(shot.keyframeUrl, 'http://localhost:3000/media/proj/shot_01_first_v1.png');
    assert.equal(shot.firstFramePrompt, '晨光下的赛博都市全景');
    assert.equal(activeFrameUrl(shot, 'first'), 'http://localhost:3000/media/proj/shot_01_first_v1.png');

    const versions = readFrameVersions(shot, 'first');
    assert.equal(versions.length, 1);
    assert.equal(versions[0].versionId, v1.versionId);
  });

  it('首末帧应当严格分轨独立存储，绝不互串 (applyFrameVersion)', () => {
    const shot: any = {
      shotId: 'shot_02',
      firstFrameImageUrl: 'http://localhost/first_v1.png',
      firstFramePrompt: '主角远景正面',
    };

    appendFrameVersion(shot, 'last', {
      imageUrl: 'http://localhost/last_v1.png',
      prompt: '主角近景背影',
      source: 'generate',
      cameraDirective: { label: '背光推镜头' },
    });

    // 校验尾帧生效
    assert.equal(shot.lastFrameImageUrl, 'http://localhost/last_v1.png');
    assert.equal(shot.lastFramePrompt, '主角近景背影');
    assert.equal(shot.lastFrameCameraDirective?.label, '背光推镜头');

    // 验证首帧完全未被污染
    assert.equal(shot.firstFrameImageUrl, 'http://localhost/first_v1.png');
    assert.equal(shot.firstFramePrompt, '主角远景正面');
    assert.equal(shot.firstFrameCameraDirective, undefined);
  });

  it('应当支持视频多版本追加与历史回退 (appendVideoVersion & applyVideoVersion)', () => {
    const shot: any = {
      shotId: 'shot_03',
    };

    const v1 = appendVideoVersion(shot, {
      videoUrl: 'http://localhost/shot_03_video_v1.mp4',
      prompt: '镜头平移',
      source: 'generate',
    });

    assert.equal(shot.videoUrl, 'http://localhost/shot_03_video_v1.mp4');
    assert.equal(activeVideoUrl(shot), 'http://localhost/shot_03_video_v1.mp4');

    const v2 = appendVideoVersion(shot, {
      videoUrl: 'http://localhost/shot_03_video_v2.mp4',
      prompt: '镜头环绕',
      source: 'generate',
    });

    assert.equal(shot.videoUrl, 'http://localhost/shot_03_video_v2.mp4');
    const versions = readVideoVersions(shot);
    assert.equal(versions.length, 2);

    // 切换回 v1
    applyVideoVersion(shot, v1);
    assert.equal(shot.videoUrl, 'http://localhost/shot_03_video_v1.mp4');
    assert.equal(shot.videoPrompt, '镜头平移');
  });
});
