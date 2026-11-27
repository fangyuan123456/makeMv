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

import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { ProjectData, LookdevVersion, TaskRecord } from '../../../../types/index.js';
import {
  uploadReferenceImage,
  updateEntity,
  selectEntityVersion,
  imageRefineEntity,
  retryTask,
} from '../../../../lib/api.js';
import { isEntityTaskRunning, getEntityTaskStatus } from '../../../../lib/taskUtils.js';
import { DirectorFloatingBubble } from '../../chat/DirectorFloatingBubble.js';
import { useReportFocus } from '../../../../hooks/StudioFocusContext.js';
import type { MediaLightboxItem } from './MediaLightboxModal.js';
import { SubCanvasSwitcher, type SubCanvasOption } from '../../canvas/SubCanvasSwitcher.js';
import {
  CharacterCard,
  LocationCard,
  ItemCard,
  LookdevVersionModal,
  type VersionModalEntity,
} from './components/index.js';

export interface LookdevCanvasProps {
  projectId: string;
  projectData: ProjectData | null;
  tasks?: TaskRecord[];
  onRunTool: (toolName: string, input: Record<string, any>) => Promise<any>;
  onRefreshProject?: () => void;
  onBackToTopology: () => void;
  onEnlargeMedia?: (media: {
    title: string;
    imageUrl?: string;
    videoUrl?: string;
    badge?: string;
    subtitle?: string;
    gallery?: MediaLightboxItem[];
  }) => void;
  subCanvasOptions?: SubCanvasOption[];
  onSwitchSubCanvas?: (option: SubCanvasOption) => void;
  isBusy: boolean;
}

interface ActiveEntityModal {
  type: 'character' | 'location' | 'item';
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
  subCanvasOptions,
  onSwitchSubCanvas,
  isBusy,
}) => {
  const [activeTab, setActiveTab] = useState<'characters' | 'locations' | 'items'>('characters');
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [spatialDrafts, setSpatialDrafts] = useState<Record<string, string>>({});
  const [voiceDrafts, setVoiceDrafts] = useState<Record<string, string>>({});
  const [isSavingSpatial, setIsSavingSpatial] = useState(false);
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
  // 正在提交 SeedVR2 高清超分请求的实体集合 & 默认超分倍率 (2× / 4×)
  const [submittingUpscale, setSubmittingUpscale] = useState<Set<string>>(new Set());
  const [upscaleMultiplier, setUpscaleMultiplier] = useState<2 | 4>(2);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoExtractionProjectRef = useRef<string | null>(null);
  const autoSpecEntitiesRef = useRef<Set<string>>(new Set());
  const pendingUploadTargetRef = useRef<{ type: 'character' | 'location' | 'item'; id: string } | null>(null);

  const entities = projectData?.entities || projectData?.artifacts?.lookdev_entities;
  const characters = entities?.characters || [];
  const locations = entities?.locations || [];
  const items = entities?.items || [];
  const runLookdev = (input: {
    targetKind: 'character' | 'location' | 'item';
    targetId: string;
    force?: boolean;
    instruction?: string;
    referenceImageUrls?: string[];
  }) => onRunTool('film.lookdev', { projectId, ...input });

  // 判断是否正在提取资产清单 (整屏 Loading 判定 SSOT)
  const isExtracting = tasks.some(
    (t) =>
      (t.status === 'running' || t.status === 'pending') &&
      t.toolName === 'film.asset_manifest'
  );

  // 首次进入若无角色且未提取，自动触发清单提取
  useEffect(() => {
    if (characters.length === 0 && !isExtracting && autoExtractionProjectRef.current !== projectId) {
      autoExtractionProjectRef.current = projectId;
      console.log('[LookdevCanvas] 首次进入定妆画布，自动提取全剧角色与场景清单...');
      onRunTool('film.asset_manifest', {
        __idempotencyKey: `lookdev:auto-extraction:${projectId}`,
      })
        .then(() => onRefreshProject?.())
        .catch((err) => console.warn('[LookdevCanvas] 自动提取视觉资产失败:', err));
    }
  }, [projectId, characters.length, isExtracting]);

  // 判断指定实体是否正在推演特征规格 (film.entity_spec)
  const isEntitySpecExtracting = (kind: 'character' | 'location' | 'item', entity: any): boolean => {
    if (!entity) return false;
    const id = entity.characterId || entity.locationId || entity.itemId || entity.id;
    if (!id) return false;
    return isEntityTaskRunning(tasks, 'film.entity_spec', {
      targetId: id,
      characterId: id,
      locationId: id,
      itemId: id,
      id,
      name: entity.name,
    });
  };

  // 清单提取完成后，自动为尚未具备完整提示词与视觉规格的实体并发下发特征推演任务
  useEffect(() => {
    if (isExtracting || !projectId) return;

    const allEntitiesToSpec: Array<{ kind: 'character' | 'location' | 'item'; id: string; name: string }> = [];

    characters.forEach((char: any) => {
      const id = char.characterId || char.id;
      if (id && (!char.promptZh || !char.promptZh.trim()) && !isEntitySpecExtracting('character', char) && !autoSpecEntitiesRef.current.has(id)) {
        allEntitiesToSpec.push({ kind: 'character', id, name: char.name });
      }
    });

    locations.forEach((loc: any) => {
      const id = loc.locationId || loc.id;
      if (id && (!loc.promptZh || !loc.promptZh.trim()) && !isEntitySpecExtracting('location', loc) && !autoSpecEntitiesRef.current.has(id)) {
        allEntitiesToSpec.push({ kind: 'location', id, name: loc.name });
      }
    });

    items.forEach((item: any) => {
      const id = item.itemId || item.id;
      if (id && (!item.promptZh || !item.promptZh.trim()) && !isEntitySpecExtracting('item', item) && !autoSpecEntitiesRef.current.has(id)) {
        allEntitiesToSpec.push({ kind: 'item', id, name: item.name });
      }
    });

    if (allEntitiesToSpec.length === 0) return;

    allEntitiesToSpec.forEach((item) => {
      autoSpecEntitiesRef.current.add(item.id);
      console.log(`[LookdevCanvas] 自动触发实体 [${item.name}] (${item.kind}) 特征规格推演...`);
      onRunTool('film.entity_spec', {
        projectId,
        targetKind: item.kind,
        targetId: item.id,
        name: item.name,
        __idempotencyKey: `lookdev:auto-spec:${projectId}:${item.kind}:${item.id}`,
      })
        .then(() => onRefreshProject?.())
        .catch((err) => console.warn(`[LookdevCanvas] 自动提取实体 [${item.name}] 特征规格失败:`, err));
    });
  }, [projectId, isExtracting, characters, locations, items]);

  // 判断指定实体是否正在执行 SeedVR2 高清超分
  const isEntityUpscaling = (kind: 'character' | 'location' | 'item', entityId?: string): boolean => {
    if (!entityId) return false;
    if (submittingUpscale.has(entityId)) return true;
    return tasks.some(
      (t) =>
        (t.status === 'running' || t.status === 'pending') &&
        t.toolName === 'film.image_upscale' &&
        t.input?.targetKind === kind &&
        t.input?.targetId === entityId
    );
  };

  // 判断指定角色是否正在定妆/超分中 (SSOT: 严格基于全局 tasks 与本地提交态判定)
  const isCharacterGenerating = (char: any): boolean => {
    const charId = char.characterId || char.id;
    if (!charId) return false;
    if (isSubmittingRefine.has(charId)) return true;
    if (isEntityUpscaling('character', charId)) return true;
    if (isEntityTaskRunning(tasks, 'film.lookdev', {
      characterId: charId,
      id: charId,
    })) return true;
    return false;
  };

  // 判断指定场景是否正在渲染/超分中 (SSOT: 严格基于全局 tasks 与本地提交态判定)
  const isLocationGenerating = (loc: any): boolean => {
    const locId = loc.locationId || loc.id;
    if (!locId) return false;
    if (isSubmittingRefine.has(locId)) return true;
    if (isEntityUpscaling('location', locId)) return true;
    if (isEntityTaskRunning(tasks, 'film.lookdev', {
      locationId: locId,
      id: locId,
    })) return true;
    return false;
  };

  // 判断指定道具是否正在渲染/超分中
  const isItemGenerating = (item: any): boolean => {
    const itemId = item.itemId || item.id;
    if (!itemId) return false;
    if (isSubmittingRefine.has(itemId)) return true;
    if (isEntityUpscaling('item', itemId)) return true;
    if (isEntityTaskRunning(tasks, 'film.lookdev', {
      itemId,
      id: itemId,
    })) return true;
    return false;
  };

  // 获取实体当前选中版本的高清超分记录（与服务端 SSOT 保持一致）
  const getActiveUpscale = (entity: any): { multiplier: number; upscaledAt: string } | undefined => {
    if (!entity?.imageUrl || !Array.isArray(entity.versions) || entity.versions.length === 0) {
      return undefined;
    }
    const activeVer = entity.versions.find((v: any) => v.versionId === entity.selectedVersionId);
    return activeVer?.upscale;
  };

  // 判断实体历史版本库中是否包含任意已超分版本（便于当前停留在非超分版本时提示可切回）
  const hasAnyUpscaledVersion = (entity: any): boolean =>
    Array.isArray(entity?.versions) && entity.versions.some((v: any) => Boolean(v?.upscale));

  // 触发单实体按需 SeedVR2 高清超分（追加无损高清新版本，原版保留可回切）
  const handleUpscaleEntity = async (
    kind: 'character' | 'location' | 'item',
    entityId: string,
    multiplier: 2 | 4 = upscaleMultiplier
  ) => {
    if (!entityId || isEntityUpscaling(kind, entityId)) return;
    setSubmittingUpscale((prev) => new Set(prev).add(entityId));
    try {
      await onRunTool('film.image_upscale', {
        projectId,
        targetKind: kind,
        targetId: entityId,
        multiplier,
      });
      onRefreshProject?.();
    } catch (err: any) {
      alert(`高清超分失败: ${err.message || String(err)}`);
    } finally {
      setSubmittingUpscale((prev) => {
        const next = new Set(prev);
        next.delete(entityId);
        return next;
      });
    }
  };

  // 手动重新触发单实体的特征规格推演 (film.entity_spec)
  const handleExtractEntitySpec = async (kind: 'character' | 'location' | 'item', entity: any) => {
    const id = entity.characterId || entity.locationId || entity.itemId || entity.id;
    if (!id || isEntitySpecExtracting(kind, entity)) return;
    try {
      await onRunTool('film.entity_spec', {
        projectId,
        targetKind: kind,
        targetId: id,
        name: entity.name,
        __idempotencyKey: `lookdev:manual-spec:${projectId}:${kind}:${id}:${Date.now()}`,
      });
      onRefreshProject?.();
    } catch (err: any) {
      alert(`提取特征规格失败: ${err.message || String(err)}`);
    }
  };

  // 还原实体提示词修改
  const handleRevertPrompt = (id: string) => {
    setPromptDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // 触发单角色定妆生图 (单个点击精准锁定，允许强制重新定妆；若有待应用改动自动先落盘保存)
  const handleGenerateCharacter = async (char: any) => {
    const charId = char.characterId || char.id;
    const originalPrompt = (char.promptZh || char.appearanceSummary || '').trim();
    const draft = promptDrafts[charId];
    if (draft !== undefined && draft.trim() !== originalPrompt) {
      try {
        await updateEntity(projectId, 'character', charId, { promptZh: draft });
        handleRevertPrompt(charId);
      } catch (err: any) {
        console.warn('[LookdevCanvas] 自动保存角色外观设定失败:', err);
      }
    }
    try {
      await runLookdev({ targetKind: 'character', targetId: charId, force: true });
      onRefreshProject?.();
    } catch (err: any) {
      alert(`定妆生成失败: ${err.message || String(err)}`);
    }
  };

  // 触发单场景氛围图生成 (单个点击精准锁定，允许强制重新生成；若有待应用改动自动先落盘保存)
  const handleGenerateLocation = async (loc: any) => {
    const locId = loc.locationId || loc.id;
    const rawPrompt = loc.promptZh || loc.appearanceSummary || loc.atmosphere || '';
    const draftPrompt = promptDrafts[locId];
    const isPromptMod = draftPrompt !== undefined && draftPrompt !== rawPrompt;

    const rawSpatial = typeof loc.spatialLayout === 'string'
      ? loc.spatialLayout
      : typeof loc.spatialLayout === 'object' && loc.spatialLayout !== null
      ? Object.values(loc.spatialLayout).filter(Boolean).join('；')
      : String(loc.spatialLayout || '');
    const draftSpatial = spatialDrafts[locId];
    const isSpatialMod = draftSpatial !== undefined && draftSpatial !== rawSpatial;

    if (isPromptMod || isSpatialMod) {
      const patch: any = {};
      if (isPromptMod) patch.promptZh = draftPrompt;
      if (isSpatialMod) patch.spatialLayout = draftSpatial;
      try {
        await updateEntity(projectId, 'location', locId, patch);
        if (isPromptMod) handleRevertPrompt(locId);
        if (isSpatialMod) {
          setSpatialDrafts((prev) => {
            const next = { ...prev };
            delete next[locId];
            return next;
          });
        }
      } catch (err: any) {
        console.warn('[LookdevCanvas] 自动保存场景设定失败:', err);
      }
    }
    try {
      await runLookdev({ targetKind: 'location', targetId: locId, force: true });
      onRefreshProject?.();
    } catch (err: any) {
      alert(`场景生成失败: ${err.message || String(err)}`);
    }
  };

  // 触发单道具特写生成 (若有待应用改动自动先落盘保存)
  const handleGenerateItem = async (item: any) => {
    const itemId = item.itemId || item.id;
    const originalPrompt = (item.promptZh || item.appearanceSummary || '').trim();
    const draft = promptDrafts[itemId];
    if (draft !== undefined && draft.trim() !== originalPrompt) {
      try {
        await updateEntity(projectId, 'item', itemId, { promptZh: draft });
        handleRevertPrompt(itemId);
      } catch (err: any) {
        console.warn('[LookdevCanvas] 自动保存道具设定失败:', err);
      }
    }
    try {
      await runLookdev({
        targetKind: 'item',
        targetId: itemId,
        force: true,
        referenceImageUrls: item.referenceImageUrl ? [item.referenceImageUrl] : undefined,
      });
      onRefreshProject?.();
    } catch (err: any) {
      alert(`生成道具特写失败: ${err?.message || String(err)}`);
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

  // 批量全剧定妆：为每个待定妆实体派发独立原子任务，按序排队逐张落盘与刷新
  const handleBatchGenerate = async () => {
    const pendingTasks: Array<{ targetKind: 'character' | 'location' | 'item'; targetId: string }> = [
      ...characters
        .filter((c: any) => !c.imageUrl)
        .map((char: any) => ({ targetKind: 'character' as const, targetId: char.characterId || char.id })),
      ...locations
        .filter((l: any) => !l.imageUrl)
        .map((loc: any) => ({ targetKind: 'location' as const, targetId: loc.locationId || loc.id })),
      ...items
        .filter((item: any) => !item.imageUrl)
        .map((item: any) => ({ targetKind: 'item' as const, targetId: item.itemId || item.id })),
    ];

    if (pendingTasks.length === 0) {
      alert('全剧角色、场景和道具已全部完成定妆。');
      return;
    }

    try {
      for (const task of pendingTasks) {
        await runLookdev({ ...task, force: false });
      }
      onRefreshProject?.();
    } catch (err: any) {
      alert(`批量定妆任务下发异常: ${err.message || String(err)}`);
    }
  };

  // 保存提示词修改
  const handleSavePrompt = async (type: 'character' | 'location' | 'item', id: string) => {
    const newPrompt = promptDrafts[id];
    if (newPrompt === undefined) {
      return;
    }
    try {
      await updateEntity(projectId, type, id, { promptZh: newPrompt });
      onRefreshProject?.();
    } catch (err: any) {
      alert(`保存提示词失败: ${err.message || String(err)}`);
    }
  };

  // 保存场景三维空间构造蓝图 (用于下游分镜镜头机位视锥调度)
  const handleSaveSpatialLayout = async (locId: string) => {
    const activeLoc = locations.find((l: any) => (l.locationId || l.id) === locId);
    const draft =
      spatialDrafts[locId] !== undefined
        ? spatialDrafts[locId]
        : activeLoc?.spatialLayout || '';
    setIsSavingSpatial(true);
    try {
      await updateEntity(projectId, 'location', locId, { spatialLayout: draft });
      onRefreshProject?.();
    } catch (err: any) {
      alert(`保存空间构造失败: ${err.message || String(err)}`);
    } finally {
      setIsSavingSpatial(false);
    }
  };

  // 辅助获取实体当前生效的参考底图 (支持乐观更新，如果已被用户点✕删除则立即返回 undefined)
  const getEntityRefImage = (entity: any): string | undefined => {
    if (!entity) return undefined;
    const id = entity.characterId || entity.locationId || entity.itemId || entity.id;
    if (deletedReferenceIds.has(id)) return undefined;
    return entity.referenceImageUrl || undefined;
  };

  // 获取当前选中版本在版本数组中的 1-based 序号
  const getSelectedVersionNumber = (entity: any): number => {
    const versions: LookdevVersion[] = entity?.versions || [];
    if (versions.length === 0) return 0;
    if (!entity?.selectedVersionId) return 0;
    const idx = versions.findIndex((v) => v.versionId === entity.selectedVersionId);
    return idx >= 0 ? idx + 1 : 0;
  };

  // 稳定缓存版本号（避免 Date.now() 导致每次重渲染图片闪烁重下）
  const getStableImageSrc = (url: string, entity: any): string => {
    const tag = entity?.selectedVersionId;
    return tag ? `${url}${url.includes('?') ? '&' : '?'}t=${encodeURIComponent(String(tag))}` : url;
  };

  const getImageGallery = (entity: any, label: string): MediaLightboxItem[] => {
    const gallery: MediaLightboxItem[] = [];
    const seen = new Set<string>();
    const add = (title: string, imageUrl?: string, badge?: string, subtitle?: string) => {
      if (!imageUrl || seen.has(imageUrl)) return;
      seen.add(imageUrl);
      gallery.push({ title, imageUrl, badge, subtitle });
    };
    const category = entity.characterId ? characters : entity.locationId ? locations : items;
    category.forEach((item: any) => {
      add(`参考底图 · ${item.name}`, getEntityRefImage(item), undefined, '创作者上传参考底图');
      (item.versions || []).forEach((version: LookdevVersion, index: number) => {
        const verUp = version.upscale;
        add(
          `${label} · ${item.name} · v${index + 1}`,
          version.imageUrl,
          verUp ? `HD ${verUp.multiplier}×` : undefined,
          verUp ? `SeedVR2 ${verUp.multiplier}× 高清超分版本` : '原图版本（未超分）'
        );
      });
      const activeUp = getActiveUpscale(item);
      add(
        `${label} · ${item.name} · 当前`,
        item.imageUrl,
        activeUp ? `HD ${activeUp.multiplier}×` : undefined,
        activeUp ? `SeedVR2 ${activeUp.multiplier}× 高清超分版本` : '原图版本（未超分）'
      );
    });
    return gallery;
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
    type: 'character' | 'location' | 'item',
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
  const allReadyEntities = [...characters, ...locations, ...items].filter((e: any) => Boolean(e.imageUrl));
  const totalUpscaledEntities = allReadyEntities.filter((e: any) => Boolean(getActiveUpscale(e))).length;

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

  // 历史版本库防重复渲染与唯一真理源收敛（杜绝同一 versionId 或 imageUrl 重复追加引发的 React Key 碰撞泄漏）
  const displayVersions = useMemo(() => {
    const list: any[] = activeSelectedEntity?.versions || [];
    const seen = new Set<string>();
    return list.filter((v: any) => {
      const k = v?.versionId || v?.imageUrl;
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [activeSelectedEntity?.versions]);

  const lookdevFocus = useMemo(() => {
    const tabLabels: Record<typeof activeTab, string> = {
      characters: '角色展台',
      locations: '场景展台',
      items: '道具展台',
    };
    if (activeSelectedEntity) {
      const kind = selectedCharacter ? 'character' : isItemEntity ? 'item' : 'location';
      const kindLabel = kind === 'character' ? '角色' : kind === 'item' ? '道具' : '场景';
      const entityId =
        activeSelectedEntity.characterId ||
        activeSelectedEntity.locationId ||
        activeSelectedEntity.itemId ||
        activeSelectedEntity.id;
      return {
        location: `视觉定妆工坊 · ${tabLabels[activeTab]}`,
        target: {
          kind,
          id: entityId,
          label: `${kindLabel} · ${activeSelectedEntity.name}`,
        },
        meta: { activeTab },
      };
    }
    return {
      location: `视觉定妆工坊 · ${tabLabels[activeTab]}`,
      meta: { activeTab },
    };
  }, [activeSelectedEntity, selectedCharacter, isItemEntity, activeTab]);
  useReportFocus(lookdevFocus);

  // ──────────────── Dirty State 全局变动感知与自动持久化 (Inspector SSOT) ────────────────
  const activeEntityId = activeSelectedEntity
    ? activeSelectedEntity.characterId ||
      activeSelectedEntity.locationId ||
      activeSelectedEntity.itemId ||
      activeSelectedEntity.id
    : null;
  const selectedLocId = selectedLocation
    ? selectedLocation.locationId || selectedLocation.id
    : null;

  // 生图提示词是否有改动
  const origPrompt = activeSelectedEntity?.promptZh || activeSelectedEntity?.appearanceSummary || '';
  const isPromptChanged = Boolean(
    activeEntityId &&
      promptDrafts[activeEntityId] !== undefined &&
      promptDrafts[activeEntityId] !== origPrompt
  );

  const rawSpatial = selectedLocation?.spatialLayout;
  const origSpatialStr =
    typeof rawSpatial === 'string'
      ? rawSpatial
      : typeof rawSpatial === 'object' && rawSpatial !== null
      ? Object.values(rawSpatial).filter(Boolean).join('；')
      : '';
  const currentSpatialStr = selectedLocId
    ? spatialDrafts[selectedLocId] !== undefined
      ? spatialDrafts[selectedLocId]
      : origSpatialStr
    : '';

  // 场景三维空间构造是否有改动 (纯文本比对)
  const isSpatialChanged = Boolean(
    selectedLocId &&
      spatialDrafts[selectedLocId] !== undefined &&
      spatialDrafts[selectedLocId] !== origSpatialStr
  );

  const selectedCharId = selectedCharacter
    ? selectedCharacter.characterId || selectedCharacter.id
    : null;
  const origVoiceStr = selectedCharacter?.voiceStyle || '';
  const currentVoiceStr = selectedCharId
    ? voiceDrafts[selectedCharId] !== undefined
      ? voiceDrafts[selectedCharId]
      : origVoiceStr
    : '';
  const isVoiceChanged = Boolean(
    selectedCharId &&
      voiceDrafts[selectedCharId] !== undefined &&
      voiceDrafts[selectedCharId] !== origVoiceStr
  );

  // 综合是否有改动
  const isEntityChanged = isPromptChanged || isSpatialChanged || isVoiceChanged;

  // 统一批量保存当前选中实体的所有未生效修改 (Prompt / 空间构造 / 声色基准)
  const handleSaveActiveEntityChanges = async () => {
    if (!activeSelectedEntity || !activeEntityId) return;
    const entityType: 'character' | 'location' | 'item' = selectedCharacter
      ? 'character'
      : selectedLocation
      ? 'location'
      : 'item';

    const patch: any = {};
    if (isPromptChanged && promptDrafts[activeEntityId] !== undefined) {
      patch.promptZh = promptDrafts[activeEntityId];
    }
    if (selectedLocation && selectedLocId && isSpatialChanged && spatialDrafts[selectedLocId] !== undefined) {
      patch.spatialLayout = spatialDrafts[selectedLocId];
    }
    if (selectedCharacter && selectedCharId && isVoiceChanged && voiceDrafts[selectedCharId] !== undefined) {
      patch.voiceStyle = voiceDrafts[selectedCharId];
    }

    if (Object.keys(patch).length > 0) {
      await updateEntity(projectId, entityType, activeEntityId, patch);
      if (selectedCharId && patch.voiceStyle !== undefined) {
        setVoiceDrafts((prev) => {
          const next = { ...prev };
          delete next[selectedCharId];
          return next;
        });
      }
      onRefreshProject?.();
    }
  };

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
      <header className="relative z-20 px-8 py-4 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-2xs flex items-center justify-between">
        <div className="flex items-center space-x-4">
          {subCanvasOptions && onSwitchSubCanvas ? (
            <SubCanvasSwitcher
              currentId="lookdev"
              options={subCanvasOptions}
              onSelect={onSwitchSubCanvas}
              onBackToTopology={onBackToTopology}
            />
          ) : (
            <button
              onClick={onBackToTopology}
              className="px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100/80 text-xs font-bold text-slate-700 flex items-center space-x-2 transition-all shadow-2xs hover:shadow-xs active:scale-95 cursor-pointer"
            >
              <span>←</span>
              <span>返回流向拓扑</span>
            </button>
          )}
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 border border-indigo-200 text-indigo-700">
              🎭 角色 {completedChars}/{characters.length} · 🏞️ 场景 {completedLocs}/{locations.length}
              {' · '}🧰 道具 {items.filter((item: any) => Boolean(item.referenceImageUrl || item.imageUrl)).length}/{items.length}
            </span>
            {allReadyEntities.length > 0 && (
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                  totalUpscaledEntities > 0
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-slate-100 border-slate-200 text-slate-500'
                }`}
                title="当前激活版本已完成 SeedVR2 高清超分的资产数量"
              >
                ✨ 已超分 {totalUpscaledEntities}/{allReadyEntities.length}
              </span>
            )}
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
              const isSpecExtracting = isEntitySpecExtracting('character', char);
              const isSelected = selectedEntityId === charId;
              const originalPrompt = char.promptZh || char.appearanceSummary || '';
              const hasDraft = promptDrafts[charId] !== undefined;
              const currentPrompt = hasDraft ? promptDrafts[charId] : originalPrompt;
              const isModified = hasDraft && promptDrafts[charId] !== originalPrompt;

              return (
                <CharacterCard
                  key={charId}
                  char={char}
                  isSelected={isSelected}
                  tasks={tasks}
                  isBusy={isBusy}
                  charRefImg={charRefImg || undefined}
                  isGen={isGen}
                  isSpecExtracting={isSpecExtracting}
                  isModified={isModified}
                  currentPrompt={currentPrompt}
                  activeRefineEntityId={activeRefineEntityId}
                  refineInput={refineInputs[charId] || ''}
                  isSubmittingRefine={isSubmittingRefine.has(charId)}
                  uploadingEntityId={uploadingEntityId}
                  getActiveUpscale={getActiveUpscale}
                  hasAnyUpscaledVersion={hasAnyUpscaledVersion}
                  getSelectedVersionNumber={getSelectedVersionNumber}
                  getStableImageSrc={getStableImageSrc}
                  getImageGallery={getImageGallery}
                  onSelect={() => setSelectedEntityId(charId)}
                  onOpenVersions={() => {
                    setVersionModalEntity({
                      type: 'character',
                      id: char.characterId || char.id,
                      name: char.name,
                      currentImageUrl: char.imageUrl,
                      versions: char.versions,
                      selectedVersionId: char.selectedVersionId,
                    });
                  }}
                  onEnlargeMedia={onEnlargeMedia}
                  onRemoveRefImage={() => handleRemoveReferenceImage('character', charId)}
                  onTriggerUpload={() => handleTriggerUpload('character', charId)}
                  onToggleRefine={() => {
                    setActiveRefineEntityId(
                      activeRefineEntityId === charId ? null : charId
                    );
                  }}
                  onRefineInputChange={(val) => {
                    setRefineInputs((prev) => ({ ...prev, [charId]: val }));
                  }}
                  onSubmitRefine={() => handleImageRefine('character', charId, char.imageUrl)}
                  onCancelRefine={() => setActiveRefineEntityId(null)}
                  onUpscale={() => handleUpscaleEntity('character', charId, 2)}
                  onExtractSpec={() => handleExtractEntitySpec('character', char)}
                  onPromptDraftChange={(val) => {
                    setPromptDrafts((prev) => ({ ...prev, [charId]: val }));
                  }}
                  onRevertPrompt={() => handleRevertPrompt(charId)}
                  onGenerate={() => handleGenerateCharacter(char)}
                  onRetryTask={(taskId) => {
                    void retryTask(taskId).then(() => onRefreshProject?.());
                  }}
                  isEntityUpscaling={isEntityUpscaling}
                />
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
              const isSpecExtracting = isEntitySpecExtracting('location', loc);
              const isSelected = selectedEntityId === locId;
              const originalPrompt = loc.promptZh || loc.appearanceSummary || loc.atmosphere || '';
              const hasDraft = promptDrafts[locId] !== undefined;
              const currentPrompt = hasDraft ? promptDrafts[locId] : originalPrompt;
              const isModified = hasDraft && promptDrafts[locId] !== originalPrompt;

              const rawSpatial = typeof loc.spatialLayout === 'string'
                ? loc.spatialLayout
                : typeof loc.spatialLayout === 'object' && loc.spatialLayout !== null
                ? Object.values(loc.spatialLayout).filter(Boolean).join('；')
                : String(loc.spatialLayout || '');
              const hasSpatialDraft = spatialDrafts[locId] !== undefined;
              const currentSpatial = hasSpatialDraft ? spatialDrafts[locId] : rawSpatial;
              const isSpatialModified = hasSpatialDraft && spatialDrafts[locId] !== rawSpatial;

              return (
                <LocationCard
                  key={locId}
                  loc={loc}
                  isSelected={isSelected}
                  tasks={tasks}
                  isBusy={isBusy}
                  locRefImg={locRefImg || undefined}
                  isGen={isGen}
                  isSpecExtracting={isSpecExtracting}
                  isModified={isModified}
                  currentPrompt={currentPrompt}
                  currentSpatial={currentSpatial}
                  isSpatialModified={isSpatialModified}
                  activeRefineEntityId={activeRefineEntityId}
                  refineInput={refineInputs[locId] || ''}
                  isSubmittingRefine={isSubmittingRefine.has(locId)}
                  uploadingEntityId={uploadingEntityId}
                  getActiveUpscale={getActiveUpscale}
                  hasAnyUpscaledVersion={hasAnyUpscaledVersion}
                  getSelectedVersionNumber={getSelectedVersionNumber}
                  getStableImageSrc={getStableImageSrc}
                  getImageGallery={getImageGallery}
                  onSelect={() => setSelectedEntityId(locId)}
                  onOpenVersions={() => {
                    setVersionModalEntity({
                      type: 'location',
                      id: loc.locationId || loc.id,
                      name: loc.name,
                      currentImageUrl: loc.imageUrl,
                      versions: loc.versions,
                      selectedVersionId: loc.selectedVersionId,
                    });
                  }}
                  onEnlargeMedia={onEnlargeMedia}
                  onRemoveRefImage={() => handleRemoveReferenceImage('location', locId)}
                  onTriggerUpload={() => handleTriggerUpload('location', locId)}
                  onToggleRefine={() => {
                    setActiveRefineEntityId(
                      activeRefineEntityId === locId ? null : locId
                    );
                  }}
                  onRefineInputChange={(val) => {
                    setRefineInputs((prev) => ({ ...prev, [locId]: val }));
                  }}
                  onSubmitRefine={() => handleImageRefine('location', locId, loc.imageUrl)}
                  onCancelRefine={() => setActiveRefineEntityId(null)}
                  onUpscale={() => handleUpscaleEntity('location', locId, 2)}
                  onExtractSpec={() => handleExtractEntitySpec('location', loc)}
                  onPromptDraftChange={(val) => {
                    setPromptDrafts((prev) => ({ ...prev, [locId]: val }));
                  }}
                  onRevertPrompt={() => handleRevertPrompt(locId)}
                  onSpatialDraftChange={(val) => {
                    setSpatialDrafts((prev) => ({ ...prev, [locId]: val }));
                  }}
                  onRevertSpatial={() => {
                    setSpatialDrafts((prev) => {
                      const next = { ...prev };
                      delete next[locId];
                      return next;
                    });
                  }}
                  onGenerate={() => handleGenerateLocation(loc)}
                  onRetryTask={(taskId) => {
                    void retryTask(taskId).then(() => onRefreshProject?.());
                  }}
                  isEntityUpscaling={isEntityUpscaling}
                />
              );
            })}
          </div>
        )}

        {/* ──────────────── Tab 3: 核心道具展台 ──────────────── */}
        {activeTab === 'items' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((item: any) => {
              const itemId = item.itemId || item.id;
              const isGenerating = isItemGenerating(item);
              const isSpecExtracting = isEntitySpecExtracting('item', item);
              const isUpscaling = isEntityUpscaling('item', itemId);
              const originalPrompt = item.promptZh || item.appearanceSummary || '';
              const hasDraft = promptDrafts[itemId] !== undefined;
              const currentPrompt = hasDraft ? promptDrafts[itemId] : originalPrompt;
              const isModified = hasDraft && promptDrafts[itemId] !== originalPrompt;

              return (
                <ItemCard
                  key={itemId}
                  item={item}
                  isSelected={selectedEntityId === itemId}
                  tasks={tasks}
                  isBusy={isBusy}
                  itemRefImg={getEntityRefImage(item) || undefined}
                  isGenerating={isGenerating}
                  isSpecExtracting={isSpecExtracting}
                  isUpscaling={isUpscaling}
                  isModified={isModified}
                  currentPrompt={currentPrompt}
                  activeRefineEntityId={activeRefineEntityId}
                  refineInput={refineInputs[itemId] || ''}
                  isSubmittingRefine={isSubmittingRefine.has(itemId)}
                  uploadingEntityId={uploadingEntityId}
                  getActiveUpscale={getActiveUpscale}
                  getSelectedVersionNumber={getSelectedVersionNumber}
                  getStableImageSrc={getStableImageSrc}
                  getImageGallery={getImageGallery}
                  onSelect={() => setSelectedEntityId(itemId)}
                  onOpenVersions={() => {
                    setVersionModalEntity({
                      type: 'item',
                      id: itemId,
                      name: item.name,
                      currentImageUrl: item.imageUrl,
                      versions: item.versions,
                      selectedVersionId: item.selectedVersionId,
                    });
                  }}
                  onEnlargeMedia={onEnlargeMedia}
                  onTriggerUpload={() => handleTriggerUpload('item', itemId)}
                  onToggleRefine={() => {
                    setActiveRefineEntityId(activeRefineEntityId === itemId ? null : itemId);
                  }}
                  onRefineInputChange={(val) => {
                    setRefineInputs((prev) => ({ ...prev, [itemId]: val }));
                  }}
                  onSubmitRefine={() => handleImageRefine('item', itemId, item.imageUrl || item.referenceImageUrl)}
                  onUpscale={() => handleUpscaleEntity('item', itemId, 2)}
                  onExtractSpec={() => handleExtractEntitySpec('item', item)}
                  onPromptDraftChange={(val) => {
                    setPromptDrafts((prev) => ({ ...prev, [itemId]: val }));
                  }}
                  onRevertPrompt={() => handleRevertPrompt(itemId)}
                  onGenerate={() => handleGenerateItem(item)}
                  onRetryTask={(taskId) => {
                    void retryTask(taskId).then(() => onRefreshProject?.());
                  }}
                />
              );
            })}
            {items.length === 0 && <div className="col-span-full py-16 text-center text-sm text-slate-400">当前没有提取到核心道具</div>}
          </div>
        )}
      </main>

      {/* ──────────────── 3. 历史定妆版本选择与切换弹窗 ──────────────── */}
      {versionModalEntity && (
        <LookdevVersionModal
          entity={versionModalEntity}
          onClose={() => setVersionModalEntity(null)}
          onSelectVersion={(type, id, versionId) => {
            handleSelectVersion(type, id, versionId);
            setVersionModalEntity((prev) => (prev ? { ...prev, selectedVersionId: versionId } : null));
          }}
        />
      )}

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
                <>
                  <img
                    key={`${activeSelectedEntity.imageUrl}_${activeSelectedEntity.selectedVersionId}`}
                    src={getStableImageSrc(activeSelectedEntity.imageUrl, activeSelectedEntity)}
                    alt={activeSelectedEntity.name}
                    className={`w-full h-full ${isLocationEntity ? 'object-cover' : 'object-contain object-center'}`}
                  />
                  {getActiveUpscale(activeSelectedEntity) && (
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-emerald-600/90 backdrop-blur-xs text-white text-[10px] font-mono font-bold shadow-xs z-10">
                      HD {getActiveUpscale(activeSelectedEntity)!.multiplier}×
                    </span>
                  )}
                </>
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
                      gallery: getImageGallery(activeSelectedEntity, selectedCharacter ? '角色定妆' : isItemEntity ? '道具特写' : '场景氛围'),
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
                  onClick={() => {
                    const up = getActiveUpscale(activeSelectedEntity);
                    onEnlargeMedia?.({
                      title: activeSelectedEntity.imageUrl ? activeSelectedEntity.name : `参考底图 · ${activeSelectedEntity.name}`,
                      imageUrl: activeSelectedEntity.imageUrl || activeRefImg,
                      badge: up ? `HD ${up.multiplier}×` : undefined,
                      subtitle: up ? `已通过 SeedVR2 完成 ${up.multiplier}× 高清超分` : undefined,
                      gallery: getImageGallery(activeSelectedEntity, selectedCharacter ? '角色定妆' : isItemEntity ? '道具特写' : '场景氛围'),
                    });
                  }}
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
                onClick={async () => {
                  try {
                    if (isEntityChanged) {
                      await handleSaveActiveEntityChanges();
                    }
                  } catch (err: any) {
                    alert(`应用修改失败: ${err?.message || String(err)}`);
                    return;
                  }

                  if (selectedCharacter) {
                    handleGenerateCharacter(selectedCharacter);
                  } else if (selectedLocation) {
                    handleGenerateLocation(selectedLocation);
                  } else if (selectedItem) {
                    const itemId = selectedItem.itemId || selectedItem.id;
                    runLookdev({
                      targetKind: 'item',
                      targetId: itemId,
                      force: true,
                      referenceImageUrls: selectedItem.referenceImageUrl ? [selectedItem.referenceImageUrl] : undefined,
                    })
                      .then(() => onRefreshProject?.())
                      .catch((err: any) => alert(`生成道具特写失败: ${err?.message || String(err)}`));
                  }
                }}
                disabled={
                  (selectedCharacter && isCharacterGenerating(selectedCharacter)) ||
                  (selectedLocation && isLocationGenerating(selectedLocation)) ||
                  (selectedItem && isItemGenerating(selectedItem)) ||
                  isBusy
                }
                className={`flex-1 py-2.5 rounded-xl text-white text-xs font-bold flex items-center justify-center space-x-1.5 transition shadow-xs disabled:opacity-50 cursor-pointer ${
                  isEntityChanged
                    ? 'bg-gradient-to-r from-amber-600 to-indigo-600 hover:from-amber-500 hover:to-indigo-500 ring-2 ring-amber-400/40 shadow-md'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                <span>✨</span>
                <span>
                  {(selectedCharacter && isCharacterGenerating(selectedCharacter)) ||
                  (selectedLocation && isLocationGenerating(selectedLocation)) ||
                  (selectedItem && isItemGenerating(selectedItem))
                    ? '处理中...'
                    : isEntityChanged
                    ? `应用修改并${
                        activeSelectedEntity.imageUrl
                          ? isLocationEntity
                            ? '重新渲染场景'
                            : isItemEntity
                            ? '重新生成道具特写'
                            : '重新定妆'
                          : isLocationEntity
                          ? '渲染场景'
                          : isItemEntity
                          ? '生成道具特写'
                          : '立即定妆'
                      }`
                    : activeSelectedEntity.imageUrl
                    ? isLocationEntity
                      ? '重新渲染场景'
                      : isItemEntity
                      ? '重新生成道具特写'
                      : '重新定妆'
                    : isLocationEntity
                    ? '渲染场景'
                    : isItemEntity
                    ? '生成道具特写'
                    : '立即定妆'}
                </span>
              </button>
            </div>

            {/* 2.5 按需高清超分栏 (SeedVR2，无损追加新版本) */}
            {activeSelectedEntity.imageUrl && (() => {
              const entityKind: 'character' | 'location' | 'item' = selectedCharacter
                ? 'character'
                : isItemEntity
                ? 'item'
                : 'location';
              const entityId =
                activeSelectedEntity.characterId ||
                activeSelectedEntity.locationId ||
                activeSelectedEntity.itemId ||
                activeSelectedEntity.id;
              const upscaling = isEntityUpscaling(entityKind, entityId);
              const entityBusy =
                (selectedCharacter && isCharacterGenerating(selectedCharacter)) ||
                (selectedLocation && isLocationGenerating(selectedLocation)) ||
                (selectedItem && isItemGenerating(selectedItem)) ||
                isBusy;
              const currentUpscale = getActiveUpscale(activeSelectedEntity);

              return (
                <div
                  className={`flex flex-col gap-2 rounded-2xl p-2.5 border transition-all ${
                    currentUpscale
                      ? 'bg-emerald-50/90 border-emerald-300'
                      : 'bg-emerald-50/70 border-emerald-200/80'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold text-emerald-950 px-1">
                    <span className="flex items-center gap-1.5">
                      <span>✨</span>
                      <span>SeedVR2 无损高清超分</span>
                    </span>
                    {currentUpscale ? (
                      <span className="px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[10px] font-mono font-bold shadow-2xs">
                        ✓ 当前已超分 {currentUpscale.multiplier}×
                      </span>
                    ) : (
                      <span className="text-[10px] text-emerald-700/80 font-normal">
                        自动追加高清新版本
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="inline-flex rounded-xl bg-white p-0.5 border border-emerald-200 shrink-0">
                      {([2, 4] as const).map((factor) => (
                        <button
                          key={factor}
                          type="button"
                          onClick={() => setUpscaleMultiplier(factor)}
                          disabled={entityBusy}
                          className={`px-2 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                            upscaleMultiplier === factor
                              ? 'bg-emerald-600 text-white shadow-2xs'
                              : 'text-emerald-700 hover:bg-emerald-50'
                          }`}
                        >
                          {factor}×
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUpscaleEntity(entityKind, entityId, upscaleMultiplier)}
                      disabled={entityBusy}
                      className="flex-1 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-2xs disabled:opacity-50 cursor-pointer"
                      title="使用官方 SeedVR2 工作流执行无损高清超分，自动追加为新版本，原版仍保留在版本库中"
                    >
                      {upscaling && (
                        <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      )}
                      <span>
                        {upscaling
                          ? `SeedVR2 超分中 (${upscaleMultiplier}×)...`
                          : currentUpscale
                          ? `重新超分当前版本 (${upscaleMultiplier}×)`
                          : `执行 SeedVR2 高清超分 (${upscaleMultiplier}×)`}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* 3. 历史定妆/渲染版本库 (角色 2:1 / 场景 16:9 / 道具 1:1 动态自适应) */}
            {displayVersions.length > 0 && (
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 flex items-center space-x-1">
                    <span>📚</span>
                    <span>
                      {isLocationEntity ? '已渲染版本库' : isItemEntity ? '道具版本库' : '已定妆版本库'} ({displayVersions.length} 版)
                    </span>
                  </span>
                  <span className="text-[10px] text-slate-500">待验收版本请对照修改要求后选用</span>
                </div>
                <div className={`grid ${isLocationEntity ? 'grid-cols-2 gap-2.5' : 'grid-cols-3 gap-2'} max-h-56 overflow-y-auto p-1`}>
                  {displayVersions.map((ver: any, idx: number) => {
                    const isSelectedVer = ver.versionId === activeSelectedEntity.selectedVersionId;
                    const entityId =
                      activeSelectedEntity.characterId ||
                      activeSelectedEntity.locationId ||
                      activeSelectedEntity.itemId ||
                      activeSelectedEntity.id;
                    return (
                      <div
                        key={`${entityId}_${ver.versionId || 'ver'}_${idx}`}
                        title={ver.reviewStatus === 'pending' ? `待验收：${ver.instruction || '请对照画面确认修改要求'}` : undefined}
                        onClick={() =>
                          handleSelectVersion(
                            selectedCharacter ? 'character' : isItemEntity ? 'item' : 'location',
                            entityId,
                            ver.versionId
                          )
                        }
                        className={`group relative rounded-xl overflow-hidden border-2 cursor-pointer transition-all ${
                          isLocationEntity ? 'aspect-video' : isItemEntity ? 'aspect-square' : 'aspect-[2/1]'
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
                        {ver.upscale && (
                          <div
                            className="absolute top-1 right-1 px-1 py-0.2 rounded bg-emerald-600/95 text-[8px] font-mono font-bold text-white shadow-2xs z-10"
                            title={`已完成 SeedVR2 ${ver.upscale.multiplier}× 高清超分`}
                          >
                            HD {ver.upscale.multiplier}×
                          </div>
                        )}
                        {ver.reviewStatus === 'pending' && (
                          <span className="absolute top-1 right-1 px-1 py-0.5 rounded bg-amber-700 text-white text-[9px] font-semibold">待验收</span>
                        )}
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

            {/* 4. 全局统一实体生图设定提示词卡片 (角色、场景、道具单一真理源 SSOT) */}
            {activeSelectedEntity && (
              <div className="space-y-3">
                {/* 板块 1：生图提示词 (Prompt) */}
                <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 flex items-center space-x-1">
                      <span>{selectedLocation ? '🎨' : '✏️'}</span>
                      <span>
                        {selectedLocation
                          ? '🎨 场景生图词 (出图专用)'
                          : selectedCharacter
                          ? '👤 角色定妆设定 (Prompt)'
                          : '📦 道具特写设定 (Prompt)'}
                      </span>
                    </span>
                    {isPromptChanged && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!activeEntityId) return;
                          handleRevertPrompt(activeEntityId);
                        }}
                        className="inline-flex items-center gap-1 text-[10px] text-white bg-amber-500 hover:bg-amber-600 border border-amber-600 px-2 py-0.5 rounded-md font-bold transition shadow-xs cursor-pointer group active:scale-95 animate-in fade-in"
                        title="放弃未应用的改动，一键还原为当前已保存设定"
                      >
                        <span>↺ 还原设定</span>
                      </button>
                    )}
                  </div>
                  <textarea
                    value={
                      promptDrafts[
                        activeSelectedEntity.characterId ||
                          activeSelectedEntity.locationId ||
                          activeSelectedEntity.itemId ||
                          activeSelectedEntity.id
                      ] ??
                      (activeSelectedEntity.promptZh || activeSelectedEntity.appearanceSummary || '')
                    }
                    onChange={(e) =>
                      setPromptDrafts((prev) => ({
                        ...prev,
                        [activeSelectedEntity.characterId ||
                          activeSelectedEntity.locationId ||
                          activeSelectedEntity.itemId ||
                          activeSelectedEntity.id]: e.target.value,
                      }))
                    }
                    placeholder={
                      selectedLocation
                        ? '聚焦宏观建筑形制开间、核心主轴陈设、PBR 真实材质与冷暖光影；纯置景描写，绝无东南西北罗盘词...'
                        : '描述实体的外观特征、服饰/材质细节与色彩...'
                    }
                    rows={3}
                    className={`w-full min-h-16 max-h-64 overflow-y-auto [field-sizing:content] text-xs text-slate-800 rounded-xl p-2.5 focus:outline-none leading-relaxed resize-y font-sans transition-colors ${
                      isPromptChanged
                        ? 'border-2 border-amber-400/90 bg-amber-50/20 focus:ring-2 focus:ring-amber-400/30'
                        : 'border border-slate-200 bg-white focus:ring-1 focus:ring-indigo-500'
                    }`}
                  />
                  {selectedLocation && (
                    <p className="text-[10px] text-slate-400 leading-tight">
                      * 专供生成场景空镜概念大片；请使用自然置景语言，避免机械方位词。
                    </p>
                  )}
                </div>

                {/* 板块 2：三维客观空间构造蓝图 (仅场景专有，专供下游分镜机位调度) */}
                {selectedLocation && (() => {
                  const locId = selectedLocation.locationId || selectedLocation.id;

                  return (
                    <div className="bg-indigo-50/40 border border-indigo-200/80 rounded-2xl p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-indigo-950 flex items-center space-x-1">
                          <span>🧭</span>
                          <span>三维空间构造 (分镜机位专用)</span>
                        </span>
                        {isSpatialChanged && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!selectedLocId) return;
                              setSpatialDrafts((prev) => {
                                const next = { ...prev };
                                delete next[selectedLocId];
                                return next;
                              });
                            }}
                            className="inline-flex items-center gap-1 text-[10px] text-white bg-amber-500 hover:bg-amber-600 border border-amber-600 px-2 py-0.5 rounded-md font-bold transition shadow-xs cursor-pointer group active:scale-95 animate-in fade-in"
                            title="放弃未应用的改动，一键还原为当前已保存空间构造"
                          >
                            <span>↺ 还原空间构造</span>
                          </button>
                        )}
                      </div>
                      <textarea
                        value={currentSpatialStr}
                        onChange={(e) =>
                          setSpatialDrafts((prev) => ({
                            ...prev,
                            [locId]: e.target.value,
                          }))
                        }
                        placeholder="标准五段式收束：【入场路径】... 【核心地标】... 【画左立面】... 【画右立面】... 【背景阻隔】..."
                        rows={4}
                        className={`w-full min-h-20 max-h-64 overflow-y-auto [field-sizing:content] text-xs text-slate-800 rounded-xl p-2.5 focus:outline-none leading-relaxed resize-y font-sans transition-colors ${
                          isSpatialChanged
                            ? 'border-2 border-amber-400/90 bg-amber-50/20 focus:ring-2 focus:ring-amber-400/30'
                            : 'border border-indigo-200/90 bg-white focus:ring-1 focus:ring-indigo-500'
                        }`}
                      />
                      <p className="text-[10px] text-indigo-600/90 leading-tight">
                        * 场景客观相对拓扑事实底座，供下游分镜镜头按具体拍摄机位动态投影视锥，不影响场景出图。
                      </p>
                    </div>
                  );
                })()}

                {/* 板块 3：角色声色基准 (仅角色专有，专供下游视频台词配音) */}
                {selectedCharacter && selectedCharId && (
                  <div className="bg-emerald-50/40 border border-emerald-200/80 rounded-2xl p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-950 flex items-center space-x-1">
                        <span>🎙️</span>
                        <span>声色基准 (视频配音专用)</span>
                      </span>
                      {isVoiceChanged && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setVoiceDrafts((prev) => {
                              const next = { ...prev };
                              delete next[selectedCharId];
                              return next;
                            });
                          }}
                          className="inline-flex items-center gap-1 text-[10px] text-white bg-amber-500 hover:bg-amber-600 border border-amber-600 px-2 py-0.5 rounded-md font-bold transition shadow-xs cursor-pointer group active:scale-95 animate-in fade-in"
                          title="放弃未应用的改动，一键还原为当前已保存声色基准"
                        >
                          <span>↺ 还原声色</span>
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      value={currentVoiceStr}
                      onChange={(e) =>
                        setVoiceDrafts((prev) => ({
                          ...prev,
                          [selectedCharId]: e.target.value,
                        }))
                      }
                      placeholder="如：沙哑低沉老年男声，语速缓慢带干咳（10~25字，独立于生图提示词）"
                      className={`w-full text-xs text-slate-800 rounded-xl px-3 py-2 focus:outline-none transition-colors ${
                        isVoiceChanged
                          ? 'border-2 border-amber-400/90 bg-amber-50/20 focus:ring-2 focus:ring-amber-400/30'
                          : 'border border-emerald-200/90 bg-white focus:ring-1 focus:ring-emerald-500'
                      }`}
                    />
                    <p className="text-[10px] text-emerald-700/85 leading-tight">
                      * 仅用于锁定视频对白声线，不会混入角色定妆生图提示词。
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      )}

      {/* 视觉定妆空间专属 AI 协作者 (LookdevCopilot) */}
      <DirectorFloatingBubble
        mode="lookdev"
        projectId={projectId}
        tasks={tasks}
        onRefreshProject={onRefreshProject}
      />
    </div>
  );
};
