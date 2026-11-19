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
import {
  recordEntityUpdated,
  recordPrdUpdated,
  recordScreenplayUpdated,
  recordShotKeyframeUpdated,
  recordShotVideoUpdated,
  recordStoryboardUpdated,
} from '../project-store/freshness.js';
import type { TaskRecord } from './types.js';
import { taskStore } from './task-store.js';

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
            if (output.genre) {
              proj.meta.genre = output.genre;
            }
            store.saveProject(proj);
          }

          // 全景剧本从 0 到 1 正向推演/重推时（非局部 Patch），自动重置下游旧的 PRD 拓扑与分幕资产，
          // 确保状态机精确转入 STEP_2_PENDING 重新以新剧本为唯一基准拆解 PRD，杜绝下游带着旧剧本脏资产假收敛
          if (!task.input?.instruction) {
            delete (store.getProject(projectId).artifacts as any).prd;
            delete (store.getProject(projectId).artifacts as any).universal_prd;
            delete (store.getProject(projectId).artifacts as any).prd_markdown;
            delete (store.getProject(projectId).artifacts as any).story;
            delete (store.getProject(projectId).artifacts as any).gdd;

            const staleFiles = ['prd.json', 'prd.md', 'story.md'];
            for (const f of staleFiles) {
              const p = path.join(projectDir, f);
              if (fs.existsSync(p)) {
                try {
                  fs.unlinkSync(p);
                } catch {}
              }
            }
          }
          // 记账剧本更新（局部 Patch 会让既有 PRD 精确标脏；全量重推已在上方清理旧 PRD）
          recordScreenplayUpdated(projectId);
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
          recordPrdUpdated(projectId);
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

          // 1. 无损增量合并已有设定与版本（支持 targetKinds 局部重提，未选中类别原样保留）
          const merged = mergeExtractedEntities(oldEntities, rawEntities, task.input?.targetKinds);
          // 2. 结合磁盘物理资产自愈水合
          const finalEntities = hydrateEntitiesWithDiskAssets(projectId, projectDir, merged);

          store.setArtifact(projectId, 'lookdev_entities', finalEntities);
          if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
          atomicWriteJsonSync(entitiesPath, finalEntities);
        }
        break;
      }

      case 'film.lookdev': {
        // 各渲染模块已逐项持久化；父任务完成后以磁盘资产清单同步项目黑板。
        const entitiesPath = path.join(projectDir, 'scenes', 'entities.json');
        const entities = safeReadJsonSync<any>(entitiesPath);
        if (!entities) throw new Error('定妆完成后缺少资产清单');
        store.setArtifact(projectId, 'lookdev_entities', entities);
        const { targetKind, targetId } = output;
        if (targetKind && targetId && ['character', 'location', 'item'].includes(targetKind)) {
          const list =
            targetKind === 'character'
              ? entities?.characters
              : targetKind === 'location'
              ? entities?.locations
              : entities?.items;
          const idKey = targetKind === 'character' ? 'characterId'
            : targetKind === 'location' ? 'locationId' : 'itemId';
          const matched = Array.isArray(list)
            ? list.find((e: any) => e[idKey] === targetId)
            : undefined;
          if (!matched) throw new Error(`定妆完成后找不到资产 ${targetKind} [${targetId}]`);
          const generatedVersion = matched?.versions?.find((version: any) => version.versionId === output.versionId);
          if (output.renderedCount && !generatedVersion) {
            throw new Error(`定妆完成后找不到生成版本 ${output.versionId}`);
          }
          if (output.renderedCount && generatedVersion?.reviewStatus !== 'pending') {
            recordEntityUpdated(projectId, { kind: targetKind, id: targetId, label: matched.name });
          }
        }
        break;
      }

      case 'film.image_upscale': {
        const targetKind = output.targetKind || task.input?.targetKind;
        const targetId = output.targetId || task.input?.targetId;
        if (targetKind === 'shot_keyframe' && targetId) {
          const isLastFrame = output.frame === 'last' || task.input?.frame === 'last';
          const multiplier = Number(output.multiplier || task.input?.multiplier || 2);
          const upscaledAt = new Date().toISOString();
          const mediaUrl =
            (isLastFrame ? output.lastFrameImageUrl : output.firstFrameImageUrl) || output.mediaUrl;

          // 同步更新分镜画布节点的高清地址与超分元数据，确保画布与 storyboards SSOT 一致
          const canvas = store.getArtifact<any>(projectId, 'storyboard_canvas');
          if (canvas?.nodes) {
            let updated = false;
            for (const n of Object.values<any>(canvas.nodes)) {
              if (n.shotId === targetId || n.id === `node_${targetId}`) {
                if (isLastFrame) {
                  if (mediaUrl) n.lastFrameUrl = mediaUrl;
                  n.lastFrameUpscale = { multiplier, upscaledAt };
                } else {
                  if (mediaUrl) n.keyframeUrl = mediaUrl;
                  n.firstFrameUpscale = { multiplier, upscaledAt };
                }
                updated = true;
              }
            }
            if (updated) {
              store.setArtifact(projectId, 'storyboard_canvas', canvas);
              atomicWriteJsonSync(path.join(projectDir, 'storyboard_canvas.json'), canvas);
            }
          }

          recordShotKeyframeUpdated(projectId, targetId, isLastFrame ? 'last' : 'first');
        } else if (targetKind && targetId && ['character', 'location', 'item'].includes(targetKind)) {
          const entitiesPath = path.join(projectDir, 'scenes', 'entities.json');
          const entities =
            safeReadJsonSync<any>(entitiesPath) || store.getArtifact<any>(projectId, 'lookdev_entities');
          if (entities) store.setArtifact(projectId, 'lookdev_entities', entities);
          const list =
            targetKind === 'character'
              ? entities?.characters
              : targetKind === 'location'
              ? entities?.locations
              : entities?.items;
          const matched = Array.isArray(list)
            ? list.find((e: any) => (e.characterId || e.locationId || e.itemId || e.id) === targetId)
            : undefined;
          recordEntityUpdated(projectId, { kind: targetKind, id: targetId, label: matched?.name || targetId });
        }
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
          const updatedClipIds = task.input?.clipId
            ? [String(task.input.clipId)]
            : rawClips.map((c: any) => c?.clipId || c?.id).filter(Boolean);
          recordStoryboardUpdated(projectId, updatedClipIds);
        }
        break;
      }

      case 'film.shot_keyframe': {
        const { shotId, firstFrameImageUrl, lastFrameImageUrl } = output;
        const storyboardsPath = path.join(projectDir, 'storyboards.json');
        const shots = store.getArtifact<any[]>(projectId, 'storyboards') || safeReadJsonSync(storyboardsPath) || [];

        if (shotId && (firstFrameImageUrl || lastFrameImageUrl)) {
          for (const item of shots) {
            const matched = item.shotId === shotId
              ? item
              : Array.isArray(item.shots)
              ? item.shots.find((s: any) => s.shotId === shotId)
              : undefined;
            if (matched) {
              if (firstFrameImageUrl) {
                matched.keyframeUrl = firstFrameImageUrl;
                matched.firstFrameImageUrl = firstFrameImageUrl;
                delete matched.firstFrameUpscale;
              }
              if (lastFrameImageUrl) {
                matched.lastFrameImageUrl = lastFrameImageUrl;
                delete matched.lastFrameUpscale;
              }
            }
          }

          // 同步更新分镜画布节点（重绘覆盖后清除对应帧的旧超分标记）
          const canvas = store.getArtifact<any>(projectId, 'storyboard_canvas');
          if (canvas?.nodes) {
            let updated = false;
            for (const n of Object.values<any>(canvas.nodes)) {
              if (n.shotId === shotId || n.id === `node_${shotId}`) {
                if (firstFrameImageUrl) {
                  n.keyframeUrl = firstFrameImageUrl;
                  delete n.firstFrameUpscale;
                }
                if (lastFrameImageUrl) {
                  n.lastFrameUrl = lastFrameImageUrl;
                  delete n.lastFrameUpscale;
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
        if (shotId && (firstFrameImageUrl || lastFrameImageUrl)) {
          recordShotKeyframeUpdated(
            projectId,
            shotId,
            firstFrameImageUrl && lastFrameImageUrl ? 'both' : lastFrameImageUrl ? 'last' : 'first'
          );
        }
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
        if (shotId && effectiveVideoUrl) {
          recordShotVideoUpdated(projectId, shotId);
        }
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

// 项目资产由任务账本事件统一投影，避免 Dispatcher 在多个终态分支中重复维护。
taskStore.onTaskEvent((event) => {
  if (event.status !== 'completed' || !event.output) return;
  syncTaskResultToProjectStore(event as unknown as TaskRecord);
});
