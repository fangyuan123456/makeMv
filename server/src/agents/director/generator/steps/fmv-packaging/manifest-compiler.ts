/**
 * agents/pipeline/workflows/steps/fmv-packaging/manifest-compiler.ts
 * 互动影游母带播放清单编译算法 (FMV Manifest Compiler SSOT)
 */

import type { FMVManifest, FMVNodeAsset, FMVChoice } from './schema.js';

export interface CompileManifestInput {
  rawNodes: any[];
  storyboardShots: any[];
  clips: any[];
  gameTitle: string;
  rootNodeId?: string;
}

export interface CompileManifestOutput {
  fmvManifest: FMVManifest;
  missingNodeIds: string[];
  usedClipIds: Set<string>;
  totalDurationSec: number;
  totalEndings: number;
  isDegraded: boolean;
}

export function compileFmvManifest(input: CompileManifestInput): CompileManifestOutput {
  const { rawNodes, storyboardShots, clips, gameTitle, rootNodeId } = input;

  const shotToNodeMap = new Map<string, string>();
  for (const sh of storyboardShots || []) {
    if (sh.shotId && sh.nodeId) {
      shotToNodeMap.set(sh.shotId, sh.nodeId);
    }
  }

  const nodeClipsMap = new Map<string, any[]>();
  for (const clip of clips || []) {
    const nodeId = shotToNodeMap.get(clip.shotId);
    if (nodeId) {
      const list = nodeClipsMap.get(nodeId) || [];
      list.push(clip);
      nodeClipsMap.set(nodeId, list);
    }
  }

  const nodesRecord: Record<string, FMVNodeAsset> = {};
  const fallbackVideoUrl = clips[0]?.videoUrl || '';
  const missingNodeIds: string[] = [];
  const usedClipIds = new Set<string>();

  for (let i = 0; i < rawNodes.length; i++) {
    const node = rawNodes[i];
    const matchedClips = nodeClipsMap.get(node.id) || [];
    const hasMatchedClip = matchedClips.length > 0;

    if (!hasMatchedClip) {
      missingNodeIds.push(node.id);
    }

    const selectedClip = hasMatchedClip ? matchedClips[0] : null;
    const videoUrl = selectedClip?.videoUrl || fallbackVideoUrl;
    const durationSec = selectedClip?.durationSec || 5;

    if (selectedClip?.clipId) {
      usedClipIds.add(selectedClip.clipId);
    }

    const fmvChoices: FMVChoice[] = (node.choices || []).map((ch: any, idx: number) => ({
      id: `choice_${node.id}_${idx + 1}`,
      fromNodeId: node.id,
      toNodeId: ch.targetNodeId,
      choiceText: ch.text || `分支选项 ${idx + 1}`,
      timeoutSeconds: 10,
      isTimeoutDefault: idx === 0,
    }));

    const isDecisionPoint = !node.isEnding && fmvChoices.length > 0;

    nodesRecord[node.id] = {
      nodeId: node.id,
      title: node.title || `剧情节点 ${node.id}`,
      videoUrl,
      durationSec,
      decisionTimeSec: Math.max(1, durationSec - 2),
      isDecisionPoint,
      choices: isDecisionPoint ? fmvChoices : undefined,
      isMissing: !hasMatchedClip,
    };
  }

  const startNodeId = rootNodeId || rawNodes[0]?.id || 'node_1';
  const effectiveClips = clips.filter((c: any) => usedClipIds.has(c.clipId));
  const totalDurationSec = effectiveClips.length > 0
    ? effectiveClips.reduce((acc: number, c: any) => acc + (c.durationSec || 0), 0)
    : clips.reduce((acc: number, c: any) => acc + (c.durationSec || 0), 0) || 120;

  const fmvManifest: FMVManifest = {
    gameTitle,
    startNodeId,
    totalDurationSec,
    nodes: nodesRecord,
  };

  const totalEndings = rawNodes.filter((n: any) => n.isEnding).length;
  const isDegraded = missingNodeIds.length > 0;

  return {
    fmvManifest,
    missingNodeIds,
    usedClipIds,
    totalDurationSec,
    totalEndings,
    isDegraded,
  };
}
