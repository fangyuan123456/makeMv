/**
 * api/routes/projects.route.ts
 * 项目工程管理与资产查询路由 (Projects Domain Route)
 */

import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { STAGE, PLANNER_STEP, readArtifactFile } from '../../project-store/artifact-fs.js';
import { parseUniversalPrdFromMarkdown } from '../../workflows/steps/build-game-assembly.step.js';
import {
  convertScenesToGameAssemblyArtifact,
  type SingleSceneJson,
  type StoryScript,
  type GlobalEntities,
} from '../../agents/game-assembly/index.js';
import type { UniversalPrdSpec } from '../../project-store/contracts/planner/index.js';
import type { GDDArtifact, NarrativeBeat, CharacterSpec } from '../../agents/planner/schema.js';
import { sendError } from '../helpers.js';

export const projectsRouter = Router();
const store = ProjectStore.getInstance();

function parseStorySections(markdown: string): Map<string, { title: string; narrativeText: string }> {
  const map = new Map<string, { title: string; narrativeText: string }>();
  for (const block of markdown.split(/(?=^##\s+)/m)) {
    const heading = block.match(/^##\s+([^\n]+)/)?.[1]?.trim() || '';
    const id = heading.match(/\b(S\d+(?:\.\d+)?)\b/i)?.[1];
    if (id) map.set(id, { title: heading || id, narrativeText: block.replace(/^##[^\n]*\n?/, '').trim() });
  }
  return map;
}

function buildGddViewFromPrd(
  prd: UniversalPrdSpec,
  prdMarkdown: string,
  storyMarkdown: string,
  spineScript: string,
  entities?: GlobalEntities
): GDDArtifact {
  const storySections = parseStorySections(storyMarkdown);
  const clipSet = new Set(prd.clips.map((c) => c.id));
  const interMap = new Map(prd.interactions.map((i) => [i.id, i]));
  const endingMap = new Map(prd.endings.map((e) => [e.id, e]));

  const variables: GDDArtifact['globalStateMachine']['variables'] = {};
  const flags: GDDArtifact['globalStateMachine']['flags'] = {};
  const inventory: string[] = [];

  for (const [key, val] of Object.entries(prd.initialState || {})) {
    if (typeof val === 'number') {
      variables[key] = { name: key, initial: val, min: Math.min(0, val), max: Math.max(100, Math.abs(val) * 2) };
    } else if (typeof val === 'boolean') {
      flags[key] = { name: key, initial: val };
    } else if (Array.isArray(val)) {
      inventory.push(...val.map(String));
    }
  }

  const characters: CharacterSpec[] =
    entities?.characters && entities.characters.length > 0
      ? entities.characters.map((c) => ({
          characterId: c.characterId,
          name: c.name,
          role: c.identity,
          appearance: c.appearanceSummary,
          personality: '',
        }))
      : [
          {
            characterId: 'char_protagonist',
            name: '主角',
            role: prd.playerIdentity || '第一视角亲历者',
            appearance: '',
            personality: '',
          },
        ];

  const beatOutline: NarrativeBeat[] = prd.clips.map((clip, idx) => {
    const sec = storySections.get(clip.id);
    const interEdges = prd.wiring.filter((w) => w.from === clip.id && interMap.has(w.to));
    const interactions = interEdges.map((w) => interMap.get(w.to)!);
    const branchExpectations = prd.wiring
      .filter((w) => w.from === clip.id || interactions.some((i) => i.id === w.from))
      .filter((w) => clipSet.has(w.to) || endingMap.has(w.to))
      .map((w) => ({
        intent: w.transition?.text || (endingMap.has(w.to) ? `达成【${endingMap.get(w.to)!.title}】` : `前往 ${w.to}`),
        targetBeatId: w.to,
        isLoopBack: Boolean(endingMap.get(w.to)?.rewindTargetClipId),
      }));

    const clipEnding = prd.wiring
      .filter((w) => w.from === clip.id || interactions.some((i) => i.id === w.from))
      .map((w) => endingMap.get(w.to))
      .find(Boolean);

    return {
      beatId: clip.id,
      act: `第 ${idx + 1} 幕`,
      title: sec?.title || clip.title,
      dramaticGoal: (sec?.narrativeText || clip.title).slice(0, 100),
      gameplayTask: interactions[0]?.prompt || '沉浸观赏与交互',
      keyConflicts: interactions[interactions.length - 1]?.prompt || '剧情推进',
      branchExpectations,
      isEnding: Boolean(clipEnding && !branchExpectations.some((b) => clipSet.has(b.targetBeatId))),
      endingTheme: clipEnding ? `${clipEnding.endingType}｜${clipEnding.title}` : undefined,
    };
  });

  return {
    schemaVersion: '4.0.0',
    title: prd.gameTitle,
    genre: prd.genre,
    hook: prd.premiseAndPerspective,
    playerRole: prd.playerIdentity,
    coreLoop: prd.gameplayAndVictorySummary,
    markdown: prdMarkdown,
    storyMarkdown,
    spineScript,
    prd,
    storySections: Object.fromEntries(storySections),
    globalStateMachine: {
      philosophy: prd.outOfFlowSummary,
      variables,
      flags,
      inventory,
    },
    characters,
    beatOutline,
  };
}

function hydrateDiskArtifactsView(projectId: string, baseArtifacts: Record<string, any>, fallbackTitle: string) {
  const artifacts: Record<string, any> = { ...baseArtifacts };
  const projectDir = store.getProjectDir(projectId);
  const entitiesPath = path.join(projectDir, 'scenes', 'entities.json');
  let entities: GlobalEntities | undefined;
  if (fs.existsSync(entitiesPath)) {
    try {
      entities = JSON.parse(fs.readFileSync(entitiesPath, 'utf-8'));
    } catch {}
  }

  let parsedPrd: UniversalPrdSpec | undefined;
  const prdMd = readArtifactFile(projectId, 'delivery', STAGE.planner, PLANNER_STEP.prd, 'prd.md');
  const storyMd = readArtifactFile(projectId, 'delivery', STAGE.planner, PLANNER_STEP.prd, 'story.md') || '';
  const memSpine = store.getArtifact<{ spineScript?: string }>(projectId, 'planner_spine')?.spineScript;
  const spineMd =
    memSpine ||
    readArtifactFile(projectId, 'debug', STAGE.planner, PLANNER_STEP.spine, 'planner_spine.md') ||
    '';
  if (prdMd) {
    try {
      parsedPrd = parseUniversalPrdFromMarkdown(prdMd);
      if (!artifacts.gdd) {
        artifacts.gdd = buildGddViewFromPrd(parsedPrd, prdMd, storyMd, spineMd, entities);
      } else {
        artifacts.gdd = {
          ...artifacts.gdd,
          prd: artifacts.gdd.prd || parsedPrd,
          spineScript: artifacts.gdd.spineScript || spineMd,
          storySections:
            artifacts.gdd.storySections || Object.fromEntries(parseStorySections(storyMd)),
        };
      }
    } catch (err) {
      console.warn(`[projects.route] 从磁盘恢复项目 [${projectId}] PRD 失败:`, err);
    }
  }

  if (!artifacts.text_game) {
    const scenesDir = path.join(projectDir, 'scenes');
    if (fs.existsSync(scenesDir)) {
      const files = fs
        .readdirSync(scenesDir)
        .filter((f) => f.endsWith('.json') && f !== 'entities.json' && f !== 'script.json');
      if (files.length > 0) {
        const sceneMap = new Map<string, SingleSceneJson>();
        for (const f of files) {
          try {
            const scene = JSON.parse(fs.readFileSync(path.join(scenesDir, f), 'utf-8')) as SingleSceneJson;
            if (scene?.sceneId) sceneMap.set(scene.sceneId, scene);
          } catch {}
        }
        const orderedIds = parsedPrd
          ? parsedPrd.clips.map((c) => c.id).filter((id) => sceneMap.has(id))
          : [...sceneMap.keys()].sort();
        const orderedScenes = orderedIds.map((id) => sceneMap.get(id)!).filter(Boolean);
        if (orderedScenes.length > 0) {
          const scriptPath = path.join(scenesDir, 'script.json');
          const script: StoryScript = fs.existsSync(scriptPath)
            ? (JSON.parse(fs.readFileSync(scriptPath, 'utf-8')) as StoryScript)
            : {
                startSceneId: orderedScenes[0].sceneId,
                initialState: {},
                scenes: [],
              };
          artifacts.text_game = convertScenesToGameAssemblyArtifact(
            parsedPrd?.gameTitle || fallbackTitle || '互动短剧',
            orderedScenes,
            script
          );
        }
      }
    }
  }

  const indexHtmlPath = path.join(projectDir, 'game-assembly', 'index.html');
  artifacts.hasStandaloneGame = fs.existsSync(indexHtmlPath);
  return artifacts;
}

/**
 * 列出所有项目元数据
 */
projectsRouter.get('/', (_req, res) => {
  const list = store.listProjects();
  res.json(list);
});

/**
 * 获取指定项目的完整工程详情与资产
 */
projectsRouter.get('/:id', (req, res) => {
  try {
    const proj = store.getProject(req.params.id);
    const artifacts = hydrateDiskArtifactsView(req.params.id, proj.artifacts || {}, proj.meta?.title);
    res.json({
      ...proj,
      artifacts,
    });
  } catch (err: any) {
    sendError(res, 500, err.message);
  }
});
