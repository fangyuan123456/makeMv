/**
 * client/src/components/studio/canvas/ShotScriptCard.tsx
 * 工业级视听摄制台本单镜头卡片 (Shooting Script Shot Card SSOT)
 *
 * 核心特性：
 * 1. 与全剧摄制单 (VisualInspectorPanel) 共享同一内存与物理存储 (SSOT 双向同步)；
 * 2. 支持直接点击打字编辑（动作时序、角色台词、机位、拟音、标题景别、时长）；
 * 3. 字段修改实时琥珀黄色高亮，单镜头右上角具备独立 [↺ 重置] 还原能力；
 * 4. 修改未保存时顶部浮现保存与重置操作栏，保存后两边立即同时生效；
 * 5. 遵守约束：在单镜头卡片检视器中不开放新增和删除镜头功能。
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { CanvasShotNode } from '../../../types/index.js';
import { updateShootingScript } from '../../../lib/api.js';
import { EntityMentionText, toMentionText } from './EntityMentionText.js';
import { TiptapMentionEditor } from './TiptapMentionEditor.js';

const AutoExpandTextarea: React.FC<{
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
  autoFocus?: boolean;
  onBlur?: () => void;
  onFocus?: () => void;
}> = ({ value, onChange, placeholder, className = '', minRows = 1, autoFocus, onBlur, onFocus }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.max(el.scrollHeight, minRows * 20)}px`;
    }
  }, [minRows]);

  useEffect(() => {
    resize();
    const timer = setTimeout(resize, 30);
    return () => clearTimeout(timer);
  }, [value, resize]);

  useEffect(() => {
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  useEffect(() => {
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
      onFocus={onFocus}
      placeholder={placeholder}
      className={`resize-none overflow-hidden block w-full ${className}`}
    />
  );
};

export interface ShotScriptCardProps {
  node: CanvasShotNode;
  projectId?: string;
  clipId?: string;
  projectData?: any;
  onRefreshProject?: () => void;
  onNodeUpdate?: (updatedNode: CanvasShotNode) => void;
  onClose?: () => void;
  className?: string;
  showMediaStatusBadge?: boolean;
}

export const ShotScriptCard: React.FC<ShotScriptCardProps> = ({
  node,
  projectId,
  clipId,
  projectData,
  onRefreshProject,
  onNodeUpdate,
  onClose,
  className = '',
  showMediaStatusBadge = false,
}) => {
  // 1. 从项目快照中精准定位当前分幕与对应的 actionBeat
  const { targetClip, matchedBeat } = useMemo(() => {
    if (!projectData) return { targetClip: null, matchedBeat: null };
    const clips =
      projectData.artifacts?.film_spec?.clips ||
      projectData.storyboards ||
      projectData.artifacts?.storyboards ||
      [];
    const c = Array.isArray(clips)
      ? clips.find(
          (item: any) =>
            item.clipId === clipId ||
            item.id === clipId ||
            item.sourceNodeId === clipId
        )
      : null;

    const beats: any[] = c?.shootingScript?.actionBeats || [];
    const nodeAny = node as any;
    const b =
      beats.find(
        (beat: any) =>
          beat.beatId === node.shotId ||
          (beat.beatId &&
            node.shotId &&
            beat.beatId.replace(/[-_]/g, '').toLowerCase() ===
              node.shotId.replace(/[-_]/g, '').toLowerCase()) ||
          (nodeAny.shotIndex !== undefined && beat.shotNumber === nodeAny.shotIndex + 1)
      ) || null;

    return { targetClip: c, matchedBeat: b };
  }, [projectData, clipId, node.shotId, (node as any).shotIndex]);

  const lookdevEntities = useMemo(() => {
    return projectData?.artifacts?.lookdev_entities || projectData?.lookdev_entities;
  }, [projectData]);

  // 2. 提取基准原始数据 (Original SSOT)
  const original = useMemo(() => {
    const rawTitle =
      matchedBeat?.beatTitle ||
      node.title ||
      node.sliceSummary ||
      '';
    const rawAction = toMentionText(
      (
        matchedBeat?.actionDescription ||
        node.actionDescription ||
        node.sceneSubject ||
        node.prompt ||
        ''
      ).replace(/[@＠]{2,}/g, '@'),
      lookdevEntities
    );
    const rawDuration = Math.round(
      matchedBeat?.estimatedSeconds || node.durationSec || 4
    );

    return {
      beatTitle: rawTitle,
      durationSec: rawDuration,
      actionDescription: rawAction,
    };
  }, [matchedBeat, node, lookdevEntities]);

  // 3. 本地可编辑表单状态
  const [form, setForm] = useState({ ...original });
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 当选中的镜头切换或权威数据更新时，重设表单
  useEffect(() => {
    setForm({ ...original });
    setSaveError(null);
  }, [original, node.id]);

  // 4. 字段级修改判定 (纯粹内容级比对：统一空白、换行与 @ 符号，打字即修改，删回即还原)
  const isFieldModified = (
    field: 'actionDescription' | 'durationSec' | string
  ) => {
    const origVal = original[field as keyof typeof original] ?? '';
    const currVal = form[field as keyof typeof form] ?? '';

    // 1. 严格相等或纯文本 trim 后相等，直接判定为未修改
    if (origVal === currVal) return false;
    if (String(origVal).trim() === String(currVal).trim()) return false;

    // 2. 动作流比对：统一换行与首尾空白，任何字符（包括 @）输入均变黄，删回原样严格恢复
    if (field === 'actionDescription') {
      const clean = (s: any) =>
        String(s || '')
          .replace(/\r\n/g, '\n')
          .trim();
      return clean(origVal) !== clean(currVal);
    }

    // 3. 时长数字归一化比对
    if (field === 'durationSec') {
      return Number(origVal || 4) !== Number(currVal || 4);
    }

    return String(origVal).trim() !== String(currVal).trim();
  };

  // 严格限定在用户真正可编辑的 2 大交互字段上，杜绝因只读系统标题或元数据差异导致卡片整体卡在修改态
  const editableFields: Array<
    'actionDescription' | 'durationSec'
  > = ['actionDescription', 'durationSec'];

  const isModified = editableFields.some((f) => isFieldModified(f));

  // 5. 还原修改 (单镜重置)
  const handleReset = () => {
    setForm({ ...original });
    setSaveError(null);
  };

  // 6. 保存修改并双向同步 (SSOT 回写)
  const handleSave = async () => {
    const pid = projectId || projectData?.meta?.projectId;
    const cid = clipId || node.clipId;
    if (!pid || !cid) {
      setSaveError('缺少项目或分幕标识，无法保存');
      return;
    }

    try {
      setIsSaving(true);
      setSaveError(null);

      // 获取当前分幕台本，无损修改对应节拍
      const currentScript = targetClip?.shootingScript || {
        clipId: cid,
        clipTitle: targetClip?.title || cid,
        actionBeats: [],
      };

      const actionBeats = Array.isArray(currentScript.actionBeats)
        ? [...currentScript.actionBeats]
        : [];

      const nodeAny = node as any;
      const beatIdx = actionBeats.findIndex(
        (b: any) =>
          b.beatId === node.shotId ||
          (b.beatId &&
            node.shotId &&
            b.beatId.replace(/[-_]/g, '').toLowerCase() ===
              node.shotId.replace(/[-_]/g, '').toLowerCase()) ||
          (nodeAny.shotIndex !== undefined && b.shotNumber === nodeAny.shotIndex + 1)
      );

      const storageAction = form.actionDescription.trim();
      const storageTitle = form.beatTitle.trim();

      const updatedBeatData = {
        beatId: node.shotId || `beat_${node.id}`,
        beatTitle: storageTitle,
        estimatedSeconds: Number(form.durationSec) || 4,
        actionDescription: storageAction,
      };

      if (beatIdx >= 0) {
        actionBeats[beatIdx] = {
          ...actionBeats[beatIdx],
          ...updatedBeatData,
        };
      } else {
        actionBeats.push({
          shotNumber: actionBeats.length + 1,
          ...updatedBeatData,
        });
      }

      const updatedScript = {
        ...currentScript,
        clipId: cid,
        actionBeats,
      };

      // 1. 调用后端统一持久化接口
      await updateShootingScript(pid, cid, updatedScript);

      // 2. 更新画布节点数据
      onNodeUpdate?.({
        ...node,
        title: form.beatTitle,
        durationSec: Number(form.durationSec) || 4,
        actionDescription: storageAction,
      });

      // 3. 刷新全剧 projectData，确保外部 VisualInspectorPanel 立即感知
      onRefreshProject?.();

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2200);
    } catch (err: any) {
      setSaveError(err.message || '保存台本失败');
    } finally {
      setIsSaving(false);
    }
  };

  // 提取纯数字序号 (例如 01)
  const numMatch = (form.beatTitle || node.title || node.id || '').match(
    /(?:镜头|片段|\bshot[_-]?|[sS]\d+[_-])\s*(\d+)/i
  );
  const shotNumStr = numMatch ? String(numMatch[1]).padStart(2, '0') : '01';

  // 提取景别或简短副标题徽章
  const shotBadge = useMemo(() => {
    if (form.beatTitle) {
      const m = form.beatTitle.match(/[（(](.*?)[）)]/);
      if (m && m[1]) return m[1].split('·')[0].trim();
      const cleaned = form.beatTitle.replace(/^(?:镜头|片段)\s*\d+[:：\s]*/, '').split('·')[0].trim();
      if (cleaned && cleaned !== form.beatTitle) return cleaned;
    }
    return matchedBeat?.cameraMotion || '';
  }, [form.beatTitle, matchedBeat]);

  return (
    <div
      className={`rounded-2xl border transition-all duration-200 p-4 space-y-3.5 ${
        isModified
          ? 'bg-amber-50/20 border-amber-300 shadow-md ring-1 ring-amber-200/50'
          : 'bg-white border-slate-200/90 shadow-xs'
      } ${className}`}
    >
      {/* 顶部修改提示与动作栏 */}
      {isModified && (
        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-300/80 text-amber-900 animate-in fade-in duration-150">
          <span className="text-[11px] font-medium flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span>片段属性已修改，与全剧演绎清单联动</span>
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleReset}
              disabled={isSaving}
              className="px-2 py-0.5 rounded-md border border-amber-300/80 bg-white hover:bg-amber-50 text-[11px] font-medium text-amber-800 transition shadow-2xs"
            >
              ↺ 还原
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-2.5 py-0.5 rounded-md bg-amber-600 hover:bg-amber-700 active:scale-95 text-[11px] font-semibold text-white transition shadow-2xs flex items-center gap-1"
            >
              {isSaving ? '保存中...' : '💾 保存'}
            </button>
          </div>
        </div>
      )}

      {saveSuccess && (
        <div className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium flex items-center gap-1.5 animate-in fade-in">
          <span>✓</span>
          <span>已保存并同步至全剧摄制单</span>
        </div>
      )}

      {saveError && (
        <div className="px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-center gap-1.5">
          <span>⚠</span>
          <span>{saveError}</span>
        </div>
      )}

      {/* 顶部紧凑状态条：纯粹标号、景别徽章、转场与时长（彻底消除冗余大标题框） */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="shrink-0 px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 font-mono font-bold text-xs">
            {shotNumStr}
          </span>
          {shotBadge && (
            <span className="shrink-0 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-medium text-xs border border-slate-200/60 truncate max-w-[200px]">
              {shotBadge}
            </span>
          )}
          {node.isSceneTransition && (
            <span className="px-2 py-0.5 rounded-md bg-amber-500 text-white font-bold text-[10px] flex items-center gap-1 shadow-2xs">
              <span>🔄</span>
              <span>场景转换</span>
            </span>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-1.5">
          {/* 单镜独立重置按钮 */}
          {isModified && (
            <button
              type="button"
              onClick={handleReset}
              className="px-2 py-0.5 rounded-md border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-[11px] font-semibold flex items-center gap-1 transition"
              title="还原当前片段为未修改状态"
            >
              <span>↺</span>
              <span>重置</span>
            </button>
          )}

          {showMediaStatusBadge && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium border ${
                node.videoUrl
                  ? 'bg-emerald-50 text-emerald-600 border-emerald-200/70'
                  : node.keyframeUrl
                  ? 'bg-indigo-50 text-indigo-600 border-indigo-200/70'
                  : 'bg-slate-50 text-slate-400 border-slate-200/70'
              }`}
            >
              {node.videoUrl ? '视频就绪' : node.videoPrompt ? '台本就绪' : '待制作'}
            </span>
          )}

          {/* 时长秒数编辑 */}
          <div
            className={`flex items-center gap-1 px-2 py-0.5 rounded-lg border text-xs font-mono transition ${
              isFieldModified('durationSec')
                ? 'bg-amber-50/70 border-amber-300 text-amber-950 ring-1 ring-amber-200'
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}
          >
            <input
              type="number"
              min={1}
              max={60}
              value={form.durationSec}
              onChange={(e) =>
                setForm({
                  ...form,
                  durationSec: Math.max(1, parseInt(e.target.value, 10) || 1),
                })
              }
              className="w-7 text-center bg-transparent outline-hidden font-bold"
            />
            <span className="text-[11px] text-slate-400 select-none">秒</span>
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="w-6 h-6 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition"
              title="关闭"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* 1. 视听动作流与声画对白统一剧本编辑器（动作 + 对白 + 拟音按时间顺序同框编写） */}
      <TiptapMentionEditor
        value={form.actionDescription}
        entities={lookdevEntities}
        onChange={(val) => setForm({ ...form, actionDescription: val })}
        isModified={isFieldModified('actionDescription')}
        placeholder="按时间顺序编写 @场景 内的动作走位、@角色 对白与现场拟音..."
      />
    </div>
  );
};
