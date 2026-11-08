/**
 * scripts/preview-recompute-plan.ts
 * 增量重算清单的离线格式预览（契约样例）
 *
 *   npx tsx scripts/preview-recompute-plan.ts
 *   npx tsx scripts/preview-recompute-plan.ts --json
 *
 * 为什么需要它：当前 26 个项目没有一个跑到分镜/视频阶段，真实数据上只能打印
 * 「0 项待重做」。清单的字段契约和可读格式需要一份可复现的样例，供前端接入、
 * 人工评审与回归对照使用。数据全是内存构造，不读项目、不写盘、不触发渲染。
 */

import {
  buildRecomputePlan,
  formatRecomputePlan,
} from '../src/agents/director/lineage/recompute-plan.js';
import {
  computeKeyframeFingerprint,
  computeClipFingerprint,
} from '../src/agents/director/lineage/fingerprint.js';

const bible = {
  characters: [{ name: '李明', characterId: 'c1', gender: '男', age: 38, appearance: '短发凌乱' }],
  storyGraph: { nodes: [{ id: 'node_1', title: '灾难降临', characterNames: ['李明'] }] },
};

const shots = [
  { shotId: 'shot_1', nodeId: 'node_1', shotScale: '中景', durationSec: 3, characterIds: ['c1'] },
  { shotId: 'shot_2', nodeId: 'node_1', shotScale: '特写', durationSec: 4, characterIds: ['c1'] },
  { shotId: 'shot_3', nodeId: 'node_1', shotScale: '全景', durationSec: 5, characterIds: ['c1'] },
];

// shot_1/2 的首帧指纹是旧值（上游改过），shot_3 是最新值；视频指纹全部最新，
// 用来演示「首帧图重做 → 视频跟着重做」的传递依赖。
const keyframes = shots.map((s) => ({
  shotId: s.shotId,
  prompt: `P_${s.shotId}`,
  inputFingerprint:
    s.shotId === 'shot_3' ? computeKeyframeFingerprint(bible, s) : 'OLD_KEYFRAME',
}));
const clips = shots.map((s) => ({
  clipId: `clip_${s.shotId}`,
  shotId: s.shotId,
  durationSec: s.durationSec,
  inputFingerprint: computeClipFingerprint(
    bible,
    s,
    keyframes.find((k) => k.shotId === s.shotId)
  ),
}));

const artifacts = {
  narrative_design: bible,
  scene_script: {
    scenes: [{ nodeId: 'node_1', sceneTitle: '走廊尽头', dialogues: [{ speaker: '李明', line: '快走' }] }],
  },
  storyboard: { shots },
  keyframe_reference: { shots: keyframes },
  video_production: { clips },
};

const plan = buildRecomputePlan(artifacts, {
  query: { characters: ['李明'] },
  pricing: { keyframePerUnit: 0.5, videoPerSecond: 2 },
});

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(plan, null, 2));
} else {
  console.log(formatRecomputePlan(plan));
}
