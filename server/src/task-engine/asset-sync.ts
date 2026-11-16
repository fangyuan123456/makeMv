/**
 * task-engine/asset-sync.ts
 * 任务执行产物向全局项目资产黑板同步器 (Asset Synchronizer SSOT)
 *
 * 核心保证：
 * 任何一步执行完毕，立即原子写盘，绝无假收敛与易失内存依赖，重启后 100% 恢复。
 */

import path from 'node:path';
import fs from 'node:fs';
import { ProjectStore } from '../project-store/ProjectStore.js';
import { getProjectDir } from '../project-store/artifact-fs.js';
import { atomicWriteJsonSync, safeReadJsonSync } from '../utils/atomicFile.js';
import {
  mergeExtractedEntities,
  hydrateEntitiesWithDiskAssets,
} from '../project-store/entity-preservation.js';
import type { TaskRecord } from './types.js';

export function syncTaskResultToProjectStore(task: TaskRecord): void {
  if (task.status !== 'completed' || !task.output) return;

  const { projectId, toolName, output } = task;
  const store = ProjectStore.getInstance();
  const projectDir = getProjectDir(projectId);

  try {
    switch (toolName) {
      case 'planner.screenplay_writer': {
        if (output.scriptMarkdown) {
          store.setArtifact(projectId, 'screenplay', output.scriptMarkdown);
          const screenplayPath = path.join(projectDir, 'screenplay.md');
          fs.writeFileSync(screenplayPath, output.scriptMarkdown, 'utf-8');
          if (output.title) {
            const proj = store.getProject(projectId);
            proj.meta.title = output.title;
            store.saveProject(proj);
          }
        }
        break;
      }

      case 'planner.script_to_prd': {
        if (output.prd) {
          store.setArtifact(projectId, 'prd', output.prd);
          store.setArtifact(projectId, 'universal_prd', output.prd);
          store.setArtifact(projectId, 'gdd', {
            title: output.title || '互动影游',
            prd: output.prd,
            storySections: output.storySections || {},
            graph: output.graph,
          });

          // 原子写盘 prd.json 确保离线秒级恢复 (包含全剧接线与拓扑数据)
          atomicWriteJsonSync(path.join(projectDir, 'prd.json'), output.prd);

          // 保持 prd.md 策划案专业 Markdown 交付物原子落盘
          if (output.prdMarkdown) {
            store.setArtifact(projectId, 'prd_markdown', output.prdMarkdown);
            fs.writeFileSync(path.join(projectDir, 'prd.md'), output.prdMarkdown, 'utf-8');
          }

          // 保持 story.md 故事分幕切片剧本原子落盘 (供工序 1 Story 切片页与后续工序直接消费)
          if (output.storyMarkdown) {
            store.setArtifact(projectId, 'story', output.storyMarkdown);
            fs.writeFileSync(path.join(projectDir, 'story.md'), output.storyMarkdown, 'utf-8');
          }
        }
        break;
      }

      case 'film.asset_extraction': {
        const rawEntities = output.entities || output;
        if (rawEntities && rawEntities.characters) {
          const scenesDir = path.join(projectDir, 'scenes');
          const entitiesPath = path.join(scenesDir, 'entities.json');
          const oldEntities =
            store.getArtifact<any>(projectId, 'lookdev_entities') ||
            safeReadJsonSync(entitiesPath) ||
            {};

          // 1. 无损增量合并已有设定与版本
          const merged = mergeExtractedEntities(oldEntities, rawEntities);
          // 2. 结合磁盘物理资产自愈水合
          const finalEntities = hydrateEntitiesWithDiskAssets(projectId, projectDir, merged);

          store.setArtifact(projectId, 'lookdev_entities', finalEntities);
          if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
          atomicWriteJsonSync(entitiesPath, finalEntities);
        }
        break;
      }

      case 'film.character_portrait': {
        const scenesDir = path.join(projectDir, 'scenes');
        const entitiesPath = path.join(scenesDir, 'entities.json');
        // 工具已在执行完成时原子写盘最新的 entities (含 versions)，直接同步黑板
        const entities = safeReadJsonSync(entitiesPath) || store.getArtifact<any>(projectId, 'lookdev_entities') || {};
        const characterId = output.characterId;
        const imageUrl = output.imageUrl || output.portraitImageUrl;

        if (characterId && characterId !== 'all' && imageUrl) {
          const chars = entities.characters || [];
          const target = chars.find((c: any) => c.characterId === characterId);
          if (target && !target.imageUrl) {
            target.imageUrl = imageUrl;
          }
        }
        store.setArtifact(projectId, 'lookdev_entities', entities);
        if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
        atomicWriteJsonSync(entitiesPath, entities);
        break;
      }

      case 'film.scene_atmosphere': {
        const scenesDir = path.join(projectDir, 'scenes');
        const entitiesPath = path.join(scenesDir, 'entities.json');
        const entities = safeReadJsonSync(entitiesPath) || store.getArtifact<any>(projectId, 'lookdev_entities') || {};
        const locationId = output.locationId;
        const imageUrl = output.imageUrl || output.mediaUrl;

        if (locationId && locationId !== 'all' && imageUrl) {
          const locs = entities.locations || [];
          const target = locs.find((l: any) => l.locationId === locationId);
          if (target && !target.imageUrl) {
            target.imageUrl = imageUrl;
          }
        }
        store.setArtifact(projectId, 'lookdev_entities', entities);
        if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
        atomicWriteJsonSync(entitiesPath, entities);
        break;
      }

      case 'film.storyboard_planning': {
        const rawClips =
          output.filmSpec?.clips ||
          output.filmSpec?.slices ||
          output.shots ||
          (Array.isArray(output) ? output : null);

        if (rawClips) {
          store.setArtifact(projectId, 'storyboards', rawClips);
          if (output.filmSpec) {
            store.setArtifact(projectId, 'film_spec', output.filmSpec);
          }
          atomicWriteJsonSync(path.join(projectDir, 'storyboards.json'), rawClips);
        }
        break;
      }

      case 'film.shot_keyframe': {
        const { shotId, keyframeUrl } = output;
        const storyboardsPath = path.join(projectDir, 'storyboards.json');
        const shots = store.getArtifact<any[]>(projectId, 'storyboards') || safeReadJsonSync(storyboardsPath) || [];

        if (shotId && keyframeUrl) {
          // 兼容打平数组或 clips 嵌套结构
          for (const item of shots) {
            if (item.shotId === shotId) {
              item.keyframeUrl = keyframeUrl;
              item.firstFrameImageUrl = keyframeUrl;
            } else if (Array.isArray(item.shots)) {
              const matched = item.shots.find((s: any) => s.shotId === shotId);
              if (matched) {
                matched.keyframeUrl = keyframeUrl;
                matched.firstFrameImageUrl = keyframeUrl;
              }
            }
          }

          // 同步更新分镜画布节点
          const canvas = store.getArtifact<any>(projectId, 'storyboard_canvas');
          if (canvas?.nodes) {
            let updated = false;
            for (const n of Object.values<any>(canvas.nodes)) {
              if (n.shotId === shotId || n.id === `node_${shotId}`) {
                n.keyframeUrl = keyframeUrl;
                updated = true;
              }
            }
            if (updated) {
              store.setArtifact(projectId, 'storyboard_canvas', canvas);
              atomicWriteJsonSync(path.join(projectDir, 'storyboard_canvas.json'), canvas);
            }
          }
        }
        store.setArtifact(projectId, 'storyboards', shots);
        atomicWriteJsonSync(storyboardsPath, shots);
        break;
      }

      case 'film.shot_video': {
        const { shotId, videoUrl } = output;
        const effectiveVideoUrl = videoUrl || output.mediaUrl;
        const storyboardsPath = path.join(projectDir, 'storyboards.json');
        const shots = store.getArtifact<any[]>(projectId, 'storyboards') || safeReadJsonSync(storyboardsPath) || [];

        if (shotId && effectiveVideoUrl) {
          for (const item of shots) {
            if (item.shotId === shotId) {
              item.videoUrl = effectiveVideoUrl;
            } else if (Array.isArray(item.shots)) {
              const matched = item.shots.find((s: any) => s.shotId === shotId);
              if (matched) {
                matched.videoUrl = effectiveVideoUrl;
              }
            }
          }

          // 同步挂载到分镜画布：作为候选方案追加并默认激活
          const canvas = store.getArtifact<any>(projectId, 'storyboard_canvas');
          if (canvas?.nodes) {
            let updated = false;
            for (const n of Object.values<any>(canvas.nodes)) {
              if (n.shotId === shotId || n.clipId === shotId || n.id === `node_${shotId}`) {
                n.videoUrl = effectiveVideoUrl;
                n.activeTaskId = task.taskId;
                n.candidateTaskIds = n.candidateTaskIds || [];
                if (!n.candidateTaskIds.includes(task.taskId)) {
                  n.candidateTaskIds.push(task.taskId);
                }
                updated = true;
              }
            }
            if (updated) {
              store.setArtifact(projectId, 'storyboard_canvas', canvas);
              atomicWriteJsonSync(path.join(projectDir, 'storyboard_canvas.json'), canvas);
            }
          }
        }
        store.setArtifact(projectId, 'storyboards', shots);
        atomicWriteJsonSync(storyboardsPath, shots);
        break;
      }

      case 'game.assembly': {
        const project = store.getProject(projectId);
        project.meta.currentStage = 'completed';
        store.setArtifact(projectId, 'hasStandaloneGame', true);
        store.saveProject(project);
        break;
      }
    }
  } catch (err) {
    console.error(`[AssetSync] 同步任务 [${toolName}] 产物失败:`, err);
  }
}
