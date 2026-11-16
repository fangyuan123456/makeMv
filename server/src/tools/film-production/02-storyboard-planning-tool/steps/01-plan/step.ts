/**
 * tools/film-production/02-storyboard-planning-tool/steps/01-plan/step.ts
 * 分镜台本规划工序执行器 (storyboardPlanningStep)
 *
 * 核心微内核机制（Dramatic Beat Driven & Zero Cap）：
 * 1. 【彻底解除数量上限】根据剧本节拍充分展开，支持单幕多镜头细腻切分；
 * 2. 【分幕独立高精推演】支持单幕定向规划与全剧并发规划，彻底根除单次大请求的 Token 瓶颈；
 * 3. 【视觉资产全自动装配】自动比对匹配出场角色立绘与空间场景母本底图；
 * 4. 【双轨落盘自洽】同时同步更新 film_spec 与 storyboards，确保画布与播放器即时消费。
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import path from 'node:path';
import fs from 'node:fs';
import { LLMProvider } from '../../../../../llm/index.js';
import { generateStructured } from '../../../../../utils/llm-diagnostics.js';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { atomicWriteJsonSync } from '../../../../../utils/atomicFile.js';
import {
  FilmAdapterArtifactSchema,
  CinematicClipOrderSchema,
  type FilmAdapterArtifact,
  type CinematicClipOrder,
} from '../../../../../project-store/contracts/film-production/film-spec.js';
import type { GlobalEntities } from '../../../../../project-store/contracts/film-production/lookdev.js';
import {
  StoryboardPlanningStepInputSchema,
  StoryboardPlanningOutputSchema,
  type StoryboardPlanningStepInput,
  type StoryboardPlanningOutput,
} from './schema.js';
import {
  STORYBOARD_PLANNING_SYSTEM_PROMPT,
  buildSingleClipStoryboardPrompt,
  buildStoryboardPlanningUserPrompt,
} from './prompt.js';

export const storyboardPlanningStep = createStep({
  id: 'plan-storyboard-spec',
  description: '将剧本与 PRD 拆解为专业的各幕电影分镜台本与镜头制作订单 (纯文本拆解 · 戏剧节拍充分展开)',
  inputSchema: StoryboardPlanningStepInputSchema,
  outputSchema: StoryboardPlanningOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = (ctx?.triggerData || ctx?.inputData || ctx || {}) as StoryboardPlanningStepInput;

    const store = ProjectStore.getInstance();
    const memGdd = store.getArtifact<any>(input.projectId, 'gdd');
    const effectivePrd =
      input.prd ||
      store.getArtifact(input.projectId, 'universal_prd') ||
      store.getArtifact(input.projectId, 'prd') ||
      memGdd?.prd ||
      undefined;

    if (!effectivePrd && !input.storyMarkdown) {
      throw new Error(`[StoryboardPlanningTool] 项目 [${input.projectId}] 缺少前序策划案 PRD 或剧本正文，无法进行分镜台本规划`);
    }

    const effectiveEntities =
      input.entities ||
      store.getArtifact<GlobalEntities>(input.projectId, 'lookdev_entities') ||
      undefined;

    const abortSignal = (input as any)?.abortSignal || (input as any)?._context?.abortSignal;

    // 1. 建立角色与场景的快速资产索引
    const charMap = new Map<string, string>();
    (effectiveEntities?.characters || []).forEach((c: any) => {
      const id = c.characterId || c.id;
      if (id && c.imageUrl) charMap.set(id, c.imageUrl);
    });

    const locMap = new Map<string, { id: string; name: string; imageUrl?: string; sceneIds?: string[] }>();
    (effectiveEntities?.locations || []).forEach((l: any) => {
      const id = l.locationId || l.id;
      if (id) {
        locMap.set(id, {
          id,
          name: l.name || '',
          imageUrl: l.imageUrl,
          sceneIds: l.sceneIds || [],
        });
      }
    });

    // 辅助函数：将视觉实体与定妆底图深度注入到单幕分镜的每个镜头中
    const enrichClipShotsWithVisualAssets = (clip: CinematicClipOrder, narrativeText?: string): CinematicClipOrder => {
      if (!clip || !Array.isArray(clip.shots)) return clip;

      clip.shots.forEach((shot, idx) => {
        shot.shotIndex = idx;
        if (!shot.shotId || !shot.shotId.startsWith(clip.clipId)) {
          shot.shotId = `${clip.clipId}-${String(idx + 1).padStart(2, '0')}`;
        }

        // 自动匹配场景母本图 (根据镜头标注的 locations、sceneIds 或描述反查真实资产 URL)
        if (!shot.backgroundImageUrl || (!shot.backgroundImageUrl.startsWith('/') && !shot.backgroundImageUrl.startsWith('http'))) {
          let foundImg = '';
          // 1. 如果 backgroundImageUrl 填的是 locationId
          if (shot.backgroundImageUrl && locMap.has(shot.backgroundImageUrl)) {
            foundImg = locMap.get(shot.backgroundImageUrl)?.imageUrl || '';
          }
          // 2. 如果 shot.locations 标注了 locationId
          if (!foundImg && Array.isArray((shot as any).locations)) {
            for (const locId of (shot as any).locations) {
              const matched = locMap.get(locId);
              if (matched?.imageUrl) {
                foundImg = matched.imageUrl;
                break;
              }
            }
          }
          // 3. 通过 sceneIds 或空间名称语义反查
          if (!foundImg) {
            for (const loc of locMap.values()) {
              if (loc.imageUrl) {
                const isSceneMatched = loc.sceneIds && loc.sceneIds.includes(clip.clipId);
                const isNameMentioned =
                  loc.name &&
                  (shot.firstFramePrompt?.includes(loc.name) ||
                    shot.videoPrompt?.includes(loc.name) ||
                    narrativeText?.includes(loc.name));

                if (isSceneMatched || isNameMentioned) {
                  foundImg = loc.imageUrl;
                  break;
                }
              }
            }
          }
          if (foundImg) {
            shot.backgroundImageUrl = foundImg;
          }
        }

        // 自动匹配出场角色立绘定妆图 (将角色 ID 转换为真实图片路径)
        const resolvedRefs: string[] = [];
        const candidates = [
          ...(Array.isArray(shot.characterReferenceImageUrls) ? shot.characterReferenceImageUrls : []),
          ...(Array.isArray(shot.characters) ? shot.characters : []),
        ];
        candidates.forEach((c) => {
          if (typeof c === 'string') {
            if (c.startsWith('/') || c.startsWith('http')) {
              if (!resolvedRefs.includes(c)) resolvedRefs.push(c);
            } else {
              const img = charMap.get(c);
              if (img && !resolvedRefs.includes(img)) resolvedRefs.push(img);
            }
          }
        });
        shot.characterReferenceImageUrls = resolvedRefs;

        // 确保时长合法（默认 3~5 秒）
        if (!shot.durationSec || shot.durationSec <= 0) {
          shot.durationSec = 4;
        }
      });

      // 重新计算整幕总时长
      clip.targetDurationSec = clip.shots.reduce((acc, s) => acc + (s.durationSec || 4), 0);
      return clip;
    };

    const agent = new Agent({
      name: 'storyboard-director-agent',
      instructions: STORYBOARD_PLANNING_SYSTEM_PROMPT,
      model: LLMProvider.getModel(),
    });

    // 提取剧本文本段落映射字典
    const storySections: Record<string, { title: string; narrativeText: string }> = {};
    if (effectivePrd?.clips && Array.isArray(effectivePrd.clips)) {
      effectivePrd.clips.forEach((c: any) => {
        storySections[c.id] = {
          title: c.title || c.id,
          narrativeText: c.narrativeText || '',
        };
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 单幕推演核心执行闭包
    // ─────────────────────────────────────────────────────────────
    const planClipOrder = async (clipId: string, title: string, narrativeText: string): Promise<CinematicClipOrder> => {
      console.log(`[StoryboardPlanningTool] 正在对分幕 [${clipId} · ${title}] 执行高精无上限分镜拆解...`);

      const prompt = buildSingleClipStoryboardPrompt({
        clipId,
        clipTitle: title,
        narrativeText,
        artStyle: effectiveEntities?.artStyle,
        characters: effectiveEntities?.characters,
        locations: effectiveEntities?.locations,
        items: (effectiveEntities as any)?.items,
        instruction: input.instruction,
      });

      const rawClipOrder = (await generateStructured({
        agent,
        prompt,
        schema: CinematicClipOrderSchema,
        stage: 'film-tool',
        step: 'storyboard-plan-single-clip',
        label: `分镜拆解·${title}`,
        abortSignal,
      })) as CinematicClipOrder;

      // 强制统一 clipId 与 sourceNodeId
      rawClipOrder.clipId = clipId;
      rawClipOrder.sourceNodeId = clipId;
      return enrichClipShotsWithVisualAssets(rawClipOrder, narrativeText);
    };

    let finalFilmSpec: FilmAdapterArtifact;

    // ─────────────────────────────────────────────────────────────
    // 模式 A：指定了单幕 clipId，仅定向推演该幕并增量合并
    // ─────────────────────────────────────────────────────────────
    if (input.clipId) {
      const targetClipId = input.clipId;
      const meta = storySections[targetClipId] || {
        title: targetClipId,
        narrativeText: (effectivePrd?.clips || []).find((c: any) => c.id === targetClipId)?.narrativeText || '',
      };

      const plannedClip = await planClipOrder(targetClipId, meta.title, meta.narrativeText);

      // 读取已有旧分镜列表并增量替换
      const existingSpec = store.getArtifact<FilmAdapterArtifact>(input.projectId, 'film_spec');
      let mergedClips: CinematicClipOrder[] = [];

      if (existingSpec && Array.isArray(existingSpec.clips) && existingSpec.clips.length > 0) {
        const foundIdx = existingSpec.clips.findIndex(
          (c) => c.clipId === targetClipId || c.sourceNodeId === targetClipId
        );
        if (foundIdx >= 0) {
          mergedClips = [...existingSpec.clips];
          mergedClips[foundIdx] = plannedClip;
        } else {
          mergedClips = [...existingSpec.clips, plannedClip];
        }
      } else {
        mergedClips = [plannedClip];
      }

      finalFilmSpec = {
        projectId: input.projectId,
        schemaVersion: '2.0.0',
        projectTitle: input.title || effectivePrd?.gameTitle || existingSpec?.projectTitle || '未命名短剧',
        clips: mergedClips,
      };
    } else {
      // ─────────────────────────────────────────────────────────────
      // 模式 B：全剧批量推演 (按幕并发独立推演，彻底消除 Token 瓶颈)
      // ─────────────────────────────────────────────────────────────
      const clipsToProcess = effectivePrd?.clips || [];
      if (clipsToProcess.length === 0) {
        throw new Error(`[StoryboardPlanningTool] 策划案 PRD 中未定义任何 clips 剧情切片`);
      }

      console.log(`[StoryboardPlanningTool] 启动全剧各幕独立分镜推演，共 ${clipsToProcess.length} 幕...`);

      // 采用受控并发（并发槽位 2），既保障速度又避免触发大模型速率限制
      const concurrency = 2;
      const plannedClips: CinematicClipOrder[] = [];

      for (let i = 0; i < clipsToProcess.length; i += concurrency) {
        const batch = clipsToProcess.slice(i, i + concurrency);
        const batchResults = await Promise.all(
          batch.map((c: any) =>
            planClipOrder(c.id, c.title || c.id, c.narrativeText || '')
          )
        );
        plannedClips.push(...batchResults);
      }

      finalFilmSpec = {
        projectId: input.projectId,
        schemaVersion: '2.0.0',
        projectTitle: input.title || effectivePrd?.gameTitle || '未命名短剧',
        clips: plannedClips,
      };
    }

    // ─────────────────────────────────────────────────────────────
    // 双轨持久化写盘与黑板同步
    // ─────────────────────────────────────────────────────────────
    if (input.projectId && finalFilmSpec) {
      store.setArtifact(input.projectId, 'film_spec', finalFilmSpec);
      if (Array.isArray(finalFilmSpec.clips)) {
        store.setArtifact(input.projectId, 'storyboards', finalFilmSpec.clips);

        // 同步原子写入磁盘 project-dir/storyboards.json
        const projectDir = store.getProjectDir(input.projectId);
        const storyboardsPath = path.join(projectDir, 'storyboards.json');
        atomicWriteJsonSync(storyboardsPath, finalFilmSpec.clips);
        console.log(`[StoryboardPlanningTool] 全剧分镜资产已成功同步落盘至 ${storyboardsPath}`);
      }
    }

    const output: StoryboardPlanningOutput = {
      projectId: input.projectId,
      filmSpec: finalFilmSpec,
    };

    return output;
  },
});
