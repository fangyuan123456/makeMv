/**
 * tools/film-production/shot-video-tool/steps/01-render/step.ts
 * 镜头视听渲染执行器与原子 Step (支持单镜头与全剧批量两栖执行)
 */

import { createStep } from '@mastra/core/workflows';
import path from 'node:path';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { atomicWriteJsonSync } from '../../../../../utils/atomicFile.js';
import {
  appendVideoVersion,
  buildShotMediaFileName,
  readVideoVersions,
} from '../../../../../project-store/shot-frame-versions.js';
import { videoGenerateTool } from '../../../../media/video-generate.tool.js';
import { isAbortError } from '../../../../../workflow-engine/run-context.js';
import type { FilmAdapterArtifact } from '../../../../../project-store/contracts/film-production/film-spec.js';
import {
  ShotVideoStepInputSchema,
  ShotVideoStepOutputSchema,
  type ShotVideoStepInput,
  type ShotVideoStepOutput,
} from './schema.js';
import { formatVideoMotionPrompt } from './prompt.js';
import { extractVideoLastFrame } from '../../../../../media/video-frame-extractor.js';

export const shotVideoStep = createStep({
  id: 'render-shot-video',
  description: '以关键帧为底，驱动图生视频算力工具渲染带声画的镜头视频 (支持单镜头重制与全剧批量续跑)',
  inputSchema: ShotVideoStepInputSchema,
  outputSchema: ShotVideoStepOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = (ctx?.triggerData || ctx?.inputData || ctx || {}) as ShotVideoStepInput;
    const {
      projectId,
      clipId,
      shotId,
      force = false,
      customPrompt,
      referenceImageUrl,
      mode,
      durationSec,
    } = input;

    const store = ProjectStore.getInstance();
    const filmSpec = store.getArtifact<FilmAdapterArtifact>(projectId, 'film_spec');

    if (!filmSpec) {
      throw new Error(`[ShotVideoTool] 项目 [${projectId}] 缺少 film_spec 分镜切片清单`);
    }

    const projectDir = store.getProjectDir(projectId);

    // 单镜头视频渲染闭包
    const renderSingleVideo = async (targetClip: any, targetShot: any): Promise<boolean> => {
      if (customPrompt && customPrompt.trim()) {
        targetShot.videoPrompt = customPrompt.trim();
      }

      const isCustomRedo = Boolean(customPrompt || referenceImageUrl);
      if (targetShot.videoUrl && !force && !isCustomRedo) {
        return true;
      }

      // 业务层纯提示词：自定义优先，否则沿用镜头台本（保持纯戏剧台本，绝不存硬件外壳）
      if (customPrompt && customPrompt.trim()) {
        targetShot.videoPrompt = customPrompt.trim();
      }
      const rawMotion =
        targetShot.videoPrompt ||
        `${targetShot.cameraMovement || '中速稳健运镜'}, 电影级平滑物理运镜，人物动作流畅写实，自然物理速率`;

      // 收集 Ref2V 多图参考资产（全线走 H3 全能参考直出：角色/场景/道具定妆图 + 可选构图参考图 + 同场景上一段末帧）
      const ref2vUrls: string[] = [];
      const ref2vLegend: string[] = [];
      {
        const entities = store.getArtifact<any>(projectId, 'lookdev_entities');
        const seenRef = new Set<string>();
        const pushRef = (url: string | undefined, label: string) => {
          const clean = url?.split('?')[0].trim();
          if (!clean || seenRef.has(clean) || ref2vUrls.length >= 9) return;
          seenRef.add(clean);
          ref2vUrls.push(clean);
          ref2vLegend.push(`<Picture ${ref2vUrls.length}> ${label}`);
        };

        if (referenceImageUrl) {
          pushRef(referenceImageUrl, '为起始构图与站位参考');
        }

        const charList = Array.isArray(entities?.characters) ? entities.characters : [];
        const targetCharIds = Array.isArray(targetShot.characters) ? targetShot.characters : [];
        for (const cid of targetCharIds) {
          const ch = charList.find((c: any) => c.characterId === cid || c.name === cid);
          if (ch) pushRef(ch.imageUrl || ch.referenceImageUrl, `为角色[${ch.name}]外观与服装基准`);
        }

        const locList = Array.isArray(entities?.locations) ? entities.locations : [];
        const matchedLoc = locList.find(
          (l: any) =>
            (targetShot.locationId && l.locationId === targetShot.locationId) ||
            (targetShot.location && l.name === targetShot.location)
        );
        if (matchedLoc) {
          pushRef(
            matchedLoc.imageUrl || matchedLoc.referenceImageUrl,
            `为场景[${matchedLoc.name}]空间美术参考（参考图不是成品构图，需按本镜机位重新构筑视角与比例）`
          );
        }

        const itemList = Array.isArray(entities?.items) ? entities.items : [];
        const targetItemIds = Array.isArray(targetShot.items) ? targetShot.items : [];
        for (const iid of targetItemIds) {
          const it = itemList.find((i: any) => i.itemId === iid || i.name === iid);
          if (it) pushRef(it.imageUrl || it.referenceImageUrl, `为道具[${it.name}]实物外观基准`);
        }

        // 若同场景前一段已生成末帧，自动带入作为上一段尾帧延续站位与光色
        const shotList = Array.isArray(targetClip.shots) ? targetClip.shots : [];
        const currIdx = shotList.findIndex((s: any) => (s.shotId || s.id) === (targetShot.shotId || targetShot.id));
        const prevShot = currIdx > 0 ? shotList[currIdx - 1] : undefined;
        const isSameScene = !targetShot.locationId || !prevShot?.locationId || targetShot.locationId === prevShot.locationId;
        if (prevShot?.videoLastFrameUrl && isSameScene && targetShot.continuityMode !== 'detached') {
          pushRef(prevShot.videoLastFrameUrl, '为上一段尾帧参考（延续前序站位与光色）');
        }

        if (ref2vUrls.length === 0) {
          console.warn(`[ShotVideoTool] 镜头 [${targetShot.shotId}] 未匹配到任何定妆或构图参考图，跳过视频渲染`);
          return false;
        }
      }

      // 底层算力硬件提示词（动态装配，仅内存态传给视频生成工具，绝不写回 targetShot 业务实体）
      const baseHardwarePrompt = formatVideoMotionPrompt(rawMotion, false, undefined, true);
      const hardwarePrompt = `${ref2vLegend.join('；')}。\n${baseHardwarePrompt}`;
      const audioPrompt = targetShot.audioPrompt || targetShot.ambience || '电影级写实环境声与质感氛围';

      const targetDuration = Math.min(15, Math.max(2, Math.round(durationSec ?? targetShot.durationSec ?? targetShot.estimatedSeconds ?? 5)));

      const existingVersions = readVideoVersions(targetShot);
      const nextSeq = existingVersions.length + 1;
      const motionTag = targetShot.motionDirective?.presetId || targetShot.motionDirective?.label || 'dolly';
      const { fileName } = buildShotMediaFileName({
        shotId: targetShot.shotId,
        kind: 'video',
        continuityMode: targetShot.continuityMode || 'auto',
        visualOrMotionTag: motionTag,
        versionSeq: nextSeq,
        ext: '.mp4',
      });

      try {
        const res: any = await (videoGenerateTool.execute as any)({
          context: {
            projectId,
            prompt: hardwarePrompt,
            audioPrompt,
            mode: 'ref2v',
            referenceImageUrls: ref2vUrls,
            duration: targetDuration,
            subfolder: 'videos',
            customFilename: fileName.replace(/\.[^.]+$/, ''),
          },
        });

        const mediaUrl = res?.mediaUrl || res?.videoUrl;
        if (!res?.success || !mediaUrl) {
          throw new Error(res?.error || '视频算力未产出有效媒体地址');
        }

        targetShot.videoUrl = mediaUrl;

        // 自动抽取视频末帧，作为后序镜头承接接戏母本图
        try {
          const localVideoPath = path.join(projectDir, 'videos', fileName);
          const lastFrameFileName = `${targetShot.shotId}_video_last_frame.png`;
          const localLastFramePath = path.join(projectDir, 'keyframes', lastFrameFileName);
          if (extractVideoLastFrame({ videoPath: localVideoPath, outputImagePath: localLastFramePath })) {
            targetShot.videoLastFrameUrl = `/media/${projectId}/keyframes/${lastFrameFileName}`;
          }
        } catch (frameErr) {
          console.warn('[ShotVideoTool] 视频末帧抽取非阻塞警告:', frameErr);
        }
        appendVideoVersion(targetShot, {
          videoUrl: mediaUrl,
          fileName,
          prompt: targetShot.videoPrompt,
          continuityMode: targetShot.continuityMode || 'auto',
          motionDirective: targetShot.motionDirective,
          dynamicDirective: targetShot.dynamicDirective,
          focusDirective: targetShot.focusDirective,
          source: 'generate',
        });

        // 同步至分镜画布节点
        const canvas = store.getArtifact<any>(projectId, 'storyboard_canvas');
        if (canvas?.nodes) {
          let updatedCanvas = false;
          for (const node of Object.values<any>(canvas.nodes)) {
            if (node.shotId !== targetShot.shotId && node.id !== `node_${targetShot.shotId}`) continue;
            node.videoUrl = mediaUrl;
            if (targetShot.videoLastFrameUrl) node.videoLastFrameUrl = targetShot.videoLastFrameUrl;
            node.videoVersions = targetShot.videoVersions;
            if (targetShot.motionDirective !== undefined) node.motionDirective = targetShot.motionDirective;
            if (targetShot.dynamicDirective !== undefined) node.dynamicDirective = targetShot.dynamicDirective;
            if (targetShot.focusDirective !== undefined) node.focusDirective = targetShot.focusDirective;
            updatedCanvas = true;
          }
          if (updatedCanvas) {
            store.setArtifact(projectId, 'storyboard_canvas', canvas);
            atomicWriteJsonSync(path.join(projectDir, 'storyboard_canvas.json'), canvas);
          }
        }

        return true;
      } catch (err: any) {
        if (isAbortError(err)) throw err;
        throw new Error(`[ShotVideoTool] 镜头 [${targetShot.shotId}] 视频渲染失败: ${err?.message || err}`);
      }
    };

    // 1. 若未提供 shotId，开启全剧批量模式 (遍历全剧已有关键帧但无视频的镜头)
    if (!shotId) {
      const allShotPairs: Array<{ clip: any; shot: any }> = [];
      for (const c of filmSpec.clips || []) {
        for (const s of c.shots || []) {
          allShotPairs.push({ clip: c, shot: s });
        }
      }

      let renderedCount = 0;
      for (const pair of allShotPairs) {
        const hasKeyframe = Boolean(pair.shot.firstFrameImageUrl || pair.shot.keyframeUrl);
        if (hasKeyframe && (force || !pair.shot.videoUrl)) {
          const success = await renderSingleVideo(pair.clip, pair.shot);
          if (success) renderedCount++;
        }
      }

      // 全量落盘与同步
      store.setArtifact(projectId, 'film_spec', filmSpec);
      store.setArtifact(projectId, 'storyboards', filmSpec.clips);
      atomicWriteJsonSync(path.join(projectDir, 'film_spec.json'), filmSpec);
      atomicWriteJsonSync(path.join(projectDir, 'storyboards.json'), filmSpec.clips);

      return {
        projectId,
        shotId: 'all',
        reused: renderedCount === 0,
        success: true,
      };
    }

    // 2. 提供了 shotId，单镜头定向重制模式 (全局反查，无需外部显式提供 clipId)
    let matchedClip = clipId ? filmSpec.clips?.find((c: any) => c.clipId === clipId) : undefined;
    let matchedShot = matchedClip?.shots?.find((s: any) => s.shotId === shotId);

    if (!matchedShot) {
      for (const c of filmSpec.clips || []) {
        const found = c.shots?.find((s: any) => s.shotId === shotId);
        if (found) {
          matchedClip = c;
          matchedShot = found;
          break;
        }
      }
    }

    if (!matchedClip || !matchedShot) {
      throw new Error(`[ShotVideoTool] 未在全剧分镜中找到镜头 [${shotId}]`);
    }

    await renderSingleVideo(matchedClip, matchedShot);

    // 单体落盘与同步
    store.setArtifact(projectId, 'film_spec', filmSpec);
    store.setArtifact(projectId, 'storyboards', filmSpec.clips);
    atomicWriteJsonSync(path.join(projectDir, 'film_spec.json'), filmSpec);
    atomicWriteJsonSync(path.join(projectDir, 'storyboards.json'), filmSpec.clips);

    return {
      projectId,
      clipId: matchedClip.clipId,
      shotId: matchedShot.shotId,
      videoUrl: matchedShot.videoUrl,
      reused: false,
      success: Boolean(matchedShot.videoUrl),
    };
  },
});
