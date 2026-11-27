/**
 * tools/game-assembly/shared/story-compiler.ts
 * 互动影游静态剧本数据编译与底座同步器（供 assembly-tool 与 compile-story-tool 共同依赖）
 */

import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { resolveProjectStorySource } from '../../../project-store/story-source.js';
import type { UniversalPrdSpec } from '../../../project-store/contracts/planner/index.js';
import { RUNTIME_FILES } from '../assembly-tool/steps/02-codegen/runtime-files.js';

export interface StoryBundle {
  projectId: string;
  title: string;
  subtitle: string;
  logline: string;
  startClipId: string;
  uiTheme: {
    genreMood: string;
    hudStyle: string;
    palette: {
      primary: string;
      accent: string;
      surface: string;
      danger: string;
    };
  };
  stateSchema: Record<
    string,
    { label: string; type: string; max?: number; visibleInHud?: boolean }
  >;
  initialState: Record<string, unknown>;
  clips: any[];
  endings: any[];
  wiring: any[];
}

export interface CompileStoryInput {
  projectId: string;
  title?: string;
  prd?: any;
  scenes?: any[];
  script?: any;
  startNodeId?: string;
}

const DEFAULT_STATE_LABELS: Record<string, string> = {
  hp: '生命值',
  health: '生命值',
  sanity: '理智值',
  clue: '线索数',
  clues: '线索数',
  trust: '信任度',
  courage: '勇气值',
  suspicion: '怀疑度',
  evidence: '关键物证',
  key: '钥匙',
};

export function generateIndexHtml(title: string): string {
  const safeTitle = String(title || '互动影游').replace(/[<>]/g, '');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="./runtime/player.css" />
  <link rel="stylesheet" href="./style.css" />
</head>
<body>
  <div id="app"></div>
  <script type="module" src="./js/main.js"></script>
</body>
</html>
`;
}

function buildStateSchema(
  prd: any,
  initialState: Record<string, unknown>
): StoryBundle['stateSchema'] {
  const schema: StoryBundle['stateSchema'] = {};
  const prdSchema = prd?.stateSchema || {};
  for (const [key, def] of Object.entries(prdSchema)) {
    const d = def as any;
    schema[key] = {
      label: d?.label || DEFAULT_STATE_LABELS[key.toLowerCase()] || key,
      type: d?.type || (typeof initialState[key] === 'boolean' ? 'flag' : 'number'),
      ...(typeof d?.max === 'number' ? { max: d.max } : {}),
      visibleInHud: d?.visibleInHud !== false,
    };
  }
  for (const [key, val] of Object.entries(initialState)) {
    if (!schema[key]) {
      schema[key] = {
        label: DEFAULT_STATE_LABELS[key.toLowerCase()] || key,
        type: typeof val === 'boolean' ? 'flag' : 'number',
        visibleInHud: true,
      };
    }
  }
  return schema;
}

export function compileStoryBundle(
  input: CompileStoryInput,
  store: ProjectStore
): StoryBundle {
  const effectivePrd: UniversalPrdSpec | undefined =
    input.prd || store.getArtifact(input.projectId, 'prd') || (resolveProjectStorySource(input.projectId) as any);
  const prdAny = (effectivePrd || {}) as any;

  const title = input.title || prdAny.gameTitle || '未命名互动影游';
  const subtitle = prdAny.subtitle || prdAny.genre || '互动电影体验';
  const logline =
    prdAny.logline ||
    prdAny.premise ||
    '每一个选择都将改写命运轨迹，请谨慎做出你的决定。';
  const startClipId =
    input.startNodeId ||
    input.script?.startSceneId ||
    prdAny.startNodeId ||
    'S1';
  const initialState =
    input.script?.initialState || prdAny.initialState || {};

  const uiTheme = {
    genreMood: prdAny.uiTheme?.genreMood || '电影级悬疑沉浸',
    hudStyle: prdAny.uiTheme?.hudStyle || 'minimal-cinematic',
    palette: {
      primary: prdAny.uiTheme?.palette?.primary || '#e6eef8',
      accent: prdAny.uiTheme?.palette?.accent || '#f59e0b',
      surface: prdAny.uiTheme?.palette?.surface || 'rgba(12, 16, 24, 0.86)',
      danger: prdAny.uiTheme?.palette?.danger || '#ef4444',
    },
  };

  const filmSpec: any = store.getArtifact(input.projectId, 'film_spec');
  const lookdevEntities: any = store.getArtifact(
    input.projectId,
    'lookdev_entities'
  );
  const storyData: any = store.getArtifact(input.projectId, 'story');

  const itemImgByName = new Map<string, string>();
  for (const item of lookdevEntities?.items || []) {
    const img = item?.imageUrl || item?.url;
    if (item?.name && img) itemImgByName.set(String(item.name).trim(), img);
  }

  const endings: any[] = Array.isArray(prdAny.endings)
    ? prdAny.endings.map((ed: any) => ({
        id: ed.id,
        endingType: ed.endingType || ed.type || 'NEUTRAL',
        title: ed.title || '结局',
        summary: ed.summary || ed.verdict || '',
        rewindTargetClipId: ed.rewindTargetClipId || null,
      }))
    : [];

  const endingMap = new Map<string, any>();
  for (const ed of endings) {
    endingMap.set(ed.id, {
      id: ed.id,
      endingType: ed.endingType,
      type: ed.endingType,
      title: ed.title,
      summary: ed.summary,
      verdict: ed.summary,
      rewindTargetClipId: ed.rewindTargetClipId,
      rewindTo: ed.rewindTargetClipId,
    });
  }

  const wiring: any[] = Array.isArray(prdAny.wiring) ? prdAny.wiring : [];
  let clips: any[] = [];

  const providedScenes: any[] =
    input.scenes && input.scenes.length
      ? input.scenes
      : input.script?.scenes || [];

  if (providedScenes.length > 0 && !prdAny.clips?.length) {
    clips = providedScenes.map((s: any) => ({
      id: s.sceneId || s.id,
      sceneId: s.sceneId || s.id,
      title: s.title || s.sceneId || '未命名幕',
      text: s.text || s.narrativeText || '',
      background: s.background || s.backgroundImageUrl || '',
      videoUrl: s.videoUrl || undefined,
      interaction: s.interaction || undefined,
      next: s.next || undefined,
      ending: s.ending || undefined,
    }));
  } else if (prdAny.clips?.length) {
    const interactionMap = new Map<string, any>();
    for (const inter of prdAny.interactions || []) {
      interactionMap.set(inter.id, inter);
    }
    const providedById = new Map<string, any>();
    for (const s of providedScenes) {
      const sid = s.sceneId || s.id;
      if (sid) providedById.set(sid, s);
    }

    clips = prdAny.clips.map((c: any) => {
      const clipId = c.id || c.clipId;
      const filmAct = (filmSpec?.acts || []).find(
        (a: any) => a.clipId === clipId
      );
      const storySection = storyData?.[clipId];
      const provided = providedById.get(clipId);

      const clipOutEdge = wiring.find((w: any) => w.from === clipId);
      let nextClipId: string | null = provided?.next || null;
      let attachedInteraction: any = provided?.interaction || null;
      let attachedEnding: any = provided?.ending || c.ending || null;

      if (clipOutEdge) {
        if (interactionMap.has(clipOutEdge.to)) {
          const inter = interactionMap.get(clipOutEdge.to);
          const interEdges = wiring.filter((w: any) => w.from === inter.id);
          const mappedOutcomes = (inter.outcomes || []).map((o: any) => {
            const edge = interEdges.find((w: any) => w.onOutcome === o.key);
            const targetId = edge?.to;
            const targetEnding = targetId ? endingMap.get(targetId) : undefined;
            return {
              key: o.key,
              label: o.label,
              ...(targetEnding
                ? { ending: targetEnding, endingId: targetEnding.id }
                : targetId
                  ? { to: targetId }
                  : {}),
              ...(o.stateChange ? { stateChange: o.stateChange } : {}),
              ...(o.feedback ? { feedback: o.feedback } : {}),
            };
          });

          const hydratedConfig = inter.config
            ? {
                ...inter.config,
                targets: Array.isArray(inter.config.targets)
                  ? inter.config.targets.map((t: any) => ({
                      ...t,
                      imageUrl:
                        t.imageUrl ||
                        itemImgByName.get(String(t.name || '').trim()),
                    }))
                  : undefined,
                decoys: Array.isArray(inter.config.decoys)
                  ? inter.config.decoys.map((d: any) => ({
                      ...d,
                      imageUrl:
                        d.imageUrl ||
                        itemImgByName.get(String(d.name || '').trim()),
                    }))
                  : undefined,
              }
            : undefined;

          attachedInteraction = {
            id: inter.id,
            kind: inter.kind,
            isBranching: inter.isBranching,
            prompt: inter.prompt,
            timeoutSec: inter.timeoutSec ?? null,
            ...(hydratedConfig ? { config: hydratedConfig } : {}),
            outcomes: mappedOutcomes,
          };
        } else if (endingMap.has(clipOutEdge.to)) {
          attachedEnding = endingMap.get(clipOutEdge.to);
        } else {
          nextClipId = clipOutEdge.to;
        }
      }

      return {
        id: clipId,
        sceneId: clipId,
        title: c.title || provided?.title || clipId,
        text:
          storySection?.narrativeText ||
          provided?.text ||
          c.narrativeText ||
          c.title ||
          '',
        background:
          filmAct?.firstFrameUrl ||
          provided?.background ||
          c.backgroundImageUrl ||
          '',
        videoUrl: filmAct?.videoUrl || provided?.videoUrl || undefined,
        ...(attachedInteraction ? { interaction: attachedInteraction } : {}),
        ...(nextClipId ? { next: nextClipId } : {}),
        ...(attachedEnding ? { ending: attachedEnding } : {}),
      };
    });
  }

  return {
    projectId: input.projectId,
    title,
    subtitle,
    logline,
    startClipId,
    uiTheme,
    stateSchema: buildStateSchema(prdAny, initialState),
    initialState,
    clips,
    endings,
    wiring,
  };
}

export async function executeCompileStoryOnly(input: {
  projectId: string;
  title?: string;
}) {
  const store = ProjectStore.getInstance();
  const projectDir = store.getProjectDir(input.projectId);
  const gameAssemblyDir = path.resolve(projectDir, 'game-assembly');
  const bundle = compileStoryBundle({ projectId: input.projectId, title: input.title, scenes: [] }, store);

  fs.mkdirSync(gameAssemblyDir, { recursive: true });
  const writtenFiles: string[] = [];

  for (const file of RUNTIME_FILES) {
    const rel = file.path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').trim();
    const target = path.resolve(gameAssemblyDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, 'utf-8');
    writtenFiles.push(`game-assembly/${rel}`);
  }

  const storyPath = path.resolve(gameAssemblyDir, 'story.json');
  fs.writeFileSync(storyPath, JSON.stringify(bundle, null, 2), 'utf-8');
  writtenFiles.push('game-assembly/story.json');

  const indexHtmlPath = path.resolve(gameAssemblyDir, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    fs.writeFileSync(indexHtmlPath, generateIndexHtml(bundle.title), 'utf-8');
    writtenFiles.push('game-assembly/index.html');
  }

  return {
    projectId: input.projectId,
    generatedFiles: writtenFiles,
    rounds: 1,
    indexPath: path.relative(projectDir, indexHtmlPath).split(path.sep).join('/'),
    success: true,
  };
}
