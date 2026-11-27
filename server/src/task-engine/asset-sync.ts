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
import { triggerScreenplayReviewAsync } from '../tools/review/screenplay-review/index.js';
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

          // 将 Step 1 的详实大纲与 2 个分支点规划物理落盘为 outline.md 与 outline.json，透明可查
          if (Array.isArray(output.actOutlines) && output.actOutlines.length > 0) {
            const outlineMarkdown = [
              `# 《${output.title || '互动影游'}》· 故事大纲与分支设定 (Step 1 纲领)`,
              `\n- **题材**：${output.genre || '未指定'}`,
              `- **故事梗概**：${output.logline || ''}`,
              output.worldSetting ? `- **世界观既定真相**：${output.worldSetting}` : '',
              `\n## 一、登场角色设定`,
              ...(Array.isArray(output.characters)
                ? output.characters.map(
                    (c: any) =>
                      `* **${c.name}**（${c.role}）\n  - 外貌视听符号：${c.appearance}\n  - 核心动机：${c.motivation}`
                  )
                : []),
              `\n## 二、分幕详实剧情大纲`,
              ...output.actOutlines.map(
                (a: any) =>
                  `### 第 ${a.actNumber} 幕《${a.title}》\n` +
                  `* **核心冲突**：${a.coreConflict}\n` +
                  `* **剧情展开脉络**：${a.plotSummary}\n` +
                  (Array.isArray(a.scenes) && a.scenes.length > 0 ? `* **场景序列**：${a.scenes.join(' ➔ ')}\n` : '') +
                  (a.turningPoint ? `* **幕末转折**：${a.turningPoint}\n` : '') +
                  (a.suspense ? `* **悬念核心**：${a.suspense}\n` : '')
              ),
              `\n## 三、全剧 2 个核心互动分支抉择点规划`,
              ...(Array.isArray(output.branchPoints)
                ? output.branchPoints.map(
                    (bp: any) => {
                      const aDest = bp.choiceA?.targetType === 'ENDING'
                        ? `终局【${bp.choiceA?.endingTitle || '终局'}】(${bp.choiceA?.endingType || 'BE'})`
                        : '推进主线';
                      const bDest = bp.choiceB?.targetType === 'ENDING'
                        ? `终局【${bp.choiceB?.endingTitle || '终局'}】(${bp.choiceB?.endingType || 'BE'})`
                        : '推进主线';

                      return (
                        `### 【互动抉择点 ${bp.pointIndex}】（位于第 ${bp.actNumber} 幕）\n` +
                        `* **场景情境**：${bp.sceneContext}\n` +
                        `* **两难抉择**：${bp.dilemma}\n` +
                        `* **选项 A**：${bp.choiceA?.text}（走向: ${aDest}，手段与代价: ${bp.choiceA?.approachAndCost}）\n` +
                        `* **选项 B**：${bp.choiceB?.text}（走向: ${bDest}，手段与代价: ${bp.choiceB?.approachAndCost}）\n`
                      );
                    }
                  )
                : []),
            ]
              .filter(Boolean)
              .join('\n');

            store.setArtifact(projectId, 'outline', outlineMarkdown);
            store.setArtifact(projectId, 'premise', output);
            fs.writeFileSync(path.join(projectDir, 'outline.md'), outlineMarkdown, 'utf-8');
            atomicWriteJsonSync(path.join(projectDir, 'outline.json'), {
              worldSetting: output.worldSetting,
              characters: output.characters,
              actOutlines: output.actOutlines,
              branchPoints: output.branchPoints,
            });
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
          // 仅在首稿/全量重推剧本时自动后台触发质量审查；局部修复或微调后由创作者按需手动重审
          if (!task.input?.instruction) {
            triggerScreenplayReviewAsync(projectId, output.scriptMarkdown);
          }
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

          // 骨架同步：保留已有同名实体的详细规格与定妆图，新增缺失实体，并清理已被新清单移除/拆分的旧实体
          if (Array.isArray(manifest.characters) && manifest.characters.length > 0) {
            const targetCharNames = new Set(manifest.characters.map((c: any) => c.name));
            updatedEntities.characters = updatedEntities.characters.filter((item: any) => targetCharNames.has(item.name));
          }
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

          if (Array.isArray(manifest.locations) && manifest.locations.length > 0) {
            const targetLocNames = new Set(manifest.locations.map((l: any) => l.name));
            updatedEntities.locations = updatedEntities.locations.filter((item: any) => targetLocNames.has(item.name));
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

          if (Array.isArray(manifest.items) && manifest.items.length > 0) {
            const targetItemNames = new Set(manifest.items.map((i: any) => i.name));
            updatedEntities.items = updatedEntities.items.filter((item: any) => targetItemNames.has(item.name));
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
          const firstBeatLoc = actionBeats?.[0]?.location;
          const firstBeatLocId = actionBeats?.[0]?.locationId;
          if (firstBeatLoc && !targetClip.location) targetClip.location = firstBeatLoc;
          if (firstBeatLocId && !targetClip.locationId) targetClip.locationId = firstBeatLocId;

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
                durationSec: beat.estimatedSeconds || 8,
                shotType: 'MEDIUM_SHOT',
                cameraMovement: 'locked-off',
                generationMode: 'ref2v',
                location: beat.location || targetClip.location || old.location,
                locationId: beat.locationId || targetClip.locationId || old.locationId,
                characters: beat.characterIds || [],
                items: beat.itemIds || [],
                sceneSubject: beat.actionDescription,
                sliceSummary: beat.beatTitle,
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

      case 'film.shot_motion_prompt': {
        const { clipId, shotId, videoPrompt, audioPrompt } = output;
        if (clipId && shotId && videoPrompt) {
          const filmSpec = store.getArtifact<any>(projectId, 'film_spec') || { clips: [] };
          const clip = (filmSpec.clips || []).find((c: any) => c.clipId === clipId);
          if (clip && Array.isArray(clip.shots)) {
            const targetShot = clip.shots.find((s: any) => s.shotId === shotId);
            if (targetShot) {
              targetShot.videoPrompt = videoPrompt;
              if (audioPrompt) targetShot.audioPrompt = audioPrompt;

              store.setArtifact(projectId, 'film_spec', filmSpec);
              store.setArtifact(projectId, 'storyboards', filmSpec.clips);
              atomicWriteJsonSync(path.join(projectDir, 'storyboards.json'), filmSpec.clips);

              // 标记视频过期，驱动后续生成
              recordShotVideoUpdated(projectId, shotId);

              // 同步更新分镜画布节点
              const canvas = store.getArtifact<any>(projectId, 'storyboard_canvas');
              if (canvas?.nodes) {
                let updated = false;
                for (const n of Object.values<any>(canvas.nodes)) {
                  if (n.shotId === shotId || n.id === `node_${shotId}`) {
                    n.videoPrompt = videoPrompt;
                    if (audioPrompt) n.audioPrompt = audioPrompt;
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
        const filmSpec = store.getArtifact<any>(projectId, 'film_spec');
        if (filmSpec) {
          filmSpec.clips = shots;
          store.setArtifact(projectId, 'film_spec', filmSpec);
          atomicWriteJsonSync(path.join(projectDir, 'film_spec.json'), filmSpec);
        }
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
