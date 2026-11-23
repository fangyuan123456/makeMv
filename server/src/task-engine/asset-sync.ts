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
  hydrateEntitiesWithDiskAssets,
} from '../project-store/entity-preservation.js';
import {
  recordEntityUpdated,
  recordPrdUpdated,
  recordScreenplayUpdated,
  recordShotKeyframeUpdated,
  recordShotPromptUpdated,
  recordShotVideoUpdated,
  recordStoryboardUpdated,
  recordEntitySpecUpdated,
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
            delete (store.getProject(projectId).artifacts as any).prd_markdown;
            delete (store.getProject(projectId).artifacts as any).story;

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

      case 'film.asset_manifest': {
        const manifest = output;
        if (manifest) {
          const scenesDir = path.join(projectDir, 'scenes');
          const entitiesPath = path.join(scenesDir, 'entities.json');
          const oldEntities =
            store.getArtifact<any>(projectId, 'lookdev_entities') ||
            safeReadJsonSync(entitiesPath) ||
            { artStyle: manifest.artStyle || '电影实拍质感', characters: [], locations: [], items: [] };

          const updatedEntities = structuredClone(oldEntities);
          updatedEntities.artStyle = manifest.artStyle || updatedEntities.artStyle;
          updatedEntities.characters = Array.isArray(updatedEntities.characters) ? updatedEntities.characters : [];
          updatedEntities.locations = Array.isArray(updatedEntities.locations) ? updatedEntities.locations : [];
          updatedEntities.items = Array.isArray(updatedEntities.items) ? updatedEntities.items : [];

          // 骨架并入：若已有对应名字实体则保留现有详细规格，若没有则创建新实体骨架
          for (const c of manifest.characters || []) {
            const found = updatedEntities.characters.find((item: any) => item.name === c.name);
            if (!found) {
              updatedEntities.characters.push({
                characterId: `char_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: c.name,
                identity: c.role || '',
                appearanceSummary: c.brief || '',
                promptZh: '',
                importance: c.importance || 'supporting',
              });
            }
          }

          for (const l of manifest.locations || []) {
            const found = updatedEntities.locations.find((item: any) => item.name === l.name);
            if (!found) {
              updatedEntities.locations.push({
                locationId: `loc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: l.name,
                atmosphere: l.brief || '',
                appearanceSummary: l.brief || '',
                promptZh: '',
                importance: l.importance || 'secondary',
                subScenes: l.subScenes || [],
              });
            } else {
              if (Array.isArray(l.subScenes) && l.subScenes.length > 0) {
                found.subScenes = Array.from(new Set([...(found.subScenes || []), ...l.subScenes]));
              }
            }
          }

          for (const i of manifest.items || []) {
            const found = updatedEntities.items.find((item: any) => item.name === i.name);
            if (!found) {
              updatedEntities.items.push({
                itemId: `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: i.name,
                description: i.brief || '',
                appearanceSummary: i.brief || '',
                promptZh: '',
              });
            }
          }

          // 显式精准删除防御：仅当创作者在结构化操作清单中显式下达 action === 'delete' 时，才允许剔除指定实体
          if (Array.isArray(task.input?.modifications) && task.input.modifications.length > 0) {
            for (const mod of task.input.modifications) {
              if (mod.action === 'delete') {
                if (mod.entityKind === 'character') {
                  updatedEntities.characters = updatedEntities.characters.filter(
                    (c: any) => (mod.targetId ? c.characterId !== mod.targetId : c.name !== mod.name)
                  );
                } else if (mod.entityKind === 'location') {
                  updatedEntities.locations = updatedEntities.locations.filter(
                    (l: any) => (mod.targetId ? l.locationId !== mod.targetId : l.name !== mod.name)
                  );
                } else if (mod.entityKind === 'item') {
                  updatedEntities.items = updatedEntities.items.filter(
                    (i: any) => (mod.targetId ? i.itemId !== mod.targetId : i.name !== mod.name)
                  );
                }
              }
            }
          }

          const hydrated = hydrateEntitiesWithDiskAssets(projectId, projectDir, updatedEntities);
          store.setArtifact(projectId, 'lookdev_entities', hydrated);
          if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
          atomicWriteJsonSync(entitiesPath, hydrated);
        }
        break;
      }

      case 'film.entity_spec': {
        const { targetKind, targetId, name, character, location, item } = output;
        if (targetKind && targetId) {
          const scenesDir = path.join(projectDir, 'scenes');
          const entitiesPath = path.join(scenesDir, 'entities.json');
          const entities =
            store.getArtifact<any>(projectId, 'lookdev_entities') ||
            safeReadJsonSync(entitiesPath) ||
            { artStyle: '电影实拍质感', characters: [], locations: [], items: [] };

          const updatedEntities = structuredClone(entities);
          if (targetKind === 'character' && character) {
            updatedEntities.characters = Array.isArray(updatedEntities.characters) ? updatedEntities.characters : [];
            const idx = updatedEntities.characters.findIndex((c: any) => (c.characterId || c.id) === targetId || c.name === name);
            if (idx >= 0) {
              updatedEntities.characters[idx] = { ...updatedEntities.characters[idx], ...character };
            } else {
              updatedEntities.characters.push(character);
            }
          } else if (targetKind === 'location' && location) {
            updatedEntities.locations = Array.isArray(updatedEntities.locations) ? updatedEntities.locations : [];
            const idx = updatedEntities.locations.findIndex((l: any) => (l.locationId || l.id) === targetId || l.name === name);
            if (idx >= 0) {
              updatedEntities.locations[idx] = { ...updatedEntities.locations[idx], ...location };
            } else {
              updatedEntities.locations.push(location);
            }
          } else if (targetKind === 'item' && item) {
            updatedEntities.items = Array.isArray(updatedEntities.items) ? updatedEntities.items : [];
            const idx = updatedEntities.items.findIndex((i: any) => (i.itemId || i.id) === targetId || i.name === name);
            if (idx >= 0) {
              updatedEntities.items[idx] = { ...updatedEntities.items[idx], ...item };
            } else {
              updatedEntities.items.push(item);
            }
          }

          const hydrated = hydrateEntitiesWithDiskAssets(projectId, projectDir, updatedEntities);
          store.setArtifact(projectId, 'lookdev_entities', hydrated);
          if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
          atomicWriteJsonSync(entitiesPath, hydrated);

          // 单实体时间戳标记更新（其他实体不动）
          recordEntitySpecUpdated(projectId, { kind: targetKind as any, id: targetId, label: name });
        }
        break;
      }

      case 'film.lookdev': {
        const entitiesPath = path.join(projectDir, 'scenes', 'entities.json');
        const entities = store.getArtifact<any>(projectId, 'lookdev_entities') || safeReadJsonSync<any>(entitiesPath);
        if (!entities) throw new Error('定妆完成后缺少资产清单');
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

      case 'film.shooting_script': {
        const { clipId, clipTitle, environmentLock, actionBeats } = output;
        if (clipId) {
          const filmSpec = store.getArtifact<any>(projectId, 'film_spec') || { clips: [] };
          filmSpec.clips = Array.isArray(filmSpec.clips) ? filmSpec.clips : [];
          let targetClip = filmSpec.clips.find((c: any) => c.clipId === clipId);
          if (!targetClip) {
            targetClip = { clipId, title: clipTitle || clipId, shots: [] };
            filmSpec.clips.push(targetClip);
          }
          if (clipTitle) targetClip.title = clipTitle;
          const shootingScriptData = {
            clipId,
            clipTitle,
            environmentLock,
            actionBeats,
            generatedAt: new Date().toISOString(),
          };
          targetClip.shootingScript = shootingScriptData;

          // 一步到位：将工业级台本节拍投影为原子镜头清单，无损保留已有已出图/视频产物
          const existingShots = Array.isArray(targetClip.shots) ? targetClip.shots : [];
          const existingMap = new Map(existingShots.map((s: any) => [s.shotId, s]));

          if (Array.isArray(actionBeats) && actionBeats.length > 0) {
            targetClip.shots = actionBeats.map((beat: any, idx: number) => {
              const shotId = `${clipId}-${String(beat.shotNumber || idx + 1).padStart(2, '0')}`;
              const old: any = existingMap.get(shotId) || {};
              return {
                ...old,
                shotId,
                clipId,
                shotIndex: idx,
                durationSec: beat.estimatedSeconds || 4,
                shotType: beat.cinematicIntent || 'MEDIUM_SHOT',
                cameraMovement: 'locked-off',
                generationMode: 'first_frame',
                characters: beat.characterIds || [],
                items: beat.itemIds || [],
                sceneSubject: beat.actionDescription,
                sliceSummary: beat.beatTitle,
                dialogue: beat.dialogue || '',
                audioPrompt: beat.audioAmbience || '',
                weatherDirective: environmentLock?.weatherDirective,
                firstFramePrompt: old.firstFramePrompt || '',
                videoPrompt: old.videoPrompt || '',
                keyframeUrl: old.keyframeUrl || old.firstFrameImageUrl,
                firstFrameImageUrl: old.firstFrameImageUrl,
                lastFrameImageUrl: old.lastFrameImageUrl,
                videoUrl: old.videoUrl,
                firstFrameUpscale: old.firstFrameUpscale,
                lastFrameUpscale: old.lastFrameUpscale,
              };
            });
          }

          store.setArtifact(projectId, 'film_spec', filmSpec);
          atomicWriteJsonSync(path.join(projectDir, 'film_spec.json'), filmSpec);

          // 核心：同步更新 storyboards 对应的 clip，确保前端通过 storyboards 或 storyboards.json 也能直接读取
          let storyboards = store.getArtifact<any[]>(projectId, 'storyboards');
          if (!Array.isArray(storyboards)) {
            const storyboardsPath = path.join(projectDir, 'storyboards.json');
            storyboards = safeReadJsonSync<any[]>(storyboardsPath) || [];
          }
          if (Array.isArray(storyboards)) {
            const sbClipIndex = storyboards.findIndex((c: any) => c.clipId === clipId);
            if (sbClipIndex >= 0) {
              storyboards[sbClipIndex] = {
                ...storyboards[sbClipIndex],
                shootingScript: shootingScriptData,
                shots: targetClip.shots,
              };
            } else {
              storyboards.push(targetClip);
            }
            store.setArtifact(projectId, 'storyboards', storyboards);
            atomicWriteJsonSync(path.join(projectDir, 'storyboards.json'), storyboards);
          }
          recordStoryboardUpdated(projectId, [clipId]);
        }
        break;
      }

      case 'film.shot_prompt': {
        const {
          clipId,
          shotId,
          firstFramePrompt,
          videoPrompt,
          cameraDirective,
          colorDirective,
          poseDirective,
          motionDirective,
          dynamicDirective,
          focusDirective,
        } = output;
        if (clipId && shotId) {
          const filmSpec = store.getArtifact<any>(projectId, 'film_spec') || { clips: [] };
          const clip = (filmSpec.clips || []).find((c: any) => c.clipId === clipId);
          if (clip && Array.isArray(clip.shots)) {
            const targetShot = clip.shots.find((s: any) => s.shotId === shotId);
            if (targetShot) {
              targetShot.firstFramePrompt = firstFramePrompt;
              if (videoPrompt) targetShot.videoPrompt = videoPrompt;
              if (cameraDirective) targetShot.cameraDirective = cameraDirective;
              if (colorDirective) targetShot.colorDirective = colorDirective;
              if (poseDirective) targetShot.poseDirective = poseDirective;
              if (motionDirective) targetShot.motionDirective = motionDirective;
              if (dynamicDirective) targetShot.dynamicDirective = dynamicDirective;
              if (focusDirective) targetShot.focusDirective = focusDirective;

              store.setArtifact(projectId, 'film_spec', filmSpec);
              store.setArtifact(projectId, 'storyboards', filmSpec.clips);
              atomicWriteJsonSync(path.join(projectDir, 'storyboards.json'), filmSpec.clips);

              // 标记首帧生图词已更新
              recordShotPromptUpdated(projectId, [shotId]);
              // 若同时推演出同相视频运镜词，同步标记视频过期
              if (videoPrompt) {
                recordShotVideoUpdated(projectId, shotId);
              }

              // 同步更新分镜画布节点
              const canvas = store.getArtifact<any>(projectId, 'storyboard_canvas');
              if (canvas?.nodes) {
                let updated = false;
                for (const n of Object.values<any>(canvas.nodes)) {
                  if (n.shotId === shotId || n.id === `node_${shotId}`) {
                    n.firstFramePrompt = firstFramePrompt;
                    if (videoPrompt) n.videoPrompt = videoPrompt;
                    updated = true;
                  }
                }
                if (updated) {
                  store.setArtifact(projectId, 'storyboard_canvas', canvas);
                  atomicWriteJsonSync(path.join(projectDir, 'storyboard_canvas.json'), canvas);
                }
              }
            }
          }
        }
        break;
      }

      case 'film.shot_keyframe': {
        const { shotId, firstFrameImageUrl, lastFrameImageUrl } = output;
        const storyboardsPath = path.join(projectDir, 'storyboards.json');
        const shots = store.getArtifact<any[]>(projectId, 'storyboards') || safeReadJsonSync(storyboardsPath) || [];
        // 工具输出里总是同时带首尾帧地址，但只有本次真正重绘的那一帧才该清 HD 标记；
        // 否则「只重绘末帧」会把首帧的 SeedVR2 历史版本标记误删。
        const renderedFrame = task.input?.frame as 'first' | 'last' | undefined;
        const renderedFirst = !renderedFrame || renderedFrame === 'first';
        const renderedLast = !renderedFrame || renderedFrame === 'last';

        if (shotId && (firstFrameImageUrl || lastFrameImageUrl)) {
          for (const item of shots) {
            const matched = item.shotId === shotId
              ? item
              : Array.isArray(item.shots)
              ? item.shots.find((s: any) => s.shotId === shotId)
              : undefined;
            if (matched) {
              if (firstFrameImageUrl && renderedFirst) {
                matched.keyframeUrl = firstFrameImageUrl;
                matched.firstFrameImageUrl = firstFrameImageUrl;
                delete matched.firstFrameUpscale;
              }
              if (lastFrameImageUrl && renderedLast) {
                matched.lastFrameImageUrl = lastFrameImageUrl;
                delete matched.lastFrameUpscale;
              }
            }
          }

          // 同步更新分镜画布节点（重绘覆盖后仅清除本次渲染帧的旧超分标记）
          const canvas = store.getArtifact<any>(projectId, 'storyboard_canvas');
          if (canvas?.nodes) {
            let updated = false;
            for (const n of Object.values<any>(canvas.nodes)) {
              if (n.shotId === shotId || n.id === `node_${shotId}`) {
                if (firstFrameImageUrl && renderedFirst) {
                  n.keyframeUrl = firstFrameImageUrl;
                  delete n.firstFrameUpscale;
                }
                if (lastFrameImageUrl && renderedLast) {
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
          recordShotKeyframeUpdated(projectId, shotId, renderedFrame || 'both');
        }
        break;
      }

      case 'film.image_upscale': {
        const { targetKind, targetId, frame = 'first', multiplier = 2 } = task.input || {};
        const effectiveMediaUrl = output.mediaUrl || output.firstFrameImageUrl || output.lastFrameImageUrl;

        if (targetKind === 'shot_keyframe' && targetId && effectiveMediaUrl) {
          const storyboardsPath = path.join(projectDir, 'storyboards.json');
          const shots = store.getArtifact<any[]>(projectId, 'storyboards') || safeReadJsonSync(storyboardsPath) || [];
          const upscaledAt = new Date().toISOString();
          const isFirst = frame !== 'last';

          for (const item of shots) {
            const matched = item.shotId === targetId
              ? item
              : Array.isArray(item.shots)
              ? item.shots.find((s: any) => s.shotId === targetId)
              : undefined;

            if (matched) {
              if (isFirst) {
                matched.firstFrameImageUrl = effectiveMediaUrl;
                matched.keyframeUrl = effectiveMediaUrl;
                matched.imageUrl = effectiveMediaUrl;
                matched.firstFrameUpscale = { multiplier, upscaledAt };
              } else {
                matched.lastFrameImageUrl = effectiveMediaUrl;
                matched.lastFrameUrl = effectiveMediaUrl;
                matched.lastFrameUpscale = { multiplier, upscaledAt };
              }
            }
          }

          // 同步分镜大画布节点
          const canvas = store.getArtifact<any>(projectId, 'storyboard_canvas');
          if (canvas?.nodes) {
            let updated = false;
            for (const n of Object.values<any>(canvas.nodes)) {
              if (n.shotId === targetId || n.id === `node_${targetId}`) {
                if (isFirst) {
                  n.keyframeUrl = effectiveMediaUrl;
                  n.firstFrameUpscale = { multiplier, upscaledAt };
                } else {
                  n.lastFrameUrl = effectiveMediaUrl;
                  n.lastFrameUpscale = { multiplier, upscaledAt };
                }
                updated = true;
              }
            }
            if (updated) {
              store.setArtifact(projectId, 'storyboard_canvas', canvas);
              atomicWriteJsonSync(path.join(projectDir, 'storyboard_canvas.json'), canvas);
            }
          }

          store.setArtifact(projectId, 'storyboards', shots);
          atomicWriteJsonSync(storyboardsPath, shots);

          const filmSpec = store.getArtifact<any>(projectId, 'film_spec');
          if (filmSpec) {
            filmSpec.clips = shots;
            store.setArtifact(projectId, 'film_spec', filmSpec);
          }

          recordShotKeyframeUpdated(projectId, targetId, isFirst ? 'first' : 'last');
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
