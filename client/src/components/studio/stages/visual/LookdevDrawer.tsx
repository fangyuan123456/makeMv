/**
 * client/src/components/studio/stages/visual/LookdevDrawer.tsx
 * 视觉定妆右侧滑出抽屉工作台 (Lookdev Sidebar Drawer SSOT)
 *
 * 核心机制：
 * 1. 右侧平滑滑出，常驻主拓扑画布，无需页面级跳转；
 * 2. 首次进入若无角色设定，自动呈现流光推演并调用 film.asset_extraction；
 * 3. 完整承载角色与场景画廊、提示词全展开修改、随时保存、参考图上传、多版本管理；
 * 4. 包含单人重新定妆与全剧批量定妆。
 */

import React, { useState, useRef, useEffect } from 'react';
import type { ProjectData, LookdevVersion, TaskRecord } from '../../../../types/index.js';
import {
  uploadReferenceImage,
  updateEntity,
  selectEntityVersion,
} from '../../../../lib/api.js';
import { isEntityTaskRunning } from '../../../../lib/taskUtils.js';

export interface LookdevDrawerProps {
  projectId: string;
  projectData: ProjectData | null;
  tasks?: TaskRecord[];
  onRunTool: (toolName: string, input: Record<string, any>) => Promise<any>;
  onRefreshProject?: () => void;
  onClose: () => void;
  onOpenFullscreen?: () => void;
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

export const LookdevDrawer: React.FC<LookdevDrawerProps> = ({
  projectId,
  projectData,
  tasks = [],
  onRunTool,
  onRefreshProject,
  onClose,
  onOpenFullscreen,
  isBusy,
}) => {
  const [activeTab, setActiveTab] = useState<'characters' | 'locations'>('characters');
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [uploadingEntityId, setUploadingEntityId] = useState<string | null>(null);
  const [versionDrawerEntity, setVersionDrawerEntity] = useState<ActiveEntityModal | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadTargetRef = useRef<{ type: 'character' | 'location'; id: string } | null>(null);

  const entities = projectData?.entities || projectData?.artifacts?.lookdev_entities;
  const characters = entities?.characters || [];
  const locations = entities?.locations || [];

  // 判断是否正在提取资产
  const isExtracting = tasks.some(
    (t) =>
      (t.status === 'running' || t.status === 'pending') &&
      t.toolName === 'film.asset_extraction'
  );

  // 首次打开自动触发提取
  useEffect(() => {
    if (characters.length === 0 && !isExtracting) {
      console.log('[LookdevDrawer] 首次打开定妆抽屉，自动提取全剧角色与场景外观...');
      onRunTool('film.asset_extraction', {}).then(() => {
        onRefreshProject?.();
      }).catch((err) => {
        console.warn('[LookdevDrawer] 自动提取视觉资产失败:', err);
      });
    }
  }, [characters.length, isExtracting]);

  // 判断指定角色是否正在定妆中 (SSOT: 严格基于全局 tasks 判定)
  const isCharacterGenerating = (characterId: string): boolean => {
    if (!characterId) return false;
    return isEntityTaskRunning(tasks, 'film.character_portrait', {
      characterId,
      id: characterId,
    });
  };

  // 判断指定场景是否正在渲染中 (SSOT: 严格基于全局 tasks 判定)
  const isLocationGenerating = (locationId: string): boolean => {
    if (!locationId) return false;
    return isEntityTaskRunning(tasks, 'film.scene_atmosphere', {
      locationId,
      id: locationId,
    });
  };

  const isBatchPortraiting = tasks.some(
    (t) =>
      (t.status === 'running' || t.status === 'pending') &&
      t.toolName === 'film.character_portrait' &&
      !t.input?.characterId
  );

  const isBatchScening = tasks.some(
    (t) =>
      (t.status === 'running' || t.status === 'pending') &&
      t.toolName === 'film.scene_atmosphere' &&
      !t.input?.locationId
  );

  // 初始化草稿提示词
  useEffect(() => {
    const drafts: Record<string, string> = {};
    characters.forEach((c: any) => {
      drafts[c.characterId] = c.promptZh || c.appearanceSummary || '';
    });
    locations.forEach((l: any) => {
      drafts[l.locationId] = l.promptZh || l.appearanceSummary || '';
    });
    setPromptDrafts((prev) => ({ ...drafts, ...prev }));
  }, [characters, locations]);

  // 手动批量提取
  const handleExtractEntities = async () => {
    await onRunTool('film.asset_extraction', {});
    onRefreshProject?.();
  };

  // 批量定妆 (增量保护：已定妆的角色不动，仅为未完成项补齐)
  const handleBatchPortrait = async () => {
    await onRunTool('film.character_portrait', { force: false });
    onRefreshProject?.();
  };

  // 单人重新定妆 (精准单体隔离)
  const handleSinglePortrait = async (characterId: string) => {
    try {
      const customPrompt = promptDrafts[characterId];
      await onRunTool('film.character_portrait', {
        characterId,
        customPrompt,
        force: true,
      });
      onRefreshProject?.();
    } catch (err: any) {
      alert(`定妆生成失败: ${err.message || String(err)}`);
    }
  };

  // 批量渲染场景 (增量保护)
  const handleBatchLocations = async () => {
    await onRunTool('film.scene_atmosphere', { force: false });
    onRefreshProject?.();
  };

  // 单个渲染场景 (精准单体隔离)
  const handleSingleLocation = async (locationId: string) => {
    try {
      const customPrompt = promptDrafts[locationId];
      await onRunTool('film.scene_atmosphere', {
        locationId,
        customPrompt,
        force: true,
      });
      onRefreshProject?.();
    } catch (err: any) {
      alert(`场景生成失败: ${err.message || String(err)}`);
    }
  };

  // 保存提示词修改
  const handleSavePrompt = async (type: 'character' | 'location', id: string) => {
    const newPrompt = promptDrafts[id];
    if (newPrompt === undefined) return;
    try {
      await updateEntity(projectId, type, id, {
        promptZh: newPrompt,
      });
      setEditingPromptId(null);
      onRefreshProject?.();
    } catch (err: any) {
      alert(`保存提示词失败: ${err.message}`);
    }
  };

  // 上传参考图
  const triggerUploadReference = (type: 'character' | 'location', id: string) => {
    pendingUploadTargetRef.current = { type, id };
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const target = pendingUploadTargetRef.current;
    if (!file || !target) return;

    setUploadingEntityId(target.id);
    try {
      const res = await uploadReferenceImage(projectId, target.type, target.id, file);
      if (res) {
        onRefreshProject?.();
      }
    } catch (err: any) {
      alert(`上传参考图失败: ${err.message}`);
    } finally {
      setUploadingEntityId(null);
      pendingUploadTargetRef.current = null;
    }
  };

  const handleRemoveReference = async (type: 'character' | 'location', id: string) => {
    try {
      await updateEntity(projectId, type, id, {
        referenceImageUrl: '',
      });
      onRefreshProject?.();
    } catch (err: any) {
      alert(`移除参考图失败: ${err.message}`);
    }
  };

  const handleSelectVersion = async (versionId: string) => {
    if (!versionDrawerEntity) return;
    try {
      await selectEntityVersion(
        projectId,
        versionDrawerEntity.type,
        versionDrawerEntity.id,
        versionId
      );
      setVersionDrawerEntity(null);
      onRefreshProject?.();
    } catch (err: any) {
      alert(`切换版本失败: ${err.message}`);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[640px] max-w-[95vw] bg-white shadow-2xl z-40 border-l border-slate-200 flex flex-col animate-in slide-in-from-right duration-250 select-none">
      {/* 隐藏文件上传 input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/png,image/jpeg,image/webp,image/jpg"
        className="hidden"
      />

      {/* 顶部标题栏与关闭按钮 */}
      <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80 flex-shrink-0">
        <div className="flex items-center space-x-2.5">
          <span className="text-xl">🎨</span>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-bold text-slate-900 tracking-tight">全剧视觉定妆母体</h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-2xs font-mono">
                🎭 {characters.filter((c: any) => Boolean(c.imageUrl)).length}/{characters.length} · 🏞️ {locations.filter((l: any) => Boolean(l.imageUrl)).length}/{locations.length}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              角色立绘与空间场景概念设定 · 随时修改提示词或上传参考图
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {onOpenFullscreen && (
            <button
              onClick={onOpenFullscreen}
              className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold flex items-center space-x-1 shadow-2xs transition cursor-pointer"
              title="进入全屏开阔展台制作工坊 (双击节点亦可进入)"
            >
              <span>⛶</span>
              <span>全屏工坊</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition cursor-pointer text-base font-bold"
            title="关闭抽屉"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 顶部操作工具条 */}
      <div className="p-3 bg-white border-b border-slate-100 flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setActiveTab('characters')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              activeTab === 'characters'
                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            全剧角色 ({characters.length})
          </button>
          <button
            onClick={() => setActiveTab('locations')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              activeTab === 'locations'
                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            空间场景 ({locations.length})
          </button>
        </div>

        <div className="flex items-center space-x-1.5">
          <button
            onClick={handleExtractEntities}
            disabled={isBusy || isExtracting}
            className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-medium rounded-lg border border-slate-200 shadow-2xs transition disabled:opacity-50 cursor-pointer"
          >
            {isExtracting ? '⏳ 提取中...' : '🔍 重新提取'}
          </button>
          {activeTab === 'characters' ? (
            <button
              onClick={handleBatchPortrait}
              disabled={isBusy || characters.length === 0 || isBatchPortraiting}
              className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg shadow-2xs transition disabled:opacity-50 cursor-pointer"
            >
              {isBatchPortraiting ? '⏳ 定妆中...' : '✨ 批量定妆'}
            </button>
          ) : (
            <button
              onClick={handleBatchLocations}
              disabled={isBusy || locations.length === 0 || isBatchScening}
              className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg shadow-2xs transition disabled:opacity-50 cursor-pointer"
            >
              {isBatchScening ? '⏳ 渲染中...' : '🌆 批量场景'}
            </button>
          )}
        </div>
      </div>

      {/* 滚动内容区 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/60">
        {/* 首次提取中动效 */}
        {isExtracting && (
          <div className="py-16 flex flex-col items-center justify-center p-8 bg-white rounded-2xl border border-dashed border-indigo-200 shadow-xs text-center space-y-3">
            <div className="relative mb-2">
              <div className="w-14 h-14 rounded-full border-3 border-indigo-400/40 animate-ping absolute" />
              <div className="w-14 h-14 rounded-full border-3 border-indigo-200 border-t-indigo-600 animate-spin" />
              <span className="absolute inset-0 flex items-center justify-center text-xl">🔍</span>
            </div>
            <h4 className="text-sm font-bold text-slate-900">正在提炼全剧角色与场景设定...</h4>
            <p className="text-xs text-slate-500 max-w-sm leading-relaxed">
              AI 视觉总监正在解析剧本核心人物外貌特征与空间光影氛围
            </p>
          </div>
        )}

        {/* 角色画廊列表 */}
        {!isExtracting && activeTab === 'characters' && (
          <div className="space-y-4">
            {characters.length === 0 ? (
              <div className="py-16 text-center bg-white rounded-2xl border border-dashed border-slate-200 p-8 shadow-xs">
                <span className="text-3xl block mb-2 opacity-60">👥</span>
                <p className="text-xs text-slate-500 font-medium">尚未提取角色设定，点击上方「重新提取」即可生成</p>
              </div>
            ) : (
              characters.map((char: any) => {
                const hasImage = Boolean(char.imageUrl);
                const isEditing = editingPromptId === char.characterId;
                const isUploading = uploadingEntityId === char.characterId;
                const hasRef = Boolean(char.referenceImageUrl);
                const isGenerating = isCharacterGenerating(char.characterId);
                const versionCount = (char.versions || []).length;

                return (
                  <div
                    key={char.characterId}
                    className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs hover:border-indigo-200 transition"
                  >
                    <div className="p-3.5 flex gap-4">
                      {/* 立绘图片区 (3:4 标准画幅，object-contain 保持头部全身 100% 完整无裁剪) */}
                      <div className="w-28 h-36 bg-slate-100 rounded-xl overflow-hidden relative flex-shrink-0 border border-slate-200/60 flex items-center justify-center p-0.5">
                        {hasImage ? (
                          <img
                            key={`${char.imageUrl}_${char.selectedVersionId}`}
                            src={`${char.imageUrl}?t=${char.selectedVersionId || Date.now()}`}
                            alt={char.name}
                            className={`w-full h-full object-contain object-top ${isGenerating ? 'blur-xs' : ''}`}
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-slate-400">
                            <span className="text-2xl opacity-40">👤</span>
                            <span className="text-[10px] text-slate-400 mt-1">待定妆</span>
                          </div>
                        )}

                        {isGenerating && (
                          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs flex flex-col items-center justify-center p-2 text-center text-white">
                            <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin mb-1" />
                            <span className="text-[10px] font-bold">生成中...</span>
                          </div>
                        )}

                        {versionCount > 0 && !isGenerating && (
                          <button
                            onClick={() =>
                              setVersionDrawerEntity({
                                type: 'character',
                                id: char.characterId,
                                name: char.name,
                                identity: char.identity,
                                appearanceSummary: char.appearanceSummary,
                                currentImageUrl: char.imageUrl,
                                referenceImageUrl: char.referenceImageUrl,
                                promptZh: promptDrafts[char.characterId] ?? (char.promptZh || ''),
                                versions: char.versions || [],
                                selectedVersionId: char.selectedVersionId,
                              })
                            }
                            className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-900/80 text-white backdrop-blur-md shadow-2xs hover:bg-indigo-600 transition border border-white/20"
                            title="查看并切换历史定妆版本"
                          >
                            版本 ({versionCount})
                          </button>
                        )}
                      </div>

                      {/* 角色描述与操作区 (上下分层，第一行名字加 shrink-0 绝不被遮挡) */}
                      <div className="flex-1 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between mb-1 gap-2">
                            <span className="text-sm font-bold text-slate-900 shrink-0">{char.name}</span>
                            <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-150 truncate">
                              {char.identity || '核心角色'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed mt-0.5">
                            {char.appearanceSummary || char.personality || '暂无详细描述'}
                          </p>
                        </div>

                        {/* 参考图与单人定妆操作 */}
                        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                          <div className="flex items-center space-x-2">
                            {hasRef ? (
                              <div className="flex items-center space-x-1.5">
                                <img
                                  src={char.referenceImageUrl}
                                  alt="Ref"
                                  className="w-7 h-7 object-cover rounded border border-slate-200"
                                />
                                <button
                                  onClick={() => handleRemoveReference('character', char.characterId)}
                                  className="text-[10px] text-rose-500 hover:text-rose-700"
                                >
                                  移除参考图
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => triggerUploadReference('character', char.characterId)}
                                disabled={isUploading || isGenerating}
                                className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium"
                              >
                                {isUploading ? '上传中...' : '📎 绑定参考图'}
                              </button>
                            )}
                          </div>

                          <button
                            onClick={() => handleSinglePortrait(char.characterId)}
                            disabled={isBusy || isGenerating}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold rounded-lg transition disabled:opacity-50"
                          >
                            {isGenerating ? '生成中...' : hasImage ? '🔄 重新定妆' : '🎨 立即定妆'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* 展开的生图提示词编辑区 */}
                    <div className="p-3 bg-slate-50/70 border-t border-slate-100">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-bold text-slate-700 flex items-center space-x-1">
                          <span>✏️</span>
                          <span>生图提示词 (展开编辑)</span>
                        </span>
                        <div className="flex items-center space-x-1.5">
                          <button
                            onClick={() => handleSavePrompt('character', char.characterId)}
                            className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-semibold rounded shadow-2xs"
                          >
                            💾 保存提示词
                          </button>
                        </div>
                      </div>
                      <textarea
                        rows={2}
                        value={promptDrafts[char.characterId] ?? ''}
                        onChange={(e) =>
                          setPromptDrafts({
                            ...promptDrafts,
                            [char.characterId]: e.target.value,
                          })
                        }
                        placeholder="输入用于立绘生成的纯中文正向描述词..."
                        className="w-full text-[11px] p-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 leading-relaxed font-sans resize-y"
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* 场景空间列表 */}
        {!isExtracting && activeTab === 'locations' && (
          <div className="space-y-4">
            {locations.length === 0 ? (
              <div className="py-16 text-center bg-white rounded-2xl border border-dashed border-slate-200 p-8 shadow-xs">
                <span className="text-3xl block mb-2 opacity-60">🌆</span>
                <p className="text-xs text-slate-500 font-medium">尚未提取空间场景，点击上方「重新提取」即可生成</p>
              </div>
            ) : (
              locations.map((loc: any) => {
                const hasImage = Boolean(loc.imageUrl);
                const isGenerating = isLocationGenerating(loc.locationId);

                return (
                  <div
                    key={loc.locationId}
                    className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs hover:border-indigo-200 transition"
                  >
                    <div className="p-3.5 flex gap-4">
                      <div className="w-36 h-24 bg-slate-100 rounded-xl overflow-hidden relative flex-shrink-0 border border-slate-100 flex items-center justify-center">
                        {hasImage ? (
                          <img
                            src={loc.imageUrl}
                            alt={loc.name}
                            className={`w-full h-full object-cover ${isGenerating ? 'blur-xs' : ''}`}
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-slate-400">
                            <span className="text-2xl opacity-40">🌆</span>
                            <span className="text-[10px] text-slate-400 mt-1">待渲染</span>
                          </div>
                        )}
                        {isGenerating && (
                          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs flex flex-col items-center justify-center text-white">
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mb-1" />
                            <span className="text-[10px] font-bold">渲染中...</span>
                          </div>
                        )}
                      </div>

                      <div className="flex-1 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-bold text-slate-900">{loc.name}</span>
                            <span className="text-[10px] font-mono text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                              {loc.locationId}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">
                            {loc.appearanceSummary || loc.atmosphere || '暂无场景描述'}
                          </p>
                        </div>

                        <div className="flex justify-end pt-2 border-t border-slate-100">
                          <button
                            onClick={() => handleSingleLocation(loc.locationId)}
                            disabled={isBusy || isGenerating}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold rounded-lg transition disabled:opacity-50"
                          >
                            {isGenerating ? '渲染中...' : hasImage ? '🔄 重新渲染' : '🌆 渲染概念图'}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-slate-50/70 border-t border-slate-100">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-bold text-slate-700">✏️ 场景提示词</span>
                        <button
                          onClick={() => handleSavePrompt('location', loc.locationId)}
                          className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-semibold rounded shadow-2xs"
                        >
                          💾 保存提示词
                        </button>
                      </div>
                      <textarea
                        rows={2}
                        value={promptDrafts[loc.locationId] ?? ''}
                        onChange={(e) =>
                          setPromptDrafts({
                            ...promptDrafts,
                            [loc.locationId]: e.target.value,
                          })
                        }
                        className="w-full text-[11px] p-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 leading-relaxed font-sans resize-y"
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* 历史版本弹窗 */}
      {versionDrawerEntity && (() => {
        const isLoc = versionDrawerEntity.type === 'location';
        return (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-6 z-50 animate-in fade-in">
            <div className="bg-white rounded-2xl max-w-lg w-full max-h-[80vh] flex flex-col shadow-2xl border border-slate-200">
              <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-900">
                  【{versionDrawerEntity.name}】{isLoc ? '历史空间渲染库' : '历史定妆版本库'}
                </h4>
                <button
                  onClick={() => setVersionDrawerEntity(null)}
                  className="text-slate-400 hover:text-slate-600 text-sm font-bold"
                >
                  ✕
                </button>
              </div>
              <div className="p-4 flex-1 overflow-y-auto grid grid-cols-2 gap-3">
                {versionDrawerEntity.versions.map((ver) => (
                  <div
                    key={ver.versionId}
                    onClick={() => handleSelectVersion(ver.versionId)}
                    className={`border rounded-xl p-2 cursor-pointer transition ${
                      ver.versionId === versionDrawerEntity.selectedVersionId
                        ? 'border-indigo-600 ring-2 ring-indigo-500/20 bg-indigo-50/30'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <img
                      src={`${ver.imageUrl}?t=${ver.versionId}`}
                      alt="ver"
                      className={`w-full ${isLoc ? 'aspect-video object-cover' : 'aspect-[2/1] object-contain'} rounded-lg mb-1.5 bg-slate-50 border border-slate-100`}
                    />
                    <div className="text-[10px] text-slate-500">
                      {new Date(ver.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
