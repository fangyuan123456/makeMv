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

import React, { useState, useEffect, useMemo } from 'react';
import type { CanvasShotNode } from '../../../types/index.js';
import { updateShootingScript } from '../../../lib/api.js';

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

  // 2. 提取基准原始数据 (Original SSOT)
  const original = useMemo(() => {
    const rawTitle =
      matchedBeat?.beatTitle ||
      node.title ||
      node.sliceSummary ||
      '';
    const rawAction =
      matchedBeat?.actionDescription ||
      node.actionDescription ||
      node.sceneSubject ||
      node.prompt ||
      '';
    const rawDialogue = (matchedBeat?.dialogue ?? node.dialogue ?? '').trim();
    const rawCamera =
      matchedBeat?.cinematicIntent ||
      node.cinematicIntent ||
      node.cameraDirective?.instruction ||
      '';
    const rawSound =
      matchedBeat?.audioAmbience ||
      node.audioAmbience ||
      node.audioPrompt ||
      '';
    const rawDuration = Math.round(
      matchedBeat?.estimatedSeconds || node.durationSec || 4
    );

    return {
      beatTitle: rawTitle,
      durationSec: rawDuration,
      actionDescription: rawAction,
      dialogue: rawDialogue,
      cinematicIntent: rawCamera,
      audioAmbience: rawSound,
    };
  }, [matchedBeat, node]);

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

  // 4. 字段级修改判定
  const isFieldModified = (field: keyof typeof original) => {
    const origVal = original[field] ?? '';
    const currVal = form[field] ?? '';
    return String(origVal).trim() !== String(currVal).trim();
  };

  const isModified = (
    Object.keys(original) as Array<keyof typeof original>
  ).some((f) => isFieldModified(f));

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

      const updatedBeatData = {
        beatId: node.shotId || `beat_${node.id}`,
        beatTitle: form.beatTitle,
        estimatedSeconds: Number(form.durationSec) || 4,
        actionDescription: form.actionDescription,
        dialogue: form.dialogue,
        cinematicIntent: form.cinematicIntent,
        audioAmbience: form.audioAmbience,
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
        actionDescription: form.actionDescription,
        dialogue: form.dialogue,
        cinematicIntent: form.cinematicIntent,
        audioAmbience: form.audioAmbience,
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
    /(?:镜头|\bshot[_-]?|[sS]\d+[_-])\s*(\d+)/i
  );
  const shotNumStr = numMatch ? String(numMatch[1]).padStart(2, '0') : '01';

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
            <span>镜头属性已修改，与全剧摄制单联动</span>
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

      {/* 顶部标题、时长与重置栏 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="shrink-0 px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 font-mono font-bold text-xs">
            {shotNumStr}
          </span>
          <input
            type="text"
            value={form.beatTitle}
            onChange={(e) => setForm({ ...form, beatTitle: e.target.value })}
            placeholder="输入镜头标题与景别（如：近景甩镜 · 违规回头 · 3s）"
            className={`flex-1 min-w-0 text-xs sm:text-sm font-bold rounded-lg px-2 py-1 outline-hidden transition border ${
              isFieldModified('beatTitle')
                ? 'bg-amber-50/70 border-amber-300 text-amber-950 focus:border-amber-500 ring-1 ring-amber-200'
                : 'bg-transparent border-transparent hover:border-slate-200 focus:border-indigo-400 focus:bg-white text-slate-800'
            }`}
          />
        </div>

        <div className="shrink-0 flex items-center gap-1.5">
          {/* 单镜独立重置按钮 */}
          {isModified && (
            <button
              type="button"
              onClick={handleReset}
              className="px-2 py-0.5 rounded-md border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-[11px] font-semibold flex items-center gap-1 transition"
              title="还原当前镜头为未修改状态"
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
              {node.videoUrl ? '视频就绪' : node.keyframeUrl ? '首帧就绪' : '待制作'}
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

      {/* 1. 纯物理动作与表演时序编辑区 (Action & Staging) */}
      <div>
        <textarea
          rows={3}
          value={form.actionDescription}
          onChange={(e) =>
            setForm({ ...form, actionDescription: e.target.value })
          }
          placeholder="描写纯物理表演动作流与画面视觉主体（禁文学心理散文）..."
          className={`w-full rounded-xl p-3 text-xs leading-relaxed outline-hidden transition border resize-y ${
            isFieldModified('actionDescription')
              ? 'bg-amber-50/70 border-amber-300 text-amber-950 focus:border-amber-500 ring-1 ring-amber-200'
              : 'bg-slate-50/80 border-slate-200/70 focus:bg-white focus:border-indigo-400 text-slate-800'
          }`}
        />
      </div>

      {/* 2. 角色对白与台词栏 (Dialogue) */}
      <div className="border-l-[3px] border-indigo-500 pl-2.5 py-0.5 flex items-center gap-2">
        <span className="text-xs font-semibold text-indigo-600 shrink-0 inline-flex items-center gap-1 select-none">
          <span>💬</span>
          <span>对白:</span>
        </span>
        <input
          type="text"
          value={form.dialogue}
          onChange={(e) => setForm({ ...form, dialogue: e.target.value })}
          placeholder="角色台词（无对白可留空）"
          className={`flex-1 rounded-lg px-2.5 py-1.5 text-xs outline-hidden transition border ${
            isFieldModified('dialogue')
              ? 'bg-amber-50/70 border-amber-300 text-amber-950 focus:border-amber-500 ring-1 ring-amber-200 font-medium'
              : 'bg-slate-50/70 border-slate-200/70 focus:bg-white focus:border-indigo-400 text-slate-800'
          }`}
        />
      </div>

      {/* 3. 视听机位建议与运镜设计 (Camera & Cinematics) */}
      <div
        className={`rounded-xl p-2.5 border transition ${
          isFieldModified('cinematicIntent')
            ? 'bg-amber-50/70 border-amber-300 ring-1 ring-amber-200'
            : 'bg-slate-50/80 border-slate-200/70 focus-within:bg-white focus-within:border-indigo-400'
        }`}
      >
        <div className="flex items-start gap-2">
          <span className="text-xs font-semibold text-slate-700 shrink-0 inline-flex items-center gap-1 select-none pt-0.5">
            <span>🎥</span>
            <span>机位:</span>
          </span>
          <textarea
            rows={2}
            value={form.cinematicIntent}
            onChange={(e) =>
              setForm({ ...form, cinematicIntent: e.target.value })
            }
            placeholder="填写机位构图、摄影运镜指令（如：近景甩镜头 Whip Pan）..."
            className="flex-1 bg-transparent text-xs leading-relaxed text-slate-800 outline-hidden resize-none"
          />
        </div>
      </div>

      {/* 4. 现场拟音与动作音效 (Foley & Ambience) */}
      <div
        className={`rounded-xl p-2.5 border transition ${
          isFieldModified('audioAmbience')
            ? 'bg-amber-50/70 border-amber-300 ring-1 ring-amber-200'
            : 'bg-amber-50/40 border-amber-200/60 focus-within:bg-white focus-within:border-amber-400'
        }`}
      >
        <div className="flex items-start gap-2">
          <span className="text-xs font-semibold text-amber-800 shrink-0 inline-flex items-center gap-1 select-none pt-0.5">
            <span>🔊</span>
            <span>拟音:</span>
          </span>
          <textarea
            rows={2}
            value={form.audioAmbience}
            onChange={(e) =>
              setForm({ ...form, audioAmbience: e.target.value })
            }
            placeholder="填写现场物理拟音与环境声音设计（如：脚步声、衣物摩擦、烛灭抽吸声）..."
            className="flex-1 bg-transparent text-xs leading-relaxed text-amber-950 outline-hidden resize-none"
          />
        </div>
      </div>
    </div>
  );
};
