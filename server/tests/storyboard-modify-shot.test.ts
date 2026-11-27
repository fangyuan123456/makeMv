import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { shootingScriptModifierStep } from '../src/tools/film-production/shooting-script-tool/index.js';
import { shotPromptModifierStep } from '../src/tools/film-production/shot-frame-prompt-tool/index.js';
import type { FilmAdapterArtifact } from '../src/project-store/contracts/film-production/film-spec.js';

test('馃幀 楠岃瘉鍒嗛暅瑙ｈ€︿笁宸ュ叿瀹氬悜寰皟妯″紡 (ShootingScript/Prompt/Motion Modifier)', async (t) => {
  const projectId = 'test_modify_shot_proj_001';
  const store = ProjectStore.getInstance();

  // 1. 鍒濆鍖栨ā鎷熺殑 film_spec
  const mockFilmSpec: FilmAdapterArtifact = {
    projectId,
    schemaVersion: '2.0.0',
    projectTitle: '娴嬭瘯鍒嗛暅淇敼鐭墽',
    clips: [
      {
        clipId: 'c1',
        sourceNodeId: 'c1',
        targetDurationSec: 8,
        shootingScript: {
          clipId: 'c1',
          clipTitle: '绗?骞?,
          environmentLock: {
            timeOfDay: '鏃ラ棿',
            weatherDirective: { label: '鑷劧鍏夌収', instruction: '鑷劧婕弽灏勫厜褰? },
            lightingDirective: { label: '涓诲厜鏌斿拰', instruction: '鍐欏疄鏌斿拰鐓ф槑' },
          },
          actionBeats: [
            {
              beatId: 'b1',
              shotNumber: 1,
              space: '绌洪棿涓€',
              beatTitle: '闀滃ご 01锛堝叏鏅?路 4s锛?,
              actionDescription: '鍘熺増鏃у姩浣滐細鍏ㄦ櫙锛屾灄鑸珯鍦ㄦ帶鍒跺彴鍓?,
              estimatedSeconds: 4,
            },
            {
              beatId: 'b2',
              shotNumber: 2,
              space: '绌洪棿涓€',
              beatTitle: '闀滃ご 02锛堣繎鏅?路 4s锛?,
              actionDescription: '鍘熺増绗簩鍔ㄤ綔',
              estimatedSeconds: 4,
            },
          ],
        },
        shots: [
          {
            shotId: 'c1-01',
            clipId: 'c1',
            shotIndex: 0,
            durationSec: 4,
            shotType: 'WIDE_SHOT',
            cameraMovement: 'locked-off',
            generationMode: 'ref2v',
            characters: ['char_lin'],
            items: [],
            firstFramePrompt: '鍘熺増鏃ч甯ф彁绀鸿瘝锛氬叏鏅紝鏋楄埅绔欏湪鎺у埗鍙板墠',
            videoPrompt: '鍘熺増鏃ц棰戣瘝锛氭灄鑸笉鍔?,
            audioPrompt: '璀︽姤澹?,
            transitionAnchor: '閿氱偣1',
          },
          {
            shotId: 'c1-02',
            clipId: 'c1',
            shotIndex: 1,
            durationSec: 4,
            shotType: 'CLOSE_UP',
            cameraMovement: 'dolly in',
            generationMode: 'ref2v',
            characters: ['char_lin'],
            items: [],
            firstFramePrompt: '鍘熺増绗簩闀滄彁绀鸿瘝',
            videoPrompt: '鍘熺増绗簩闀滆棰戣瘝',
            audioPrompt: '蹇冭烦澹?,
            transitionAnchor: '閿氱偣2',
          },
        ],
      },
    ],
  };

  store.setArtifact(projectId, 'film_spec', mockFilmSpec);
  store.setArtifact(projectId, 'universal_prd', {
    gameTitle: '娴嬭瘯鐭墽',
    clips: [{ id: 'c1', title: '绗?骞?, narrativeText: '鑸版ˉ鐖嗗彂璀︽姤锛屾灄鑸煡鐪嬪睆骞? }],
  });

  await t.test('1. ShootingScriptModifier 鎵ц鍙版湰鑺傛媿缁撴瀯鍖栨洿鏂?(0 LLM 寮€閿€)', async () => {
    const res = await shootingScriptModifierStep.execute({
      context: {
        projectId,
        clipId: 'c1',
        modifications: [
          {
            action: 'update',
            beatId: 'b1',
            beat: {
              estimatedSeconds: 5,
              actionDescription: '鏋楄埅绱ф€ユ寜涓嬮棴閿侀榾',
            },
          },
        ],
      },
    } as any);

    assert.equal(res.actionBeats.length, 2);
    const updatedBeat = res.actionBeats.find((b: any) => b.beatId === 'b1');
    assert.equal(updatedBeat?.estimatedSeconds, 5);
    assert.equal(updatedBeat?.actionDescription, '鏋楄埅绱ф€ユ寜涓嬮棴閿侀榾');
  });

  await t.test('2. ShotPromptModifier 鎵ц鍗曢暅棣栧抚璇嶈嚜瀹氫箟鏋侀€熻鐩?(0 LLM 寮€閿€)', async () => {
    const customFirstFrame = '35mm鍙樺舰瀹介摱骞曞井浠版媿锛屽喎钃濆睆骞曞厜鏄犵収锛屾灄鑸弻鎵嬫拺鍦ㄦ帶鍒跺彴涓婇潰鍚戠敾鍙崇揣鐩敓鍛界孩绾?;
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

  await t.test('3. ShotPromptModifier 鎵ц鍗曢暅瑙嗛杩愰暅璇嶈嚜瀹氫箟鏋侀€熻鐩?(0 LLM 寮€閿€)', async () => {
    const customVideo = '0~1.5s 闀滃ご寰帹 鉃?1.5~3.5s 鏋楄埅鐚涙寜闂攣闃€ 鉃?3.5~5s 璀︽姤绾㈠厜鎵皠瀹氬娍';
    const res = await shotPromptModifierStep.execute({
      context: {
        projectId,
        clipId: 'c1',
        shotId: 'c1-01',
        customVideoPrompt: customVideo,
      },
    } as any);

    assert.equal(res.videoPrompt, customVideo);
  });
});
