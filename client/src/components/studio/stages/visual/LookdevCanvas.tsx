/**
 * client/src/components/studio/stages/visual/LookdevCanvas.tsx
 * 全剧视觉定妆专属制作画布 (Lookdev Inner Canvas SSOT)
 *
 * 核心机制：
 * 1. 【开阔制作画布】彻底告别狭窄的右侧抽屉，拥有独立且沉浸的 100% 浅色全屏展台；
 * 2. 【双向导航】顶部具备「← 返回流向拓扑」面包屑，随时无缝退回拓扑总览；
 * 3. 【全能制作】角色与场景立绘生成、提示词直接编辑保存、参考图上传与一键删除、多版本管理；
 * 4. 【客户端定向修改】卡片原生集成基于当前图 AI 定向精修（多模态图生图，锁定人脸与身材，定向微调服饰/道具）；
 * 5. 【零延迟乐观更新】点击 ✕ 删除参考底图 0 毫秒响应，彻底告别僵尸复活；
 * 6. 【极简右侧抽屉】右侧侧边栏专注纯粹的立绘大图查看、版本切换与提示词精修，无多余冗余卡片。
 */

import React, { useState, useRef, useEffect } from 'react';
import type { ProjectData, LookdevVersion, TaskRecord } from '../../../../types/index.js';
import {
  uploadReferenceImage,
  updateEntity,
  selectEntityVersion,
  imageRefineEntity,
} from '../../../../lib/api.js';
import { isEntityTaskRunning } from '../../../../lib/taskUtils.js';
import { DirectorFloatingBubble } from '../../chat/DirectorFloatingBubble.js';

export interface LookdevCanvasProps {
  projectId: string;
  projectData: ProjectData | null;
  tasks?: TaskRecord[];
  onRunTool: (toolName: string, input: Record<string, any>) => Promise<any>;
  onRefreshProject?: () => void;
  onBackToTopology: () => void;
  onEnlargeMedia?: (media: { title: string; imageUrl?: string; videoUrl?: string }) => void;
  isBusy: boolean;
}

interface ActiveEntityModal {
  type: 'character' | 'location';
  id: string;
  name: string;
  identity?: string;
  appearanceSummary?: string;
  currentImageUrl?: string;
  referenceImageUrl?: string;
  promptZh?: string;
  versions: LookdevVersion[];
  selectedVersionId?: string;
}

export const LookdevCanvas: React.FC<LookdevCanvasProps> = ({
  projectId,
  projectData,
  tasks = [],
  onRunTool,
  onRefreshProject,
  onBackToTopology,
  onEnlargeMedia,
  isBusy,
}) => {
  const [activeTab, setActiveTab] = useState<'characters' | 'locations' | 'items'>('characters');
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [uploadingEntityId, setUploadingEntityId] = useState<string | null>(null);
  const [versionModalEntity, setVersionModalEntity] = useState<ActiveEntityModal | null>(null);
  // 当前在定妆界面中点击选中的定妆卡 ID (用于滑出右侧侧边栏)
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  // 已被用户主动删除参考底图的实体 ID 集合 (用于前端 0 毫秒乐观更新，防止任何延迟和卡顿)
  const [deletedReferenceIds, setDeletedReferenceIds] = useState<Set<string>>(new Set());
  // 当前展开「基于此图定向修改」面板的实体 ID (单卡展开)
  const [activeRefineEntityId, setActiveRefineEntityId] = useState<string | null>(null);
  // 定向修改输入的自然语言草稿
  const [refineInputs, setRefineInputs] = useState<Record<string, string>>({});
  // 正在提交定向精修请求的实体集合 (网络提交期微态保护)
  const [isSubmittingRefine, setIsSubmittingRefine] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadTargetRef = useRef<{ type: 'character' | 'location' | 'item'; id: string } | null>(null);

  const entities = projectData?.entities || projectData?.artifacts?.lookdev_entities;
  const characters = entities?.characters || [];
  const locations = entities?.locations || [];
  const items = entities?.items || [];

  // 判断是否正在提取资产
  const isExtracting = tasks.some(
    (t) =>
      (t.status === 'running' || t.status === 'pending') &&
      t.toolName === 'film.asset_extraction'
  );

  // 首次进入若无角色，自动触发提取
  useEffect(() => {
    if (characters.length === 0 && !isExtracting) {
      console.log('[LookdevCanvas] 首次进入定妆画布，自动提取全剧角色与场景外观...');
      onRunTool('film.asset_extraction', {})
        .then(() => onRefreshProject?.())
        .catch((err) => console.warn('[LookdevCanvas] 自动提取视觉资产失败:', err));
    }
  }, [characters.length, isExtracting]);

  // 判断指定角色是否正在定妆中 (SSOT: 严格基于全局 tasks 与定向精修提交状态判定)
  const isCharacterGenerating = (char: any): boolean => {
    const charId = char.characterId || char.id;
    if (!charId) return false;
    if (isSubmittingRefine.has(charId)) return true;
    return isEntityTaskRunning(tasks, 'film.character_portrait', {
      characterId: charId,
      id: charId,
    });
  };

  // 判断指定场景是否正在渲染中 (SSOT: 严格基于全局 tasks 与定向精修提交状态判定)
  const isLocationGenerating = (loc: any): boolean => {
    const locId = loc.locationId || loc.id;
    if (!locId) return false;
    if (isSubmittingRefine.has(locId)) return true;
    return isEntityTaskRunning(tasks, 'film.scene_atmosphere', {
      locationId: locId,
      id: locId,
    });
  };

  // 触发单角色定妆生图 (单个点击精准锁定，允许强制重新定妆)
  const handleGenerateCharacter = async (char: any) => {
    const charId = char.characterId || char.id;
    try {
      await onRunTool('film.character_portrait', {
        projectId,
        characterId: charId,
        force: true,
      });
      onRefreshProject?.();
    } catch (err: any) {
      alert(`定妆生成失败: ${err.message || String(err)}`);
    }
  };

  // 触发单场景氛围图生成 (单个点击精准锁定，允许强制重新生成)
  const handleGenerateLocation = async (loc: any) => {
    const locId = loc.locationId || loc.id;
    try {
      await onRunTool('film.scene_atmosphere', {
        projectId,
        locationId: locId,
        force: true,
      });
      onRefreshProject?.();
    } catch (err: any) {
      alert(`场景生成失败: ${err.message || String(err)}`);
    }
  };

  // 触发基于当前立绘图的 AI 定向精修 (多模态图生图，严格锁定人物面容与体态身材)
  const handleImageRefine = async (
    type: 'character' | 'location' | 'item',
    entityId: string,
    baseImageUrl?: string
  ) => {
    const instruction = refineInputs[entityId]?.trim();
    if (!instruction) {
      alert('请输入修改要求，例如：换成黑色皮衣、戴细框墨镜、头发扎成马尾等');
      return;
    }
    if (!baseImageUrl) {
      alert('请先生成首张定妆立绘，才能基于此图定向修改！');
      return;
    }

    setIsSubmittingRefine((prev) => new Set(prev).add(entityId));

    try {
      await imageRefineEntity(projectId, type, entityId, instruction, baseImageUrl);
      // 清空输入并收起面板
      setRefineInputs((prev) => ({ ...prev, [entityId]: '' }));
      setActiveRefineEntityId(null);
      onRefreshProject?.();
    } catch (err: any) {
      alert(`基于当前图修改失败: ${err.message || String(err)}`);
    } finally {
      setIsSubmittingRefine((prev) => {
        const next = new Set(prev);
        next.delete(entityId);
        return next;
      });
    }
  };

  // 批量全剧定妆 (幂等增量：已定妆的角色和场景坚决不动，仅为未完成项补齐)
  const handleBatchGenerate = async () => {
    const pendingChars = characters.filter((c: any) => !c.imageUrl);
    const pendingLocs = locations.filter((l: any) => !l.imageUrl);

    if (pendingChars.length === 0 && pendingLocs.length === 0) {
      alert('全剧角色与场景已全部完成定妆，定过的保持不动！如需重新设计某位角色，请在对应卡片点击「重新定妆」。');
      return;
    }

    try {
      const taskPromises = [
        ...pendingChars.map((char: any) => {
          const cId = char.characterId || char.id;
          return onRunTool('film.character_portrait', {
            projectId,
            characterId: cId,
            force: false,
          });
        }),
        ...pendingLocs.map((loc: any) => {
          const lId = loc.locationId || loc.id;
          return onRunTool('film.scene_atmosphere', {
            projectId,
            locationId: lId,
            force: false,
          });
        }),
      ];

      await Promise.allSettled(taskPromises);
      onRefreshProject?.();
    } catch (err: any) {
      alert(`批量定妆任务下发异常: ${err.message || String(err)}`);
    }
  };

  // 保存提示词修改
  const handleSavePrompt = async (type: 'character' | 'location' | 'item', id: string) => {
    const newPrompt = promptDrafts[id];
    if (newPrompt === undefined) {
      setEditingPromptId(null);
      return;
    }
    try {
      await updateEntity(projectId, type, id, { promptZh: newPrompt });
      onRefreshProject?.();
      setEditingPromptId(null);
    } catch (err: any) {
      alert(`保存提示词失败: ${err.message || String(err)}`);
    }
  };

  // 辅助获取实体当前生效的参考底图 (支持乐观更新，如果已被用户点✕删除则立即返回 undefined)
  const getEntityRefImage = (entity: any): string | undefined => {
    if (!entity) return undefined;
    const id = entity.characterId || entity.locationId || entity.id;
    if (deletedReferenceIds.has(id)) return undefined;
    return entity.referenceImageUrl || undefined;
  };

  // 上传参考图
  const handleTriggerUpload = (type: 'character' | 'location' | 'item', id: string) => {
    pendingUploadTargetRef.current = { type, id };
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pendingUploadTargetRef.current) return;
    const { type, id } = pendingUploadTargetRef.current;
    setUploadingEntityId(id);
    try {
      const fileUrl = await uploadReferenceImage(projectId, type, id, file);
      await updateEntity(projectId, type, id, { referenceImageUrl: fileUrl });
      setDeletedReferenceIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      onRefreshProject?.();
    } catch (err: any) {
      alert(`上传参考图失败: ${err.message || String(err)}`);
    } finally {
      setUploadingEntityId(null);
      pendingUploadTargetRef.current = null;
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // 清除/删除实体的参考底图 (即时乐观更新，0 延迟响应)
  const handleRemoveReferenceImage = async (type: 'character' | 'location' | 'item', id: string) => {
    // 1. 本地乐观更新，界面 0 毫秒立即清除
    setDeletedReferenceIds((prev) => new Set(prev).add(id));
    try {
      await updateEntity(projectId, type, id, { referenceImageUrl: '' });
      onRefreshProject?.();
    } catch (err: any) {
      // 失败时回滚
      setDeletedReferenceIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      alert(`删除参考底图失败: ${err.message || String(err)}`);
    }
  };

  // 切换实体定妆历史版本
  const handleSelectVersion = async (
    type: 'character' | 'location',
    id: string,
    versionId: string
  ) => {
    try {
      await selectEntityVersion(projectId, type, id, versionId);
      onRefreshProject?.();
    } catch (err: any) {
      alert(`切换版本失败: ${err.message || String(err)}`);
    }
  };

  const completedChars = characters.filter((c: any) => Boolean(c.imageUrl)).length;
  const completedLocs = locations.filter((l: any) => Boolean(l.imageUrl)).length;

  // 反查当前在定妆界面中点击选中的实体对象
  const selectedCharacter = characters.find(
    (c: any) => (c.characterId || c.id) === selectedEntityId
  );
  const selectedLocation = locations.find(
    (l: any) => (l.locationId || l.id) === selectedEntityId
  );
  const selectedItem = items.find(
    (i: any) => (i.itemId || i.id) === selectedEntityId
  );
  const activeSelectedEntity = selectedCharacter || selectedLocation || selectedItem;
  const isItemEntity = !selectedCharacter && !selectedLocation && Boolean(selectedItem);
  const isLocationEntity = !selectedCharacter && !isItemEntity && Boolean(selectedLocation);
  const activeRefImg = activeSelectedEntity ? getEntityRefImage(activeSelectedEntity) : undefined;

  return (
    <div className="relative w-full h-full flex flex-col bg-[#f8fafc] overflow-hidden select-none animate-in fade-in duration-200">
      {/* 隐式文件上传 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* 优雅浅色底网格点阵 */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-60">
        <defs>
          <pattern id="lookdev_dot_grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.2" fill="#cbd5e1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#lookdev_dot_grid)" />
      </svg>

      {/* ──────────────── 1. 顶部专业视听导航栏 ──────────────── */}
      <header className="relative z-10 px-8 py-4 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-2xs flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={onBackToTopology}
            className="px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100/80 text-xs font-bold text-slate-700 flex items-center space-x-2 transition-all shadow-2xs hover:shadow-xs active:scale-95 cursor-pointer"
          >
            <span>←</span>
            <span>返回流向拓扑</span>
          </button>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center space-x-3">
            <span className="text-2xl">🎨</span>
            <div className="flex items-center space-x-2">
              <h2 className="text-base font-black text-slate-900 tracking-tight">
                全剧视觉定妆工坊
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 border border-indigo-200 text-indigo-700">
                🎭 角色 {completedChars}/{characters.length} · 🏞️ 场景 {completedLocs}/{locations.length}
                {' · '}🧰 道具 {items.filter((item: any) => Boolean(item.referenceImageUrl || item.imageUrl)).length}/{items.length}
              </span>
            </div>
          </div>
        </div>

        {/* 顶部右侧：标签与批量操作 */}
        <div className="flex items-center space-x-4">
          {/* 标签切换 */}
          <div className="p-1 bg-slate-100 rounded-xl flex items-center space-x-1 border border-slate-200">
            <button
              onClick={() => setActiveTab('characters')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'characters'
                  ? 'bg-white text-indigo-600 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🎭 核心角色 ({characters.length})
            </button>
            <button
              onClick={() => setActiveTab('locations')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'locations'
                  ? 'bg-white text-indigo-600 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🏞️ 场景氛围 ({locations.length})
            </button>
            <button
              onClick={() => setActiveTab('items')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'items'
                  ? 'bg-white text-indigo-600 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🧰 核心道具 ({items.length})
            </button>
          </div>

          <button
            onClick={handleBatchGenerate}
            disabled={isBusy}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer ${
              isBusy
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-100 active:scale-95'
            }`}
          >
            <span>✨ 全剧一键批量定妆</span>
          </button>
        </div>
      </header>

      {/* 资产提取遮罩固定在画布层，不参与下方展台滚动 */}
      {isExtracting && (
        <div className="absolute inset-x-0 top-[65px] bottom-0 bg-white/85 backdrop-blur-md z-30 flex flex-col items-center justify-center p-8 select-none animate-in fade-in duration-300">
          <div className="relative w-16 h-16 mb-5 flex items-center justify-center">
            <svg
              className="w-14 h-14 text-indigo-600 animate-spin"
              viewBox="0 0 100 100"
              style={{ animationDuration: '1s' }}
            >
              {Array.from({ length: 12 }).map((_, i) => (
                <rect
                  key={i}
                  x="46.5"
                  y="10"
                  width="7"
                  height="22"
                  rx="3.5"
                  fill="currentColor"
                  opacity={(i + 1) / 12}
                  transform={`rotate(${i * 30} 50 50)`}
                />
              ))}
            </svg>
          </div>
          <h3 className="text-base font-black text-slate-800 tracking-tight mb-2">
            AI 视觉导演正在提取全剧视觉设定...
          </h3>
          <p className="text-xs text-slate-500 text-center max-w-md leading-relaxed mb-5">
            正在深度解析剧本圣经与人物小传，提炼全剧登场角色的形象特征与场景空间氛围，自动装配纯中文影视级视觉定妆提示词。
          </p>
          <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-indigo-50 border border-indigo-200/80 text-indigo-700 text-[11px] font-semibold shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
            <span>🎭 正在解析核心角色设定 · 🏞️ 构想场景光影空间</span>
          </div>
        </div>
      )}

      {/* ──────────────── 2. 核心展台内容区 ──────────────── */}
      <main className="relative z-10 flex-1 overflow-y-auto px-8 py-6">
        {/* ──────────────── Tab 1: 角色展台 ──────────────── */}
        {activeTab === 'characters' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {characters.map((char: any) => {
              const charId = char.characterId || char.id;
              const charRefImg = getEntityRefImage(char);
              const isGen = isCharacterGenerating(char);
              const isEditing = editingPromptId === charId;
              const isSelected = selectedEntityId === charId;
              const currentPrompt =
                promptDrafts[charId] !== undefined
                  ? promptDrafts[charId]
                  : char.promptZh || char.appearanceSummary || '';

              return (
                <div
                  key={charId}
                  onClick={() => setSelectedEntityId(charId)}
                  className={`bg-white/95 backdrop-blur-xs border rounded-3xl p-4 transition-all flex flex-col group cursor-pointer ${
                    isSelected
                      ? 'border-indigo-500 ring-4 ring-indigo-500/20 shadow-md bg-indigo-50/20'
                      : 'border-slate-200/90 hover:border-indigo-300 shadow-xs hover:shadow-md'
                  }`}
                >
                  {/* 立绘主图 (工业级 2:1 三视图画幅，object-contain 保持正/侧/背三重视角 100% 完整无裁剪) */}
                  <div className="relative w-full aspect-[2/1] rounded-2xl overflow-hidden bg-slate-100 border border-slate-200/60 mb-3.5 group/img flex items-center justify-center p-1">
                    {char.imageUrl ? (
                      <>
                        <img
                          key={`${char.imageUrl}_${char.selectedVersionId}`}
                          src={`${char.imageUrl}?t=${char.selectedVersionId || Date.now()}`}
                          alt={char.name}
                          className="w-full h-full object-contain object-center group-hover/img:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-xs text-white text-[10px] font-medium border border-white/20">
                          📐 概念三视图 · 正/侧/背
                        </div>
                      </>
                    ) : charRefImg ? (
                      <div className="relative w-full h-full flex items-center justify-center">
                        <img
                          src={charRefImg}
                          alt={`参考底图 · ${char.name}`}
                          className="w-full h-full object-contain object-top group-hover/img:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-black/65 backdrop-blur-xs text-white text-[10px] font-semibold border border-white/20">
                          📷 参考底图 (待定妆)
                        </div>
                      </div>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4 text-center">
                        <span className="text-3xl mb-2">🎭</span>
                        <span className="text-xs font-semibold">待生成立绘</span>
                        <span className="text-[10px] text-slate-400 mt-1">
                          点击下方「重新定妆」立即启动
                        </span>
                      </div>
                    )}

                    {/* 生成中遮罩 */}
                    {isGen && (
                      <div className="absolute inset-0 bg-slate-900/65 backdrop-blur-xs flex flex-col items-center justify-center text-white z-10">
                        <span className="text-2xl animate-spin mb-2">⏳</span>
                        <span className="text-xs font-bold">AI 定妆中...</span>
                      </div>
                    )}

                    {/* 图片左上角：版本库切换入口 (直观显示当前方案版本，点击可自由选用任意历史版本) */}
                    {char.versions && char.versions.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setVersionModalEntity({
                            type: 'character',
                            id: char.characterId || char.id,
                            name: char.name,
                            currentImageUrl: char.imageUrl,
                            versions: char.versions,
                            selectedVersionId: char.selectedVersionId || char.versions[char.versions.length - 1]?.versionId,
                          });
                        }}
                        className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-black/65 hover:bg-black/85 backdrop-blur-xs text-white text-[10px] font-mono font-semibold flex items-center space-x-1 cursor-pointer transition-all border border-white/20 z-10"
                        title="点击查看并切换历史定妆版本"
                      >
                        <span>v{char.versions.length}</span>
                        <span className="text-[9px] text-indigo-300 font-sans">({char.versions.length}版)</span>
                      </button>
                    )}

                    {/* 图片右上角：放大灯箱入口 */}
                    {(char.imageUrl || charRefImg) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEnlargeMedia?.({
                            title: char.imageUrl ? `角色定妆 · ${char.name}` : `参考底图 · ${char.name}`,
                            imageUrl: char.imageUrl || charRefImg,
                          });
                        }}
                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 backdrop-blur-xs text-white opacity-0 group-hover/img:opacity-100 transition-opacity text-xs z-10 cursor-pointer"
                        title="放大查看原图"
                      >
                        ⛶
                      </button>
                    )}

                    {/* 参考图微缩胶囊 (附带真实底图小预览与删除按钮) */}
                    {char.imageUrl && charRefImg && (
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          onEnlargeMedia?.({
                            title: `参考底图 · ${char.name}`,
                            imageUrl: charRefImg,
                          });
                        }}
                        className="absolute bottom-2 left-2 px-2 py-1 rounded-lg bg-black/75 hover:bg-black/90 backdrop-blur-xs text-white text-[10px] flex items-center space-x-1.5 cursor-pointer border border-white/20 shadow-xs z-10"
                        title="点击全屏查看参考底图"
                      >
                        <img
                          src={charRefImg}
                          alt="底图"
                          className="w-4 h-4 rounded-full object-cover border border-white/60 shrink-0"
                        />
                        <span className="font-medium text-slate-200">参考底图</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handleRemoveReferenceImage('character', charId);
                          }}
                          className="w-4 h-4 rounded-full bg-black/50 hover:bg-rose-600 text-white flex items-center justify-center transition cursor-pointer text-[10px] ml-0.5 shadow-2xs"
                          title="删除参考底图"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 角色名称与身份简介 (分层排版，确保名字 100% 完整显示绝不被挤压遮挡) */}
                  <div className="mb-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="text-sm font-bold text-slate-900 tracking-tight shrink-0">
                        {char.name}
                      </h4>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/80 shrink-0">
                        {char.role || '主要角色'}
                      </span>
                    </div>
                    {char.identity && (
                      <p
                        title={char.identity}
                        className="text-[11px] text-slate-500 truncate leading-normal"
                      >
                        {char.identity}
                      </p>
                    )}
                  </div>

                  {/* 中文提示词全展开与修改 */}
                  <div className="flex-1 bg-slate-50 border border-slate-200/70 rounded-xl p-2.5 mb-3 flex flex-col">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-bold text-slate-700 flex items-center space-x-1">
                        <span>🎨 角色外观设定</span>
                      </span>
                      {isEditing ? (
                        <div className="flex items-center space-x-1.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSavePrompt('character', charId);
                            }}
                            className="text-[10px] text-indigo-600 font-bold hover:underline"
                          >
                            保存
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingPromptId(null);
                            }}
                            className="text-[10px] text-slate-400 hover:text-slate-600"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingPromptId(charId);
                            setPromptDrafts((prev) => ({
                              ...prev,
                              [charId]: char.promptZh || char.appearanceSummary || '',
                            }));
                          }}
                          className="text-[10px] text-slate-400 hover:text-indigo-600 flex items-center space-x-0.5 cursor-pointer"
                        >
                          <span>✏️ 编辑</span>
                        </button>
                      )}
                    </div>

                    {isEditing ? (
                      <textarea
                        value={currentPrompt}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          setPromptDrafts((prev) => ({ ...prev, [charId]: e.target.value }))
                        }
                        rows={3}
                        placeholder="描述角色的外貌特征、体态骨相、服装穿着与发型配饰..."
                        className="w-full text-xs text-slate-800 bg-white border border-indigo-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                      />
                    ) : (
                      <p className="text-xs text-slate-600 leading-relaxed line-clamp-3 overflow-hidden select-text">
                        {char.promptZh || char.appearanceSummary || '暂无详细提示词'}
                      </p>
                    )}
                  </div>

                  {/* 底部操作行动条 */}
                  <div className="flex items-center space-x-2 pt-1 border-t border-slate-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTriggerUpload('character', charId);
                      }}
                      disabled={uploadingEntityId === charId}
                      className="px-2.5 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-[11px] font-semibold text-slate-600 flex items-center space-x-1 transition-colors cursor-pointer"
                      title="上传参考底图以控制人脸/服饰一致性"
                    >
                      <span>{uploadingEntityId === charId ? '上传中...' : '📷 换底图'}</span>
                    </button>

                    {/* 基于此图修改按钮 (仅当已有立绘时展示) */}
                    {char.imageUrl && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveRefineEntityId(
                            activeRefineEntityId === charId ? null : charId
                          );
                        }}
                        className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold flex items-center space-x-1 transition-all cursor-pointer ${
                          activeRefineEntityId === charId
                            ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                            : 'bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200'
                        }`}
                        title="基于当前立绘进行图生图定向精修（严格锁定人物五官身材，仅修改衣服/发色/道具）"
                      >
                        <span>🎨</span>
                        <span>{activeRefineEntityId === charId ? '收起修改' : '基于此图修改'}</span>
                      </button>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleGenerateCharacter(char);
                      }}
                      disabled={isGen || isBusy}
                      className={`flex-1 py-1.5 rounded-xl text-xs font-bold flex items-center justify-center space-x-1 transition-all cursor-pointer ${
                        isGen || isBusy
                          ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                          : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 active:scale-95'
                      }`}
                    >
                      <span>✨</span>
                      <span>{char.imageUrl ? '重新定妆' : '生成定妆'}</span>
                    </button>
                  </div>

                  {/* 展开的基于当前图定向精修面板 */}
                  {activeRefineEntityId === charId && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="mt-2.5 p-3 rounded-2xl bg-gradient-to-br from-purple-50/95 to-indigo-50/90 border border-purple-200 shadow-xs space-y-2 animate-in fade-in zoom-in-95 duration-150"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-purple-950 flex items-center space-x-1">
                          <span>🎨</span>
                          <span>多模态通用定向精修</span>
                        </span>
                        <span className="text-[10px] text-purple-600 font-mono">
                          动态差分解耦
                        </span>
                      </div>
                      <p className="text-[10px] text-purple-700 leading-tight">
                        以当前立绘为基准底模，支持修改任意肢体姿态、面容神情、服饰道具或细节：
                      </p>
                      <textarea
                        value={refineInputs[charId] || ''}
                        onChange={(e) =>
                          setRefineInputs((prev) => ({ ...prev, [charId]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleImageRefine('character', charId, char.imageUrl);
                          }
                        }}
                        rows={2}
                        placeholder="输入任意修改指令（如：双脚并拢站立、头不要偏目光看前面、换深色风衣、去掉面具、加一道浅伤疤等）..."
                        className="w-full text-xs text-slate-800 bg-white border border-purple-200 rounded-xl p-2 focus:outline-none focus:ring-2 focus:ring-purple-400 placeholder:text-slate-400 resize-none shadow-2xs font-sans"
                      />
                      <div className="flex items-center justify-between pt-0.5">
                        <span className="text-[10px] text-purple-600">Enter 回车即刻出图</span>
                        <div className="flex items-center space-x-1.5">
                          <button
                            onClick={() => setActiveRefineEntityId(null)}
                            className="px-2 py-1 rounded-lg text-[11px] text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 transition cursor-pointer"
                          >
                            取消
                          </button>
                          <button
                            onClick={() => handleImageRefine('character', charId, char.imageUrl)}
                            disabled={isSubmittingRefine.has(charId) || isGen || isBusy}
                            className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-xs flex items-center space-x-1 transition active:scale-95 disabled:opacity-50 cursor-pointer"
                          >
                            <span>🎨</span>
                            <span>
                              {isSubmittingRefine.has(charId) ? 'AI 构思融合中...' : '定向修改并出图'}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ──────────────── Tab 2: 场景展台 ──────────────── */}
        {activeTab === 'locations' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {locations.map((loc: any) => {
              const locId = loc.locationId || loc.id;
              const locRefImg = getEntityRefImage(loc);
              const isGen = isLocationGenerating(loc);
              const isEditing = editingPromptId === locId;
              const isSelected = selectedEntityId === locId;
              const currentPrompt =
                promptDrafts[locId] !== undefined
                  ? promptDrafts[locId]
                  : loc.promptZh || loc.atmospherePrompt || '';

              return (
                <div
                  key={locId}
                  onClick={() => setSelectedEntityId(locId)}
                  className={`bg-white/95 backdrop-blur-xs border rounded-3xl p-4 transition-all flex flex-col group cursor-pointer ${
                    isSelected
                      ? 'border-indigo-500 ring-4 ring-indigo-500/20 shadow-md bg-indigo-50/20'
                      : 'border-slate-200/90 hover:border-indigo-300 shadow-xs hover:shadow-md'
                  }`}
                >
                  {/* 场景氛围主图 (16:9 画幅) */}
                  <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-100 border border-slate-200/60 mb-3.5 group/img">
                    {loc.imageUrl ? (
                      <img
                        key={`${loc.imageUrl}_${loc.selectedVersionId}`}
                        src={`${loc.imageUrl}?t=${loc.selectedVersionId || Date.now()}`}
                        alt={loc.name}
                        className="w-full h-full object-cover group-hover/img:scale-105 transition-transform duration-300"
                      />
                    ) : locRefImg ? (
                      <div className="relative w-full h-full flex items-center justify-center">
                        <img
                          src={locRefImg}
                          alt={`参考底图 · ${loc.name}`}
                          className="w-full h-full object-cover group-hover/img:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-black/65 backdrop-blur-xs text-white text-[10px] font-semibold border border-white/20">
                          📷 参考底图 (待渲染)
                        </div>
                      </div>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4 text-center">
                        <span className="text-3xl mb-1.5">🏞️</span>
                        <span className="text-xs font-semibold">待生成场景氛围图</span>
                      </div>
                    )}

                    {/* 生成中遮罩 */}
                    {isGen && (
                      <div className="absolute inset-0 bg-slate-900/65 backdrop-blur-xs flex flex-col items-center justify-center text-white z-10">
                        <span className="text-2xl animate-spin mb-2">⏳</span>
                        <span className="text-xs font-bold">场景渲染中...</span>
                      </div>
                    )}

                    {/* 场景左上角：版本库切换入口 */}
                    {loc.versions && loc.versions.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setVersionModalEntity({
                            type: 'location',
                            id: loc.locationId || loc.id,
                            name: loc.name,
                            currentImageUrl: loc.imageUrl,
                            versions: loc.versions,
                            selectedVersionId: loc.selectedVersionId || loc.versions[loc.versions.length - 1]?.versionId,
                          });
                        }}
                        className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-black/65 hover:bg-black/85 backdrop-blur-xs text-white text-[10px] font-mono font-semibold flex items-center space-x-1 cursor-pointer transition-all border border-white/20 z-10"
                        title="点击查看并切换历史场景氛围版本"
                      >
                        <span>v{loc.versions.length}</span>
                        <span className="text-[9px] text-indigo-300 font-sans">({loc.versions.length}版)</span>
                      </button>
                    )}

                    {/* 场景右上角：放大灯箱入口 */}
                    {(loc.imageUrl || locRefImg) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEnlargeMedia?.({
                            title: loc.imageUrl ? `场景氛围 · ${loc.name}` : `场景参考底图 · ${loc.name}`,
                            imageUrl: loc.imageUrl || locRefImg,
                          });
                        }}
                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 backdrop-blur-xs text-white opacity-0 group-hover/img:opacity-100 transition-opacity text-xs z-10 cursor-pointer"
                        title="放大查看原图"
                      >
                        ⛶
                      </button>
                    )}

                    {/* 场景参考图微缩胶囊 (附带真实底图小预览与删除按钮) */}
                    {loc.imageUrl && locRefImg && (
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          onEnlargeMedia?.({
                            title: `场景参考底图 · ${loc.name}`,
                            imageUrl: locRefImg,
                          });
                        }}
                        className="absolute bottom-2 left-2 px-2 py-1 rounded-lg bg-black/75 hover:bg-black/90 backdrop-blur-xs text-white text-[10px] flex items-center space-x-1.5 cursor-pointer border border-white/20 shadow-xs z-10"
                        title="点击全屏查看场景参考底图"
                      >
                        <img
                          src={locRefImg}
                          alt="底图"
                          className="w-4 h-4 rounded-full object-cover border border-white/60 shrink-0"
                        />
                        <span className="font-medium text-slate-200">参考底图</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handleRemoveReferenceImage('location', locId);
                          }}
                          className="w-4 h-4 rounded-full bg-black/50 hover:bg-rose-600 text-white flex items-center justify-center transition cursor-pointer text-[10px] ml-0.5 shadow-2xs"
                          title="删除场景参考底图"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-bold text-slate-900 truncate">
                      {loc.name}
                    </h4>
                  </div>

                  {/* 场景提示词 */}
                  <div className="flex-1 bg-slate-50 border border-slate-200/70 rounded-xl p-2.5 mb-3 flex flex-col">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-bold text-slate-700">
                        🏞️ 空间与光影提示词
                      </span>
                      {isEditing ? (
                        <div className="flex items-center space-x-1.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSavePrompt('location', locId);
                            }}
                            className="text-[10px] text-indigo-600 font-bold hover:underline"
                          >
                            保存
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingPromptId(null);
                            }}
                            className="text-[10px] text-slate-400 hover:text-slate-600"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingPromptId(locId);
                            setPromptDrafts((prev) => ({
                              ...prev,
                              [locId]: loc.promptZh || loc.atmospherePrompt || '',
                            }));
                          }}
                          className="text-[10px] text-slate-400 hover:text-indigo-600 flex items-center space-x-0.5 cursor-pointer"
                        >
                          <span>✏️ 编辑</span>
                        </button>
                      )}
                    </div>

                    {isEditing ? (
                      <textarea
                        value={currentPrompt}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          setPromptDrafts((prev) => ({ ...prev, [locId]: e.target.value }))
                        }
                        rows={3}
                        className="w-full text-xs text-slate-800 bg-white border border-indigo-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                      />
                    ) : (
                      <p className="text-xs text-slate-600 leading-relaxed line-clamp-3 overflow-hidden select-text">
                        {loc.promptZh || loc.atmospherePrompt || '暂无详细提示词'}
                      </p>
                    )}
                  </div>

                  {/* 底部按钮 */}
                  <div className="flex items-center space-x-2 pt-1 border-t border-slate-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTriggerUpload('location', locId);
                      }}
                      disabled={uploadingEntityId === locId}
                      className="px-2.5 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-[11px] font-semibold text-slate-600 flex items-center space-x-1 transition-colors cursor-pointer"
                      title="上传参考底图以控制场景风格一致性"
                    >
                      <span>{uploadingEntityId === locId ? '上传中...' : '📷 换底图'}</span>
                    </button>

                    {/* 基于此图修改按钮 (仅当已有场景图时展示) */}
                    {loc.imageUrl && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveRefineEntityId(
                            activeRefineEntityId === locId ? null : locId
                          );
                        }}
                        className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold flex items-center space-x-1 transition-all cursor-pointer ${
                          activeRefineEntityId === locId
                            ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                            : 'bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200'
                        }`}
                        title="基于当前场景进行图生图定向精修（保持场景结构，仅修改天气/光影/氛围）"
                      >
                        <span>🎨</span>
                        <span>{activeRefineEntityId === locId ? '收起修改' : '基于此图修改'}</span>
                      </button>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleGenerateLocation(loc);
                      }}
                      disabled={isGen || isBusy}
                      className={`flex-1 py-1.5 rounded-xl text-xs font-bold flex items-center justify-center space-x-1 transition-all cursor-pointer ${
                        isGen || isBusy
                          ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                          : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 active:scale-95'
                      }`}
                    >
                      <span>✨</span>
                      <span>{loc.imageUrl ? '重新渲染' : '生成场景'}</span>
                    </button>
                  </div>

                  {/* 展开的基于当前场景定向精修面板 */}
                  {activeRefineEntityId === locId && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="mt-2.5 p-3 rounded-2xl bg-gradient-to-br from-purple-50/95 to-indigo-50/90 border border-purple-200 shadow-xs space-y-2 animate-in fade-in zoom-in-95 duration-150"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-purple-950 flex items-center space-x-1">
                          <span>🎨</span>
                          <span>多模态通用定向精修</span>
                        </span>
                        <span className="text-[10px] text-purple-600 font-mono">
                          动态差分解耦
                        </span>
                      </div>
                      <p className="text-[10px] text-purple-700 leading-tight">
                        以当前场景为基准底模，支持修改任意空间布局、天气光影、建筑构件或时空氛围：
                      </p>
                      <textarea
                        value={refineInputs[locId] || ''}
                        onChange={(e) =>
                          setRefineInputs((prev) => ({ ...prev, [locId]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleImageRefine('location', locId, loc.imageUrl);
                          }
                        }}
                        rows={2}
                        placeholder="输入任意修改指令（如：变成暴雨倾盆的黑夜、换成黄昏暖色夕阳、增加霓虹招牌等）..."
                        className="w-full text-xs text-slate-800 bg-white border border-purple-200 rounded-xl p-2 focus:outline-none focus:ring-2 focus:ring-purple-400 placeholder:text-slate-400 resize-none shadow-2xs font-sans"
                      />
                      <div className="flex items-center justify-between pt-0.5">
                        <span className="text-[10px] text-purple-600">Enter 回车即刻出图</span>
                        <div className="flex items-center space-x-1.5">
                          <button
                            onClick={() => setActiveRefineEntityId(null)}
                            className="px-2 py-1 rounded-lg text-[11px] text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 transition cursor-pointer"
                          >
                            取消
                          </button>
                          <button
                            onClick={() => handleImageRefine('location', locId, loc.imageUrl)}
                            disabled={isSubmittingRefine.has(locId) || isGen || isBusy}
                            className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-xs flex items-center space-x-1 transition active:scale-95 disabled:opacity-50 cursor-pointer"
                          >
                            <span>🎨</span>
                            <span>
                              {isSubmittingRefine.has(locId) ? 'AI 构思融合中...' : '定向修改并出图'}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ──────────────── Tab 3: 核心道具展台 ──────────────── */}
        {activeTab === 'items' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((item: any) => {
              const itemId = item.itemId || item.id;
              const imageUrl = item.imageUrl || item.referenceImageUrl;
              const isGenerating = isEntityTaskRunning(tasks, 'film.prop_lookdev', { itemId, id: itemId });
              const isEditing = editingPromptId === itemId;
              const currentPrompt = promptDrafts[itemId] !== undefined ? promptDrafts[itemId] : item.promptZh || item.appearanceSummary || '';
              return (
                <div
                  key={itemId}
                  onClick={() => setSelectedEntityId(itemId)}
                  className="bg-white/95 border border-slate-200/90 rounded-3xl p-4 shadow-xs flex flex-col cursor-pointer"
                >
                  <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-slate-100 border border-slate-200/60 mb-3.5 flex items-center justify-center">
                    {imageUrl ? (
                      <img src={`${imageUrl}?t=${Date.now()}`} alt={item.name} className="w-full h-full object-contain" />
                    ) : (
                      <div className="text-center text-slate-400"><span className="text-4xl block mb-2">🧰</span><span className="text-xs font-semibold">待生成道具特写</span></div>
                    )}
                    {isGenerating && <div className="absolute inset-0 bg-slate-900/65 flex flex-col items-center justify-center text-white"><span className="text-2xl animate-spin mb-2">⏳</span><span className="text-xs font-bold">道具渲染中...</span></div>}
                  </div>
                  <h3 className="text-sm font-bold text-slate-900">{item.name}</h3>
                  <p className="text-[11px] text-slate-500 mt-1 line-clamp-3">{item.description || item.appearanceSummary || '核心剧情道具'}</p>
                  {isEditing ? (
                    <textarea
                      value={currentPrompt}
                      onChange={(e) => setPromptDrafts((prev) => ({ ...prev, [itemId]: e.target.value }))}
                      rows={3}
                      className="mt-3 w-full text-xs text-slate-800 bg-white border border-indigo-200 rounded-xl p-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-y"
                    />
                  ) : (
                    <p className="mt-2 text-[10px] text-slate-400 line-clamp-2">{currentPrompt}</p>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <button type="button" onClick={() => handleTriggerUpload('item', itemId)} disabled={uploadingEntityId === itemId} className="flex-1 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-[11px] font-semibold text-slate-600 cursor-pointer disabled:opacity-50">
                      {uploadingEntityId === itemId ? '上传中...' : '📷 换底图'}
                    </button>
                    <button type="button" onClick={() => isEditing ? handleSavePrompt('item', itemId) : setEditingPromptId(itemId)} className="flex-1 py-1.5 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-[11px] font-semibold text-indigo-700 cursor-pointer">
                      {isEditing ? '保存提示词' : '✎ 修改提示词'}
                    </button>
                  </div>
                  {imageUrl && (
                    <button
                      type="button"
                      onClick={() => setActiveRefineEntityId(activeRefineEntityId === itemId ? null : itemId)}
                      className={`mt-2 w-full py-1.5 rounded-xl border text-[11px] font-bold cursor-pointer ${activeRefineEntityId === itemId ? 'bg-purple-600 text-white border-purple-600' : 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'}`}
                    >
                      🎨 {activeRefineEntityId === itemId ? '收起智能修改' : '基于此图智能修改'}
                    </button>
                  )}
                  {activeRefineEntityId === itemId && imageUrl && (
                    <div className="mt-2 p-3 rounded-2xl bg-purple-50 border border-purple-200 space-y-2">
                      <textarea
                        value={refineInputs[itemId] || ''}
                        onChange={(e) => setRefineInputs((prev) => ({ ...prev, [itemId]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleImageRefine('item', itemId, imageUrl); } }}
                        rows={2}
                        placeholder="输入局部修改，例如：改成银色外壳、去掉裂纹、增加蓝色指示灯"
                        className="w-full text-xs text-slate-800 bg-white border border-purple-200 rounded-xl p-2 resize-none focus:outline-none focus:ring-2 focus:ring-purple-400"
                      />
                      <button
                        type="button"
                        onClick={() => handleImageRefine('item', itemId, imageUrl)}
                        disabled={isSubmittingRefine.has(itemId) || isGenerating || isBusy}
                        className="w-full py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
                      >
                        {isSubmittingRefine.has(itemId) ? 'AI 构思融合中...' : '定向修改并出图'}
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => onRunTool('film.prop_lookdev', { projectId, itemId, force: true, referenceImageUrls: item.referenceImageUrl ? [item.referenceImageUrl] : undefined }).then(() => onRefreshProject?.())}
                    disabled={isBusy || isGenerating}
                    className="mt-3 w-full py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-xs font-bold disabled:opacity-50 cursor-pointer"
                  >
                    {isGenerating ? '渲染中...' : imageUrl ? '重新生成道具特写' : '生成道具特写'}
                  </button>
                </div>
              );
            })}
            {items.length === 0 && <div className="col-span-full py-16 text-center text-sm text-slate-400">当前没有提取到核心道具</div>}
          </div>
        )}
      </main>

      {/* ──────────────── 3. 历史定妆版本选择与切换弹窗 ──────────────── */}
      {versionModalEntity && (() => {
        const isLocationModal = versionModalEntity.type === 'location';
        return (
          <div
            onClick={() => setVersionModalEntity(null)}
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-6 animate-in fade-in duration-200 select-none"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-200"
            >
              <div className="p-4 px-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div className="flex items-center space-x-2">
                  <span className="text-xl">{isLocationModal ? '🏞️' : '🎨'}</span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      {isLocationModal ? '选择场景空间版本' : '选择定妆方案版本'} · {versionModalEntity.name}
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      共{isLocationModal ? '渲染' : '生成'}了 {versionModalEntity.versions.length} 个版本，点击任意卡片即可直接设定为主{isLocationModal ? '场景' : '方案'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setVersionModalEntity(null)}
                  className="w-8 h-8 rounded-full hover:bg-slate-200 text-slate-500 flex items-center justify-center transition cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className={`p-6 overflow-y-auto grid ${isLocationModal ? 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'} gap-4 bg-slate-50/50`}>
                {versionModalEntity.versions.map((ver, idx) => {
                  const isSelected =
                    ver.versionId ===
                    (versionModalEntity.selectedVersionId ||
                      versionModalEntity.versions[versionModalEntity.versions.length - 1]?.versionId);
                  return (
                    <div
                      key={ver.versionId || idx}
                      onClick={() => {
                        handleSelectVersion(
                          versionModalEntity.type,
                          versionModalEntity.id,
                          ver.versionId
                        );
                        setVersionModalEntity((prev) =>
                          prev ? { ...prev, selectedVersionId: ver.versionId } : null
                        );
                      }}
                      className={`group relative rounded-2xl overflow-hidden border-2 cursor-pointer transition-all bg-white flex flex-col ${
                        isSelected
                          ? 'border-indigo-600 ring-4 ring-indigo-500/20 shadow-md'
                          : 'border-slate-200 hover:border-indigo-300 shadow-2xs hover:shadow-sm'
                      }`}
                    >
                      <div className={`relative ${isLocationModal ? 'aspect-video' : 'aspect-[2/1]'} bg-slate-100 flex items-center justify-center ${isLocationModal ? '' : 'p-1'}`}>
                        <img
                          src={`${ver.imageUrl}?t=${ver.versionId}`}
                          alt={`Version ${idx + 1}`}
                          className={`w-full h-full ${isLocationModal ? 'object-cover' : 'object-contain object-center'}`}
                        />
                        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-xs text-white text-[10px] font-mono font-semibold">
                          v{idx + 1}
                        </div>
                        {isSelected && (
                          <div className="absolute inset-0 bg-indigo-600/15 flex items-center justify-center">
                            <span className="px-2.5 py-1 rounded-xl bg-indigo-600 text-white text-xs font-bold shadow-xs">
                              当前选用
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="p-2.5 bg-white border-t border-slate-100 flex items-center justify-between">
                        <span className="text-[10px] text-slate-400 font-mono">
                          {new Date(ver.createdAt).toLocaleDateString()}
                        </span>
                        {isSelected ? (
                          <span className="text-[10px] text-indigo-600 font-bold">✓ 选用中</span>
                        ) : (
                          <span className="text-[10px] text-slate-500 group-hover:text-indigo-600 font-medium">
                            设为当前
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ──────────────── 4. 右侧独立查看抽屉 (Inspector SSOT，专注大图、历史版本与提示词，无多余修改面板) ──────────────── */}
      {activeSelectedEntity && (
        <aside className="fixed top-0 right-0 w-[420px] h-full bg-white/95 backdrop-blur-xl border-l border-slate-200/90 shadow-2xl z-40 flex flex-col animate-in slide-in-from-right duration-200 select-none">
          {/* 顶部标题栏 */}
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 shrink-0">
            <div className="flex items-center space-x-2.5 truncate">
              <span className="text-xl shrink-0">{selectedCharacter ? '🎭' : isItemEntity ? '🧰' : '🏞️'}</span>
              <div className="truncate">
                <div className="flex items-center space-x-2">
                  <h3 className="text-sm font-bold text-slate-900 truncate">
                    {activeSelectedEntity.name}
                  </h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 shrink-0">
                    {selectedCharacter ? (activeSelectedEntity.role || '主要角色') : isItemEntity ? '核心道具' : '空间场景'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 truncate mt-0.5">
                  {activeSelectedEntity.identity || activeSelectedEntity.appearanceSummary || '概念设定详情'}
                </p>
              </div>
            </div>
            <button
              onClick={() => setSelectedEntityId(null)}
              className="w-8 h-8 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-700 flex items-center justify-center transition cursor-pointer font-bold text-sm shrink-0 ml-2"
              title="关闭侧边栏"
            >
              ✕
            </button>
          </div>

          {/* 滚动内容区 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* 1. 立绘/场景大图 (角色 2:1 三视图 / 场景 16:9 横版) */}
            <div className={`relative w-full ${isLocationEntity ? 'aspect-video' : isItemEntity ? 'aspect-square' : 'aspect-[2/1]'} bg-slate-100 rounded-2xl overflow-hidden border border-slate-200/80 flex items-center justify-center ${isLocationEntity ? '' : 'p-1'} group`}>
              {activeSelectedEntity.imageUrl ? (
                <img
                  key={`${activeSelectedEntity.imageUrl}_${activeSelectedEntity.selectedVersionId}`}
                  src={`${activeSelectedEntity.imageUrl}?t=${activeSelectedEntity.selectedVersionId || Date.now()}`}
                  alt={activeSelectedEntity.name}
                  className={`w-full h-full ${isLocationEntity ? 'object-cover' : 'object-contain object-center'}`}
                />
              ) : activeRefImg ? (
                <div className="relative w-full h-full flex items-center justify-center">
                  <img
                    src={activeRefImg}
                    alt={`参考底图 · ${activeSelectedEntity.name}`}
                    className={`w-full h-full ${isLocationEntity ? 'object-cover' : 'object-contain object-center'}`}
                  />
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-black/65 backdrop-blur-xs text-white text-[10px] font-semibold border border-white/20">
                    📷 当前参考底图 ({isLocationEntity ? '待渲染场景' : isItemEntity ? '待生成道具特写' : '待生成定妆'})
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-400">
                  <span className="text-3xl mb-1">{selectedCharacter ? '🎭' : isItemEntity ? '🧰' : '🏞️'}</span>
                  <span className="text-xs">{selectedCharacter ? '待生成立绘' : isItemEntity ? '待生成道具特写' : '待生成场景'}</span>
                </div>
              )}

              {/* 大图左下角画中画：当前参考底图微缩对比浮层 (带点击放大与小 ✕ 删除底图按钮) */}
              {activeSelectedEntity.imageUrl && activeRefImg && (
                <div
                  onClick={() =>
                    onEnlargeMedia?.({
                      title: `参考底图 · ${activeSelectedEntity.name}`,
                      imageUrl: activeRefImg,
                    })
                  }
                  className="absolute bottom-2.5 left-2.5 p-1 rounded-xl bg-black/75 hover:bg-black/90 backdrop-blur-md border border-white/20 shadow-lg cursor-pointer group/ref flex items-center space-x-2 transition-all hover:scale-105 z-10"
                  title="点击全屏查看当前参考底图"
                >
                  <img
                    src={activeRefImg}
                    alt="参考底图"
                    className={`${isLocationEntity ? 'w-14 h-9 object-cover' : isItemEntity ? 'w-12 h-12 object-contain' : 'w-10 h-14 object-cover object-top'} rounded-lg border border-white/30 shrink-0`}
                  />
                  <div className="pr-1 text-left">
                    <span className="text-[10px] text-indigo-300 font-bold block">
                      📷 参考底图
                    </span>
                    <span className="text-[9px] text-slate-300 block font-mono">点击放大</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      handleRemoveReferenceImage(
                        selectedCharacter ? 'character' : isItemEntity ? 'item' : 'location',
                        activeSelectedEntity.characterId || activeSelectedEntity.locationId || activeSelectedEntity.itemId || activeSelectedEntity.id
                      );
                    }}
                    className="w-5 h-5 rounded-full bg-black/50 hover:bg-rose-600 text-white flex items-center justify-center transition cursor-pointer text-xs ml-0.5 shadow-2xs"
                    title="删除此底图"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* 放大按钮 */}
              {(activeSelectedEntity.imageUrl || activeRefImg) && (
                <button
                  onClick={() =>
                    onEnlargeMedia?.({
                      title: activeSelectedEntity.imageUrl ? activeSelectedEntity.name : `参考底图 · ${activeSelectedEntity.name}`,
                      imageUrl: activeSelectedEntity.imageUrl || activeRefImg,
                    })
                  }
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 backdrop-blur-xs text-white opacity-0 group-hover:opacity-100 transition text-xs cursor-pointer z-10"
                  title="放大查看原图"
                >
                  ⛶ 放大
                </button>
              )}
            </div>

            {/* 2. 操作快捷栏：单人重新定妆 + 换底图 */}
            <div className="flex items-center space-x-2">
              <button
                onClick={() =>
                  handleTriggerUpload(
                    selectedCharacter ? 'character' : isItemEntity ? 'item' : 'location',
                    activeSelectedEntity.characterId || activeSelectedEntity.locationId || activeSelectedEntity.itemId || activeSelectedEntity.id
                  )
                }
                disabled={uploadingEntityId === (activeSelectedEntity.characterId || activeSelectedEntity.locationId || activeSelectedEntity.itemId || activeSelectedEntity.id)}
                className="flex-1 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-xs font-semibold text-slate-700 flex items-center justify-center space-x-1 transition shadow-2xs cursor-pointer"
              >
                <span>📷</span>
                <span>
                  {uploadingEntityId === (activeSelectedEntity.characterId || activeSelectedEntity.locationId || activeSelectedEntity.itemId || activeSelectedEntity.id)
                    ? '上传中...'
                    : activeRefImg
                    ? '更换参考图'
                    : '上传参考底图'}
                </span>
              </button>

              <button
                onClick={() => {
                  if (selectedCharacter) {
                    handleGenerateCharacter(selectedCharacter);
                  } else if (selectedLocation) {
                    handleGenerateLocation(selectedLocation);
                  } else if (selectedItem) {
                    const itemId = selectedItem.itemId || selectedItem.id;
                    onRunTool('film.prop_lookdev', { projectId, itemId, force: true, referenceImageUrls: selectedItem.referenceImageUrl ? [selectedItem.referenceImageUrl] : undefined })
                      .then(() => onRefreshProject?.());
                  }
                }}
                disabled={
                  (selectedCharacter && isCharacterGenerating(selectedCharacter)) ||
                  (selectedLocation && isLocationGenerating(selectedLocation)) ||
                  (selectedItem && isEntityTaskRunning(tasks, 'film.prop_lookdev', { itemId: selectedItem.itemId || selectedItem.id, id: selectedItem.itemId || selectedItem.id })) ||
                  isBusy
                }
                className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center space-x-1 transition shadow-xs disabled:opacity-50 cursor-pointer"
              >
                <span>✨</span>
                <span>
                  {(selectedCharacter && isCharacterGenerating(selectedCharacter)) ||
                  (selectedLocation && isLocationGenerating(selectedLocation)) ||
                  (selectedItem && isEntityTaskRunning(tasks, 'film.prop_lookdev', { itemId: selectedItem.itemId || selectedItem.id, id: selectedItem.itemId || selectedItem.id }))
                    ? '生成中...'
                    : activeSelectedEntity.imageUrl
                    ? isItemEntity ? '重新生成道具特写' : '重新定妆'
                    : isItemEntity ? '生成道具特写' : '立即定妆'}
                </span>
              </button>
            </div>

            {/* 3. 历史定妆/渲染版本库 (角色 3:4 / 场景 16:9 动态自适应) */}
            {!isItemEntity && activeSelectedEntity.versions && activeSelectedEntity.versions.length > 0 && (
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 flex items-center space-x-1">
                    <span>📚</span>
                    <span>
                      {isLocationEntity ? '已渲染版本库' : '已定妆版本库'} ({activeSelectedEntity.versions.length} 版)
                    </span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">点击直接切换选用</span>
                </div>
                <div className={`grid ${isLocationEntity ? 'grid-cols-2 gap-2.5' : 'grid-cols-3 gap-2'} max-h-56 overflow-y-auto p-1`}>
                  {activeSelectedEntity.versions.map((ver: any, idx: number) => {
                    const isSelectedVer =
                      ver.versionId ===
                      (activeSelectedEntity.selectedVersionId ||
                        activeSelectedEntity.versions[activeSelectedEntity.versions.length - 1]?.versionId);
                    return (
                      <div
                        key={ver.versionId || idx}
                        onClick={() =>
                          handleSelectVersion(
                            selectedCharacter ? 'character' : 'location',
                            activeSelectedEntity.characterId || activeSelectedEntity.locationId || activeSelectedEntity.id,
                            ver.versionId
                          )
                        }
                        className={`group relative rounded-xl overflow-hidden border-2 cursor-pointer transition-all ${
                          isLocationEntity ? 'aspect-video' : 'aspect-[2/1]'
                        } bg-white ${
                          isSelectedVer
                            ? 'border-indigo-600 ring-2 ring-indigo-500/20 shadow-xs'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <img
                          src={`${ver.imageUrl}?t=${ver.versionId}`}
                          alt="ver"
                          className={`w-full h-full ${isLocationEntity ? 'object-cover' : 'object-contain object-center'}`}
                        />
                        <div className="absolute top-1 left-1 px-1 py-0.2 rounded bg-black/60 text-[9px] font-mono text-white">
                          v{idx + 1}
                        </div>
                        {isSelectedVer && (
                          <div className="absolute inset-0 bg-indigo-600/15 flex items-center justify-center">
                            <span className="px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[9px] font-bold shadow-2xs">
                              选用中
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 4. 生图提示词编辑大文本框 */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 flex items-center space-x-1">
                  <span>✏️</span>
                  <span>生图提示词 (Prompt)</span>
                </span>
                <button
                  onClick={() =>
                      handleSavePrompt(
                      selectedCharacter ? 'character' : isItemEntity ? 'item' : 'location',
                      activeSelectedEntity.characterId || activeSelectedEntity.locationId || activeSelectedEntity.itemId || activeSelectedEntity.id
                    )
                  }
                  className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold shadow-2xs transition cursor-pointer"
                >
                  💾 保存修改
                </button>
              </div>
              <textarea
                value={
                  promptDrafts[activeSelectedEntity.characterId || activeSelectedEntity.locationId || activeSelectedEntity.itemId || activeSelectedEntity.id] ??
                  (activeSelectedEntity.promptZh || activeSelectedEntity.appearanceSummary || '')
                }
                onChange={(e) =>
                  setPromptDrafts((prev) => ({
                    ...prev,
                    [activeSelectedEntity.characterId || activeSelectedEntity.locationId || activeSelectedEntity.itemId || activeSelectedEntity.id]: e.target.value,
                  }))
                }
                rows={1}
                className="w-full min-h-12 max-h-64 overflow-y-auto [field-sizing:content] text-xs text-slate-800 bg-white border border-slate-200 rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 leading-relaxed resize-y font-sans"
              />
            </div>
          </div>
        </aside>
      )}

      {/* 视觉定妆空间专属 AI 协作者 (LookdevCopilot) */}
      <DirectorFloatingBubble
        mode="lookdev"
        projectId={projectId}
        projectData={projectData}
        tasks={tasks}
        onRunTool={onRunTool}
        onRefreshProject={onRefreshProject}
        isBusy={isBusy}
      />
    </div>
  );
};
