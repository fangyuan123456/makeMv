/**
 * agents/planner/steps/prd-synthesis/graph-builder.ts
 * 纯算法状态机拓扑与 100% 通用 PRD 基础积木构建器
 * (Deterministic StoryGraph & Universal PRD Wiring Builder)
 *
 * 核心设计：
 * 1. 零大模型幻觉：100% 基于上游结构化产物 clips 与 branches 确定性装配视频清单与基础接线；
 * 2. 严格 1:1 单互动对齐：每段 clip 至多挂载 1 个互动节点 `I_${clipId}`（ACTION 顺延或 CHOICE 分流）；
 * 3. 安全合流 Step 4 轻量 AI 的增量增强（`applyPrdEnhancement`），绝不允许改写或伪造 `clips` 编号。
 */

import type { SlicedClipNode } from '../interaction-slicing/schema.js';
import type { DerivedBranchNode } from '../branch-derivation/schema.js';
import type {
  StoryGraph,
  StoryGraphNode,
  StoryGraphEdge,
  UniversalPrdSpec,
  PrdClipNode,
  PrdInteractionNode,
  PrdEndingNode,
  PrdWiringEdge,
  PrdEnhancementOutput,
} from './schema.js';

/**
 * 把模型给出的归宿 ID 归一化成真实存在的 clipId。
 */
export function resolveClipId(
  clips: SlicedClipNode[],
  rawId: string | undefined,
  fallbackClipId?: string
): string | undefined {
  if (!rawId) return fallbackClipId;
  if (clips.some((c) => c.clipId === rawId)) return rawId;
  const owner = clips.find(
    (c) => c.interaction?.category === 'CHOICE' && c.interaction.cutId === rawId
  );
  if (owner) return owner.clipId;
  return undefined;
}

/** REJOIN 支线的合流目标；无法解析时返回 undefined，宁可不画边也不画悬空边 */
export function resolveBranchTarget(
  clips: SlicedClipNode[],
  branch: DerivedBranchNode
): string | undefined {
  if (branch.resolutionType !== 'REJOIN') return undefined;
  const sourceIndex = clips.findIndex((c) => c.clipId === branch.sourceClipId);
  const fallback = sourceIndex >= 0 ? clips[sourceIndex + 1]?.clipId : undefined;
  return resolveClipId(clips, branch.targetClipId, fallback);
}

/**
 * 纯算法构建 100% 通用 PRD 基础骨架（完全基于上游 clips 与 branches）
 */
export function buildBaseUniversalPrdSpec(params: {
  title: string;
  clips: SlicedClipNode[];
  branches: DerivedBranchNode[];
}): UniversalPrdSpec {
  const { title, clips, branches } = params;

  const prdClips: PrdClipNode[] = [];
  const interactions: PrdInteractionNode[] = [];
  const endings: PrdEndingNode[] = [];
  const wiring: PrdWiringEdge[] = [];

  if (clips.length === 0) {
    return {
      gameTitle: title,
      genre: '互动影游',
      playerIdentity: '第一视角亲历者',
      premiseAndPerspective: `《${title}》互动影游。`,
      outOfFlowSummary: '无',
      gameplayAndVictorySummary: '按段观看视频并在播完后做出抉择，推进至结局。',
      uiPagesSummary: [
        { page: '主页', features: '开始/继续游戏、功能入口' },
        { page: '播放页', features: '全屏播片、字幕、播完互动浮层、暂停入口' },
        { page: '暂停与设置', features: '继续、重看本段、返回主页、音量/字幕开关' },
      ],
      startNodeId: '',
      initialState: {},
      clips: [],
      interactions: [],
      endings: [],
      wiring: [],
    };
  }

  // 1. 按主干顺序紧随其支线组装 clips（与 story.md 顺序严格 1:1 对齐）
  const usedBranchCutIds = new Set<string>();
  for (const clip of clips) {
    prdClips.push({
      id: clip.clipId,
      title: clip.title,
      video: `${clip.clipId}.mp4`,
    });
    for (const b of branches.filter((x) => x.sourceClipId === clip.clipId)) {
      usedBranchCutIds.add(b.cutId);
      prdClips.push({
        id: b.cutId,
        title: b.branchTitle,
        video: `${b.cutId}.mp4`,
      });
    }
  }
  for (const b of branches.filter((x) => !usedBranchCutIds.has(x.cutId))) {
    prdClips.push({
      id: b.cutId,
      title: b.branchTitle,
      video: `${b.cutId}.mp4`,
    });
  }

  // 2. 装配主干结局与分支结局节点
  const lastClip = clips[clips.length - 1];
  const goldenEndingId = `END_${lastClip.clipId}_HE`;
  endings.push({
    id: goldenEndingId,
    endingType: 'HE',
    title: '通关结局',
    isVictory: true,
    summary: `主线推进至《${lastClip.title}》后达成结局。`,
  });

  for (const b of branches) {
    if (b.resolutionType !== 'ENDING') continue;
    const rewindTargetClipId =
      resolveClipId(clips, b.rewindTargetClipId, b.sourceClipId) || b.sourceClipId;
    endings.push({
      id: `END_${b.cutId}`,
      endingType: b.endingType || 'BE',
      title: b.endingTitle || b.branchTitle,
      isVictory: false,
      summary: b.verdict || `达成结局【${b.endingTitle || b.branchTitle}】。`,
      ...(rewindTargetClipId ? { rewindTargetClipId } : {}),
    });
  }

  // 3. 确定性装配所有互动节点与 wiring 接线边（严格 1 片段至多对应 1 互动节点 I_${clipId}）
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const isLast = clip.isEnding || i === clips.length - 1;
    const nextMainlineId = !isLast ? clips[i + 1]?.clipId : undefined;
    const fallthroughTarget = nextMainlineId || goldenEndingId;
    const inter = clip.interaction;
    const interId = `I_${clip.clipId}`;

    if (inter?.category === 'ACTION') {
      const actionKind = inter.actionType || 'TAP_HOTSPOT';
      interactions.push({
        id: interId,
        kind: actionKind,
        prompt: inter.prompt || `完成【${clip.title}】交互`,
        timeoutSec: null,
        outcomes: [
          {
            key: 'SUCCESS',
            label: actionKind,
            ...(inter.feedback ? { feedback: inter.feedback } : {}),
          },
        ],
      });
      wiring.push({ from: clip.clipId, onOutcome: 'onEnded', condition: null, transition: null, to: interId });
      wiring.push({ from: interId, onOutcome: '*', condition: null, transition: null, to: fallthroughTarget });
    } else if (!isLast && inter?.category === 'CHOICE') {
      const cutId = inter.cutId || `${clip.clipId}.1`;
      const matchedBranch = branches.find(
        (b) => b.cutId === cutId || b.sourceClipId === clip.clipId
      );
      const branchTarget = matchedBranch ? matchedBranch.cutId : fallthroughTarget;

      interactions.push({
        id: interId,
        kind: 'CHOICE',
        prompt: inter.conflictSummary || clip.title,
        timeoutSec: null,
        outcomes: [
          { key: 'A', label: inter.mainlineChoice || '继续主线' },
          { key: 'B', label: inter.branchChoice || '探索分支' },
        ],
      });
      wiring.push({ from: clip.clipId, onOutcome: 'onEnded', condition: null, transition: null, to: interId });
      wiring.push({ from: interId, onOutcome: 'A', condition: null, transition: null, to: fallthroughTarget });
      wiring.push({ from: interId, onOutcome: 'B', condition: null, transition: null, to: branchTarget });
    } else {
      wiring.push({ from: clip.clipId, onOutcome: 'onEnded', condition: null, transition: null, to: fallthroughTarget });
    }
  }

  // 4. 装配支线节点出边
  for (const b of branches) {
    if (b.resolutionType === 'ENDING') {
      wiring.push({
        from: b.cutId,
        onOutcome: 'onEnded',
        condition: null,
        transition: null,
        to: `END_${b.cutId}`,
      });
    } else {
      const target = resolveBranchTarget(clips, b) || goldenEndingId;
      wiring.push({
        from: b.cutId,
        onOutcome: 'onEnded',
        condition: null,
        transition: null,
        to: target,
      });
    }
  }

  return {
    gameTitle: title,
    genre: '互动影游',
    playerIdentity: '第一视角亲历者',
    premiseAndPerspective: `《${title}》互动影游。`,
    outOfFlowSummary: '无',
    gameplayAndVictorySummary: `观看片段并在播完后交互抉择，推进至结局。`,
    uiPagesSummary: [
      { page: '主页', features: '开始/继续游戏、功能入口' },
      { page: '播放页', features: '全屏播视频、字幕、播完互动浮层、暂停入口' },
      { page: '暂停与设置', features: '继续播放、重看本段、返回主页、音量与字幕设置' },
    ],
    startNodeId: clips[0].clipId,
    initialState: {},
    clips: prdClips,
    interactions,
    endings,
    wiring,
  };
}

/**
 * 将 Step 4 轻量 AI 增补结果安全合流进确定性 PRD 骨架（绝不破坏既有 clips 编号与连通基础）
 */
export function applyPrdEnhancement(
  base: UniversalPrdSpec,
  enhancement: PrdEnhancementOutput
): UniversalPrdSpec {
  const interactions: PrdInteractionNode[] = base.interactions.map((item) => ({
    ...item,
    outcomes: item.outcomes.map((o) => ({ ...o })),
  }));
  let endings: PrdEndingNode[] = base.endings.map((e) => ({ ...e }));
  let wiring: PrdWiringEdge[] = base.wiring.map((w) => ({ ...w }));

  // 1. 应用交互点增量（kind / timeout / config / stateChange / feedback / 超时路由）
  for (const patch of enhancement.interactionPatches || []) {
    const target = interactions.find((i) => i.id === patch.interactionId);
    if (!target) continue;

    if (patch.kind) target.kind = patch.kind;
    if (patch.timeoutSec !== undefined) target.timeoutSec = patch.timeoutSec;
    if (patch.config && Object.keys(patch.config).length > 0) {
      target.config = patch.config;
    }

    for (const op of patch.outcomePatches || []) {
      const outcome = target.outcomes.find((o) => o.key === op.key);
      if (!outcome) continue;
      if (op.stateChange) outcome.stateChange = op.stateChange;
      if (op.feedback) outcome.feedback = op.feedback;
    }

    // 超时逻辑同步至 wiring（未设超时时清除 TIMEOUT；设了超时且有默认去向时动态添加）
    if (patch.timeoutSec === null || patch.defaultOutcomeKey === null) {
      target.outcomes = target.outcomes.filter((o) => o.key !== 'TIMEOUT');
      wiring = wiring.filter((w) => !(w.from === target.id && w.onOutcome === 'TIMEOUT'));
    } else if (typeof target.timeoutSec === 'number' && patch.defaultOutcomeKey) {
      if (!target.outcomes.some((o) => o.key === 'TIMEOUT')) {
        target.outcomes.push({ key: 'TIMEOUT', label: '超时触发' });
      }
      const hasWildcard = wiring.some((w) => w.from === target.id && w.onOutcome === '*');
      if (!hasWildcard) {
        const refEdge = wiring.find(
          (w) => w.from === target.id && w.onOutcome === patch.defaultOutcomeKey
        );
        const existingTimeoutEdge = wiring.find(
          (w) => w.from === target.id && w.onOutcome === 'TIMEOUT'
        );
        if (refEdge) {
          if (existingTimeoutEdge) {
            existingTimeoutEdge.to = refEdge.to;
          } else {
            wiring.push({
              from: target.id,
              onOutcome: 'TIMEOUT',
              condition: null,
              transition: null,
              to: refEdge.to,
            });
          }
        }
      }
    }
  }

  // 2. 应用 REJOIN 支线转场卡
  for (const tr of enhancement.branchTransitions || []) {
    const edge = wiring.find((w) => w.from === tr.fromClipId && w.onOutcome === 'onEnded');
    if (edge) {
      edge.transition = {
        text: tr.text,
        durationSec: tr.durationSec || 1.5,
      };
    }
  }

  // 3. 应用结局增强（支持将同一末幕按 condition 拆分为 TE + HE）
  const endingIdSet = new Set(endings.map((e) => e.id));
  const clipIdSet = new Set(base.clips.map((c) => c.id));
  const enhancementsBySource = new Map<string, typeof enhancement.endingEnhancements>();

  for (const ee of enhancement.endingEnhancements || []) {
    if (!clipIdSet.has(ee.sourceClipId)) continue;
    const list = enhancementsBySource.get(ee.sourceClipId) || [];
    list.push(ee);
    enhancementsBySource.set(ee.sourceClipId, list);
  }

  for (const [sourceClipId, list] of enhancementsBySource.entries()) {
    // 查找该片段最终连向结局的起点 ID（clip 本身或它挂载的唯一尾帧交互节点 I_${sourceClipId}）
    const terminalFromIds = new Set<string>([sourceClipId, `I_${sourceClipId}`]);
    const existingEndingEdges = wiring.filter(
      (w) => terminalFromIds.has(w.from) && endingIdSet.has(w.to)
    );
    if (existingEndingEdges.length === 0) continue;

    const anchorFrom = existingEndingEdges[0].from;
    const anchorOutcome = existingEndingEdges[0].onOutcome;

    // 移除旧的默认结局边，按条件边优先 + null 兜底在后重建
    wiring = wiring.filter(
      (w) => !(terminalFromIds.has(w.from) && endingIdSet.has(w.to))
    );

    const sortedList = [...list].sort((a, b) => {
      const aCond = a.condition && a.condition !== 'default' ? 0 : 1;
      const bCond = b.condition && b.condition !== 'default' ? 0 : 1;
      return aCond - bCond;
    });

    for (const item of sortedList) {
      const normalizedCond =
        item.condition && item.condition !== 'default' && item.condition.trim() !== ''
          ? item.condition.trim()
          : null;
      const eid = item.endingId || `END_${sourceClipId}_${item.endingType}`;
      const existingNode = endings.find((e) => e.id === eid);
      const inheritedRewindTarget = existingEndingEdges
        .map((edge) => endings.find((e) => e.id === edge.to)?.rewindTargetClipId)
        .find(Boolean);
      if (existingNode) {
        existingNode.endingType = item.endingType;
        existingNode.title = item.title;
        existingNode.isVictory = item.isVictory;
        existingNode.summary = item.summary;
      } else {
        endings.push({
          id: eid,
          endingType: item.endingType,
          title: item.title,
          isVictory: item.isVictory,
          summary: item.summary,
          ...(!item.isVictory && inheritedRewindTarget ? { rewindTargetClipId: inheritedRewindTarget } : {}),
        });
        endingIdSet.add(eid);
      }

      wiring.push({
        from: anchorFrom,
        onOutcome: anchorOutcome,
        condition: normalizedCond,
        transition: null,
        to: eid,
      });
    }
  }

  // 清理未被任何 wiring 引用的孤立旧结局节点
  const referencedTargets = new Set(wiring.map((w) => w.to));
  endings = endings.filter((e) => referencedTargets.has(e.id));

  return {
    gameTitle: base.gameTitle,
    genre: enhancement.genre || base.genre,
    playerIdentity: enhancement.playerIdentity || base.playerIdentity,
    premiseAndPerspective: enhancement.premiseAndPerspective || base.premiseAndPerspective,
    outOfFlowSummary: enhancement.outOfFlowSummary || base.outOfFlowSummary,
    gameplayAndVictorySummary:
      enhancement.gameplayAndVictorySummary || base.gameplayAndVictorySummary,
    uiPagesSummary:
      enhancement.uiPagesSummary && enhancement.uiPagesSummary.length > 0
        ? enhancement.uiPagesSummary
        : base.uiPagesSummary,
    startNodeId: base.startNodeId,
    initialState: enhancement.initialState || base.initialState,
    clips: base.clips,
    interactions,
    endings,
    wiring,
  };
}

/**
 * 构建供前端可视化与拓扑度量使用的 StoryGraph DAG
 */
export function buildStoryGraph(
  clips: SlicedClipNode[],
  branches: DerivedBranchNode[]
): StoryGraph {
  const nodes: StoryGraphNode[] = [];
  const edges: StoryGraphEdge[] = [];

  if (clips.length === 0) {
    return { startNodeId: '', nodes: [], edges: [] };
  }

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    nodes.push({
      nodeId: clip.clipId,
      nodeType: 'MAINLINE_CLIP',
      title: clip.title,
      level: clip.level,
      contentSnippet: clip.narrativeText.slice(0, 100).replace(/\s+/g, ' '),
    });

    if (i < clips.length - 1) {
      const inter = clip.interaction;
      edges.push({
        fromNodeId: clip.clipId,
        toNodeId: clips[i + 1].clipId,
        edgeType: 'MAINLINE_PROGRESS',
        label:
          (inter?.category === 'CHOICE' ? inter.mainlineChoice : inter?.prompt) || '主线推进',
      });
    }
  }

  const lastClip = clips[clips.length - 1];
  const goldenEndingNodeId = `END_${lastClip.clipId}_HE`;
  nodes.push({
    nodeId: goldenEndingNodeId,
    nodeType: 'ENDING',
    title: '通关结局 (HE)',
    level: lastClip.level + 1,
    endingType: 'HE',
    contentSnippet: `主线推进至《${lastClip.title}》后达成通关结局。`,
  });
  edges.push({
    fromNodeId: lastClip.clipId,
    toNodeId: goldenEndingNodeId,
    edgeType: 'CHOICE_BRANCH',
    label: '终局达成',
  });

  for (const branch of branches) {
    const branchNodeId = branch.cutId;
    nodes.push({
      nodeId: branchNodeId,
      nodeType: 'BRANCH_CLIP',
      title: branch.branchTitle,
      level: branch.level,
      contentSnippet: branch.narrativeText.slice(0, 100).replace(/\s+/g, ' '),
    });

    const sourceClip = clips.find((c) => c.clipId === branch.sourceClipId);
    const choiceLabel =
      sourceClip?.interaction?.category === 'CHOICE' &&
      sourceClip.interaction.cutId === branch.cutId
        ? sourceClip.interaction.branchChoice || branch.choiceText || '分支抉择'
        : branch.choiceText || '分支抉择';

    edges.push({
      fromNodeId: branch.sourceClipId,
      toNodeId: branchNodeId,
      edgeType: 'CHOICE_BRANCH',
      label: choiceLabel,
      condition: branch.choiceText,
    });

    if (branch.resolutionType === 'REJOIN') {
      const target = resolveBranchTarget(clips, branch);
      if (target) {
        edges.push({
          fromNodeId: branchNodeId,
          toNodeId: target,
          edgeType: 'REJOIN',
          label: '殊途同归合流',
          condition: branch.rejoinConsequence || '化解危机承接主线',
        });
      }
    } else if (branch.resolutionType === 'ENDING') {
      const branchEndingNodeId = `END_${branch.cutId}`;
      nodes.push({
        nodeId: branchEndingNodeId,
        nodeType: 'ENDING',
        title: branch.endingTitle || '终局结算',
        level: branch.level + 1,
        endingType: branch.endingType || 'BE',
        contentSnippet: branch.verdict || '命运在此定格。',
      });
      edges.push({
        fromNodeId: branchNodeId,
        toNodeId: branchEndingNodeId,
        edgeType: 'CHOICE_BRANCH',
        label: `达成【${branch.endingTitle || '结局'}】`,
      });

      const rewindTarget =
        resolveClipId(clips, branch.rewindTargetClipId, branch.sourceClipId) ||
        branch.sourceClipId;
      if (clips.some((c) => c.clipId === rewindTarget)) {
        edges.push({
          fromNodeId: branchEndingNodeId,
          toNodeId: rewindTarget,
          edgeType: 'REWIND',
          label: '⏪ 回溯抉择',
          condition: '回溯重新抉择',
        });
      }
    }
  }

  return {
    startNodeId: clips[0].clipId,
    nodes,
    edges,
  };
}
