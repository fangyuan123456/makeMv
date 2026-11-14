/**
 * client/src/components/LookdevAssetDeck.tsx
 * 视频工坊顶部：定妆卡片 (Lookdev & Visual Entities Deck)
 *
 * 核心功能：
 * 1. 集中展示大模型从策划案与剧本大纲中提炼的角色定妆、实物道具与场景外观设定（纯文本特征）；
 * 2. 现代工作室亮色质感美学，分类筛选（全部 / 角色 / 实物道具 / 场景）；
 * 3. 支持中文生图提示词一键复制与快捷查看。
 */

import React, { useState } from 'react';
import type {
  LookdevEntitiesArtifact,
  ExtractedCharacter,
  ExtractedItem,
  ExtractedLocation,
  ProjectStudioTaskRegistry,
} from '../types/index.js';

interface LookdevAssetDeckProps {
  entities?: LookdevEntitiesArtifact | null;
  studioTasks?: ProjectStudioTaskRegistry | null;
  onRedoEntity?: (params: {
    actionType: 'character_portrait' | 'prop_lookdev' | 'scene_atmosphere';
    targetId: string;
    customPrompt?: string;
    referenceImageUrls?: string[];
  }) => Promise<void>;
  className?: string;
}

export const LookdevAssetDeck: React.FC<LookdevAssetDeckProps> = ({
  entities,
  studioTasks,
  onRedoEntity,
  className = '',
}) => {
  const [activeFilter, setActiveFilter] = useState<'all' | 'characters' | 'items' | 'locations'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedPromptId, setExpandedPromptId] = useState<string | null>(null);

  // 定妆重做编辑弹窗状态
  const [editingEntity, setEditingEntity] = useState<{
    actionType: 'character_portrait' | 'prop_lookdev' | 'scene_atmosphere';
    targetId: string;
    name: string;
    customPrompt: string;
    referenceImageUrl: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleCopyPrompt = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // 忽略剪贴板错误
    }
  };

  const handleStartEdit = (
    actionType: 'character_portrait' | 'prop_lookdev' | 'scene_atmosphere',
    targetId: string,
    name: string,
    defaultPrompt: string,
    existingRefUrl?: string
  ) => {
    setEditingEntity({
      actionType,
      targetId,
      name,
      customPrompt: defaultPrompt,
      referenceImageUrl: existingRefUrl || '',
    });
    setSubmitError(null);
  };

  const handleSubmitRedo = async () => {
    if (!editingEntity || !onRedoEntity) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onRedoEntity({
        actionType: editingEntity.actionType,
        targetId: editingEntity.targetId,
        customPrompt: editingEntity.customPrompt.trim() || undefined,
        referenceImageUrls: editingEntity.referenceImageUrl.trim()
          ? [editingEntity.referenceImageUrl.trim()]
          : undefined,
      });
      setEditingEntity(null);
    } catch (err: any) {
      setSubmitError(err.message || '重做定妆资产失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!entities || (!entities.characters?.length && !entities.items?.length && !entities.locations?.length)) {
    return (
      <div className={`lookdev-deck-container lookdev-empty ${className}`}>
        <div className="lookdev-empty-box">
          <span className="empty-icon">🎨</span>
          <div className="empty-text-wrap">
            <h4 className="empty-title">视听定妆卡片待就绪</h4>
            <p className="empty-desc">
              在左侧与 AI 视听总导演完成第一阶段策划案推演后，确认推进视频 Agent Step 1，系统将立即使用大模型提取全剧实物道具、场景空间与角色定妆纯文本特征。
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { artStyle, characters = [], items = [], locations = [] } = entities;
  const totalCount = characters.length + items.length + locations.length;

  return (
    <section className={`lookdev-deck-container ${className}`}>
      {/* 1. 顶部定妆 Header 与统计栏 */}
      <div className="lookdev-deck-header">
        <div className="lookdev-title-row">
          <div className="deck-title-wrap">
            <span className="deck-badge-icon">🎬</span>
            <h3 className="deck-main-title">全剧视听定妆卡片</h3>
            <span className="deck-sub-badge">Step 1 提炼设定</span>
          </div>

          {artStyle && (
            <div className="deck-art-style-badge" title={artStyle}>
              <span className="style-prefix">🎨 美学基调：</span>
              <span className="style-text">{artStyle}</span>
            </div>
          )}
        </div>

        {/* 2. 统计与类别筛选 Tab */}
        <div className="lookdev-filter-bar">
          <div className="filter-pill-group">
            <button
              type="button"
              className={`filter-pill ${activeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setActiveFilter('all')}
            >
              全部视听资产 ({totalCount})
            </button>
            <button
              type="button"
              className={`filter-pill ${activeFilter === 'characters' ? 'active' : ''}`}
              onClick={() => setActiveFilter('characters')}
            >
              🎭 角色定妆 ({characters.length})
            </button>
            <button
              type="button"
              className={`filter-pill ${activeFilter === 'items' ? 'active' : ''}`}
              onClick={() => setActiveFilter('items')}
            >
              📦 实物与道具 ({items.length})
            </button>
            <button
              type="button"
              className={`filter-pill ${activeFilter === 'locations' ? 'active' : ''}`}
              onClick={() => setActiveFilter('locations')}
            >
              🏞️ 场景外观 ({locations.length})
            </button>
          </div>

          <span className="deck-tip-text">
            💡 纯文本提炼不耗算力，支持查看提示词与设定外观
          </span>
        </div>
      </div>

      {/* 3. 卡片网格展示区 */}
      <div className="lookdev-cards-grid">
        {/* 角色卡片 */}
        {(activeFilter === 'all' || activeFilter === 'characters') &&
          characters.map((char: ExtractedCharacter) => {
            const isCopied = copiedId === char.characterId;
            const isPromptExpanded = expandedPromptId === char.characterId;
            const charTaskId = studioTasks?.lookdev?.characters?.[char.characterId];

            return (
              <div key={char.characterId} className="lookdev-entity-card character-card">
                <div className="entity-card-head">
                  {char.referenceImageUrl ? (
                    <img
                      src={char.referenceImageUrl}
                      alt={char.name}
                      className="entity-avatar-image"
                    />
                  ) : (
                    <div className="entity-avatar-placeholder">
                      <span>🎭</span>
                    </div>
                  )}
                  <div className="entity-title-meta">
                    <div className="entity-name-row">
                      <span className="entity-name">{char.name}</span>
                      <span className="entity-tag character-tag">角色</span>
                    </div>
                    <span className="entity-role">{char.identity || '重要角色'}</span>
                    {charTaskId && (
                      <span className="entity-task-pill" title={`任务槽位: ${charTaskId}`}>
                        ⚡ Task: {charTaskId.slice(-8)}
                      </span>
                    )}
                  </div>
                  {onRedoEntity && (
                    <button
                      type="button"
                      className="btn-redo-entity"
                      onClick={() =>
                        handleStartEdit(
                          'character_portrait',
                          char.characterId,
                          char.name,
                          char.promptZh,
                          char.referenceImageUrl
                        )
                      }
                      title="重绘/垫图重做角色定妆"
                    >
                      🎨 定妆
                    </button>
                  )}
                </div>

                <div className="entity-card-body">
                  <p className="entity-summary">{char.appearanceSummary}</p>
                </div>

                {char.promptZh && (
                  <div className="entity-prompt-section">
                    <div className="prompt-header">
                      <span className="prompt-label">定妆提示词</span>
                      <div className="prompt-actions">
                        <button
                          type="button"
                          className="btn-tiny"
                          onClick={() => setExpandedPromptId(isPromptExpanded ? null : char.characterId)}
                        >
                          {isPromptExpanded ? '收起' : '展开'}
                        </button>
                        <button
                          type="button"
                          className={`btn-tiny ${isCopied ? 'btn-copied' : ''}`}
                          onClick={() => handleCopyPrompt(char.characterId, char.promptZh)}
                        >
                          {isCopied ? '已复制' : '复制'}
                        </button>
                      </div>
                    </div>
                    {isPromptExpanded && (
                      <div className="prompt-content-box">
                        <code>{char.promptZh}</code>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

        {/* 实物与道具卡片 */}
        {(activeFilter === 'all' || activeFilter === 'items') &&
          items.map((item: ExtractedItem) => {
            const isCopied = copiedId === item.itemId;
            const isPromptExpanded = expandedPromptId === item.itemId;
            const itemTaskId = studioTasks?.lookdev?.items?.[item.itemId];

            return (
              <div key={item.itemId} className="lookdev-entity-card item-card">
                <div className="entity-card-head">
                  {item.referenceImageUrl ? (
                    <img
                      src={item.referenceImageUrl}
                      alt={item.name}
                      className="entity-avatar-image"
                    />
                  ) : (
                    <div className="entity-avatar-placeholder item-avatar">
                      <span>📦</span>
                    </div>
                  )}
                  <div className="entity-title-meta">
                    <div className="entity-name-row">
                      <span className="entity-name">{item.name}</span>
                      <span className="entity-tag item-tag">实物道具</span>
                    </div>
                    <span className="entity-role">{item.description || '关键剧情物料'}</span>
                    {itemTaskId && (
                      <span className="entity-task-pill" title={`任务槽位: ${itemTaskId}`}>
                        ⚡ Task: {itemTaskId.slice(-8)}
                      </span>
                    )}
                  </div>
                  {onRedoEntity && (
                    <button
                      type="button"
                      className="btn-redo-entity"
                      onClick={() =>
                        handleStartEdit(
                          'prop_lookdev',
                          item.itemId,
                          item.name,
                          item.promptZh,
                          item.referenceImageUrl
                        )
                      }
                      title="重绘/垫图重做道具特写"
                    >
                      🎨 定妆
                    </button>
                  )}
                </div>

                <div className="entity-card-body">
                  <p className="entity-summary">{item.appearanceSummary}</p>
                </div>

                {item.promptZh && (
                  <div className="entity-prompt-section">
                    <div className="prompt-header">
                      <span className="prompt-label">道具视觉提示词</span>
                      <div className="prompt-actions">
                        <button
                          type="button"
                          className="btn-tiny"
                          onClick={() => setExpandedPromptId(isPromptExpanded ? null : item.itemId)}
                        >
                          {isPromptExpanded ? '收起' : '展开'}
                        </button>
                        <button
                          type="button"
                          className={`btn-tiny ${isCopied ? 'btn-copied' : ''}`}
                          onClick={() => handleCopyPrompt(item.itemId, item.promptZh)}
                        >
                          {isCopied ? '已复制' : '复制'}
                        </button>
                      </div>
                    </div>
                    {isPromptExpanded && (
                      <div className="prompt-content-box">
                        <code>{item.promptZh}</code>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

        {/* 核心场景卡片 */}
        {(activeFilter === 'all' || activeFilter === 'locations') &&
          locations.map((loc: ExtractedLocation) => {
            const isCopied = copiedId === loc.locationId;
            const isPromptExpanded = expandedPromptId === loc.locationId;
            const locTaskId = studioTasks?.lookdev?.locations?.[loc.locationId];

            return (
              <div key={loc.locationId} className="lookdev-entity-card location-card">
                <div className="entity-card-head">
                  {loc.referenceImageUrl ? (
                    <img
                      src={loc.referenceImageUrl}
                      alt={loc.name}
                      className="entity-avatar-image"
                    />
                  ) : (
                    <div className="entity-avatar-placeholder loc-avatar">
                      <span>🏞️</span>
                    </div>
                  )}
                  <div className="entity-title-meta">
                    <div className="entity-name-row">
                      <span className="entity-name">{loc.name}</span>
                      <span className="entity-tag loc-tag">场景空间</span>
                    </div>
                    <span className="entity-role">{loc.atmosphere || '故事主要发生地'}</span>
                    {locTaskId && (
                      <span className="entity-task-pill" title={`任务槽位: ${locTaskId}`}>
                        ⚡ Task: {locTaskId.slice(-8)}
                      </span>
                    )}
                  </div>
                  {onRedoEntity && (
                    <button
                      type="button"
                      className="btn-redo-entity"
                      onClick={() =>
                        handleStartEdit(
                          'scene_atmosphere',
                          loc.locationId,
                          loc.name,
                          loc.promptZh,
                          loc.referenceImageUrl
                        )
                      }
                      title="重绘/垫图重做场景空镜"
                    >
                      🎨 定妆
                    </button>
                  )}
                </div>

                <div className="entity-card-body">
                  <p className="entity-summary">{loc.appearanceSummary}</p>
                  {loc.sceneIds && loc.sceneIds.length > 0 && (
                    <div className="entity-scene-refs">
                      <span className="scene-refs-label">关联镜头：</span>
                      {loc.sceneIds.map((sid) => (
                        <span key={sid} className="scene-ref-pill">
                          #{sid}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {loc.promptZh && (
                  <div className="entity-prompt-section">
                    <div className="prompt-header">
                      <span className="prompt-label">场景环境提示词</span>
                      <div className="prompt-actions">
                        <button
                          type="button"
                          className="btn-tiny"
                          onClick={() => setExpandedPromptId(isPromptExpanded ? null : loc.locationId)}
                        >
                          {isPromptExpanded ? '收起' : '展开'}
                        </button>
                        <button
                          type="button"
                          className={`btn-tiny ${isCopied ? 'btn-copied' : ''}`}
                          onClick={() => handleCopyPrompt(loc.locationId, loc.promptZh)}
                        >
                          {isCopied ? '已复制' : '复制'}
                        </button>
                      </div>
                    </div>
                    {isPromptExpanded && (
                      <div className="prompt-content-box">
                        <code>{loc.promptZh}</code>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {/* 4. 定妆微调与参考图重做弹窗 */}
      {editingEntity && (
        <div className="keyframe-modal-overlay" onClick={() => setEditingEntity(null)}>
          <div className="keyframe-modal-dialog entity-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="keyframe-modal-header">
              <div className="modal-title-wrap">
                <span className="modal-badge">
                  定妆微调 · 工序 [
                  {editingEntity.actionType === 'character_portrait'
                    ? '角色立绘'
                    : editingEntity.actionType === 'prop_lookdev'
                    ? '道具特写'
                    : '场景空镜'}
                  ]
                </span>
                <h3 className="modal-title">{editingEntity.name}</h3>
              </div>
              <button
                type="button"
                className="btn-close-modal"
                onClick={() => setEditingEntity(null)}
              >
                ✕
              </button>
            </div>

            <div className="keyframe-modal-body entity-modal-body">
              <div className="keyframe-meta-panel" style={{ width: '100%' }}>
                <div className="meta-block">
                  <div className="meta-label-row">
                    <span className="meta-label">视觉生成提示词 (可手动微调)</span>
                  </div>
                  <textarea
                    className="prompt-edit-textarea"
                    rows={4}
                    value={editingEntity.customPrompt}
                    onChange={(e) =>
                      setEditingEntity((prev) =>
                        prev ? { ...prev, customPrompt: e.target.value } : null
                      )
                    }
                    placeholder="在此输入或微调提示词..."
                  />
                </div>

                <div className="meta-block">
                  <div className="meta-label-row">
                    <span className="meta-label">垫图 / 参考图 URL (可选)</span>
                  </div>
                  <input
                    type="text"
                    className="prompt-edit-input"
                    value={editingEntity.referenceImageUrl}
                    onChange={(e) =>
                      setEditingEntity((prev) =>
                        prev ? { ...prev, referenceImageUrl: e.target.value } : null
                      )
                    }
                    placeholder="粘贴外部参考图 URL，作为生成参考图..."
                  />
                </div>

                <div className="modal-actions-bar">
                  <button
                    type="button"
                    className="btn btn-action-redo btn-redo-keyframe"
                    disabled={isSubmitting}
                    onClick={handleSubmitRedo}
                  >
                    {isSubmitting ? '⏳ 正在物理生成...' : '🎨 提交生成定妆资产'}
                  </button>
                </div>

                {submitError && (
                  <div className="action-error-banner">
                    ⚠️ {submitError}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
