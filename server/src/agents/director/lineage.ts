/**
 * agents/director/lineage.ts
 * 产物血缘图与影响面查询 (Artifact Lineage & Impact Query)
 *
 * ── 为什么需要 ──
 * 「改了李明，哪些镜头要重做？」这个问题目前只能靠 cascadeStages 按阶段粗粒度
 * 作废（一改就整段重算），或者干脆假装没变——因为它答不出来。答案其实一直
 * 散落在各份产物里，只是从来没人把它们连起来：
 *
 *   storyGraph.nodes[].characterNames   →  节点声明了哪些角色
 *   scene.dialogues[].speaker           →  场次里谁说话
 *   shot.nodeId / keyframe.shotId / clip.shotId  →  派生的结构链
 *
 * ── 两种边，语义不同，混用就会误伤 ──
 *   declares（声明）：角色 → 某产物条目。表示"这个条目里出现了这个角色"。
 *   derives（派生）：上游条目 → 下游资产。表示"下游是由上游算出来的"。
 *
 * 分开的理由是实打实踩出来的：若让角色变更顺着 node 一直传到该节点下所有镜头，
 * 那么"节点里有李明，但第 2 个镜头是空镜"这种情况会把空镜也算成受影响。
 * 所以角色变更只在 declares 边上游走；只有「节点本身被改」时才沿 derives 向下全传。
 * 镜头若自带 characterIds（精确声明），就不再接受来自节点的角色传导。
 *
 * ── 边界 ──
 * 本模块只做「算」，不做「做」：不触发重渲、不写盘、不改任何产物。
 * 渲染是唯一花真钱的动作，必须由人确认后再执行。
 */

/** stageArtifacts 的键（WorkflowStage 值）与 TEXT_FILES 的键都认 */
const STAGE_ALIASES: Record<string, string> = {
  'narrative_design': 'story-bible',
  'narrative-design': 'story-bible',
  'story_bible': 'story-bible',
  'character_design': 'character-design',
  'character-design': 'character-design',
  'scene_script': 'scene-script',
  'scene-script': 'scene-script',
  'storyboard': 'storyboard',
  'keyframe_reference': 'keyframe',
  'keyframe-reference': 'keyframe',
  'keyframe': 'keyframe',
  'video_production': 'clip',
  'video-production': 'clip',
  'clip': 'clip',
  'fmv_packaging': 'manifest',
};

export type LineageKind = 'character' | 'node' | 'scene' | 'shot' | 'keyframe' | 'clip';

/** declares：角色出现在这个条目里；derives：下游由上游派生 */
export type EdgeKind = 'declares' | 'derives';

export interface LineageNode {
  id: string;
  kind: LineageKind;
  label: string;
  /** 上游节点键 */
  parents: string[];
  /** 与 parents 一一对应的边类型 */
  parentEdges: EdgeKind[];
}

export interface LineageGraph {
  nodes: Map<string, LineageNode>;
  /** 上游键 → 下游 [下游键, 边类型] */
  children: Map<string, Array<{ id: string; edge: EdgeKind }>>;
  /** 自带精确出镜声明的条目（镜头 characterIds / 场次 speaker） */
  preciseIds: Set<string>;
  /** 有多少镜头自带精确出镜角色 */
  preciseShotCount: number;
  totalShotCount: number;
  /** 建图时缺失的关键产物 */
  missing: string[];
}

export interface ImpactQuery {
  /** 角色名或 characterId */
  characters?: string[];
  /** 剧情节点 id，如 node_2 */
  nodeIds?: string[];
  /** 镜头 id，如 shot_3 */
  shotIds?: string[];
}

export interface ImpactHit {
  id: string;
  /** 归因链，从本节点向上游回溯，形如 [clip_shot_1, shot_1, 灾难降临, 李明] */
  chain: string[];
}

export interface ImpactResult {
  characters: ImpactHit[];
  nodes: ImpactHit[];
  scenes: ImpactHit[];
  shots: ImpactHit[];
  keyframes: ImpactHit[];
  clips: ImpactHit[];
  /** 影响面是否因缺数据而不完整 */
  incomplete: boolean;
  missing: string[];
  /** shot：镜头级精确；node：按节点粗算（可能多算，安全侧） */
  usedGranularity: 'shot' | 'node';
  /** 一句话结论，可直接进对话气泡或待确认卡片 */
  summary: string;
}

function asArray<T = any>(value: any): T[] {
  return Array.isArray(value) ? value : [];
}

function str(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normKey(key: string): string {
  return STAGE_ALIASES[key] || key;
}

function pickArtifact(stageArtifacts: Record<string, any> | undefined, logicalKey: string): any {
  for (const [k, v] of Object.entries(stageArtifacts || {})) {
    if (normKey(k) === logicalKey) return v;
  }
  return undefined;
}

/**
 * 从全部产物构建血缘图。
 *
 * 容错口径：任何一层产物缺失都不抛错，只记入 missing——影响面查询必须能在
 * 「只跑到第 3 步」的项目上工作，否则它就只能在完工后才用得上，没有意义。
 */
export function buildLineage(stageArtifacts: Record<string, any> | undefined): LineageGraph {
  const nodes = new Map<string, LineageNode>();
  const children = new Map<string, Array<{ id: string; edge: EdgeKind }>>();
  const missing: string[] = [];
  /** 自带出镜声明的条目（含空声明：声明了"这里没有角色"也是精确信息） */
  const preciseIds = new Set<string>();
  /** 自带 characterIds 的镜头数，用于判断影响面精度 */
  let preciseShotCount = 0;

  const add = (id: string, kind: LineageKind, label: string, parents: Array<[string, EdgeKind]>) => {
    const existing = nodes.get(id);
    if (existing) {
      for (const [p, edge] of parents) {
        if (!p) continue;
        if (existing.parents.includes(p)) continue;
        existing.parents.push(p);
        existing.parentEdges.push(edge);
        linkChild(p, id, edge);
      }
      return;
    }
    const node: LineageNode = {
      id,
      kind,
      label,
      parents: [],
      parentEdges: [],
    };
    for (const [p, edge] of parents) {
      if (!p) continue;
      if (!node.parents.includes(p)) {
        node.parents.push(p);
        node.parentEdges.push(edge);
      }
    }
    nodes.set(id, node);
    for (let i = 0; i < node.parents.length; i++) {
      linkChild(node.parents[i], id, node.parentEdges[i]);
    }
  };

  function linkChild(parent: string, child: string, edge: EdgeKind) {
    if (!children.has(parent)) children.set(parent, []);
    const list = children.get(parent)!;
    if (!list.some((c) => c.id === child && c.edge === edge)) list.push({ id: child, edge });
  }

  const bible = pickArtifact(stageArtifacts, 'story-bible');
  if (!bible) missing.push('story-bible');

  /* ── 角色 ── */
  const nameToCharKey = new Map<string, string>();
  const idToCharKey = new Map<string, string>();
  for (const c of asArray(bible?.characters)) {
    const name = str(c?.name);
    const cid = str(c?.characterId);
    if (!name && !cid) continue;
    const key = `character:${cid || name}`;
    add(key, 'character', name || cid, []);
    if (name) nameToCharKey.set(name, key);
    if (cid) idToCharKey.set(cid, key);
  }
  // characterNames 索引表里有、characters 里没有的名字也建节点，否则引用查不到归属
  for (const n of asArray<string>(bible?.characterNames)) {
    const name = str(n);
    if (!name || nameToCharKey.has(name)) continue;
    const key = `character:${name}`;
    nameToCharKey.set(name, key);
    add(key, 'character', name, []);
  }

  const resolveChar = (ref: any): string | null => {
    const raw = str(ref);
    if (!raw) return null;
    return idToCharKey.get(raw) || nameToCharKey.get(raw) || `character:${raw}`;
  };

  /* ── 剧情节点 ── */
  const rawNodes = asArray(bible?.storyGraph?.nodes);
  if (bible && rawNodes.length === 0) missing.push('storyGraph.nodes');
  const nodeIds = new Set<string>();
  for (const n of rawNodes) {
    const nodeId = str(n?.id);
    if (!nodeId) continue;
    nodeIds.add(nodeId);
    const declared = Array.from(
      new Set(
        asArray<string>(n?.characterNames)
          .map(resolveChar)
          .filter((x): x is string => !!x)
      )
    );
    add(`node:${nodeId}`, 'node', str(n?.title) || nodeId, declared.map((c) => [c, 'declares'] as [string, EdgeKind]));
  }

  /* ── 场次（分场剧本） ── */
  const script = pickArtifact(stageArtifacts, 'scene-script');
  if (!script) missing.push('scene-script');
  asArray(script?.scenes).forEach((scene: any, idx: number) => {
    const nodeId = str(scene?.nodeId);
    if (!nodeId) return;
    const parents: Array<[string, EdgeKind]> = [];
    if (nodeIds.has(nodeId)) parents.push([`node:${nodeId}`, 'derives']);
    else missing.push(`node:${nodeId}（仅存在于分场剧本）`);
    // 说话人本身就说明谁出场，比节点级更准，按 declares 处理
    const speakers = Array.from(
      new Set(
        asArray(scene?.dialogues)
          .map((d: any) => resolveChar(d?.speaker))
          .filter((x): x is string => !!x)
      )
    );
    for (const key of speakers) parents.push([key as string, 'declares']);
    const sceneKey = `scene:${nodeId}#${idx + 1}`;
    if (Array.isArray(scene?.dialogues)) preciseIds.add(sceneKey);
    add(sceneKey, 'scene', str(scene?.sceneTitle) || `${nodeId} 第 ${idx + 1} 场`, parents);
  });

  /* ── 镜头（分镜） ── */
  const storyboard = pickArtifact(stageArtifacts, 'storyboard');
  if (!storyboard) missing.push('storyboard');
  const shots = asArray(storyboard?.shots);

  for (const shot of shots) {
    const shotId = str(shot?.shotId);
    if (!shotId) continue;
    const parents: Array<[string, EdgeKind]> = [];
    const nodeId = str(shot?.nodeId);
    if (nodeId) {
      parents.push([`node:${nodeId}`, 'derives']);
      if (!nodeIds.has(nodeId)) missing.push(`node:${nodeId}（仅存在于分镜）`);
    }
    // 镜头级出镜角色：精确声明，用于把影响面收窄到真正出镜的镜头。
    // 优先 characterIds（稳定），回落 characterNames（模型原始输出，改名后可能失效）
    const declaredRaw = Array.isArray(shot?.characterIds)
      ? shot.characterIds
      : Array.isArray(shot?.characterNames)
        ? shot.characterNames
        : null;
    const shotChars = Array.from(
      new Set(
        asArray<string>(declaredRaw)
          .map((c) => resolveChar(c))
          .filter((x): x is string => !!x)
      )
    );
    if (declaredRaw) {
      preciseIds.add(`shot:${shotId}`);
      preciseShotCount++;
    }
    for (const c of shotChars) parents.push([c, 'declares']);

    add(
      `shot:${shotId}`,
      'shot',
      `${shotId}${str(shot?.shotScale) ? `（${str(shot.shotScale)}）` : ''}`,
      parents
    );
  }

  /* ── 关键帧 ── */
  const keyframes = asArray(pickArtifact(stageArtifacts, 'keyframe')?.shots);
  for (const kf of keyframes) {
    const shotId = str(kf?.shotId);
    if (!shotId) continue;
    if (!nodes.has(`shot:${shotId}`)) missing.push(`shot:${shotId}（仅存在于关键帧）`);
    add(`keyframe:${shotId}`, 'keyframe', `首帧 ${shotId}`, [[`shot:${shotId}`, 'derives']]);
  }

  /* ── 视频片段 ── */
  const clips = asArray(pickArtifact(stageArtifacts, 'clip')?.clips);
  for (const clip of clips) {
    const clipId = str(clip?.clipId);
    if (!clipId) continue;
    const shotId = str(clip?.shotId);
    const parents: Array<[string, EdgeKind]> = [];
    if (shotId) {
      parents.push([`shot:${shotId}`, 'derives']);
      if (!nodes.has(`shot:${shotId}`)) missing.push(`shot:${shotId}（仅存在于片段）`);
    }
    // 片段若自带出镜角色（未来字段），一并入图，删角色时可直接命中
    for (const key of new Set(
      asArray<string>(clip?.characterIds)
        .map(resolveChar)
        .filter((x): x is string => !!x)
    )) {
      parents.push([key as string, 'declares']);
    }
    add(`clip:${clipId}`, 'clip', clipId, parents);
  }

  return {
    nodes,
    children,
    preciseIds,
    preciseShotCount,
    totalShotCount: shots.length,
    missing: Array.from(new Set(missing)),
  };
}

/** 沿某条边类型向下遍历，返回 id → 归因链（本节点在前，上游在后） */
function walk(
  graph: LineageGraph,
  start: string,
  edge: EdgeKind,
  opts: { skipPreciseShots?: boolean; reached?: Set<string> } = {}
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const reached = opts.reached || new Set<string>();
  const label = (id: string) => graph.nodes.get(id)?.label || id.split(':')[1] || id;

  const queue: Array<{ id: string; chain: string[] }> = [{ id: start, chain: [label(start)] }];
  reached.add(`${edge}:${start}`);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const { id: childId, edge: childEdge } of graph.children.get(cur.id) || []) {
      if (childEdge !== edge) continue;
      /*
       * 角色变更不穿透到「自己声明了出镜表」的下游条目：
       * 镜头里没写李明，说明这个镜头他不出镜，改他不该让这个镜头重渲。
       * 只有「节点本身被改」才向下全传（那条路径不传 skipPreciseShots）。
       */
      if (opts.skipPreciseShots && childEdge === 'derives' && graph.preciseIds.has(childId)) {
        continue;
      }
      const visitKey = `${edge}:${childId}`;
      if (reached.has(visitKey)) continue;
      reached.add(visitKey);
      const chain = [label(childId), ...cur.chain];
      result.set(childId, chain);
      queue.push({ id: childId, chain });
    }
  }
  return result;
}

function collect(
  graph: LineageGraph,
  hits: Map<string, string[]>,
  kind: LineageKind,
  out: ImpactHit[]
): void {
  for (const [id, chain] of hits) {
    const node = graph.nodes.get(id);
    if (node?.kind !== kind) continue;
    out.push({ id: id.slice(id.indexOf(':') + 1), chain });
  }
}

/**
 * 影响面查询：给定变更集合，返回全部失效下游。
 *
 * 语义区分：
 *   - 改角色 → 只走 declares（谁提到了他），镜头自带出镜表时不再受节点传导；
 *   - 改节点 → 沿 derives 向下全传（节点本身变了，其下镜头都基于旧节点）。
 * 空查询返回空结果——宁可不动，也不要在没弄清改了什么时全量重渲。
 */
export function queryImpact(graph: LineageGraph, query: ImpactQuery): ImpactResult {
  const result: ImpactResult = {
    characters: [],
    nodes: [],
    scenes: [],
    shots: [],
    keyframes: [],
    clips: [],
    incomplete: graph.missing.length > 0,
    missing: [...graph.missing],
    usedGranularity:
      graph.totalShotCount > 0 && graph.preciseShotCount >= graph.totalShotCount
        ? 'shot'
        : 'node',
    summary: '',
  };

  const charStarts = new Set<string>();
  const nodeStarts = new Set<string>();
  const shotStarts = new Set<string>();

  for (const raw of query.characters || []) {
    const name = str(raw);
    if (!name) continue;
    if (graph.nodes.has(`character:${name}`)) {
      charStarts.add(`character:${name}`);
      continue;
    }
    const byLabel = Array.from(graph.nodes.values()).find(
      (n) => n.kind === 'character' && n.label === name
    );
    if (byLabel) charStarts.add(byLabel.id);
  }
  for (const raw of query.nodeIds || []) {
    const id = str(raw).replace(/^node:/, '');
    if (id && graph.nodes.has(`node:${id}`)) nodeStarts.add(`node:${id}`);
  }
  for (const raw of query.shotIds || []) {
    const id = str(raw).replace(/^shot:/, '');
    if (id && graph.nodes.has(`shot:${id}`)) shotStarts.add(`shot:${id}`);
  }

  if (charStarts.size + nodeStarts.size + shotStarts.size === 0) {
    result.summary = '未定位到任何可追踪的上游对象，影响面按空处理（不会触发重算）。';
    return result;
  }

  const merged = new Map<string, string[]>();
  const merge = (m: Map<string, string[]>, tail: string[] = []) => {
    for (const [id, chain] of m) {
      if (merged.has(id)) continue;
      merged.set(id, tail.length ? [...chain, ...tail] : chain);
    }
  };

  // 角色变更：先走声明边（谁提到了他），命中条目后再沿派生边扩散到其下游资产
  for (const start of charStarts) {
    const declared = walk(graph, start, 'declares', { skipPreciseShots: true });
    merge(declared);
    for (const [hitId, declaredChain] of declared) {
      const hit = graph.nodes.get(hitId);
      if (!hit) continue;
      if (hit.kind === 'node') {
        // 扩到该节点下的镜头/首帧/片段；精确登记的镜头自己说了算，不穿透
        merge(walk(graph, hitId, 'derives', { skipPreciseShots: true }), declaredChain.slice(1));
      } else if (hit.kind === 'shot') {
        // 镜头自己就出镜了：它的首帧和片段必然失效
        merge(walk(graph, hitId, 'derives'), declaredChain.slice(1));
      }
    }
  }

  // 节点变更：派生边向下全传（节点自身变了，其下产物都基于旧节点）
  for (const start of nodeStarts) {
    merge(walk(graph, start, 'declares'));
    merge(walk(graph, start, 'derives'));
  }

  // 镜头变更：从其下游资产起算
  for (const start of shotStarts) {
    merge(new Map([[start, [graph.nodes.get(start)?.label || start]]]));
    merge(walk(graph, start, 'derives'));
  }

  collect(graph, merged, 'character', result.characters);
  collect(graph, merged, 'node', result.nodes);
  collect(graph, merged, 'scene', result.scenes);
  collect(graph, merged, 'shot', result.shots);
  collect(graph, merged, 'keyframe', result.keyframes);
  collect(graph, merged, 'clip', result.clips);

  result.summary = buildSummary(result);
  return result;
}

function buildSummary(r: ImpactResult): string {
  const parts: string[] = [];
  if (r.scenes.length) parts.push(`${r.scenes.length} 场戏`);
  if (r.shots.length) parts.push(`${r.shots.length} 个镜头`);
  if (r.keyframes.length) parts.push(`${r.keyframes.length} 张首帧图`);
  if (r.clips.length) parts.push(`${r.clips.length} 段视频`);
  if (parts.length === 0) {
    return r.incomplete
      ? '未找到受影响的已生成资产（部分产物缺失，影响面可能不完整）。'
      : '没有已生成的下游资产需要重做。';
  }
  const granularityNote = r.usedGranularity === 'node' ? '（镜头未登记出镜角色，按节点粗算，可能多算）' : '';
  const incompleteNote = r.incomplete
    ? `；注意：${r.missing.slice(0, 3).join('、')} 缺失，结果可能不完整`
    : '';
  return `受影响：${parts.join('、')}${granularityNote}${incompleteNote}。`;
}
