/**
 * agents/text-game/steps/scene-assembly/step.ts
 * 分幕装配工序 (sceneAssemblyStep) —— 纯确定性装配，不调模型
 *
 * 产出两份东西，故意分开：
 *   1. scenes/<幕号>.json —— 素材文件，只有背景图 + 正文，等同于「一集视频」
 *   2. scenes/script.json —— 播放表，只有玩法（介入点 / 岔口 / 终局 / 下一幕）
 *
 * 素材与玩法分离后，换图、改文案不用碰逻辑；改路由不用重画图。
 * 刻意不产出任何「画面描述 / 生图提示词」：幕尾画面是镜头累积的结果，提前画不出来。
 */

import path from 'path';
import fs from 'fs';
import { createStep } from '@mastra/core/workflows';
import { runTaskRecordedStep } from '../../../../workflow-engine/TaskStore.js';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import type {
  SingleSceneJson,
  GlobalEntities,
  StoryScript,
  ScriptScene,
  ScriptInteraction,
  ScriptChoice,
} from '../../schema.js';
import type {
  UniversalPrdSpec,
  PrdInteractionNode,
  PrdEndingNode,
} from '../../../planner/steps/prd-synthesis/schema.js';
import {
  SceneAssemblyInputSchema,
  SceneAssemblyOutputSchema,
  type SceneAssemblyInput,
  type SceneAssemblyOutput,
} from './schema.js';

export interface ParsedStorySection {
  title: string;
  narrativeText: string;
}

/**
 * 纯函数解析 `story.md`（按 `## <clipId>｜<title>` 提取每幕正文与标题）
 */
export function parseStorySections(storyMarkdown: string): Map<string, ParsedStorySection> {
  const sections = new Map<string, ParsedStorySection>();
  if (!storyMarkdown || !storyMarkdown.trim()) {
    return sections;
  }

  let currentId: string | null = null;
  let currentTitle = '';
  let bodyLines: string[] = [];

  const flushSection = () => {
    if (!currentId) return;
    while (bodyLines.length > 0 && !bodyLines[0].trim()) bodyLines.shift();
    while (
      bodyLines.length > 0 &&
      (!bodyLines[bodyLines.length - 1].trim() || bodyLines[bodyLines.length - 1].trim() === '---')
    ) {
      bodyLines.pop();
    }
    sections.set(currentId, {
      title: currentTitle,
      narrativeText: bodyLines.join('\n').trim(),
    });
  };

  for (const line of storyMarkdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+([^\s｜|]+)(?:[｜|](.*))?$/);
    if (heading) {
      flushSection();
      currentId = heading[1].trim();
      currentTitle = (heading[2] || '').trim();
      bodyLines = [];
      continue;
    }
    if (currentId) {
      bodyLines.push(line);
    }
  }
  flushSection();

  return sections;
}

function isBranchClipId(clipId: string, prd: UniversalPrdSpec): boolean {
  if (/\.\d+$/.test(clipId)) return true;
  return prd.wiring.some((w) => w.to === clipId && w.onOutcome === 'B');
}

function deriveRewindClipFromWiring(prd: UniversalPrdSpec, clipId: string): string | undefined {
  const clipIdSet = new Set(prd.clips.map((c) => c.id));
  const incomingClipEdge = prd.wiring.find((w) => w.to === clipId && clipIdSet.has(w.from));
  if (incomingClipEdge) return incomingClipEdge.from;

  const incomingInterEdge = prd.wiring.find((w) => w.to === clipId);
  if (incomingInterEdge) {
    const ownerClipEdge = prd.wiring.find(
      (w) => w.to === incomingInterEdge.from && clipIdSet.has(w.from)
    );
    if (ownerClipEdge) return ownerClipEdge.from;
  }

  const prefix = clipId.match(/^(.+)\.\d+$/)?.[1];
  return prefix && clipIdSet.has(prefix) ? prefix : undefined;
}

const ENDING_TYPE_RANK: Record<PrdEndingNode['endingType'], number> = {
  TE: 0,
  HE: 1,
  SE: 2,
  NE: 3,
  BE: 4,
};

/**
 * 从 UniversalPrdSpec 推导某一幕在播放器里的玩法：介入点 / 岔口 / 终局 / 下一幕
 *
 * 这里是「玩法」进入剧本的唯一入口。素材文件（scenes/*.json）只装图和字，
 * 玩家能点什么、播完去哪，全部落在 script.json 里。
 */
export function buildScriptScene(clipId: string, prd: UniversalPrdSpec, title: string): ScriptScene {
  const clipIdSet = new Set(prd.clips.map((c) => c.id));
  const interMap = new Map(prd.interactions.map((i) => [i.id, i]));
  const endingMap = new Map(prd.endings.map((e) => [e.id, e]));

  // 沿接线从本幕走一遍，收集相邻的互动点、结局与下一幕（深度上限防脏数据成环）
  const interactions: PrdInteractionNode[] = [];
  const endings: PrdEndingNode[] = [];
  const nextClips: string[] = [];

  const walk = (fromId: string, depth: number) => {
    if (depth > 4) return;
    for (const edge of prd.wiring) {
      if (edge.from !== fromId) continue;
      const inter = interMap.get(edge.to);
      if (inter) {
        if (!interactions.some((i) => i.id === inter.id)) {
          interactions.push(inter);
          walk(inter.id, depth + 1);
        }
        continue;
      }
      const ending = endingMap.get(edge.to);
      if (ending) {
        if (!endings.some((e) => e.id === ending.id)) endings.push(ending);
        continue;
      }
      if (clipIdSet.has(edge.to) && !nextClips.includes(edge.to)) nextClips.push(edge.to);
    }
  };
  walk(clipId, 0);

  // 岔口：CHOICE 类互动点，每个 outcome 落到哪个幕
  const choiceNode = interactions.find((i) => i.kind.toUpperCase() === 'CHOICE');
  const choices: ScriptChoice[] = [];
  if (choiceNode) {
    for (const outcome of choiceNode.outcomes) {
      if (outcome.key === 'TIMEOUT') continue;
      for (const edge of prd.wiring) {
        if (edge.from !== choiceNode.id) continue;
        if (edge.onOutcome !== outcome.key && edge.onOutcome !== '*') continue;
        if (!clipIdSet.has(edge.to)) continue;
        choices.push({
          text: outcome.label,
          to: edge.to,
          ...(outcome.stateChange ? { stateChange: outcome.stateChange } : {}),
        });
      }
    }
  }

  // 介入点：非 CHOICE 的互动（点击 / 长按 / 找线索），播完本幕弹出来，做完继续走 next
  const actionNode = interactions.find((i) => i.kind.toUpperCase() !== 'CHOICE');
  const actionOutcome = actionNode?.outcomes[0];
  const interaction: ScriptInteraction | undefined = actionNode
    ? {
        kind: actionNode.kind,
        prompt: actionNode.prompt,
        ...(actionOutcome?.feedback ? { feedback: actionOutcome.feedback } : {}),
        ...(actionOutcome?.stateChange ? { stateChange: actionOutcome.stateChange } : {}),
      }
    : undefined;

  const isEnding = nextClips.length === 0 && choices.length === 0 && endings.length > 0;

  let ending: ScriptScene['ending'];
  if (isEnding) {
    // 元数据展示优先体现高阶胜局（TE > HE > SE > NE > BE）
    const ranked = [...endings].sort(
      (a, b) =>
        (a.isVictory ? 0 : 10) +
        (ENDING_TYPE_RANK[a.endingType] ?? 5) -
        ((b.isVictory ? 0 : 10) + (ENDING_TYPE_RANK[b.endingType] ?? 5))
    );
    const primary = ranked[0];
    const branchClip = isBranchClipId(clipId, prd);
    const rewindCandidate = endings.find((e) => !e.isVictory && (e.rewindTargetClipId || branchClip));
    const rewindClipId = rewindCandidate?.rewindTargetClipId || deriveRewindClipFromWiring(prd, clipId);
    ending = {
      type: primary.endingType,
      title: primary.title,
      ...(primary.summary ? { verdict: primary.summary } : {}),
      ...(rewindClipId && clipIdSet.has(rewindClipId) ? { rewindTo: rewindClipId } : {}),
    };
  }

  const nextClip = !isEnding && choices.length === 0 ? nextClips[0] : undefined;

  return {
    sceneId: clipId,
    title,
    ...(choices.length > 0 ? { choices } : {}),
    ...(interaction ? { interaction } : {}),
    ...(nextClip ? { next: nextClip } : {}),
    ...(ending ? { ending } : {}),
  };
}

/**
 * 清洗 story.md 正文里的排版残留，只做格式清理，不改写、不压缩任何内容：
 * - 丢掉小标题行（`## / ###` 开头）与单独成行的加粗标题（`**黄金主干剧情**`）
 * - 去掉强调标记 `**`、行首引用符 `>` 与分隔线
 */
export function cleanNarrative(text: string): string {
  const kept: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      kept.push('');
      continue;
    }
    if (/^#{1,6}\s/.test(line)) continue;
    if (/^\*\*[^*]+\*\*$/.test(line)) continue;
    if (/^-{3,}$/.test(line)) continue;
    kept.push(line.replace(/\*\*/g, '').replace(/^>\s*/, ''));
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 全量装配：素材（图 + 字）与剧本（玩法 + 路由）分开产出，各写各的文件。
 */
export function assembleScenes(input: SceneAssemblyInput): {
  scenes: SingleSceneJson[];
  script: StoryScript;
  missingLocationSceneIds: string[];
  multiLocationSceneIds: string[];
} {
  const { projectId, prd, storyMarkdown, lookdev } = input;
  const storyMap = parseStorySections(storyMarkdown);

  // sceneId → location（由 lookdev 里每个场景自带的 sceneIds 反查，不靠名字匹配）
  const locationByScene = new Map<string, GlobalEntities['locations'][number]>();
  // 同一幕被多个场景登记 = 这一幕跨了空间（首归属按场景出现顺序取，其余视为收尾空间）
  const locationHits = new Map<string, string[]>();
  for (const loc of lookdev.locations || []) {
    for (const sid of loc.sceneIds || []) {
      const hits = locationHits.get(sid) || [];
      hits.push(loc.locationId);
      locationHits.set(sid, hits);
      if (!locationByScene.has(sid)) locationByScene.set(sid, loc);
    }
  }
  const multiLocationSceneIds = [...locationHits.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([sid]) => sid);

  const missingLocationSceneIds: string[] = [];
  // 幕标题只有一份推导：素材与播放表共用，HUD 直接读播放表条目即可
  const titleOf = (clipId: string, clipTitle: string): string =>
    storyMap.get(clipId)?.title || clipTitle || clipId;

  const scenes: SingleSceneJson[] = prd.clips.map((clip) => {
    const sceneId = clip.id;
    const section = storyMap.get(sceneId);
    const body = cleanNarrative(section?.narrativeText || '');
    const loc = locationByScene.get(sceneId);
    if (!loc) missingLocationSceneIds.push(sceneId);

    return {
      sceneId,
      title: titleOf(sceneId, clip.title),
      background: loc?.referenceImageUrl || '',
      text: body,
    };
  });

  const script: StoryScript = {
    startSceneId: prd.startNodeId || prd.clips[0]?.id || 'S1',
    initialState: (prd.initialState || {}) as StoryScript['initialState'],
    scenes: prd.clips.map((clip) => buildScriptScene(clip.id, prd, titleOf(clip.id, clip.title))),
  };

  return { scenes, script, missingLocationSceneIds, multiLocationSceneIds };
}

export async function executeSceneAssemblyStep(
  input: SceneAssemblyInput
): Promise<SceneAssemblyOutput> {
  const { projectId } = input;
  const { scenes, script, missingLocationSceneIds, multiLocationSceneIds } = assembleScenes(input);

  if (missingLocationSceneIds.length > 0) {
    console.warn(
      `[SceneAssembly] 以下剧幕没有归属场景，background 为空: ${missingLocationSceneIds.join(', ')}`
    );
  }
  if (multiLocationSceneIds.length > 0) {
    console.warn(
      `[SceneAssembly] 以下剧幕跨越了多个场景（装配取首归属，其余空间留待拆镜头）: ${multiLocationSceneIds.join(', ')}`
    );
  }

  const projectDir = ProjectStore.getInstance().getProjectDir(projectId);
  const scenesDir = path.resolve(projectDir, 'scenes');
  fs.mkdirSync(scenesDir, { recursive: true });
  for (const scene of scenes) {
    fs.writeFileSync(
      path.resolve(scenesDir, `${scene.sceneId}.json`),
      JSON.stringify(scene, null, 2),
      'utf-8'
    );
  }
  fs.writeFileSync(
    path.resolve(scenesDir, 'script.json'),
    JSON.stringify(script, null, 2),
    'utf-8'
  );

  const sceneIdSet = new Set(scenes.map((s) => s.sceneId));
  const usedLocationIds = new Set(
    (input.lookdev.locations || [])
      .filter((l) => (l.sceneIds || []).some((id) => sceneIdSet.has(id)))
      .map((l) => l.locationId)
  );
  const unusedLocations = (input.lookdev.locations || [])
    .map((l) => l.locationId)
    .filter((id) => !usedLocationIds.has(id));
  const interactionCount = script.scenes.filter((s) => s.interaction).length;
  const choiceCount = script.scenes.filter((s) => (s.choices?.length || 0) > 0).length;
  const endingCount = script.scenes.filter((s) => s.ending).length;

  const summary =
    `装配 ${scenes.length} 幕 / 使用 ${usedLocationIds.size} 个场景 / ` +
    `介入点 ${interactionCount} 处 / 岔口 ${choiceCount} 处 / 终局 ${endingCount} 个` +
    (unusedLocations.length > 0 ? `（${unusedLocations.length} 个场景未被引用：${unusedLocations.join(',')}）` : '') +
    (missingLocationSceneIds.length > 0
      ? `；${missingLocationSceneIds.length} 幕缺背景图（${missingLocationSceneIds.join(',')}）`
      : '') +
    (multiLocationSceneIds.length > 0
      ? `；${multiLocationSceneIds.length} 幕跨场景（${multiLocationSceneIds.join(',')}）`
      : '');

  return { scenes, script, summary };
}

export const sceneAssemblyStep = createStep({
  id: 'scene-assembly-step',
  inputSchema: SceneAssemblyInputSchema,
  outputSchema: SceneAssemblyOutputSchema,
  execute: async ({ context }) => {
    return await runTaskRecordedStep('scene-assembly-step', async () => {
      const ctx = context as any;
      const trigger = ctx.triggerData || ctx;
      // 母本图（含场景空镜链接）由定妆出图工序回填；提取工序只有文字，作为兜底
      const lookdev =
        ctx.steps?.['lookdev-render-step']?.output?.entities ||
        ctx.steps?.['lookdev-extract-step']?.output?.entities ||
        trigger.lookdev;
      return await executeSceneAssemblyStep({
        projectId: trigger.projectId || ctx.projectId,
        title: trigger.title,
        prd: trigger.prd,
        storyMarkdown: trigger.storyMarkdown,
        lookdev,
      });
    });
  },
});
