/**
 * client/src/components/GddWorldBibleViewer.tsx
 * 第一阶段产物展示：首屏直接呈现「故事流向拓扑图」，点击节点自动定位到下方对应说明（含片段剧情与互动点）
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  GDDArtifact,
  UniversalPrdSpec,
  PrdClipNode,
  PrdInteractionNode,
  PrdEndingNode,
  PrdStateChange,
} from '../types/index.js';
import {
  PlannerTopologyDiagram,
  type TopoNodeFocusRequest,
} from './PlannerTopologyDiagram.js';

interface GddWorldBibleViewerProps {
  gdd?: GDDArtifact;
}

type OrderedNodeEntry =
  | { id: string; kind: 'clip'; clip: PrdClipNode; isStart: boolean }
  | { id: string; kind: 'interaction'; interaction: PrdInteractionNode }
  | { id: string; kind: 'ending'; ending: PrdEndingNode };

function formatStateChangeItems(sc?: PrdStateChange): string[] {
  if (!sc) return [];
  const items: string[] = [];
  if (sc.add) {
    for (const [k, v] of Object.entries(sc.add)) {
      items.push(`${k} ${v >= 0 ? `+${v}` : v}`);
    }
  }
  if (sc.set) {
    for (const [k, v] of Object.entries(sc.set)) {
      const valText = Array.isArray(v) ? `[${v.join(', ')}]` : String(v);
      items.push(`${k} = ${valText}`);
    }
  }
  return items;
}

function buildOrderedNodeEntries(prd: UniversalPrdSpec): OrderedNodeEntry[] {
  const clipMap = new Map(prd.clips.map((c) => [c.id, c]));
  const interMap = new Map(prd.interactions.map((i) => [i.id, i]));
  const endingMap = new Map(prd.endings.map((e) => [e.id, e]));

  const added = new Set<string>();
  const entries: OrderedNodeEntry[] = [];

  const pushClip = (clip: PrdClipNode) => {
    if (added.has(clip.id)) return;
    added.add(clip.id);
    entries.push({
      id: clip.id,
      kind: 'clip',
      clip,
      isStart: clip.id === prd.startNodeId,
    });
  };

  const pushInteractionChain = (startInterId: string) => {
    const queue = [startInterId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (added.has(cur) || !interMap.has(cur)) continue;
      added.add(cur);
      entries.push({
        id: cur,
        kind: 'interaction',
        interaction: interMap.get(cur)!,
      });
      for (const edge of prd.wiring) {
        if (edge.from === cur && interMap.has(edge.to) && !added.has(edge.to)) {
          queue.push(edge.to);
        }
      }
    }
  };

  // 按主/支片段顺带其后紧跟的互动点顺序排列，便于对照故事流阅读
  for (const clip of prd.clips) {
    pushClip(clip);
    for (const edge of prd.wiring) {
      if (edge.from === clip.id && interMap.has(edge.to)) {
        pushInteractionChain(edge.to);
      }
    }
  }

  for (const inter of prd.interactions) {
    if (!added.has(inter.id)) {
      pushInteractionChain(inter.id);
    }
  }

  for (const ending of prd.endings) {
    if (!added.has(ending.id)) {
      added.add(ending.id);
      entries.push({ id: ending.id, kind: 'ending', ending });
    }
  }

  // 防遗漏：确保任何引用到 clipMap/endingMap 的节点都收录在内
  for (const clip of clipMap.values()) pushClip(clip);
  for (const ending of endingMap.values()) {
    if (!added.has(ending.id)) {
      added.add(ending.id);
      entries.push({ id: ending.id, kind: 'ending', ending });
    }
  }

  return entries;
}

export const GddWorldBibleViewer: React.FC<GddWorldBibleViewerProps> = ({
  gdd,
}) => {
  const [subTab, setSubTab] = useState<'topology' | 'script' | 'prd'>('topology');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [pulsingNodeId, setPulsingNodeId] = useState<string | null>(null);
  const [focusPulseSeq, setFocusPulseSeq] = useState<number>(0);
  const [topoFocusRequest, setTopoFocusRequest] = useState<TopoNodeFocusRequest | null>(null);
  const [nodeFilter, setNodeFilter] = useState<'clip' | 'interaction' | 'ending'>('clip');
  const [showOverview, setShowOverview] = useState<boolean>(false);

  const detailRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const pendingScrollIdRef = useRef<string | null>(null);

  // 切项目/新 GDD 时重置选中态与默认分页
  useEffect(() => {
    setSelectedNodeId(null);
    setPulsingNodeId(null);
    setFocusPulseSeq(0);
    setTopoFocusRequest(null);
    setNodeFilter(
      gdd?.prd?.clips?.length
        ? 'clip'
        : gdd?.prd?.interactions?.length
          ? 'interaction'
          : gdd?.prd?.endings?.length
            ? 'ending'
            : 'clip'
    );
    pendingScrollIdRef.current = null;
  }, [gdd?.title, gdd?.prd?.startNodeId]);

  const orderedEntries = useMemo(() => {
    if (!gdd?.prd) return [];
    return buildOrderedNodeEntries(gdd.prd);
  }, [gdd?.prd]);

  const nodeTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of orderedEntries) {
      if (entry.kind === 'clip') map.set(entry.id, entry.clip.title);
      else if (entry.kind === 'interaction') map.set(entry.id, entry.interaction.kind);
      else map.set(entry.id, `${entry.ending.endingType}·${entry.ending.title}`);
    }
    return map;
  }, [orderedEntries]);

  // 选中节点后自动切到对应分页并平滑居中定位到目标卡片、高亮闪烁提示
  useEffect(() => {
    const targetId = pendingScrollIdRef.current;
    if (!targetId || subTab !== 'topology') return;
    const el = detailRefs.current.get(targetId);
    if (!el) return;

    pendingScrollIdRef.current = null;
    setPulsingNodeId(null);
    let raf2 = 0;
    let timer: number | undefined;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setPulsingNodeId(targetId);
        timer = window.setTimeout(() => {
          setPulsingNodeId((prev) => (prev === targetId ? null : prev));
        }, 1200);
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [selectedNodeId, focusPulseSeq, nodeFilter, subTab]);

  const focusNodeAndScroll = (nodeId: string) => {
    const entry = orderedEntries.find((e) => e.id === nodeId);
    if (entry) {
      setNodeFilter(entry.kind);
    }
    pendingScrollIdRef.current = nodeId;
    setSelectedNodeId(nodeId);
    setFocusPulseSeq((s) => s + 1);
  };

  const backToTopologyNode = (nodeId: string) => {
    pendingScrollIdRef.current = null;
    setSelectedNodeId(nodeId);
    setTopoFocusRequest((prev) => ({
      nodeId,
      seq: (prev?.seq ?? 0) + 1,
    }));
  };

  if (!gdd) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🗺️</div>
        <h3 style={{ color: '#fff', marginBottom: '8px' }}>暂未生成第一阶段策划案</h3>
        <p>请在左侧对话框向 AI 视听总导演描述创意，并授权推演第一阶段策划与故事流向。</p>
      </div>
    );
  }

  const prd = gdd.prd;
  const visibleEntries = orderedEntries.filter((e) => e.kind === nodeFilter);
  const hasSelectedInCurrentTab = visibleEntries.some((e) => e.id === selectedNodeId);

  const initialVarCount = Object.keys(gdd.globalStateMachine?.variables || {}).length;
  const initialFlagCount = Object.keys(gdd.globalStateMachine?.flags || {}).length;
  const initialInvCount = (gdd.globalStateMachine?.inventory || []).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 顶部栏：作品抬头 + 辅助视图切换 */}
      <div className="gdd-top-bar">
        <div className="gdd-top-meta">
          <h2 className="gdd-top-title">《{gdd.title}》</h2>
          <span className="brand-badge">{gdd.genre || '互动影游'}</span>
          {prd && (
            <span className="gdd-top-counts">
              {prd.clips.length} 片段 · {prd.interactions.length} 互动点 · {prd.endings.length} 结局
            </span>
          )}
        </div>

        <div className="gdd-top-tabs">
          <button
            type="button"
            className={`btn ${subTab === 'topology' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSubTab('topology')}
          >
            🗺️ 故事流向拓扑图
          </button>
          <button
            type="button"
            className={`btn ${subTab === 'script' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSubTab('script')}
          >
            📖 剧本原文
          </button>
          <button
            type="button"
            className={`btn ${subTab === 'prd' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSubTab('prd')}
          >
            📑 PRD
          </button>
        </div>
      </div>

      {subTab === 'topology' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* 上半区：直接就是故事流向拓扑图 */}
          {prd ? (
            <div className="topo-section-anchor">
              <PlannerTopologyDiagram
                prd={prd}
                storySections={gdd.storySections}
                selectedNodeId={selectedNodeId}
                focusNodeRequest={topoFocusRequest}
                onSelectNode={focusNodeAndScroll}
                onClearSelection={() => setSelectedNodeId(null)}
              />
              {selectedNodeId && (
                <div className="topo-selection-bar">
                  <span className="topo-selection-info">
                    <span>📍 当前选中：</span>
                    <code className="node-id-code">{selectedNodeId}</code>
                    <strong>{nodeTitleMap.get(selectedNodeId) || ''}</strong>
                  </span>
                  <div className="topo-selection-actions">
                    <button
                      type="button"
                      className="node-jump-pill"
                      onClick={() => focusNodeAndScroll(selectedNodeId)}
                    >
                      ↓ 查看详细说明
                    </button>
                    <button
                      type="button"
                      className="node-back-top-btn"
                      onClick={() => setSelectedNodeId(null)}
                    >
                      取消选中
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="panel-card" style={{ borderColor: 'rgba(245, 158, 11, 0.4)' }}>
              <div style={{ fontSize: '13px', color: 'var(--accent-amber)' }}>
                ⚠️ 当前产物未附带结构化 PRD（clips/interactions/wiring），暂以节拍概览展示。
              </div>
            </div>
          )}

          {/* 全局背景与初始流外状态折叠条（不喧宾夺主，随时展开核对） */}
          <div className="gdd-overview-strip">
            <div
              className="gdd-overview-toggle"
              onClick={() => setShowOverview((v) => !v)}
            >
              <div className="gdd-overview-summary">
                <span className="gdd-overview-pill">世界观 & 流外状态</span>
                <span className="gdd-overview-hook">{gdd.hook}</span>
                <span className="gdd-overview-stats">
                  变量 {initialVarCount} · 旗标 {initialFlagCount} · 物品 {initialInvCount}
                </span>
              </div>
              <span style={{ fontSize: '12px', color: 'var(--accent-cyan)', flexShrink: 0 }}>
                {showOverview ? '收起 ▲' : '展开详情 ▾'}
              </span>
            </div>

            {showOverview && (
              <div className="gdd-overview-body">
                <div className="gdd-overview-grid">
                  <div className="gdd-overview-box">
                    <div className="gdd-overview-label">👤 玩家视角与身份</div>
                    <div className="gdd-overview-text">{gdd.playerRole}</div>
                  </div>
                  {gdd.coreLoop && (
                    <div className="gdd-overview-box">
                      <div className="gdd-overview-label">🔄 玩法循环与胜负</div>
                      <div className="gdd-overview-text">{gdd.coreLoop}</div>
                    </div>
                  )}
                  {gdd.globalStateMachine?.philosophy && (
                    <div className="gdd-overview-box">
                      <div className="gdd-overview-label">🎛️ 流外状态设计</div>
                      <div className="gdd-overview-text">{gdd.globalStateMachine.philosophy}</div>
                    </div>
                  )}
                </div>

                {(initialVarCount > 0 || initialFlagCount > 0 || initialInvCount > 0) && (
                  <div className="gdd-state-chips">
                    {Object.entries(gdd.globalStateMachine.variables || {}).map(([key, v]) => (
                      <span key={`var-${key}`} className="gdd-state-chip">
                        📊 {v.name}: <strong>{v.initial}</strong>
                      </span>
                    ))}
                    {Object.entries(gdd.globalStateMachine.flags || {}).map(([key, f]) => (
                      <span key={`flag-${key}`} className="gdd-state-chip">
                        🚩 {f.name}: <strong>{String(f.initial)}</strong>
                      </span>
                    ))}
                    {(gdd.globalStateMachine.inventory || []).map((item, i) => (
                      <span key={`inv-${i}`} className="gdd-state-chip">
                        🗝️ {item}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 下半区：对应所有拓扑节点的详细说明（点击上方节点自动平滑定位到此） */}
          {prd ? (
            <div className="node-details-section">
              <div className="node-details-header">
                <div className="node-details-title">
                  <span>📋 节点详细说明</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 400 }}>
                    共 {orderedEntries.length} 个节点（点击上方节点自动切入对应分类并高亮定位）
                  </span>
                </div>

                <div className="node-filter-group">
                  <button
                    type="button"
                    className={`node-filter-btn ${nodeFilter === 'clip' ? 'active' : ''}`}
                    onClick={() => setNodeFilter('clip')}
                  >
                    🎬 片段剧情 ({prd.clips.length})
                  </button>
                  <button
                    type="button"
                    className={`node-filter-btn ${nodeFilter === 'interaction' ? 'active' : ''}`}
                    onClick={() => setNodeFilter('interaction')}
                  >
                    🎮 互动点 ({prd.interactions.length})
                  </button>
                  <button
                    type="button"
                    className={`node-filter-btn ${nodeFilter === 'ending' ? 'active' : ''}`}
                    onClick={() => setNodeFilter('ending')}
                  >
                    🏆 结局 ({prd.endings.length})
                  </button>
                </div>
              </div>

              <div className="node-details-list">
                {visibleEntries.map((entry) => {
                  const isSelected = selectedNodeId === entry.id;
                  const isPulsing = pulsingNodeId === entry.id;
                  const siblingMuted = hasSelectedInCurrentTab && !isSelected;
                  const stateClasses = `${isSelected ? 'selected' : siblingMuted ? 'dimmed-sibling' : ''} ${isPulsing ? 'pulse-retrigger' : ''}`.trim();

                  if (entry.kind === 'clip') {
                    const sec = gdd.storySections?.[entry.id];
                    const narrativeText = sec?.narrativeText?.trim() || '';

                    return (
                      <div
                        key={entry.id}
                        id={`node-detail-${entry.id}`}
                        ref={(el) => {
                          detailRefs.current.set(entry.id, el);
                        }}
                        className={`node-detail-card kind-clip ${stateClasses}`}
                      >
                        <div className="node-detail-head">
                          <div className="node-detail-head-left">
                            {isSelected && <span className="node-focused-tag">📍 当前定位</span>}
                            <span className={`node-kind-pill ${entry.isStart ? 'start' : 'clip'}`}>
                              {entry.isStart ? '🎬 起点片段' : '🎬 剧情片段'}
                            </span>
                            <code className="node-id-code">{entry.id}</code>
                            <span className="node-detail-name">{entry.clip.title}</span>
                            <span className="node-video-tag">🎥 {entry.clip.video}</span>
                          </div>
                          <button
                            type="button"
                            className="node-back-top-btn"
                            onClick={() => backToTopologyNode(entry.id)}
                          >
                            ↑ 回到节点
                          </button>
                        </div>

                        <div className="node-story-body">
                          {narrativeText || '（暂无本幕剧本正文）'}
                        </div>
                      </div>
                    );
                  }

                  if (entry.kind === 'interaction') {
                    const inter = entry.interaction;
                    const configEntries = inter.config ? Object.entries(inter.config) : [];

                    return (
                      <div
                        key={entry.id}
                        id={`node-detail-${entry.id}`}
                        ref={(el) => {
                          detailRefs.current.set(entry.id, el);
                        }}
                        className={`node-detail-card kind-interaction ${stateClasses}`}
                      >
                        <div className="node-detail-head">
                          <div className="node-detail-head-left">
                            {isSelected && <span className="node-focused-tag">📍 当前定位</span>}
                            <span className="node-kind-pill interaction">
                              🎮 互动点 · {inter.kind}
                            </span>
                            <code className="node-id-code">{inter.id}</code>
                            <span className="node-timeout-pill">
                              {typeof inter.timeoutSec === 'number'
                                ? `⏱️ 限时 ${inter.timeoutSec}s`
                                : '♾️ 不限时'}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="node-back-top-btn"
                            onClick={() => backToTopologyNode(entry.id)}
                          >
                            ↑ 回到节点
                          </button>
                        </div>

                        <div className="node-inter-prompt">
                          <span className="node-inter-prompt-label">操作提示：</span>
                          <span>{inter.prompt}</span>
                        </div>

                        {configEntries.length > 0 && (
                          <div className="node-inter-config">
                            <span className="node-links-label">玩法参数 (config)：</span>
                            {configEntries.map(([k, v]) => (
                              <code key={k} className="node-config-chip">
                                {k}: {JSON.stringify(v)}
                              </code>
                            ))}
                          </div>
                        )}

                        <div className="node-outcomes-list">
                          {inter.outcomes.map((o) => {
                            const stateItems = formatStateChangeItems(o.stateChange);

                            return (
                              <div key={o.key} className="node-outcome-row">
                                <div className="node-outcome-main">
                                  <span className="node-outcome-key">{o.key}</span>
                                  <span className="node-outcome-label">{o.label}</span>
                                  {o.feedback && (
                                    <span className="node-outcome-feedback">反馈：{o.feedback}</span>
                                  )}
                                  {stateItems.map((st, idx) => (
                                    <span key={idx} className="node-state-badge">
                                      🎛️ {st}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  // ending card
                  const ending = entry.ending;
                  return (
                    <div
                      key={entry.id}
                      id={`node-detail-${entry.id}`}
                      ref={(el) => {
                        detailRefs.current.set(entry.id, el);
                      }}
                      className={`node-detail-card kind-ending ${ending.isVictory ? 'victory' : 'defeat'} ${stateClasses}`}
                    >
                      <div className="node-detail-head">
                        <div className="node-detail-head-left">
                          {isSelected && <span className="node-focused-tag">📍 当前定位</span>}
                          <span className={`node-kind-pill ${ending.isVictory ? 'victory' : 'defeat'}`}>
                            {ending.isVictory ? `🏆 ${ending.endingType} · 通关结局` : `💀 ${ending.endingType} · 终局`}
                          </span>
                          <code className="node-id-code">{ending.id}</code>
                          <span className="node-detail-name">{ending.title}</span>
                        </div>
                        <button
                          type="button"
                          className="node-back-top-btn"
                          onClick={() => backToTopologyNode(entry.id)}
                        >
                          ↑ 回到节点
                        </button>
                      </div>

                      <div className="node-story-body">
                        {ending.summary}
                      </div>

                      {ending.rewindTargetClipId && (
                        <div className="node-links-footer">
                          <div className="node-links-group">
                            <span className="node-links-label">回溯重选：</span>
                            <button
                              type="button"
                              className="node-jump-pill rewind"
                              onClick={() => focusNodeAndScroll(ending.rewindTargetClipId!)}
                            >
                              🔄 回溯重选至 {ending.rewindTargetClipId}
                              {nodeTitleMap.get(ending.rewindTargetClipId)
                                ? ` (${nodeTitleMap.get(ending.rewindTargetClipId)})`
                                : ''}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            gdd.beatOutline &&
            gdd.beatOutline.length > 0 && (
              <div className="panel-card">
                <div className="panel-card-title">
                  <span>🗺️ 叙事节拍列表 (共 {gdd.beatOutline.length} 拍)</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {gdd.beatOutline.map((beat) => (
                    <div
                      key={beat.beatId}
                      style={{
                        background: 'var(--bg-elevated)',
                        padding: '12px 14px',
                        borderRadius: '6px',
                        borderLeft: beat.isEnding
                          ? '3px solid var(--accent-amber)'
                          : '3px solid var(--accent-cyan)',
                      }}
                    >
                      <div style={{ fontWeight: 600, color: '#fff', marginBottom: '4px' }}>
                        [{beat.act}] {beat.title} ({beat.beatId})
                      </div>
                      <div style={{ fontSize: '12px', color: '#cbd5e1' }}>{beat.dramaticGoal}</div>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      )}

      {subTab === 'script' &&
        (gdd.spineScript ? (
          <pre className="gdd-raw-pre">{gdd.spineScript}</pre>
        ) : (
          <div className="gdd-raw-empty">当前项目暂无未切分前的剧本原文记录。</div>
        ))}

      {subTab === 'prd' &&
        (gdd.markdown ? (
          <pre className="gdd-raw-pre">{gdd.markdown}</pre>
        ) : (
          <div className="gdd-raw-empty">当前项目暂无 PRD 文档。</div>
        ))}
    </div>
  );
};
