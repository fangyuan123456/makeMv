/**
 * client/src/components/studio/stages/visual/VisualInspectorPanel.tsx
 * 视听制作右侧轻量预览检查器 (Visual Inspector SSOT)
 *
 * 职责分工：
 * 1. 【极轻量只读预览】不放复杂的修改输入框，消除越界感与拥挤感；
 * 2. 【定妆节点】只读预览已定妆角色与场景画廊，展示定妆进度；
 * 3. 【剧情节点】直接播放视听视频切片或大图、完整查看剧集剧本文本 (narrativeText)、速览分镜镜头；
 * 4. 【深潜引导】底部配备明显的「进入画布制作 ➔」按钮，也可以双击节点直接进入。
 */

import React from 'react';
import type { ProjectData } from '../../../../types/index.js';
import { updateShootingScript } from '../../../../lib/api.js';
import { TiptapMentionEditor } from '../../canvas/TiptapMentionEditor.js';
import { toMentionText } from '../../canvas/EntityMentionText.js';

const AutoResizeTextarea: React.FC<{
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
  autoFocus?: boolean;
  onBlur?: () => void;
}> = ({ value, onChange, placeholder, className, minRows = 1, autoFocus, onBlur }) => {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const resize = React.useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.max(textareaRef.current.scrollHeight, minRows * 18)}px`;
    }
  }, [minRows]);

  React.useEffect(() => {
    resize();
    const timer = setTimeout(resize, 30);
    return () => clearTimeout(timer);
  }, [value, resize]);

  React.useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [autoFocus]);

  return (
    <textarea
      ref={textareaRef}
      rows={minRows}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        resize();
      }}
      onBlur={onBlur}
      placeholder={placeholder}
      className={`resize-none overflow-hidden block ${className || ''}`}
    />
  );
};

const InsertDivider: React.FC<{
  onInsert: () => void;
}> = ({ onInsert }) => {
  return (
    <div
      onClick={onInsert}
      className="group/divider relative h-4 -my-1 cursor-pointer flex items-center justify-center transition-all z-10 select-none"
      title="点击在此处插入新镜头"
    >
      <div className="absolute inset-x-2 h-[1.5px] bg-transparent group-hover/divider:bg-indigo-400/80 transition-colors rounded-full" />
      <div className="relative w-4 h-4 rounded-full bg-white border border-indigo-300 text-indigo-600 shadow-xs flex items-center justify-center text-[11px] font-bold opacity-0 scale-75 group-hover/divider:opacity-100 group-hover/divider:scale-100 group-hover/divider:bg-indigo-600 group-hover/divider:text-white group-hover/divider:border-indigo-600 transition-all duration-150">
        +
      </div>
    </div>
  );
};

interface StoryboardShotItem {
  id?: string;
  shotId?: string;
  shotSize?: string;
  shotType?: string;
  cameraMovement?: string;
  narration?: string;
  dialogue?: string;
  visualPromptZh?: string;
  promptZh?: string;
  imageUrl?: string;
  firstFrameImageUrl?: string;
  keyframeUrl?: string;
  [key: string]: any;
}

export interface VisualInspectorPanelProps {
  node: {
    id: string;
    kind: 'lookdev' | 'clip' | 'ending';
    clipId?: string;
    title: string;
    badge: string;
    badgeColor: string;
    status: 'locked' | 'pending' | 'in_progress' | 'completed';
    isUnlocked: boolean;
    keyframeUrl?: string;
    videoUrl?: string;
    durationSec?: number;
  };
  projectData: ProjectData | null;
  onClose: () => void;
  onEnterCanvas: (kind: 'lookdev' | 'clip', clipId?: string, clipTitle?: string) => void;
  onEnlargeMedia?: (media: { title: string; imageUrl?: string; videoUrl?: string }) => void;
  onRefreshProject?: () => Promise<void> | void;
}

export const VisualInspectorPanel: React.FC<VisualInspectorPanelProps> = ({
  node,
  projectData,
  onClose,
  onEnterCanvas,
  onEnlargeMedia,
  onRefreshProject,
}) => {
  const [activeScriptTab, setActiveScriptTab] = React.useState<'story' | 'performance'>('story');
  const [activeVideoIdx, setActiveVideoIdx] = React.useState(0);
  const [autoAdvancePlay, setAutoAdvancePlay] = React.useState(false);
  const clipVideoRef = React.useRef<HTMLVideoElement | null>(null);

  // 1. 提取定妆视觉实体
  const entities = projectData?.entities || projectData?.artifacts?.lookdev_entities;
  const characters = entities?.characters || [];
  const locations = entities?.locations || [];
  const items = entities?.items || [];

  // 2. 提取当前幕剧情文本
  const prd = projectData?.prd || projectData?.artifacts?.gdd?.prd;
  const currentClip = (prd?.clips || []).find((c: any) => c.id === node.clipId);
  const narrativeText =
    currentClip?.narrativeText ||
    (node.clipId ? projectData?.storySections?.[node.clipId]?.narrativeText : '') ||
    '暂无剧集文本描述';

  // 3. 提取分镜镜头列表
  const rawStoryboards = projectData?.storyboards || projectData?.artifacts?.storyboards || [];
  const filmSpec = projectData?.artifacts?.film_spec;

  const currentClipId = node.clipId;
  const [beats, setBeats] = React.useState<any[]>([]);
  const [originalBeatsJson, setOriginalBeatsJson] = React.useState<string>('');
  const [deletingBeatIndex, setDeletingBeatIndex] = React.useState<number | null>(null);
  const [isSavingScript, setIsSavingScript] = React.useState(false);
  const [saveSuccessTip, setSaveSuccessTip] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [editingBeatIndex, setEditingBeatIndex] = React.useState<number | null>(null);

  let shots: StoryboardShotItem[] = [];
  if (currentClipId && Array.isArray(rawStoryboards) && rawStoryboards.length > 0) {
    const matchedClip = rawStoryboards.find(
      (item: any) =>
        item.clipId === currentClipId ||
        item.id === currentClipId ||
        item.sourceNodeId === currentClipId
    );
    if (matchedClip && Array.isArray(matchedClip.shots)) {
      shots = matchedClip.shots;
    } else {
      shots = rawStoryboards.filter(
        (s: any) => s.clipId === currentClipId || s.sourceNodeId === currentClipId
      );
    }
  }

  if (shots.length === 0 && currentClipId && filmSpec?.clips) {
    const matched = filmSpec.clips.find(
      (c: any) =>
        c.clipId === currentClipId ||
        c.sourceNodeId === currentClipId
    );
    if (matched?.shots) shots = matched.shots;
  }

  // 4. 提取当前幕导演演绎剧本 (Performance Script)
  const matchedFilmClip = filmSpec?.clips?.find(
    (c: any) =>
      c.clipId === currentClipId ||
      c.sourceNodeId === currentClipId
  );
  const matchedRawClip = Array.isArray(rawStoryboards)
    ? rawStoryboards.find(
        (c: any) =>
          c.clipId === currentClipId ||
          c.sourceNodeId === currentClipId
      )
    : undefined;
  const shootingScript = matchedFilmClip?.shootingScript || matchedRawClip?.shootingScript;

  // 收集当前幕下所有已生成视频的片段，用于按顺序连播整幕预览
  const clipVideos = React.useMemo(() => {
    const list = (shots || [])
      .filter((s: any) => Boolean(s?.videoUrl))
      .map((s: any, idx: number) => ({
        shotId: s.shotId || s.id || `s_${idx + 1}`,
        title: s.sliceSummary || s.title || `片段 ${idx + 1}`,
        videoUrl: s.videoUrl as string,
      }));
    if (list.length === 0 && node.videoUrl) {
      list.push({
        shotId: node.id,
        title: node.title,
        videoUrl: node.videoUrl,
      });
    }
    return list;
  }, [shots, node.videoUrl, node.id, node.title]);

  React.useEffect(() => {
    setActiveVideoIdx(0);
    setAutoAdvancePlay(false);
  }, [currentClipId]);

  React.useEffect(() => {
    if (activeVideoIdx >= clipVideos.length && clipVideos.length > 0) {
      setActiveVideoIdx(0);
    }
  }, [activeVideoIdx, clipVideos.length]);

  const activeClipVideo = clipVideos[activeVideoIdx] || clipVideos[0];

  // 自动从 shootingScript 同步到直接可编辑的 beats 状态（基准文本经由 toMentionText 标准化，与输入态严格对齐）
  React.useEffect(() => {
    const rawBeats = Array.isArray(shootingScript?.actionBeats)
      ? shootingScript.actionBeats.map((b: any, idx: number) => ({
          ...b,
          beatId: b.beatId || `beat_init_${idx + 1}`,
          actionDescription: toMentionText(b.actionDescription || '', entities),
        }))
      : [];
    const jsonStr = JSON.stringify(rawBeats);
    setBeats(JSON.parse(jsonStr));
    setOriginalBeatsJson(jsonStr);
  }, [currentClipId, shootingScript, entities]);

  const originalBeats = React.useMemo(() => {
    try {
      return originalBeatsJson ? JSON.parse(originalBeatsJson) : [];
    } catch {
      return [];
    }
  }, [originalBeatsJson]);

  const originalBeatsMap = React.useMemo(() => {
    const map = new Map<string, any>();
    for (const b of originalBeats) {
      if (b.beatId) {
        map.set(b.beatId, b);
      }
    }
    return map;
  }, [originalBeats]);

  const isFieldModified = (index: number, field: string) => {
    const curr = beats[index];
    if (!curr) return false;
    const orig = curr.beatId ? originalBeatsMap.get(curr.beatId) : undefined;
    if (!orig) return true; // 新增镜头的字段标记为修改态
    if (field === 'shotNumber') return false; // 顺延序号变化不作为用户字段修改
    const origVal = orig[field] ?? '';
    const currVal = curr[field] ?? '';
    if (field === 'actionDescription') {
      const s1 = String(origVal).replace(/\r\n/g, '\n').trim();
      const s2 = String(currVal).replace(/\r\n/g, '\n').trim();
      return s1 !== s2;
    }
    return String(origVal).trim() !== String(currVal).trim();
  };

  const isBeatModified = React.useCallback(
    (index: number) => {
      const curr = beats[index];
      if (!curr) return false;
      const orig = curr.beatId ? originalBeatsMap.get(curr.beatId) : undefined;
      if (!orig) return true; // 新增镜头卡片整体标记为修改态
      const checkFields = [
        'beatTitle',
        'actionDescription',
        'estimatedSeconds',
        'space',
      ];
      return checkFields.some((f) => {
        const origVal = orig[f] ?? '';
        const currVal = curr[f] ?? '';
        return String(origVal).trim() !== String(currVal).trim();
      });
    },
    [beats, originalBeatsMap]
  );

  const isDirty = React.useMemo(() => {
    if (beats.length !== originalBeats.length) return true;
    return beats.some((_, idx) => isBeatModified(idx));
  }, [beats, originalBeats, isBeatModified]);

  const handleUpdateBeat = (index: number, field: string, value: any) => {
    setBeats((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleInsertBeatAt = (targetIndex: number) => {
    setBeats((prev) => {
      const refBeat = prev[targetIndex] || (targetIndex > 0 ? prev[targetIndex - 1] : prev[0]);
      const newBeat = {
        beatId: `beat_user_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        shotNumber: targetIndex + 1,
        space: refBeat?.space || '空间一',
        beatTitle: '新增镜头',
        actionDescription: '',
        estimatedSeconds: 4,
      };
      const next = [...prev];
      next.splice(targetIndex, 0, newBeat);
      return next.map((b, idx) => ({ ...b, shotNumber: idx + 1 }));
    });
  };

  const handleDeleteBeat = (index: number) => {
    setBeats((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, idx) => idx !== index);
      return next.map((b, idx) => ({ ...b, shotNumber: idx + 1 }));
    });
    setDeletingBeatIndex(null);
  };

  const handleResetSingleBeat = (index: number) => {
    const curr = beats[index];
    if (!curr) return;
    const orig = curr.beatId ? originalBeatsMap.get(curr.beatId) : undefined;
    if (orig) {
      setBeats((prev) => {
        const next = [...prev];
        next[index] = {
          ...JSON.parse(JSON.stringify(orig)),
          shotNumber: curr.shotNumber, // 保留当前合理的顺延序号
        };
        return next;
      });
    } else {
      // 若是用户自主新增的镜头，重置即删除该新增镜头
      handleDeleteBeat(index);
    }
  };

  const handleResetAll = () => {
    try {
      setBeats(JSON.parse(originalBeatsJson));
    } catch {}
    setDeletingBeatIndex(null);
    setSaveError(null);
  };

  const handleSaveEdit = async () => {
    const projectId = projectData?.meta?.projectId;
    if (!currentClipId || !projectId) return;
    try {
      setIsSavingScript(true);
      setSaveError(null);
      const updatedScript = {
        ...shootingScript,
        clipId: currentClipId,
        actionBeats: beats,
      };
      await updateShootingScript(projectId, currentClipId, updatedScript);
      setOriginalBeatsJson(JSON.stringify(beats));
      setSaveSuccessTip(true);
      setTimeout(() => setSaveSuccessTip(false), 2500);
      if (onRefreshProject) {
        await onRefreshProject();
      }
    } catch (err: any) {
      setSaveError(err.message || '保存失败');
    } finally {
      setIsSavingScript(false);
    }
  };

  return (
    <aside className="absolute top-4 right-4 bottom-4 w-[420px] max-w-[calc(100vw-2rem)] bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-3xl shadow-xl z-30 flex flex-col overflow-hidden animate-in slide-in-from-right-4 duration-200 select-none">
      {/* 顶部标题与关闭 */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
        <div className="flex items-center space-x-2.5 overflow-hidden">
          <span className="text-lg">
            {node.kind === 'lookdev' ? '🎨' : '🎬'}
          </span>
          <div className="truncate">
            <h3 className="text-sm font-bold text-slate-800 truncate">
              {node.title}
            </h3>
            <span className="text-[11px] text-slate-500 font-medium">
              {node.kind === 'lookdev'
                ? '全剧视觉定妆 · 快速预览'
                : '单幕视听切片 · 属性检视'}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          title="关闭检视面板"
        >
          ✕
        </button>
      </div>

      {/* 滚动内容区 */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 text-slate-700">
        {/* ────────────── A. 全剧视觉定妆预览 ────────────── */}
        {node.kind === 'lookdev' && (() => {
          const completedCharCount = characters.filter((c: any) => Boolean(c.imageUrl)).length;
          const totalCharCount = characters.length;
          const completedLocCount = locations.filter((l: any) => Boolean(l.imageUrl)).length;
          const totalLocCount = locations.length;
          const completedItemCount = items.filter((item: any) => Boolean(item.imageUrl || item.referenceImageUrl)).length;
          const totalItemCount = items.length;
          const isNotExtracted = totalCharCount === 0 && totalLocCount === 0 && totalItemCount === 0;

          if (isNotExtracted) {
            return (
              <div className="space-y-4">
                <div className="p-3 bg-indigo-50/60 border border-indigo-100 rounded-2xl flex items-center justify-between text-xs text-indigo-900">
                  <span className="font-semibold">定妆状态</span>
                  <span className="font-bold bg-white px-2.5 py-0.5 rounded-full border border-indigo-200 text-indigo-700 shadow-2xs text-[11px]">
                    🎨 视觉设定待提取
                  </span>
                </div>

                {/* 未提取设定友好引导卡片 */}
                <div className="p-6 bg-slate-50 border border-dashed border-slate-200 rounded-2xl text-center space-y-2.5">
                  <span className="text-3xl block">🎨</span>
                  <h4 className="text-xs font-bold text-slate-800">
                    全剧视觉设定尚未提取
                  </h4>
                  <p className="text-[11px] text-slate-500 leading-relaxed max-w-xs mx-auto">
                    当前尚未从剧本中提炼登场角色形象与场景空间。点击下方「进入画布制作」即可自动解析剧本圣经并提取视觉母体。
                  </p>
                </div>
              </div>
            );
          }

          return (
            <div className="space-y-4">
              <div className="p-3 bg-indigo-50/60 border border-indigo-100 rounded-2xl flex items-center justify-between text-xs text-indigo-900">
                <span className="font-semibold">定妆完成度</span>
                <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                  <span className="font-bold bg-white px-2.5 py-0.5 rounded-full border border-indigo-200 text-indigo-700 shadow-2xs text-[11px]">
                    🎭 角色 {completedCharCount}/{totalCharCount}
                  </span>
                  <span className="font-bold bg-white px-2.5 py-0.5 rounded-full border border-indigo-200 text-indigo-700 shadow-2xs text-[11px]">
                    🏞️ 场景 {completedLocCount}/{totalLocCount}
                  </span>
                  <span className="font-bold bg-white px-2.5 py-0.5 rounded-full border border-indigo-200 text-indigo-700 shadow-2xs text-[11px]">
                    🧰 道具 {completedItemCount}/{totalItemCount}
                  </span>
                </div>
              </div>

              {/* 角色卡片只读预览 */}
              <div>
                <div className="text-xs font-bold text-slate-800 mb-2.5 flex items-center justify-between">
                  <span className="flex items-center space-x-1.5">
                    <span>🎭</span>
                    <span>核心角色立绘</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    共 {characters.length} 个角色
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {characters.slice(0, 4).map((char: any, idx: number) => (
                    <div
                      key={char.characterId || char.id || `char_${idx}`}
                      onClick={() => {
                        if (char.imageUrl) {
                          onEnlargeMedia?.({
                            title: `角色定妆 · ${char.name}`,
                            imageUrl: char.imageUrl,
                          });
                        }
                      }}
                      className="group relative bg-slate-50 hover:bg-white border border-slate-200/80 hover:border-indigo-300 rounded-2xl p-2 overflow-hidden flex flex-col items-center transition-all cursor-pointer shadow-2xs hover:shadow-xs"
                      title={char.imageUrl ? '点击放大查看原图' : undefined}
                    >
                      <div className="w-full aspect-[2/1] rounded-xl overflow-hidden bg-slate-100 border border-slate-200/60 relative mb-2 flex items-center justify-center p-0.5">
                        {char.imageUrl ? (
                          <img
                            src={`${char.imageUrl}?t=${char.selectedVersionId || ''}`}
                            alt={char.name}
                            className="w-full h-full object-contain object-center group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 text-xs">
                            <span className="text-lg mb-1">⏳</span>
                            <span>待定妆</span>
                          </div>
                        )}
                        {char.versions && char.versions.length > 0 && (
                          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.2 rounded bg-black/60 text-[9px] font-mono text-white font-semibold">
                            v{char.versions.length}
                          </span>
                        )}
                      </div>
                      <div className="w-full text-center">
                        <div className="text-xs font-bold text-slate-800 truncate">
                          {char.name}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate mt-0.5">
                          {char.identity || '主要角色'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 场景只读预览 */}
              {locations.length > 0 && (
                <div>
                  <div className="text-xs font-bold text-slate-800 mb-2.5 flex items-center justify-between">
                    <span className="flex items-center space-x-1.5">
                      <span>🏞️</span>
                      <span>关键场景画廊</span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      共 {locations.length} 个场景
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {locations.slice(0, 2).map((loc: any, idx: number) => (
                      <div
                        key={loc.locationId || loc.id || `loc_${idx}`}
                        onClick={() => {
                          if (loc.imageUrl) {
                            onEnlargeMedia?.({
                              title: `场景氛围 · ${loc.name}`,
                              imageUrl: loc.imageUrl,
                            });
                          }
                        }}
                        className="bg-slate-50 hover:bg-white border border-slate-200/80 hover:border-indigo-300 rounded-2xl p-2 overflow-hidden flex flex-col items-center transition-all cursor-pointer shadow-2xs hover:shadow-xs"
                        title={loc.imageUrl ? '点击放大查看原图' : undefined}
                      >
                        <div className="w-full aspect-video rounded-xl overflow-hidden bg-slate-200 relative mb-1.5">
                          {loc.imageUrl ? (
                            <img
                              src={`${loc.imageUrl}?t=${loc.selectedVersionId || ''}`}
                              alt={loc.name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
                              待渲染
                            </div>
                          )}
                        </div>
                        <div className="text-xs font-medium text-slate-700 truncate w-full text-center">
                          {loc.name}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 道具只读预览 */}
              {items.length > 0 && (
                <div>
                  <div className="text-xs font-bold text-slate-800 mb-2.5 flex items-center justify-between">
                    <span className="flex items-center space-x-1.5">
                      <span>🧰</span>
                      <span>核心道具展台</span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      共 {items.length} 个道具
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {items.slice(0, 4).map((item: any, idx: number) => {
                      const imageUrl = item.imageUrl || item.referenceImageUrl;
                      return (
                        <div
                          key={item.itemId || item.id || `item_${idx}`}
                          onClick={() => {
                            if (imageUrl) {
                              onEnlargeMedia?.({
                                title: `道具特写 · ${item.name}`,
                                imageUrl,
                              });
                            }
                          }}
                          className="group relative bg-slate-50 hover:bg-white border border-slate-200/80 hover:border-indigo-300 rounded-2xl p-2 overflow-hidden flex flex-col items-center transition-all cursor-pointer shadow-2xs hover:shadow-xs"
                          title={imageUrl ? '点击放大查看原图' : undefined}
                        >
                          <div className="w-full aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200/60 relative mb-2 flex items-center justify-center">
                            {imageUrl ? (
                              <img
                                src={`${imageUrl}?t=${item.updatedAt || ''}`}
                                alt={item.name}
                                className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                              />
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 text-xs">
                                <span className="text-lg mb-1">⏳</span>
                                <span>待定妆</span>
                              </div>
                            )}
                          </div>
                          <div className="w-full text-center">
                            <div className="text-xs font-bold text-slate-800 truncate">{item.name}</div>
                            <div className="text-[10px] text-slate-500 truncate mt-0.5">
                              {item.description || item.appearanceSummary || '核心剧情道具'}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ────────────── B. 单幕剧情切片属性检视 ────────────── */}
        {node.kind === 'clip' && (
          <div className="space-y-4">
            {/* 1. 视听预览窗 (整幕多片段顺序连播或关键帧大图) */}
            <div className="space-y-2">
              <div className="relative aspect-video rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 shadow-inner group">
                {activeClipVideo ? (
                  <>
                    <video
                      ref={clipVideoRef}
                      key={activeClipVideo.videoUrl}
                      src={activeClipVideo.videoUrl}
                      controls
                      autoPlay={autoAdvancePlay}
                      playsInline
                      onEnded={() => {
                        if (activeVideoIdx < clipVideos.length - 1) {
                          setAutoAdvancePlay(true);
                          setActiveVideoIdx((prev) => prev + 1);
                        } else {
                          setAutoAdvancePlay(false);
                        }
                      }}
                      className="w-full h-full object-cover"
                    />
                    {clipVideos.length > 1 && (
                      <div className="pointer-events-none absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md bg-black/65 backdrop-blur-xs text-[10px] font-medium text-white">
                        片段 {activeVideoIdx + 1}/{clipVideos.length} · {activeClipVideo.title}
                      </div>
                    )}
                    {onEnlargeMedia && (
                      <button
                        type="button"
                        onClick={() =>
                          onEnlargeMedia({
                            title: `${node.title} · ${activeClipVideo.title}`,
                            videoUrl: activeClipVideo.videoUrl,
                          })
                        }
                        className="absolute top-2.5 right-2.5 px-2 py-1 rounded-lg bg-black/65 hover:bg-black/85 backdrop-blur-xs text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-10"
                        title="全屏放大播放"
                      >
                        ⛶
                      </button>
                    )}
                  </>
                ) : node.keyframeUrl ? (
                  <>
                    <img
                      src={node.keyframeUrl}
                      alt={node.title}
                      className="w-full h-full object-cover"
                    />
                    <button
                      onClick={() =>
                        onEnlargeMedia?.({
                          title: node.title,
                          imageUrl: node.keyframeUrl,
                          videoUrl: node.videoUrl,
                        })
                      }
                      className="absolute bottom-2.5 right-2.5 px-2.5 py-1 rounded-lg bg-black/60 hover:bg-black/80 backdrop-blur-xs text-[11px] font-medium text-white flex items-center space-x-1 transition-opacity opacity-0 group-hover:opacity-100"
                    >
                      <span>⛶ 放大查看</span>
                    </button>
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 text-xs">
                    <span className="text-2xl mb-1.5">🎬</span>
                    <span>本幕分镜镜头待规划生成</span>
                  </div>
                )}
              </div>

              {(clipVideos.length > 1 || (shots.length > 0 && clipVideos.length < shots.length)) && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                  {shots.length > 0 && (
                    <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                      已生成 {clipVideos.length}/{shots.length}
                    </span>
                  )}
                  {clipVideos.map((cv, idx) => (
                    <button
                      key={`${cv.shotId}_${idx}`}
                      type="button"
                      onClick={() => {
                        setAutoAdvancePlay(true);
                        setActiveVideoIdx(idx);
                      }}
                      className={`shrink-0 px-2 py-1 rounded-lg text-[11px] font-medium border transition ${
                        idx === activeVideoIdx
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                      title={cv.title}
                    >
                      片段 {idx + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 2. 剧本文本分页切换：故事剧本 vs 视听演绎剧本 */}
            <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-3.5 space-y-3">
              {/* 分页切换 Tab Header */}
              <div className="flex items-center space-x-1 p-1 bg-slate-200/60 rounded-xl">
                <button
                  type="button"
                  onClick={() => setActiveScriptTab('story')}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center space-x-1 ${
                    activeScriptTab === 'story'
                      ? 'bg-white text-slate-800 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <span>📖 故事剧本</span>
                  <span className="text-[10px] text-slate-400 font-normal">文学</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveScriptTab('performance')}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center space-x-1 ${
                    activeScriptTab === 'performance'
                      ? 'bg-white text-indigo-700 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <span>🎬 视听演绎剧本</span>
                  {shootingScript ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  ) : (
                    <span className="text-[9px] bg-amber-100 text-amber-700 px-1 py-0.2 rounded font-normal">待生成</span>
                  )}
                </button>
              </div>

              {/* Tab 1: 故事剧本文学正文 */}
              {activeScriptTab === 'story' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span className="font-medium">本幕剧情故事蓝本</span>
                    <span className="text-[10px] text-slate-400">文学情节与对白</span>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap select-text bg-white p-3 rounded-xl border border-slate-200/60">
                    {narrativeText}
                  </p>
                </div>
              )}

              {/* Tab 2: 视听演绎剧本 (环境锁 + 连续纯物理动作流) */}
              {activeScriptTab === 'performance' && (
                <div className="space-y-3">
                  {shootingScript ? (
                    <>
                      {/* 顶部操作区：标题纯粹独立，有修改时自适应滑出全宽整洁操作条 */}
                      <div className="space-y-2 pb-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-800 flex items-center gap-1 select-none">
                              <span>🎬</span>
                              <span>导演视听摄制单</span>
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono px-1.5 py-0.2 rounded bg-slate-100 border border-slate-200/60 select-none">
                              {beats.length} 镜
                            </span>
                          </div>

                          {saveSuccessTip && (
                            <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md animate-in fade-in duration-150 flex items-center gap-1 select-none">
                              <span>✓</span>
                              <span>已保存生效</span>
                            </span>
                          )}
                          {saveError && (
                            <span className="text-[10px] font-medium text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded select-none">
                              {saveError}
                            </span>
                          )}
                        </div>

                        {/* 修改状态条：全宽自适应，左侧状态脉冲，右侧精致按钮，绝不拥挤折行 */}
                        {isDirty && (
                          <div className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-amber-50/90 border border-amber-300/80 text-amber-950 animate-in slide-in-from-top-1 fade-in duration-150 shadow-2xs">
                            <div className="flex items-center gap-1.5 text-[11px] font-medium whitespace-nowrap select-none">
                              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
                              <span>台本已修改未保存</span>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={handleResetAll}
                                disabled={isSavingScript}
                                className="text-[11px] text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-amber-200 px-2 py-0.5 rounded-md transition-colors cursor-pointer flex items-center gap-0.5 shadow-2xs whitespace-nowrap"
                                title="将全幕所有修改还原为初始状态"
                              >
                                <span>↺</span>
                                <span>重置</span>
                              </button>
                              <button
                                type="button"
                                onClick={handleSaveEdit}
                                disabled={isSavingScript}
                                className="text-[11px] text-white bg-indigo-600 hover:bg-indigo-700 font-medium px-2.5 py-0.5 rounded-md transition-all flex items-center gap-1 shadow-2xs disabled:opacity-50 cursor-pointer whitespace-nowrap active:scale-95"
                              >
                                <span>{isSavingScript ? '⏳' : '💾'}</span>
                                <span>{isSavingScript ? '保存中' : '保存修改'}</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 视听动作表演流：全部进入自由输入框（彻底消灭死标题），直接可编辑 + 修改黄色高亮 */}
                      <div className="space-y-2.5">
                        {beats.map((beat: any, bIdx: number) => {
                          const beatModified = isBeatModified(bIdx);
                          const titleModified = isFieldModified(bIdx, 'beatTitle');
                          const descModified = isFieldModified(bIdx, 'actionDescription');

                          return (
                            <React.Fragment key={beat.beatId || `beat_${bIdx}`}>
                              {/* 全剧第0镜头开头支持插入新镜头 */}
                              {bIdx === 0 && (
                                <InsertDivider onInsert={() => handleInsertBeatAt(0)} />
                              )}

                              {/* 单镜头卡片：修改了呈现温暖琥珀黄边框高亮 */}
                              <div className={`group p-3 bg-white border rounded-xl space-y-2 text-xs shadow-2xs transition-all ${
                                beatModified
                                  ? 'border-amber-300 bg-amber-50/15 ring-1 ring-amber-200/50'
                                  : 'border-slate-200/80 hover:border-indigo-300'
                              }`}>
                                  {/* 顶部镜号与标题栏 */}
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                      {/* 统一专业镜号徽标 */}
                                      <span className={`w-5 h-5 rounded-md text-[10px] font-mono font-bold flex items-center justify-center shrink-0 border transition-colors ${
                                        beatModified
                                          ? 'bg-amber-100 border-amber-300 text-amber-800'
                                          : 'bg-indigo-50 border border-indigo-200 text-indigo-700'
                                      }`}>
                                        {String(beat.shotNumber || bIdx + 1).padStart(2, '0')}
                                      </span>

                                      {/* 标题：直接点击编辑，修改了黄色高亮 */}
                                      <AutoResizeTextarea
                                        minRows={1}
                                        value={beat.beatTitle || ''}
                                        onChange={(val) => handleUpdateBeat(bIdx, 'beatTitle', val)}
                                        placeholder="镜头标题（如：近景甩镜 · 违规回头）"
                                        className={`text-xs font-bold px-1 py-0.5 flex-1 min-w-0 outline-none focus:outline-none focus:ring-0 leading-normal rounded transition-colors ${
                                          titleModified
                                            ? 'bg-amber-100/70 border border-amber-300 text-amber-950'
                                            : 'text-slate-800 bg-transparent hover:bg-slate-50 focus:bg-white border-b border-transparent focus:border-indigo-400'
                                        }`}
                                      />
                                    </div>

                                    {/* 右侧时长与删除/重置操作区 */}
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {/* 修改状态对应的单卡片 Reset 按钮 */}
                                      {beatModified && (
                                        <button
                                          type="button"
                                          onClick={() => handleResetSingleBeat(bIdx)}
                                          className="text-[10px] font-medium text-amber-800 hover:text-amber-950 bg-amber-100 hover:bg-amber-200/90 border border-amber-300 px-1.5 py-0.5 rounded flex items-center gap-0.5 cursor-pointer transition-colors shadow-2xs whitespace-nowrap shrink-0"
                                          title="将此镜头还原至修改前"
                                        >
                                          <span>↺</span>
                                          <span>重置</span>
                                        </button>
                                      )}

                                      {/* 删除镜头：内联二次确认，防止误触 */}
                                      {deletingBeatIndex === bIdx ? (
                                        <div className="flex items-center gap-1 text-[10px] bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5 animate-in fade-in duration-100">
                                          <span className="text-rose-700 font-medium">删镜?</span>
                                          <button
                                            type="button"
                                            onClick={() => handleDeleteBeat(bIdx)}
                                            className="px-1.5 py-0.2 rounded bg-rose-600 text-white font-medium hover:bg-rose-700 cursor-pointer"
                                          >
                                            确定
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setDeletingBeatIndex(null)}
                                            className="px-1.5 py-0.2 rounded bg-white text-slate-600 hover:bg-slate-100 border border-slate-200 cursor-pointer"
                                          >
                                            取消
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => setDeletingBeatIndex(bIdx)}
                                          disabled={beats.length <= 1}
                                          className="w-5 h-5 flex items-center justify-center text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors disabled:opacity-0 group-hover:text-slate-400 cursor-pointer"
                                          title="删除此镜头"
                                        >
                                          ✕
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {/* 物理动作与画面描述：所见即所得即梦式行内资产编辑器（输入与显示 100% 同体） */}
                                  <TiptapMentionEditor
                                    value={beat.actionDescription || ''}
                                    entities={entities}
                                    onChange={(val) => handleUpdateBeat(bIdx, 'actionDescription', val)}
                                    isModified={descModified}
                                    placeholder="在 @场景 中，@角色 动作走位、内联对白与物理拟音/环境声景..."
                                  />
                                </div>

                                {/* 卡片之间的优雅横线与+号插入点（hover 时显现，点击直接插入） */}
                                <InsertDivider onInsert={() => handleInsertBeatAt(bIdx + 1)} />
                              </React.Fragment>
                            );
                          })}
                      </div>
                    </>
                  ) : (
                    <div className="p-4 bg-white border border-dashed border-slate-200 rounded-xl text-center space-y-2">
                      <span className="text-2xl block">🎬</span>
                      <h5 className="text-xs font-bold text-slate-700">当前幕尚未升级为视听演绎剧本</h5>
                      <p className="text-[11px] text-slate-400 leading-relaxed max-w-xs mx-auto">
                        视听演绎剧本负责提炼黄昏薄雾等场景时空环境锁，并将故事升级为纯物理动作表演流。点击下方「进入画布制作」即可自动深化生成。
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 底部固定行动栏：双击下钻入口 */}
      <div className="p-4 bg-slate-50/90 border-t border-slate-100 flex items-center justify-between">
        <span className="text-[11px] text-slate-600 font-medium">
          💡 双击节点亦可直接进入
        </span>
        <button
          onClick={() => {
            if (node.kind === 'lookdev') {
              onEnterCanvas('lookdev');
            } else if (node.kind === 'clip' && node.clipId) {
              onEnterCanvas('clip', node.clipId, node.title);
            }
          }}
          disabled={!node.isUnlocked}
          className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all shadow-xs ${
            node.isUnlocked
              ? 'bg-indigo-600 hover:bg-indigo-700 text-white hover:shadow-indigo-200'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          }`}
        >
          <span>进入画布制作</span>
          <span>➔</span>
        </button>
      </div>
    </aside>
  );
};
