import path from 'path';
import fs from 'fs';
import { FMVManifest, FMVNodeAsset } from './types.js';
import { StoryboardArtifact } from '../storyboard/types.js';
import { loopFrameService } from './loop-frame.service.js';
import { ffmpegService } from '../../media/ffmpeg.js';

export class NodePackagerService {
  /**
   * 将独立的镜头视频打包封装为互动节点级 FMV 资产，
 * 为决策点生成静止定格帧与往复呼吸循环视频，
 * 并导出最终的互动影游资产清单元数据 (game_manifest.json)。
   */
  async packageFMVGame(options: {
    projectDir: string;
    sessionId: string;
    clips: Array<{ shotId: string; localPath: string; videoUrl: string; duration?: number }>;
    storyboard: StoryboardArtifact;
    storyGraph?: any;
    gameTitle?: string;
  }): Promise<FMVManifest> {
    const { projectDir, sessionId, clips, storyboard, storyGraph, gameTitle } = options;

    const fmvDir = path.join(projectDir, 'fmv');
    const loopsDir = path.join(fmvDir, 'loops');
    const framesDir = path.join(fmvDir, 'frames');
    fs.mkdirSync(fmvDir, { recursive: true });
    fs.mkdirSync(loopsDir, { recursive: true });
    fs.mkdirSync(framesDir, { recursive: true });

    const clipMap = new Map<string, { shotId: string; localPath: string; videoUrl: string; duration?: number }>();
    for (const c of clips) {
      clipMap.set(c.shotId, c);
    }

    const nodeAssets: Record<string, FMVNodeAsset> = {};
    let totalGameDuration = 0;

    if (storyGraph && storyGraph.nodes && storyGraph.nodes.length > 0) {
      for (const node of storyGraph.nodes) {
        const nodeShots = storyboard.shots.filter(
          (s) => s.sceneId === node.id || s.unitId === node.id || s.shotId.startsWith(node.id) || (storyboard.shots.length === 1)
        );
        const nodeClips = nodeShots
          .map((s) => clipMap.get(s.shotId))
          .filter(Boolean) as Array<{ shotId: string; localPath: string; videoUrl: string; duration?: number }>;

        const primaryClip = nodeClips[0] || clips[0];
        if (!primaryClip) continue;

        let nodeVideoPath = primaryClip.localPath;
        let nodeVideoUrl = primaryClip.videoUrl;

        if (nodeClips.length > 1) {
          const stitchedPath = path.join(fmvDir, `node_${node.id}.mp4`);
          const clipPaths = nodeClips.map((c) => c.localPath).filter(Boolean);
          try {
            await ffmpegService.concatClips(clipPaths, stitchedPath);
            nodeVideoPath = stitchedPath;
            nodeVideoUrl = `/media/${sessionId}/fmv/${path.basename(stitchedPath)}`;
          } catch (concatErr) {
            console.warn(`[NodePackager] Concat node ${node.id} failed, using primary clip:`, concatErr);
          }
        }

        const duration = await ffmpegService.getDuration(nodeVideoPath);
        totalGameDuration += duration;

        const isDecisionPoint = node.type === 'decision' || node.type === 'qte' || node.type === 'investigation';
        let holdImageUrl: string | undefined;
        let loopVideoUrl: string | undefined;

        if (isDecisionPoint && fs.existsSync(nodeVideoPath)) {
          const holdFramePath = path.join(framesDir, `hold_${node.id}.jpg`);
          const loopClipPath = path.join(loopsDir, `loop_${node.id}.mp4`);

          try {
            await loopFrameService.extractHoldFrame(nodeVideoPath, holdFramePath);
            if (fs.existsSync(holdFramePath)) {
              holdImageUrl = `/media/${sessionId}/fmv/frames/${path.basename(holdFramePath)}`;
            }

            await loopFrameService.generatePingPongLoop(nodeVideoPath, loopClipPath, 2);
            if (fs.existsSync(loopClipPath)) {
              loopVideoUrl = `/media/${sessionId}/fmv/loops/${path.basename(loopClipPath)}`;
            }
          } catch (loopErr) {
            console.warn(`[NodePackager] Loop generation for ${node.id} skipped:`, loopErr);
          }
        }

        const nodeChoices = (storyGraph.choices || []).filter((c: any) => c.fromNodeId === node.id);

        nodeAssets[node.id] = {
          nodeId: node.id,
          title: node.title,
          videoUrl: nodeVideoUrl,
          localPath: nodeVideoPath,
          durationSec: duration,
          decisionTimeSec: isDecisionPoint ? Math.max(0, duration - 3) : undefined,
          holdImageUrl,
          loopVideoUrl,
          isDecisionPoint,
          choices: nodeChoices,
        };
      }
    } else {
      for (const shot of storyboard.shots) {
        const clip = clipMap.get(shot.shotId);
        if (!clip) continue;

        nodeAssets[shot.shotId] = {
          nodeId: shot.shotId,
          title: shot.shotId,
          videoUrl: clip.videoUrl,
          localPath: clip.localPath,
          durationSec: clip.duration || 5,
          isDecisionPoint: false,
        };
        totalGameDuration += clip.duration || 5;
      }
    }

    const manifest: FMVManifest = {
      gameTitle: gameTitle || 'Interactive FMV',
      startNodeId: storyGraph?.startNodeId || Object.keys(nodeAssets)[0] || 'node_01',
      totalDurationSec: Math.round(totalGameDuration),
      nodes: nodeAssets,
    };

    const manifestPath = path.join(fmvDir, 'game_manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    console.log(`[NodePackager] Exported FMV game manifest with ${Object.keys(nodeAssets).length} nodes: ${manifestPath}`);

    return manifest;
  }
}

export const nodePackagerService = new NodePackagerService();
