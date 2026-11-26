import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { safeReadJsonSync } from '../../utils/atomicFile.js';
import { hydrateEntitiesWithDiskAssets } from '../../project-store/entity-preservation.js';
import { computeProjectStaleMap } from '../../project-store/freshness.js';
import { parseStorySections } from '../../project-store/story-sections.js';
import { readFrameVersions, readVideoVersions } from '../../project-store/shot-frame-versions.js';
import { getReviewWithFreshness } from '../../tools/review/shared/review-store.js';
import { SCREENPLAY_REVIEW_KEY } from '../../tools/review/screenplay-review/index.js';
import { sendError } from '../helpers.js';

const store = ProjectStore.getInstance();

/** 读出时补齐镜头首/末帧与视频版本库，兼容「已有媒体但还没有版本记录」的旧项目 */
function withFrameVersions(shot: any): any {
  return {
    ...shot,
    firstFrameVersions: readFrameVersions(shot, 'first'),
    lastFrameVersions: readFrameVersions(shot, 'last'),
    videoVersions: readVideoVersions(shot),
  };
}

function normalizeStoryboards(clips: any): any {
  if (!Array.isArray(clips)) return clips;
  return clips.map((clip: any) =>
    Array.isArray(clip?.shots)
      ? { ...clip, shots: clip.shots.map(withFrameVersions) }
      : withFrameVersions(clip)
  );
}

export const getProjectSnapshot = (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const proj = store.getProject(projectId);
    const projectDir = store.getProjectDir(projectId);

    // 1. 视觉资产表 (结合物理磁盘图片自动自愈水合，确保定妆资产永不丢失)
    let rawEntities =
      store.getArtifact(projectId, 'lookdev_entities') ||
      safeReadJsonSync(path.join(projectDir, 'scenes', 'entities.json'));
    const entities = hydrateEntitiesWithDiskAssets(projectId, projectDir, rawEntities);

    // 2. 策划案 PRD (结构化数据)
    const prd = store.getArtifact(projectId, 'prd');

    // 3. 策划案 Markdown 原文 (含第 5 章界面规划与第 3 章接线 JSON)
    const prdMarkdown = store.getArtifact<string>(projectId, 'prd_markdown');

    // 4. 剧本正文与故事原文 (分幕黄金剧情与故事大纲)
    let screenplay = store.getArtifact<string>(projectId, 'screenplay');
    if (!screenplay) {
      const legacySpinePath = path.join(projectDir, '.debug', '01-planner', '01-write-spine-script', 'planner_spine.md');
      if (fs.existsSync(legacySpinePath)) {
        screenplay = fs.readFileSync(legacySpinePath, 'utf-8');
      }
    }

    // 4.1 分幕切片剧本全文 (Tool 2 产物：story.md)
    let story = store.getArtifact<string>(projectId, 'story');

    // 从分幕切片剧本或正文中提取故事分幕字典 (storySections) 并补全 clips 中的故事原文
    const storySections = parseStorySections(story || screenplay || '');

    if (prd && Array.isArray(prd.clips)) {
      prd.clips = prd.clips.map((c: any) => ({
        ...c,
        narrativeText: c.narrativeText || storySections[c.id]?.narrativeText || '',
      }));
    }

    // 5. 分镜列表 (优先 storyboards 字段，或从 film_spec.clips 中自动提取)
    let filmSpec = store.getArtifact<any>(projectId, 'film_spec') || safeReadJsonSync(path.join(projectDir, 'film_spec.json'));
    let storyboards = store.getArtifact<any[]>(projectId, 'storyboards');
    if (!storyboards) {
      if (filmSpec && Array.isArray(filmSpec.clips)) {
        storyboards = filmSpec.clips;
      }
    }
    // 确保 storyboards 中的 clip 如果自身缺少 shootingScript，能够从 filmSpec.clips 中补齐
    if (Array.isArray(storyboards) && filmSpec && Array.isArray(filmSpec.clips)) {
      for (const clip of storyboards) {
        if (!clip.shootingScript) {
          const fc = filmSpec.clips.find((c: any) => c.clipId === clip.clipId);
          if (fc?.shootingScript) {
            clip.shootingScript = fc.shootingScript;
          }
        }
      }
    }

    // 6. 游戏站点是否已生成 & 上下游脏状态追踪表
    const hasStandaloneGame = fs.existsSync(path.join(projectDir, 'game-assembly', 'index.html'));
    const staleMap = computeProjectStaleMap(projectId);
    const screenplayReview = getReviewWithFreshness(projectId, SCREENPLAY_REVIEW_KEY, screenplay || '');

    const storyboardsWithVersions = normalizeStoryboards(storyboards);

    res.json({
      ...proj,
      prd,
      prdMarkdown,
      screenplay,
      screenplayReview,
      story: story || screenplay,
      storySections,
      entities,
      storyboards: storyboardsWithVersions,
      staleMap,
      artifacts: {
        ...proj.artifacts,
        prd,
        prdMarkdown,
        screenplay,
        story: story || screenplay,
        storySections,
        lookdev_entities: entities,
        film_spec: filmSpec,
        storyboards: storyboardsWithVersions,
        hasStandaloneGame,
        staleMap,
      },
    });
  } catch (err: any) {
    sendError(res, 500, err.message);
  }
};
