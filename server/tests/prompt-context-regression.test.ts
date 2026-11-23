import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBranchContext } from '../src/project-store/story-context.js';
import { buildStoryboardBreakdownPrompt } from '../src/tools/film-production/storyboard-breakdown-tool/steps/01-breakdown/prompt.js';
import { buildCharacterPortraitPrompt } from '../src/tools/film-production/lookdev-tool/character/prompt.js';
import { buildShotKeyframePrompt } from '../src/tools/film-production/shot-keyframe-tool/steps/01-render/prompt.js';
import { buildShotPromptPrompt } from '../src/tools/film-production/shot-prompt-tool/steps/01-prompt/prompt.js';
import { formatVideoMotionPrompt } from '../src/tools/film-production/shot-video-tool/steps/01-render/prompt.js';

const graph = {
  startNodeId: 'start',
  clips: ['start', 'left', 'right', 'merge', 'unrelated'].map(id => ({ id, title: id, video: `${id}.mp4` })),
  interactions: [{ id: 'choice', kind: 'choice', prompt: '', outcomes: [] }, { id: 'loop', kind: 'choice', prompt: '', outcomes: [] }],
  wiring: [
    { from: 'start', to: 'choice', onOutcome: 'end' },
    { from: 'choice', to: 'left', onOutcome: 'A' },
    { from: 'choice', to: 'right', onOutcome: 'B' },
    { from: 'left', to: 'merge', onOutcome: 'end' },
    { from: 'right', to: 'merge', onOutcome: 'end' },
    { from: 'choice', to: 'loop', onOutcome: 'retry' },
    { from: 'loop', to: 'choice', onOutcome: 'retry' },
  ],
};
const sections = { start: { narrativeText: '出发' }, left: { narrativeText: '左路取得钥匙' }, right: { narrativeText: '右路空手返回' } };

test('branch context follows graph edges through choices, not neighboring array entries', () => {
  const result = buildBranchContext(graph, 'right', sections);
  assert.match(result.previousClipSummary, /start.*出发/);
  assert.doesNotMatch(result.previousClipSummary, /左路取得钥匙/);
  assert.match(result.nextClipSummary, /merge/);
  assert.doesNotMatch(result.nextClipSummary, /unrelated/);
  const reordered = { ...graph, clips: [...graph.clips].reverse() };
  assert.deepEqual(buildBranchContext(reordered, 'right', sections), result);
});

test('merged branches stay alternatives and cycles terminate', () => {
  const result = buildBranchContext(graph, 'merge', sections);
  assert.match(result.previousClipSummary, /左路取得钥匙/);
  assert.match(result.previousClipSummary, /右路空手返回/);
  assert.match(result.previousClipSummary, /互斥.*不代表同时发生/);
  assert.match(buildBranchContext(graph, 'start', sections).previousClipSummary, /明确指定的开篇/);
  assert.match(buildBranchContext(graph, 'unrelated', sections).previousClipSummary, /不可据此推断开篇/);
});

test('missing narrative fails instead of creating a replacement story', () => {
  assert.throws(() => buildStoryboardBreakdownPrompt({ clipId: 'c2', clipTitle: '续幕', narrativeText: '  ' }), /非空剧情正文/);
  const prompt = buildStoryboardBreakdownPrompt({ clipId: 'c2', clipTitle: '续幕', narrativeText: '她放下钥匙。' });
  assert.match(prompt, /前序信息未知/);
});

test('render packaging preserves animation, symmetric composition, and slow motion', () => {
  const portrait = buildCharacterPortraitPrompt({ promptZh: '蓝衣少女' } as any, '水彩动画');
  assert.match(portrait, /水彩动画/);
  assert.doesNotMatch(portrait, /写实摄影/);
  const keyframe = buildShotKeyframePrompt({ firstFramePrompt: '水彩动画，两人对称站立。' } as any,
    [{ role: 'character', url: '/a.png', name: '少女' }]);
  assert.match(keyframe, /水彩动画，两人对称站立/);
  assert.doesNotMatch(keyframe, /Kodak|ARRI|严禁在画面中出现三视图或多个人物/);
  const motion = formatVideoMotionPrompt('慢动作呈现花瓣飘落。', true);
  assert.match(motion, /慢动作/);
  assert.doesNotMatch(motion, /写实电影物理速率/);
});

test('first-frame prompt stays within the still-image output contract', () => {
  const prompt = buildShotPromptPrompt({ shot: { shotId: 'c1-01', title: '空镜', sceneSubject: '湖面' }, clipTitle: '湖畔' });
  assert.doesNotMatch(prompt, /动态表演与运镜规范|videoPrompt|结构化数组/);
  assert.match(prompt, /ShotPromptOutputSchema/);
});
