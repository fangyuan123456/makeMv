/**
 * client/src/components/TextGameCockpit.tsx
 * 独立可玩文游 (index.html) 预览 + 0-Token 本地试玩座舱
 *
 * 角色定妆 / 关键帧批量渲染已内聚到阶段二，不再需要客户端确认；
 * 阶段二直接产出 text-game/index.html，默认以 iframe 呈现，玩家在游戏内修改后续接入。
 */

import React, { useState, useEffect, useRef } from 'react';
import type { TextGameArtifact, PlayerGameState, TextGameNode } from '../types/index.js';
import { initRuntimeGame, stepRuntimeGame, buildGameUrl } from '../lib/api.js';
import { StatusHudSvg } from './StatusHudSvg.js';
import { StoryGraphSvgDiagram } from './StoryGraphSvgDiagram.js';

function getHistoryNodeId(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object' && 'nodeId' in item) {
    return String((item as { nodeId: unknown }).nodeId || '');
  }
  return '';
}

interface TextGameCockpitProps {
  projectId: string;
  textGame?: TextGameArtifact;
  gameUrl?: string | null;
  onRefreshProject?: () => void;
}

export const TextGameCockpit: React.FC<TextGameCockpitProps> = ({
  projectId,
  textGame,
  gameUrl,
}) => {
  const [gameState, setGameState] = useState<PlayerGameState | null>(null);
  const [currentNode, setCurrentNode] = useState<TextGameNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGraphModal, setShowGraphModal] = useState(false);
  // 阶段二直接产出 index.html：默认展示独立游戏，0-Token 座舱降为可选视图
  const [viewMode, setViewMode] = useState<'standalone' | 'cockpit'>('standalone');
  const [frameKey, setFrameKey] = useState(0);
  const stageNarrativeRef = useRef<HTMLDivElement | null>(null);
  const src = gameUrl || buildGameUrl(projectId);

  const jumpToStageNode = (node: TextGameNode) => {
    setCurrentNode(node);
    requestAnimationFrame(() => {
      stageNarrativeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  useEffect(() => {
    if (gameUrl) {
      setViewMode('standalone');
      setFrameKey((k) => k + 1);
    }
  }, [gameUrl]);

  // 初始化 0-Token 试玩座舱
  const handleStartGame = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await initRuntimeGame(projectId);
      setGameState(res.state);
      setCurrentNode(res.node);
    } catch (err: any) {
      setError(err.message || '初始化试玩失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (textGame && !gameState && !loading) {
      handleStartGame();
    }
  }, [projectId, textGame]);

  // 执行玩家决策
  const handleChoice = async (choiceId: string) => {
    if (!gameState || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await stepRuntimeGame(projectId, gameState, choiceId);
      setGameState(res.state);
      setCurrentNode(res.node);
    } catch (err: any) {
      setError(err.message || '决策推进失败');
    } finally {
      setLoading(false);
    }
  };

  if (!textGame) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎮</div>
        <h3 style={{ color: '#fff', marginBottom: '8px' }}>暂未生成互动文游资产</h3>
        <p>在左侧对话里确认策划案后，再授权「生成可玩文游」即可直接产出 index.html 游戏。</p>
        {gameUrl && (
          <a className="btn btn-primary" style={{ marginTop: '16px' }} href={gameUrl} target="_blank" rel="noreferrer">
            🎮 打开已产出的游戏
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="game-workspace">
      <div className="game-toolbar">
        <div className="game-toolbar-left">
          <span className="game-toolbar-title">🎮 {textGame.title}</span>
          <span className="brand-badge" style={{ fontSize: '10px' }}>阶段二直接产出 · 无需定妆确认</span>
        </div>
        <div className="game-toolbar-actions">
          <button
            className={`btn ${viewMode === 'standalone' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '12px', padding: '5px 10px' }}
            onClick={() => {
              setViewMode('standalone');
              setFrameKey((k) => k + 1);
            }}
          >
            🕹️ 独立游戏 (index.html)
          </button>
          <button
            className={`btn ${viewMode === 'cockpit' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '12px', padding: '5px 10px' }}
            onClick={() => setViewMode('cockpit')}
          >
            🧪 0-Token 试玩座舱
          </button>
          <a
            className="btn btn-secondary"
            style={{ fontSize: '12px', padding: '5px 10px' }}
            href={src}
            target="_blank"
            rel="noreferrer"
          >
            ↗ 新窗口打开
          </a>
        </div>
      </div>

      {viewMode === 'standalone' && (
        <div className="standalone-game">
          <div className="standalone-game-screen landscape">
            <iframe
              key={frameKey}
              className="standalone-game-frame"
              src={`${src}?t=${frameKey}`}
              title={`${textGame.title} - 独立可玩文游`}
            />
          </div>
        </div>
      )}

      <div className="textgame-stage" style={{ display: viewMode === 'standalone' ? 'none' : undefined }}>
      {/* 主演视窗 */}
      <div className="stage-main">
        {/* 顶部控制栏 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-surface)', padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>🎮</span>
            <span style={{ fontWeight: 700, color: '#fff' }}>{textGame.title}</span>
            <span className="brand-badge" style={{ fontSize: '10px' }}>0-Token 纯本地试玩</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn btn-secondary"
              style={{ fontSize: '12px', padding: '5px 10px' }}
              onClick={() => setShowGraphModal(!showGraphModal)}
            >
              🗺️ {showGraphModal ? '关闭' : '展开'} SVG 故事网络图
            </button>
            <button
              className="btn btn-secondary"
              style={{ fontSize: '12px', padding: '5px 10px' }}
              onClick={handleStartGame}
            >
              🔄 重启试玩
            </button>
          </div>
        </div>

        {/* 纯 SVG HUD 状态条 (实时显示变量/旗标/物品) */}
        {gameState && <StatusHudSvg state={gameState} />}

        {error && (
          <div style={{ background: 'rgba(244, 63, 94, 0.15)', border: '1px solid #f43f5e', padding: '10px 14px', borderRadius: '6px', color: '#ff859b', fontSize: '13px' }}>
            {error}
          </div>
        )}

        {/* 场景多媒体视窗 (第一视角关键帧立绘) */}
        <div className="stage-scene-media">
          {currentNode?.visual?.imageUrl ? (
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
              <img
                src={currentNode.visual.imageUrl}
                alt={currentNode.title}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>
                    📍 场景: {currentNode.visual.locationName || '未知空间'}
                  </div>
                  {currentNode.visual.entityNames && currentNode.visual.entityNames.length > 0 && (
                    <div style={{ fontSize: '11px', color: '#cbd5e1', marginTop: '2px' }}>
                      👥 出场: {currentNode.visual.entityNames.join('、')}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                  {currentNode.visual.perspective && (
                    <div style={{ fontSize: '10px', color: 'var(--accent-cyan)', background: 'rgba(0,0,0,0.6)', padding: '2px 6px', borderRadius: '4px' }}>
                      🎥 {currentNode.visual.perspective}
                    </div>
                  )}
                  {currentNode.visual.composition && (
                    <div style={{ fontSize: '10px', color: '#94a3b8', fontStyle: 'italic', background: 'rgba(0,0,0,0.6)', padding: '2px 6px', borderRadius: '4px' }}>
                      {currentNode.visual.composition}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="stage-scene-placeholder">
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>🖼️</div>
              <div style={{ fontWeight: 600, color: '#cbd5e1' }}>【首帧视听画面待生成】</div>
              <div style={{ fontSize: '11px', marginTop: '6px', maxWidth: '460px', color: '#94a3b8' }}>
                {currentNode?.visual?.imagePromptEn || currentNode?.visual?.scenePrompt || '关键帧已在阶段二自动产出，无需单独定妆确认'}
              </div>
            </div>
          )}
        </div>

        {/* 文学叙事与演出 */}
        <div ref={stageNarrativeRef} className="stage-narrative">
          {/* 音效提示条 */}
          {currentNode?.audioCue && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--accent-amber)', background: 'rgba(245, 158, 11, 0.1)', padding: '3px 10px', borderRadius: '4px', marginBottom: '10px', borderLeft: '2px solid var(--accent-amber)' }}>
              <span>🔊</span>
              <span>听觉氛围: {currentNode.audioCue}</span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h3 style={{ color: 'var(--accent-cyan)', fontSize: '17px', margin: 0 }}>
              {currentNode?.title || '正在加载节点...'}
            </h3>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
              Node ID: {currentNode?.id}
            </span>
          </div>

          <div style={{ whiteSpace: 'pre-wrap', marginBottom: '16px', fontSize: '15px', lineHeight: 1.8, color: '#f1f5f9' }}>
            {currentNode?.narrativeText}
          </div>

          {/* 终局通知 */}
          {currentNode?.isEnding && (
            <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid var(--accent-emerald)', borderRadius: '6px', padding: '14px', textAlign: 'center', color: '#fff', margin: '14px 0' }}>
              <div style={{ fontSize: '20px', marginBottom: '4px' }}>🏆</div>
              <div style={{ fontWeight: 700, fontSize: '16px' }}>达成终局：[{currentNode.endingType || '故事收束'}]</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                当前支线推演完毕。您可以点击右上角「重启试玩」体验其他分歧路线。
              </div>
            </div>
          )}

          {/* 决策选项组 */}
          <div className="choices-group">
            {currentNode?.choices && currentNode.choices.length > 0 ? (
              currentNode.choices.map((choice) => {
                // 多态门禁判定：检查 flags、items、variables
                const missingConditions: string[] = [];
                (choice.requiredFlags || []).forEach((f) => {
                  if (!gameState?.flags?.[f]) missingConditions.push(`标记 [${f}]`);
                });
                (choice.requiredItems || []).forEach((item) => {
                  if (!gameState?.inventory?.includes(item)) missingConditions.push(`持有 [${item}]`);
                });
                if (choice.requiredVariables && gameState?.variables) {
                  Object.entries(choice.requiredVariables).forEach(([k, r]) => {
                    const val = gameState.variables[k] ?? 0;
                    if (r.gte !== undefined && val < r.gte) missingConditions.push(`${k}≥${r.gte}`);
                    if (r.lte !== undefined && val > r.lte) missingConditions.push(`${k}≤${r.lte}`);
                  });
                }
                const isLocked = missingConditions.length > 0;

                return (
                  <button
                    key={choice.id}
                    className="choice-btn"
                    disabled={loading || isLocked}
                    style={{
                      opacity: isLocked ? 0.5 : 1,
                      cursor: isLocked ? 'not-allowed' : 'pointer',
                      borderLeft: isLocked ? '3px solid #64748b' : '3px solid var(--accent-cyan)',
                    }}
                    onClick={() => handleChoice(choice.id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontWeight: 600 }}>
                        {isLocked ? '🔒 ' : '👉 '}
                        {choice.text}
                      </div>
                      {isLocked && (
                        <span style={{ fontSize: '11px', color: '#f43f5e', fontFamily: 'var(--font-mono)' }}>
                          未满足: {missingConditions.join(', ')}
                        </span>
                      )}
                    </div>

                    {/* 状态变动预览提示 */}
                    {choice.stateMutation && (
                      <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                        {choice.stateMutation.variables && Object.entries(choice.stateMutation.variables).map(([k, v]) => (
                          <span key={k} style={{ color: (v as number) >= 0 ? '#38bdf8' : '#fb7185' }}>
                            {k} {(v as number) > 0 ? `+${v}` : v}
                          </span>
                        ))}
                        {choice.stateMutation.inventoryAdd && choice.stateMutation.inventoryAdd.map((item) => (
                          <span key={item} style={{ color: '#fbbf24' }}>+持有 [{item}]</span>
                        ))}
                        {choice.stateMutation.inventoryRemove && choice.stateMutation.inventoryRemove.map((item) => (
                          <span key={item} style={{ color: '#94a3b8' }}>-消耗 [{item}]</span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })
            ) : (
              <button className="btn btn-primary" onClick={handleStartGame}>
                🔄 重新开启试玩
              </button>
            )}
          </div>
        </div>

        {/* 嵌入式纯 SVG 拓扑图谱视窗 */}
        {showGraphModal && (
          <div className="panel-card" style={{ marginTop: '14px' }}>
            <div className="panel-card-title">
              <span>🗺️ 全剧分层 DAG 拓扑图谱 (纯原生自主绘制 SVG)</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                青色高光表示当前节点，绿色边线表示已探索足迹
              </span>
            </div>
            <StoryGraphSvgDiagram
              nodes={textGame.nodes}
              startNodeId={textGame.startNodeId}
              currentNodeId={currentNode?.id}
              visitedNodeIds={(gameState?.history || []).map(getHistoryNodeId).filter(Boolean)}
              onSelectNode={jumpToStageNode}
            />
          </div>
        )}
      </div>

      {/* 状态看板与背包侧栏 */}
      <div className="stage-sidebar">
        {/* 故事节点导航清单 */}
        <div className="panel-card">
          <div className="panel-card-title">
            <span>📑 节点清单 ({textGame.nodes.length} 幕)</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '240px', overflowY: 'auto' }}>
            {textGame.nodes.map((node) => {
              const isCurrent = node.id === currentNode?.id;
              const isVisited = (gameState?.history || [])
                .map(getHistoryNodeId)
                .includes(node.id);
              return (
                <div
                  key={node.id}
                  onClick={() => setCurrentNode(node)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    background: isCurrent ? 'rgba(0, 210, 255, 0.15)' : 'var(--bg-elevated)',
                    border: isCurrent ? '1px solid var(--accent-cyan)' : '1px solid transparent',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '12px',
                  }}
                >
                  <span style={{ color: isCurrent ? 'var(--accent-cyan)' : (isVisited ? '#10b981' : '#cbd5e1') }}>
                    {node.title}
                  </span>
                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                    {node.isEnding ? (node.endingType || '结局') : (isVisited ? '✓' : '')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 关键线索与道具背包 */}
        <div className="panel-card">
          <div className="panel-card-title">
            <span>🎒 关键线索与道具背包</span>
          </div>
          {gameState?.inventory && gameState.inventory.length > 0 ? (
            <div className="inventory-tags">
              {gameState.inventory.map((item, idx) => (
                <div key={idx} className="inventory-item">
                  🗝️ {item}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>背包暂无持有物</div>
          )}
        </div>

        {/* 探索足迹 */}
        <div className="panel-card">
          <div className="panel-card-title">
            <span>👣 探索足迹 ({gameState?.history?.length || 0})</span>
          </div>
          <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {gameState?.history && gameState.history.length > 0 ? (
              gameState.history.map((h, i) => {
                const nodeId = getHistoryNodeId(h);
                return (
                  <div key={i} style={{ color: nodeId === currentNode?.id ? 'var(--accent-cyan)' : '#94a3b8' }}>
                    {i + 1}. {nodeId}
                  </div>
                );
              })
            ) : (
              <div>尚未启程</div>
            )}
          </div>
        </div>
      </div>
    </div>
    </div>
  );
};
