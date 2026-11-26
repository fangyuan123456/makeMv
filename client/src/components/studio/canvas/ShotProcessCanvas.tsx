import React, { useEffect, useMemo, useState, useRef } from 'react';
import type { CanvasShotNode, ShotFrameVersion, ShotVideoVersion, TaskRecord } from '../../../types/index.js';
import type { MediaLightboxItem } from '../stages/visual/MediaLightboxModal.js';
import { useReportFocus } from '../../../hooks/StudioFocusContext.js';
import { selectShotVersion, updateShotPrompt, updateShotContinuity, runTask, fetchTaskRecord } from '../../../lib/api.js';
import { DirectorDropdownBar, type DirectorDirectives } from './DirectorDropdownBar.js';
import { DirectorVideoDropdownBar } from './DirectorVideoDropdownBar.js';
import { SubCanvasSwitcher, type SubCanvasOption } from './SubCanvasSwitcher.js';
import { TiptapMentionEditor } from './TiptapMentionEditor.js';
import {
  extractStructuredVisuals,
  extractStructuredVideoDirectives,
  purifySubjectPrompt,
  purifyActionPrompt,
  reconstructShotPrompt,
  reconstructVideoPrompt,
  type VideoDirectives,
} from './presets/promptDeconstructor.js';

interface ShotProcessCanvasProps {
  node: CanvasShotNode;
  allNodes?: CanvasShotNode[];
  onSelectNode?: (node: CanvasShotNode) => void;
  projectId: string;
  projectData?: any;
  tasks?: TaskRecord[];
  onClose: () => void;
  onRunTool: (toolName: string, input: Record<string, any>) => Promise<any>;
  onRefreshProject?: () => void;
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

type ProcessNode = 'first' | 'last' | 'video';

export const ShotProcessCanvas: React.FC<ShotProcessCanvasProps> = ({
  node,
  allNodes = [],
  onSelectNode,
  projectId,
  projectData,
  tasks = [],
  onClose,
  onRunTool,
  onRefreshProject,
  onEnlargeMedia,
  subCanvasOptions,
  onSwitchSubCanvas,
  isBusy,
}) => {
  const lookdevEntities = useMemo(() => {
    return (
      projectData?.entities ||
      projectData?.artifacts?.lookdev_entities ||
      {}
    );
  }, [projectData]);

  const [selected, setSelected] = useState<ProcessNode>('first');
  const [shotDropdownOpen, setShotDropdownOpen] = useState(false);
  const shotMenuRef = React.useRef<HTMLDivElement>(null);

  // 切换目标镜头节点时自动重置首选步骤为首帧与更新连续性
  useEffect(() => {
    setSelected('first');
    setContinuityMode(node.continuityMode || 'auto');
  }, [node.id, node.shotId]);

  // 点击外部自动收起镜头下拉
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (shotMenuRef.current && !shotMenuRef.current.contains(e.target as Node)) {
        setShotDropdownOpen(false);
      }
    };
    if (shotDropdownOpen) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutside);
    };
  }, [shotDropdownOpen]);

  const currentIndex = useMemo(() => {
    if (!allNodes) return -1;
    return allNodes.findIndex((n) => n.id === node.id || n.shotId === node.shotId);
  }, [allNodes, node.id, node.shotId]);

  const prevShotNode = currentIndex > 0 && allNodes ? allNodes[currentIndex - 1] : null;
  const nextShotNode =
    currentIndex >= 0 && allNodes && currentIndex < allNodes.length - 1
      ? allNodes[currentIndex + 1]
      : null;

  const canGoPrevShot = Boolean(prevShotNode && prevShotNode.isUnlocked !== false);
  const canGoNextShot = Boolean(nextShotNode && nextShotNode.isUnlocked !== false);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [savedPrompt, setSavedPrompt] = useState('');
  const [submittingAction, setSubmittingAction] = useState<{
    step: ProcessNode;
    mode: 'generate' | 'upscale';
  } | null>(null);
  const [upscaleMultiplier, setUpscaleMultiplier] = useState<2 | 4>(2);
  const [zoom, setZoom] = useState(1);
  const [panelOpen, setPanelOpen] = useState(true);
  const [directives, setDirectives] = useState<DirectorDirectives>({});
  const [savedImageDirectives, setSavedImageDirectives] = useState<DirectorDirectives>({});
  const [pureSubject, setPureSubject] = useState('');

  // 视频专属结构化运镜状态 (与图片模式严格隔离)
  const [videoDirectives, setVideoDirectives] = useState<VideoDirectives>({});
  const [savedVideoDirectives, setSavedVideoDirectives] = useState<VideoDirectives>({});
  const [pureAction, setPureAction] = useState('');
  const [videoInstruction, setVideoInstruction] = useState('');

  // 镜头视听时空连续性模式 (auto 智能决策 | linked 强制连贯 | detached 独立机位)
  const [continuityMode, setContinuityMode] = useState<'auto' | 'linked' | 'detached'>(
    node.continuityMode || 'auto'
  );
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);

  // 提取前序镜头接戏数据 SSOT（优先从 film_spec 查找，降级从 allNodes 查找）
  const previousShotData = useMemo(() => {
    if (!node.shotId) return undefined;
    const filmSpec = projectData?.artifacts?.film_spec;
    const clipId = node.clipId || node.shotId.split('-')[0];
    const clip = filmSpec?.clips?.find((c: any) => c.clipId === clipId);
    if (clip && Array.isArray(clip.shots)) {
      const idx = clip.shots.findIndex((s: any) => s.shotId === node.shotId);
      if (idx > 0) return clip.shots[idx - 1];
    }
    if (allNodes && allNodes.length > 0) {
      const idx = allNodes.findIndex((n) => n.shotId === node.shotId || n.id === node.id);
      if (idx > 0) return allNodes[idx - 1];
    }
    return undefined;
  }, [projectData, node.shotId, node.clipId, node.id, allNodes]);

  // 为编辑器注入 @link(前序尾帧) 虚拟链接实体（支持胶囊高亮与悬停看前序尾帧图）
  const editorEntities = useMemo(() => {
    if (!previousShotData) return lookdevEntities;
    const prevImg =
      previousShotData.videoLastFrameUrl ||
      previousShotData.lastFrameImageUrl ||
      previousShotData.lastFrameUrl ||
      previousShotData.firstFrameImageUrl ||
      previousShotData.keyframeUrl;
    const base = lookdevEntities || {};
    return {
      ...base,
      locations: [
        ...(base.locations || []),
        {
          locationId: 'preceding_frame_link',
          name: 'link(前序尾帧)',
          imageUrl: prevImg,
          role: '前序镜头接戏尾帧参考',
        },
      ],
    };
  }, [lookdevEntities, previousShotData]);

  const toggleContinuityMode = async () => {
    if (!node.shotId || isGeneratingPrompt) return;
    const nextMode: 'linked' | 'detached' =
      continuityMode === 'detached' ? 'linked' : 'detached';
    setContinuityMode(nextMode);

    // 检查是否有对应模式的缓存提示词
    const continuityPrompts = (node as any).continuityPrompts || {};
    const cachedPrompt = nextMode === 'detached' ? continuityPrompts.detached : continuityPrompts.linked;

    if (cachedPrompt && cachedPrompt.trim()) {
      setDraftPrompt(cachedPrompt);
      setSavedPrompt(cachedPrompt);
      try {
        await updateShotContinuity(projectId, node.shotId, nextMode, cachedPrompt);
        onRefreshProject?.();
      } catch (err: any) {
        console.warn('切换连续性模式失败:', err);
      }
      return;
    }

    // 若无对应模式提示词，触发动态自愈推演
    setIsGeneratingPrompt(true);
    try {
      const clipId = node.clipId || node.shotId.split('-')[0];
      const task = await runTask(projectId, 'film.shot_frame_prompt', {
        projectId,
        clipId,
        shotId: node.shotId,
        continuityMode: nextMode,
      });

      let generatedPrompt = '';
      if (task?.taskId) {
        const startTime = Date.now();
        while (Date.now() - startTime < 12000) {
          await new Promise((r) => setTimeout(r, 800));
          try {
            const currentTask = await fetchTaskRecord(task.taskId);
            if (currentTask.status === 'completed') {
              generatedPrompt = currentTask.output?.firstFramePrompt || '';
              break;
            } else if (currentTask.status === 'failed' || currentTask.status === 'cancelled') {
              break;
            }
          } catch {}
        }
      }

      if (generatedPrompt && generatedPrompt.trim()) {
        setDraftPrompt(generatedPrompt);
        setSavedPrompt(generatedPrompt);
        if (!(node as any).continuityPrompts) (node as any).continuityPrompts = {};
        if (nextMode === 'detached') {
          (node as any).continuityPrompts.detached = generatedPrompt;
        } else {
          (node as any).continuityPrompts.linked = generatedPrompt;
        }
        await updateShotContinuity(projectId, node.shotId, nextMode, generatedPrompt);
      } else {
        // 兜底补齐：承接模式下注入声明式 @link(前序尾帧)；独立模式下剔除 @link
        let fallbackPrompt = draftPrompt || node.firstFramePrompt || '';
        if (nextMode === 'linked') {
          if (!fallbackPrompt.includes('@link')) {
            fallbackPrompt = `@link(前序尾帧) 继承前序时空光色。${fallbackPrompt}`;
          }
        } else {
          fallbackPrompt = fallbackPrompt.replace(/[@＠]link(?:\([^)]*\))?\s*/g, '').trim();
        }
        setDraftPrompt(fallbackPrompt);
        setSavedPrompt(fallbackPrompt);
        await updateShotContinuity(projectId, node.shotId, nextMode, fallbackPrompt);
      }
      onRefreshProject?.();
    } catch (err: any) {
      console.warn('动态生成连续性提示词失败:', err);
      await updateShotContinuity(projectId, node.shotId, nextMode);
      onRefreshProject?.();
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  // 镜头视听属性原生结构化契约读取（首帧/末帧/视频三轨严格独立隔离存储，正交纯化）
  const loadStepData = React.useCallback(
    (targetKind: ProcessNode) => {
      if (targetKind === 'video') {
        const rawVideo = (node.videoPrompt || node.prompt || '').trim();
        const { directives: defaultVideoDir, pureAction: extractedAction } = extractStructuredVideoDirectives({
          ...node,
          videoPrompt: rawVideo,
        });
        const displayAction = extractedAction;
        setVideoDirectives(defaultVideoDir);
        setSavedVideoDirectives(defaultVideoDir);
        setPureAction(displayAction);
        setDraftPrompt(displayAction);
        setSavedPrompt(displayAction);
      } else if (targetKind === 'last') {
        const rawP = (node.lastFramePrompt || '').trim();
        const lastDirs: DirectorDirectives = {
          camera: node.lastFrameCameraDirective,
          color: node.lastFrameColorDirective,
          pose: node.lastFramePoseDirective,
        };
        const { directives: defaultDirectives, pureSubject: extractedSubject } = extractStructuredVisuals({
          ...node,
          cameraDirective: lastDirs.camera,
          colorDirective: lastDirs.color,
          poseDirective: lastDirs.pose,
          firstFramePrompt: rawP,
        });
        const displaySubject = extractedSubject;
        setDirectives(defaultDirectives);
        setSavedImageDirectives(defaultDirectives);
        setPureSubject(displaySubject);
        setDraftPrompt(displaySubject);
        setSavedPrompt(displaySubject);
      } else {
        const rawP = (node.firstFramePrompt || node.prompt || '').trim();
        const firstDirs: DirectorDirectives = {
          camera: node.firstFrameCameraDirective || node.cameraDirective,
          color: node.firstFrameColorDirective || node.colorDirective,
          pose: node.firstFramePoseDirective || node.poseDirective,
        };
        const { directives: defaultDirectives, pureSubject: extractedSubject } = extractStructuredVisuals({
          ...node,
          cameraDirective: firstDirs.camera,
          colorDirective: firstDirs.color,
          poseDirective: firstDirs.pose,
          firstFramePrompt: rawP,
        });
        const displaySubject = extractedSubject;
        setDirectives(defaultDirectives);
        setSavedImageDirectives(defaultDirectives);
        setPureSubject(displaySubject);
        setDraftPrompt(displaySubject);
        setSavedPrompt(displaySubject);
      }
    },
    [
      node.shotId,
      node.firstFrameCameraDirective,
      node.firstFrameColorDirective,
      node.firstFramePoseDirective,
      node.lastFrameCameraDirective,
      node.lastFrameColorDirective,
      node.lastFramePoseDirective,
      node.cameraDirective,
      node.colorDirective,
      node.poseDirective,
      node.motionDirective,
      node.dynamicDirective,
      node.focusDirective,
      node.sceneSubject,
      node.firstFramePrompt,
      node.lastFramePrompt,
      node.videoPrompt,
      node.prompt,
      lookdevEntities,
    ]
  );

  useEffect(() => {
    loadStepData(selected);
  }, [selected, loadStepData]);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [selectingVersion, setSelectingVersion] = useState<string | null>(null);
  const [optimisticVersionIds, setOptimisticVersionIds] = useState<Partial<Record<ProcessNode, string>>>({});
  useEffect(() => {
    setOptimisticVersionIds({});
  }, [
    node.shotId,
    node.selectedFirstFrameVersionId,
    node.selectedLastFrameVersionId,
    node.selectedVideoVersionId,
    node.firstFrameVersions?.length,
    node.lastFrameVersions?.length,
    node.videoVersions?.length,
  ]);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = React.useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const hasLastFrame = node.generationMode === 'first_last_frame' || Boolean(node.lastFrameUrl);
  const processNodes: ProcessNode[] = hasLastFrame ? ['first', 'last', 'video'] : ['first', 'video'];
  const labels: Record<ProcessNode, string> = { first: '首帧', last: '末帧', video: '视频' };

  const getActiveTask = (kind: ProcessNode): TaskRecord | undefined => {
    if (!node.shotId) return undefined;
    return tasks.find((t) => {
      if (t.status !== 'running' && t.status !== 'pending') return false;
      if (kind === 'video') {
        if (t.toolName !== 'film.shot_video') return false;
        return !t.input?.shotId || t.input.shotId === node.shotId;
      }
      if (t.toolName === 'film.shot_keyframe') {
        if (t.input?.shotId && t.input.shotId !== node.shotId) return false;
        if (t.input?.frame && t.input.frame !== kind) return false;
        return true;
      }
      if (t.toolName === 'film.image_upscale') {
        if (t.input?.targetKind !== 'shot_keyframe') return false;
        if (t.input?.targetId !== node.shotId) return false;
        const targetFrame = t.input?.frame || 'first';
        if (targetFrame !== kind) return false;
        return true;
      }
      return false;
    });
  };

  // 监听针对当前镜头的首帧生图词推演任务 (film.shot_frame_prompt)
  const activeFramePromptTask = useMemo(() => {
    return tasks.find((t) => {
      if (t.status !== 'running' && t.status !== 'pending') return false;
      if (t.toolName !== 'film.shot_frame_prompt' && t.toolName !== 'film.shot_prompt') return false;
      return t.input?.shotId === node.shotId;
    });
  }, [tasks, node.shotId]);

  // 监听针对当前镜头的视频动态运镜词推演任务 (film.shot_motion_prompt)
  const activeMotionPromptTask = useMemo(() => {
    return tasks.find((t) => {
      if (t.status !== 'running' && t.status !== 'pending') return false;
      if (t.toolName !== 'film.shot_motion_prompt') return false;
      return t.input?.shotId === node.shotId;
    });
  }, [tasks, node.shotId]);

  const isPromptExtracting = Boolean(activeFramePromptTask);
  const isMotionExtracting = Boolean(activeMotionPromptTask);

  // 当前步骤是否正在推演提示词
  const isSelectedPromptExtracting = isPromptExtracting || isMotionExtracting;

  const autoExtractedShotRef = useRef<string | null>(null);

  // 点进单镜详情或切换镜头时：按需自动补齐缺失的首帧生图词或视频运镜词
  useEffect(() => {
    if (!projectId || !node.shotId || !node.clipId) return;

    if (
      (!node.firstFramePrompt || !node.videoPrompt) &&
      !isPromptExtracting &&
      !isMotionExtracting &&
      autoExtractedShotRef.current !== node.shotId
    ) {
      autoExtractedShotRef.current = node.shotId;
      if (!node.firstFramePrompt) {
        onRunTool('film.shot_frame_prompt', {
          projectId,
          clipId: node.clipId,
          shotId: node.shotId,
          __idempotencyKey: `shot-frame-prompt:auto:${projectId}:${node.shotId}`,
        })
          .then(() => onRefreshProject?.())
          .catch((err) => console.warn(`[ShotProcessCanvas] 自动推演镜头 [${node.shotId}] 首帧词失败:`, err));
      }
      if (!node.videoPrompt) {
        onRunTool('film.shot_motion_prompt', {
          projectId,
          clipId: node.clipId,
          shotId: node.shotId,
          __idempotencyKey: `shot-motion-prompt:auto:${projectId}:${node.shotId}`,
        })
          .then(() => onRefreshProject?.())
          .catch((err) => console.warn(`[ShotProcessCanvas] 自动推演镜头 [${node.shotId}] 视频运镜词失败:`, err));
      }
    }
  }, [projectId, node.shotId, node.clipId, node.firstFramePrompt, node.videoPrompt, isPromptExtracting, isMotionExtracting]);

  // 手动重新推演首关键帧生图词
  const handleExtractShotPrompt = async () => {
    if (!node.shotId || !node.clipId || isPromptExtracting) return;
    try {
      await onRunTool('film.shot_frame_prompt', {
        projectId,
        clipId: node.clipId,
        shotId: node.shotId,
        __idempotencyKey: `shot-frame-prompt:manual:${projectId}:${node.shotId}:${Date.now()}`,
      });
      onRefreshProject?.();
    } catch (err: any) {
      alert(`推演首帧提示词失败: ${err.message || String(err)}`);
    }
  };

  // 手动重新推演视频运镜词
  const handleExtractShotMotion = async () => {
    if (!node.shotId || !node.clipId || isMotionExtracting) return;
    try {
      await onRunTool('film.shot_motion_prompt', {
        projectId,
        clipId: node.clipId,
        shotId: node.shotId,
        __idempotencyKey: `shot-motion-prompt:manual:${projectId}:${node.shotId}:${Date.now()}`,
      });
      onRefreshProject?.();
    } catch (err: any) {
      alert(`推演视频运镜词失败: ${err.message || String(err)}`);
    }
  };

  const isStepRunning = (kind: ProcessNode): boolean =>
    submittingAction?.step === kind || Boolean(getActiveTask(kind));

  const isStepUpscaling = (kind: ProcessNode): boolean => {
    if (submittingAction?.step === kind && submittingAction.mode === 'upscale') return true;
    return getActiveTask(kind)?.toolName === 'film.image_upscale';
  };

  const mediaUrl = (kind: ProcessNode) =>
    kind === 'first' ? node.keyframeUrl : kind === 'last' ? node.lastFrameUrl : node.videoUrl;
  const prompt = (kind: ProcessNode) =>
    kind === 'first' ? node.firstFramePrompt : kind === 'last' ? node.lastFramePrompt : node.videoPrompt || node.prompt;

  const selectedActiveTask = getActiveTask(selected);
  const isSelectedRunning = isStepRunning(selected);
  const isSelectedUpscaling = isStepUpscaling(selected);
  const getStepUpscale = (kind: ProcessNode) =>
    kind === 'first' ? node.firstFrameUpscale : kind === 'last' ? node.lastFrameUpscale : undefined;
  const selectedUpscale = getStepUpscale(selected);

  // 当前激活帧/视频的历史版本库（图片与视频双轨齐备）
  const currentVersions: Array<ShotFrameVersion | ShotVideoVersion> = useMemo(() => {
    if (selected === 'video') {
      return (node.videoVersions || []) as ShotVideoVersion[];
    }
    return (selected === 'last' ? node.lastFrameVersions : node.firstFrameVersions) || [];
  }, [selected, node.videoVersions, node.lastFrameVersions, node.firstFrameVersions]);

  const cleanMedia = (url?: string) => (url ? url.split('?')[0] : '');
  const activeMedia = cleanMedia(mediaUrl(selected));
  const explicitSelectedVersionId =
    optimisticVersionIds[selected] ||
    (selected === 'video'
      ? (node as any).selectedVideoVersionId
      : selected === 'last'
      ? (node as any).selectedLastFrameVersionId
      : (node as any).selectedFirstFrameVersionId);
  const activeVersion =
    (explicitSelectedVersionId
      ? currentVersions.find((v: any) => v.versionId === explicitSelectedVersionId)
      : undefined) ||
    currentVersions.find((v: any) => cleanMedia(v.imageUrl || v.videoUrl) === activeMedia);
  const activeVersionId = activeVersion?.versionId;
  const activeImageUrl = selected === 'video' ? undefined : activeMedia;
  const frameKey = selected as 'first' | 'last';

  // 选用历史版本（仅切换媒体版本，保留当前最新提示词）
  const handleSelectVersion = async (targetVer: ShotFrameVersion | ShotVideoVersion) => {
    const versionId = targetVer.versionId;
    if (!node.shotId || selectingVersion || isSelectedRunning || versionId === activeVersionId) return;
    setSelectingVersion(versionId);
    try {
      await selectShotVersion(projectId, node.shotId, selected, versionId);
      setOptimisticVersionIds((prev) => ({ ...prev, [selected]: versionId }));
      onRefreshProject?.();
    } catch (err: any) {
      alert(`切换版本失败: ${err?.message || String(err)}`);
    } finally {
      setSelectingVersion(null);
    }
  };

  const handleSavePrompt = async () => {
    if (!node.shotId || savingPrompt) return;
    setSavingPrompt(true);
    try {
      const directivePayload =
        selected === 'video'
          ? {
              motionDirective: videoDirectives.motion,
              dynamicDirective: videoDirectives.dynamic,
              focusDirective: videoDirectives.focus,
            }
          : {
              cameraDirective: directives.camera,
              colorDirective: directives.color,
              poseDirective: directives.pose,
            };
      const storagePrompt = draftPrompt.trim();
      await updateShotPrompt(projectId, node.shotId, selected, storagePrompt, directivePayload);
      if (selected === 'video') {
        setSavedVideoDirectives({ ...videoDirectives });
      } else {
        setSavedImageDirectives({ ...directives });
      }
      setSavedPrompt(draftPrompt);
      onRefreshProject?.();
    } catch (err: any) {
      alert(`保存提示词失败: ${err?.message || String(err)}`);
    } finally {
      setSavingPrompt(false);
    }
  };

  // 辅助检测当前项与基准项是否一致（判定是否发生变更）
  const checkDirectiveChanged = (current?: any, saved?: any) => {
    if (!current && !saved) return false;
    if (!current && saved) return true; // 原本有，现在被移除待生效
    if (current && !saved) return true; // 原本无，现在新挂载待生效
    return (current.presetId || current.label) !== (saved.presetId || saved.label);
  };

  // 图片专属已挂载标签（精简收敛：专注于电影调色）
  const activeImageDirectiveList = useMemo(() => {
    const list: Array<{
      category: keyof DirectorDirectives;
      icon: string;
      name: string;
      instruction: string;
      isChanged: boolean;
      previousName?: string;
    }> = [];

    if (directives.color) {
      const changed = checkDirectiveChanged(directives.color, savedImageDirectives.color);
      list.push({
        category: 'color',
        icon: '🎨',
        name: directives.color.label,
        instruction: directives.color.instruction,
        isChanged: changed,
        previousName: changed ? savedImageDirectives.color?.label : undefined,
      });
    }
    return list;
  }, [directives, savedImageDirectives]);

  // 视频专属已挂载标签（精简收敛：专注于运镜轨迹）
  const activeVideoDirectiveList = useMemo(() => {
    const list: Array<{
      category: keyof VideoDirectives;
      icon: string;
      name: string;
      instruction: string;
      isChanged: boolean;
      previousName?: string;
    }> = [];

    if (videoDirectives.motion) {
      const changed = checkDirectiveChanged(videoDirectives.motion, savedVideoDirectives.motion);
      list.push({
        category: 'motion',
        icon: '🎥',
        name: videoDirectives.motion.label,
        instruction: videoDirectives.motion.instruction,
        isChanged: changed,
        previousName: changed ? savedVideoDirectives.motion?.label : undefined,
      });
    }
    return list;
  }, [videoDirectives.motion, savedVideoDirectives.motion]);

  // 全局是否偏离当前镜头选择状态（基准态）
  const isImageDirectivesChanged = useMemo(() => {
    return checkDirectiveChanged(directives.color, savedImageDirectives.color);
  }, [directives.color, savedImageDirectives.color]);

  const isVideoDirectivesChanged = useMemo(() => {
    return checkDirectiveChanged(videoDirectives.motion, savedVideoDirectives.motion);
  }, [videoDirectives.motion, savedVideoDirectives.motion]);

  // 提示词与视听配置全局变动感知 (Dirty State)
  const isPromptChanged = Boolean(draftPrompt.trim() !== (savedPrompt || '').trim());
  const isAnyChanged =
    selected === 'video'
      ? Boolean(isVideoDirectivesChanged || isPromptChanged)
      : Boolean(isImageDirectivesChanged || isPromptChanged);

  // 计算视听标签双态摘要（当前已生效 vs 变更待生效），实时通过焦点上报同步至服务端与 AI 导演
  const directiveSummary = useMemo(() => {
    if (selected === 'video') {
      const current = [
        savedVideoDirectives.motion ? `运镜:「${savedVideoDirectives.motion.label}」` : null,
      ].filter(Boolean).join(' · ') || '尚未设定运镜轨迹';

      const draft = [
        videoDirectives.motion ? `运镜:「${videoDirectives.motion.label}」` : null,
      ].filter(Boolean).join(' · ') || '无';

      const changedItems = activeVideoDirectiveList
        .filter((i) => i.isChanged)
        .map((i) => `${i.name}（原为「${i.previousName || '未设置'}」）`);

      return {
        currentDirectives: current,
        draftDirectives: draft,
        changedSummary: changedItems.length > 0 ? changedItems.join('；') : '',
        hasChanges: changedItems.length > 0,
      };
    } else {
      const current = [
        savedImageDirectives.color ? `调色:「${savedImageDirectives.color.label}」` : null,
      ].filter(Boolean).join(' · ') || '尚未设定电影调色';

      const draft = [
        directives.color ? `调色:「${directives.color.label}」` : null,
      ].filter(Boolean).join(' · ') || '无';

      const changedItems = activeImageDirectiveList
        .filter((i) => i.isChanged)
        .map((i) => `${i.name}（原为「${i.previousName || '未设置'}」）`);

      return {
        currentDirectives: current,
        draftDirectives: draft,
        changedSummary: changedItems.length > 0 ? changedItems.join('；') : '',
        hasChanges: changedItems.length > 0,
      };
    }
  }, [
    selected,
    directives,
    savedImageDirectives,
    videoDirectives,
    savedVideoDirectives,
    activeImageDirectiveList,
    activeVideoDirectiveList,
  ]);

  const processFocus = useMemo(
    () => ({
      location: `演绎片段处理页 · ${labels[selected]}处理`,
      target: {
        kind: 'shot',
        id: node.shotId || node.id,
        label: node.title,
        subview: `${labels[selected]}处理`,
      },
      meta: {
        clipId: node.clipId,
        step: selected,
        currentDirectives: directiveSummary.currentDirectives,
        draftDirectives: directiveSummary.draftDirectives,
        changedSummary: directiveSummary.changedSummary,
        hasDirectiveChanges: directiveSummary.hasChanges,
      },
    }),
    [node.shotId, node.id, node.title, node.clipId, selected, directiveSummary, labels]
  );
  useReportFocus(processFocus, 10);

  const removeImageDirective = (cat: keyof DirectorDirectives) => {
    setDirectives((prev) => ({ ...prev, [cat]: undefined }));
  };

  const removeVideoDirective = (cat: keyof VideoDirectives) => {
    setVideoDirectives((prev) => ({ ...prev, [cat]: undefined }));
  };

  // 视听上拉预设：切换预设时独立更新结构化 directives 状态，正交隔离，绝不倒灌污染剧情提示词输入框
  const handleImageDirectivesChange = (next: DirectorDirectives) => {
    setDirectives(next);
  };

  const handleVideoDirectivesChange = (next: VideoDirectives) => {
    setVideoDirectives(next);
  };

  const openEnlarged = (kind: ProcessNode) => {
    const url = mediaUrl(kind);
    if (!url || !onEnlargeMedia) return;
    const gallery: MediaLightboxItem[] = [];
    const seen = new Set<string>();
    for (const step of processNodes) {
      const stepUrl = mediaUrl(step);
      if (!stepUrl) continue;
      seen.add(cleanMedia(stepUrl));
      const stepUp = getStepUpscale(step);
      gallery.push({
        title: `${node.title} · ${labels[step]}`,
        imageUrl: step === 'video' ? undefined : stepUrl,
        videoUrl: step === 'video' ? stepUrl : undefined,
        badge: stepUp ? `HD ${stepUp.multiplier}×` : undefined,
        subtitle:
          step === 'video'
            ? '高保真视听切片播放'
            : stepUp
            ? `已通过 SeedVR2 完成 ${stepUp.multiplier}× 高清超分`
            : '原图预览（未超分）',
      });
    }
    // 历史版本也能在灯箱里逐张翻看
    const frameVersions: ShotFrameVersion[] =
      kind === 'video' ? [] : (kind === 'last' ? node.lastFrameVersions : node.firstFrameVersions) || [];
    frameVersions.forEach((ver, idx) => {
      if (seen.has(cleanMedia(ver.imageUrl))) return;
      seen.add(cleanMedia(ver.imageUrl));
      gallery.push({
        title: `${node.title} · ${labels[kind]} v${idx + 1}`,
        imageUrl: ver.imageUrl,
        badge: ver.upscale ? `HD ${ver.upscale.multiplier}×` : undefined,
        subtitle: ver.instruction
          ? `定向微调：${ver.instruction}`
          : ver.upscale
          ? `SeedVR2 ${ver.upscale.multiplier}× 高清超分版本`
          : '历史原图版本',
      });
    });
    const currentUp = getStepUpscale(kind);
    onEnlargeMedia({
      title: `${node.title} · ${labels[kind]}`,
      imageUrl: kind === 'video' ? undefined : url,
      videoUrl: kind === 'video' ? url : undefined,
      badge: currentUp ? `HD ${currentUp.multiplier}×` : undefined,
      subtitle:
        kind === 'video'
          ? '高保真视听切片播放'
          : currentUp
          ? `已通过 SeedVR2 完成 ${currentUp.multiplier}× 高清超分`
          : '原图预览（未超分）',
      gallery: gallery.length > 0 ? gallery : undefined,
    });
  };

  const runSelected = async () => {
    if (!node.shotId || isSelectedRunning) return;
    const step = selected;
    setSubmittingAction({ step, mode: 'generate' });
    try {
      if (step === 'video') {
        const rawDraft = (draftPrompt || prompt('video') || '').trim();
        const purePrompt = rawDraft;
        // 持久化纯净剧情提示词与挂载标签，正交存储，绝不污染提示词正文
        try {
          await updateShotPrompt(projectId, node.shotId, 'video', purePrompt, {
            motionDirective: videoDirectives.motion,
            dynamicDirective: videoDirectives.dynamic,
            focusDirective: videoDirectives.focus,
          });
        } catch {}
        // 底层工具执行：仅当用户主动调整了运镜标签或补充了微调指令时才拼接，避免重复覆盖纯净提示词
        const toolPrompt =
          isVideoDirectivesChanged || videoInstruction.trim()
            ? reconstructVideoPrompt(purePrompt, videoDirectives, videoInstruction)
            : purePrompt;
        await onRunTool('film.shot_video', {
          shotId: node.shotId,
          clipId: node.clipId,
          customPrompt: toolPrompt || purePrompt,
          force: true,
        });
        setSavedVideoDirectives({ ...videoDirectives });
        setSavedPrompt(rawDraft);
      } else {
        const rawDraft = (draftPrompt || prompt(step) || '').trim();
        const purePrompt = rawDraft;
        // 持久化纯净剧情提示词与挂载标签，正交存储，绝不污染提示词正文
        try {
          await updateShotPrompt(projectId, node.shotId, step, purePrompt, {
            cameraDirective: directives.camera,
            colorDirective: directives.color,
            poseDirective: directives.pose,
          });
        } catch {}
        // 底层工具执行：仅当用户主动调整了视听标签时才拼接，避免无故往尾巴塞入旧指令
        const toolPrompt = isImageDirectivesChanged
          ? reconstructShotPrompt(purePrompt, directives)
          : purePrompt;
        await onRunTool('film.shot_keyframe', {
          shotId: node.shotId,
          frame: step,
          customPrompt: toolPrompt || purePrompt,
          continuityMode,
          force: true,
        });
        setSavedImageDirectives({ ...directives });
        setSavedPrompt(rawDraft);
      }
    } finally {
      setSubmittingAction((prev) => (prev?.step === step ? null : prev));
    }
  };

  const runUpscaleSelected = async () => {
    if (!node.shotId || selected === 'video' || !mediaUrl(selected) || isSelectedRunning) return;
    const step = selected;
    setSubmittingAction({ step, mode: 'upscale' });
    try {
      await onRunTool('film.image_upscale', {
        targetKind: 'shot_keyframe',
        targetId: node.shotId,
        clipId: node.clipId,
        frame: step,
        multiplier: upscaleMultiplier,
      });
    } finally {
      setSubmittingAction((prev) => (prev?.step === step ? null : prev));
    }
  };

  return (
    <div
      className="relative w-full h-full bg-slate-100/70 overflow-hidden select-none"
      onWheel={(e) => {
        e.preventDefault();
        setZoom((value) => Math.min(1.8, Math.max(0.45, value * (e.deltaY < 0 ? 1.08 : 0.92))));
      }}
      onMouseDown={(e) => {
        setDragging(true);
        dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      }}
      onMouseMove={(e) => {
        if (dragging) {
          setPan({
            x: dragStart.current.panX + e.clientX - dragStart.current.x,
            y: dragStart.current.panY + e.clientY - dragStart.current.y,
          });
        }
      }}
      onMouseUp={() => setDragging(false)}
      onMouseLeave={() => setDragging(false)}
      style={{
        backgroundImage: 'radial-gradient(#cbd5e1 1.2px, transparent 1.2px)',
        backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
      }}
    >
      {/* 顶部悬浮控制栏：支持子画布与镜头快捷直切 */}
      <div className="absolute top-4 left-5 z-50 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl shadow-sm px-3.5 py-2 flex items-center gap-3 select-none">
        {/* 1. 返回分镜头无限画布 */}
        <button
          type="button"
          onClick={onClose}
          className="px-2.5 py-1.5 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 hover:text-indigo-600 flex items-center space-x-1 transition shadow-2xs active:scale-95 cursor-pointer"
          title="返回演绎片段画布"
        >
          <span>←</span>
          <span>返回演绎片段画布</span>
        </button>

        <span className="h-4 w-px bg-slate-200" />

        {/* 2. 跨分幕/定妆切换器 */}
        {subCanvasOptions && onSwitchSubCanvas && (
          <>
            <SubCanvasSwitcher
              currentId={node.clipId || ''}
              options={subCanvasOptions}
              onSelect={onSwitchSubCanvas}
              onBackToTopology={onClose}
            />
            <span className="h-4 w-px bg-slate-200" />
          </>
        )}

        {/* 3. 本幕镜头快捷切换器与上一镜/下一镜步进 */}
        <div ref={shotMenuRef} className="relative z-50 flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setShotDropdownOpen((prev) => !prev)}
            className="px-3 py-1.5 rounded-xl border border-indigo-200/90 bg-indigo-50/90 hover:bg-indigo-100 text-xs font-bold text-indigo-900 flex items-center space-x-1.5 transition cursor-pointer shadow-2xs active:scale-95"
          >
            <span>🎯</span>
            <span className="max-w-[150px] truncate">{node.title || '当前镜头'}</span>
            {currentIndex >= 0 && allNodes && allNodes.length > 0 && (
              <span className="text-[10px] font-mono text-indigo-600 font-semibold px-1 py-0.2 rounded bg-white/80 border border-indigo-200/60">
                {currentIndex + 1}/{allNodes.length}
              </span>
            )}
            <span className={`text-[9px] text-indigo-400 transition-transform duration-200 ${shotDropdownOpen ? 'rotate-180' : ''}`}>
              ▼
            </span>
          </button>

          {/* 上一镜 / 下一镜快捷步进按钮 */}
          {allNodes && allNodes.length > 1 && (
            <div className="flex items-center space-x-0.5">
              <button
                type="button"
                disabled={!canGoPrevShot}
                onClick={() => canGoPrevShot && prevShotNode && onSelectNode?.(prevShotNode)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200/90 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-700 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer shadow-2xs active:scale-95"
                title={prevShotNode ? (prevShotNode.isUnlocked === false ? '上一镜尚未解锁' : `切到上一镜：${prevShotNode.title}`) : '已是第一镜'}
              >
                ◀ 上一镜
              </button>
              <button
                type="button"
                disabled={!canGoNextShot}
                onClick={() => canGoNextShot && nextShotNode && onSelectNode?.(nextShotNode)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200/90 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-700 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer shadow-2xs active:scale-95"
                title={nextShotNode ? (nextShotNode.isUnlocked === false ? '下一镜尚未解锁（等待前一镜头完成）' : `切到下一镜：${nextShotNode.title}`) : '已是最后一镜'}
              >
                下一镜 ▶
              </button>
            </div>
          )}

          {/* 镜头下拉清单 */}
          {shotDropdownOpen && allNodes && allNodes.length > 0 && (
            <div className="absolute top-full left-0 mt-1.5 w-72 bg-white border border-slate-200 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.25)] ring-1 ring-slate-900/10 z-[100] py-2 max-h-80 overflow-y-auto font-sans animate-in fade-in zoom-in-95 duration-100">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 py-1 flex items-center justify-between border-b border-slate-100 pb-1 mb-1">
                <span>本幕所有演绎片段</span>
                <span className="font-mono text-slate-500 font-normal">
                  共 {allNodes.length} 段
                </span>
              </div>
              {allNodes.map((s, idx) => {
                const isSelected = s.id === node.id || s.shotId === node.shotId;
                const isShotUnlocked = s.isUnlocked !== false;
                const hasFirst = Boolean(s.keyframeUrl || s.videoUrl);
                const hasVideo = Boolean(s.videoUrl);
                return (
                  <button
                    key={s.id || s.shotId || idx}
                    type="button"
                    disabled={!isShotUnlocked}
                    onClick={() => {
                      if (!isShotUnlocked) return;
                      onSelectNode?.(s);
                      setShotDropdownOpen(false);
                    }}
                    title={!isShotUnlocked ? '需前一镜头生成完毕后方可解锁' : undefined}
                    className={`w-full text-left px-3 py-2 rounded-xl flex items-center justify-between transition mb-0.5 ${
                      !isShotUnlocked
                        ? 'opacity-40 cursor-not-allowed bg-slate-50/40 text-slate-400'
                        : isSelected
                        ? 'bg-indigo-50 border border-indigo-200/80 text-indigo-900 font-bold cursor-pointer'
                        : 'hover:bg-slate-50 text-slate-700 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center space-x-2 min-w-0 pr-2">
                      <span className="text-xs font-mono text-slate-400 flex-shrink-0">
                        {!isShotUnlocked ? '🔒' : String(idx + 1).padStart(2, '0')}
                      </span>
                      <span className="text-xs truncate">{s.title || `镜头 ${idx + 1}`}</span>
                    </div>
                    <div className="flex items-center space-x-1 flex-shrink-0">
                      {!isShotUnlocked ? (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-400">
                          待解锁
                        </span>
                      ) : hasVideo ? (
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200/60">
                          视频已成
                        </span>
                      ) : hasFirst ? (
                        <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.2 rounded border border-indigo-200/60">
                          首帧已出
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.2 rounded">
                          待生成
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {node.location && (
          <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60 hidden md:inline-flex items-center gap-1">
            <span>📍</span>
            <span>{node.location}</span>
          </span>
        )}
        <span className="text-[11px] text-slate-400 hidden md:inline">镜头分步制作架构</span>
      </div>

      <div className="absolute inset-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', zIndex: 0 }}>
        <div className="absolute left-24 top-44 flex items-center gap-16">
          {processNodes.map((kind, index) => {
            const activeTask = getActiveTask(kind);
            const running = isStepRunning(kind);
            const upscaling = isStepUpscaling(kind);
            const url = mediaUrl(kind);
            const upscaleMeta =
              kind === 'first' ? node.firstFrameUpscale : kind === 'last' ? node.lastFrameUpscale : undefined;

            return (
              <React.Fragment key={kind}>
                {index > 0 && (
                  <div className="w-20 -mt-6 flex items-center gap-0" aria-hidden="true">
                    <span className="h-0.5 flex-1 bg-indigo-300" />
                    <span className="w-0 h-0 border-y-[5px] border-y-transparent border-l-[8px] border-l-indigo-400" />
                  </div>
                )}
                <div className="flex flex-col items-center">
                  <div
                    role="button"
                    tabIndex={0}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (selected !== kind) {
                        setSelected(kind);
                      } else {
                        loadStepData(kind);
                      }
                      setPanelOpen(true);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (url && !running) openEnlarged(kind);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (selected !== kind) {
                          setSelected(kind);
                        } else {
                          loadStepData(kind);
                        }
                      }
                    }}
                    onMouseEnter={(e) => {
                      if (kind === 'video') {
                        const v = e.currentTarget.querySelector('video');
                        v?.play().catch(() => {});
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (kind === 'video') {
                        const v = e.currentTarget.querySelector('video');
                        if (v) {
                          v.pause();
                          v.currentTime = 0;
                        }
                      }
                    }}
                    title={url && !running ? (kind === 'video' ? '悬停播放视频 · 单击选中 · 双击全屏放大' : '单击选中 · 双击全屏放大查看') : undefined}
                    className={`group relative w-64 aspect-video bg-slate-900 rounded-2xl overflow-hidden border shadow-[0_4px_20px_-4px_rgba(15,23,42,0.08)] hover:shadow-[0_10px_30px_-6px_rgba(15,23,42,0.14)] transition-all flex items-center justify-center cursor-pointer ${
                      selected === kind
                        ? 'border-indigo-600 ring-4 ring-indigo-500/15'
                        : 'border-slate-200/90 hover:border-indigo-300'
                    }`}
                  >
                    {url ? (
                      kind === 'video' ? (
                        <>
                          <video
                            key={url}
                            src={url}
                            poster={node.keyframeUrl || node.firstFrameImageUrl}
                            preload="auto"
                            muted
                            playsInline
                            loop
                            className="w-full h-full object-cover"
                          />
                          {!running && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none group-hover:opacity-0 transition-opacity duration-200">
                              <div className="w-10 h-10 rounded-full bg-black/55 backdrop-blur-xs border border-white/20 flex items-center justify-center text-white shadow-lg">
                                <svg className="w-4 h-4 ml-0.5 fill-current" viewBox="0 0 24 24">
                                  <path d="M8 5v14l11-7z" />
                                </svg>
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <img key={url} src={url} alt={labels[kind]} className="w-full h-full object-cover" />
                      )
                    ) : (
                      <div className="w-full h-full bg-slate-50/80 flex flex-col items-center justify-center p-3 text-center space-y-1">
                        <span className="text-xl opacity-60">{kind === 'video' ? '🎬' : '🖼️'}</span>
                        <span className="text-xs font-semibold text-slate-500">待生成{labels[kind]}</span>
                        <span className="text-[10px] text-slate-400">点击右侧面板配置提示词</span>
                      </div>
                    )}

                    {/* 悬停右上角放大按钮（图片与视频通用） */}
                    {url && !running && onEnlargeMedia && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEnlarged(kind);
                        }}
                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/65 hover:bg-black/85 backdrop-blur-xs text-white opacity-0 group-hover:opacity-100 transition-opacity text-xs z-10 cursor-pointer"
                        title={kind === 'video' ? '全屏放大播放视频' : '全屏放大查看原图'}
                      >
                        ⛶
                      </button>
                    )}

                    {/* 高清超分标识角标 */}
                    {url && !running && upscaleMeta && (
                      <span
                        className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-emerald-600/95 backdrop-blur-xs text-white text-[10px] font-mono font-bold tracking-tight shadow-xs border border-emerald-300/40 z-10"
                        title={`已通过 SeedVR2 完成 ${upscaleMeta.multiplier}× 高清超分`}
                      >
                        ✨ HD {upscaleMeta.multiplier}×
                      </span>
                    )}

                    {/* 上游资产变更待同步角标 */}
                    {url && !running && ((kind !== 'video' && node.staleKeyframeReason) || (kind === 'video' && node.staleVideoReason)) && (
                      <span
                        className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-amber-500/90 backdrop-blur-xs text-white text-[10px] font-semibold shadow-xs z-10"
                        title={kind === 'video' ? node.staleVideoReason : node.staleKeyframeReason}
                      >
                        ⚠ 上游已变更
                      </span>
                    )}

                    {/* 视听一体化提示词/运镜推演中局部毛玻璃遮罩 */}
                    {!running && isPromptExtracting && (
                      <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-xs flex flex-col items-center justify-center text-white px-3 text-center z-10 animate-in fade-in duration-200">
                        <div className="relative w-8 h-8 mb-2 flex items-center justify-center">
                          <svg
                            className="w-8 h-8 text-indigo-400 animate-spin"
                            viewBox="0 0 100 100"
                            style={{ animationDuration: '1.2s' }}
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
                          <span className="absolute text-[11px]">{kind === 'video' ? '🎬' : '✨'}</span>
                        </div>
                        <span className="text-xs font-bold tracking-tight text-indigo-200">
                          {kind === 'video' ? '推演运镜台本中...' : '推演首帧提示词中...'}
                        </span>
                        <span className="text-[10px] text-slate-400 mt-0.5">
                          {kind === 'video' ? '编排机位轨迹与动量速率' : '结合定妆推演构图与光影'}
                        </span>
                      </div>
                    )}

                    {/* 生成中毛玻璃加载遮罩 */}
                    {running && (
                      <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-xs flex flex-col items-center justify-center text-white px-3 text-center z-10 animate-in fade-in duration-200">
                        <svg
                          className="w-7 h-7 text-indigo-400 animate-spin mb-2"
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
                        <span className="text-xs font-bold tracking-tight">
                          {upscaling
                            ? `正在高清超分 (${activeTask?.input?.multiplier || upscaleMultiplier}×)...`
                            : `正在生成${labels[kind]}...`}
                        </span>
                        {activeTask?.progress?.message && (
                          <span className="text-[10px] text-slate-300 mt-1 line-clamp-1">
                            {activeTask.progress.message}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <span
                    className={`mt-2 text-xs font-semibold ${
                      selected === kind ? 'text-indigo-600' : 'text-slate-500'
                    }`}
                  >
                    {labels[kind]}
                  </span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {panelOpen && (
      <aside
        className="absolute top-4 right-4 bottom-4 z-30 w-[360px] max-w-[calc(100vw-2rem)] bg-white/95 backdrop-blur-xl border border-slate-200/90 rounded-3xl shadow-[0_16px_50px_-12px_rgba(15,23,42,0.14)] ring-1 ring-black/5 overflow-y-auto overscroll-contain p-5"
        onWheel={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900">{labels[selected]}处理</div>
            <div className="mt-1 text-[11px] text-slate-500 truncate">当前节点：{node.title}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isSelectedRunning && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
                <span>{isSelectedUpscaling ? '超分中' : '生成中'}</span>
              </span>
            )}
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition flex items-center justify-center text-sm font-bold cursor-pointer"
              title="关闭侧边栏"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 当前帧大图预览（与定妆侧边栏一致：可全屏放大，视频支持悬停自动播放） */}
        <div
          onMouseEnter={(e) => {
            if (selected === 'video') {
              const v = e.currentTarget.querySelector('video');
              v?.play().catch(() => {});
            }
          }}
          onMouseLeave={(e) => {
            if (selected === 'video') {
              const v = e.currentTarget.querySelector('video');
              if (v) {
                v.pause();
                v.currentTime = 0;
              }
            }
          }}
          className="mt-4 relative w-full aspect-video bg-slate-900 rounded-2xl overflow-hidden border border-slate-200/80 flex items-center justify-center group shadow-2xs"
        >
          {mediaUrl(selected) ? (
            selected === 'video' ? (
              <>
                <video
                  key={mediaUrl(selected)}
                  src={mediaUrl(selected)}
                  poster={node.keyframeUrl || node.firstFrameImageUrl}
                  preload="auto"
                  muted
                  playsInline
                  loop
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none group-hover:opacity-0 transition-opacity duration-200">
                  <div className="w-12 h-12 rounded-full bg-black/60 backdrop-blur-xs border border-white/20 flex items-center justify-center text-white shadow-xl">
                    <svg className="w-5 h-5 ml-0.5 fill-current" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
              </>
            ) : (
              <img key={mediaUrl(selected)} src={mediaUrl(selected)} alt={labels[selected]} className="w-full h-full object-cover" />
            )
          ) : (
            <div className="flex flex-col items-center justify-center text-slate-400 gap-2 select-none py-4">
              <div className="w-10 h-10 rounded-2xl bg-slate-200/60 border border-slate-300/40 flex items-center justify-center text-slate-400 shadow-2xs">
                {selected === 'video' ? (
                  <svg className="w-5 h-5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2.5" />
                    <path d="m10 9 6 3-6 3V9z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="3" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="m21 15-5-5L5 21" />
                  </svg>
                )}
              </div>
              <div className="text-center">
                <span className="text-xs font-semibold text-slate-600 block">待生成{labels[selected]}</span>
                <span className="text-[10px] text-slate-400 block mt-0.5">配置视听属性后点击底部按钮即可出图</span>
              </div>
            </div>
          )}
          {mediaUrl(selected) && selectedUpscale && (
            <span className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-emerald-600/90 backdrop-blur-xs text-white text-[10px] font-mono font-bold shadow-xs z-10">
              HD {selectedUpscale.multiplier}×
            </span>
          )}
          {mediaUrl(selected) && !isSelectedRunning && onEnlargeMedia && (
            <button
              type="button"
              onClick={() => openEnlarged(selected)}
              className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 backdrop-blur-xs text-white opacity-0 group-hover:opacity-100 transition text-xs cursor-pointer z-10"
              title="全屏放大查看"
            >
              ⛶ 放大
            </button>
          )}
        </div>

        {/* 历史版本库：平铺展示所有历史版本，点击即刻选用并回弹参数 */}
        {currentVersions.length > 0 && (
          <div className="mt-4 rounded-2xl border border-slate-200/80 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-slate-800">
                📚 {labels[selected]}版本库 ({currentVersions.length} 版)
              </span>
              <span className="text-[10px] text-slate-500">点击切换并选用</span>
            </div>

            {/* 版本缩略图矩阵（所有版本直接平铺，一目了然） */}
            <div className="mt-2.5 grid grid-cols-3 gap-2 max-h-48 overflow-y-auto p-0.5">
              {currentVersions.map((ver: any, idx) => {
                const active = ver.versionId === activeVersionId;
                const url = cleanMedia(ver.imageUrl || ver.videoUrl);
                const isVideo = selected === 'video' || Boolean(ver.videoUrl);

                return (
                  <button
                    key={ver.versionId || idx}
                    type="button"
                    disabled={Boolean(selectingVersion) || isSelectedRunning}
                    onClick={() => handleSelectVersion(ver)}
                    title={
                      ver.instruction
                        ? `定向微调：${ver.instruction}`
                        : ver.upscale
                        ? `SeedVR2 ${ver.upscale.multiplier}× 高清超分版本`
                        : ver.prompt || '镜头版本'
                    }
                    className={`relative aspect-video rounded-xl overflow-hidden border-2 bg-slate-900 transition cursor-pointer disabled:opacity-60 group/ver ${
                      active
                        ? 'border-indigo-600 ring-2 ring-indigo-500/20'
                        : 'border-slate-200 hover:border-indigo-300'
                    }`}
                  >
                    {isVideo ? (
                      <video
                        src={`${url}?t=${encodeURIComponent(ver.versionId)}`}
                        poster={node.keyframeUrl || node.firstFrameImageUrl}
                        preload="auto"
                        muted
                        playsInline
                        loop
                        onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                        onMouseLeave={(e) => {
                          const v = e.currentTarget as HTMLVideoElement;
                          v.pause();
                          v.currentTime = 0;
                        }}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <img
                        src={`${url}?t=${encodeURIComponent(ver.versionId)}`}
                        alt={`v${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    )}

                    {/* 版本编号角标 */}
                    <span className="absolute top-0.5 left-0.5 px-1.5 py-0.5 rounded bg-black/75 text-[9px] font-mono text-white flex items-center gap-1 shadow-2xs border border-white/10 font-bold">
                      v{idx + 1}
                    </span>

                    {ver.upscale && (
                      <span className="absolute top-0.5 right-0.5 px-1 py-0.5 rounded bg-emerald-600 text-[8px] font-mono font-bold text-white">
                        HD {ver.upscale.multiplier}×
                      </span>
                    )}

                    {/* 选用态高亮 */}
                    {active && (
                      <span className="absolute inset-0 bg-indigo-600/20 flex items-center justify-center pointer-events-none">
                        <span className="px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[9px] font-bold shadow-2xs">
                          选用中
                        </span>
                      </span>
                    )}
                    {selectingVersion === ver.versionId && (
                      <span className="absolute inset-0 bg-white/70 flex items-center justify-center text-[10px] font-bold text-indigo-700 pointer-events-none">
                        切换中…
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 首帧时空因果决策：是否承接上镜尾帧 */}
        {selected === 'first' && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 shadow-2xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1">
                  <span>{continuityMode === 'detached' ? '✂️' : '🔗'}</span>
                  <span>{continuityMode === 'detached' ? '独立新机位起幅' : '继承承接上镜尾帧'}</span>
                </span>
                <span className="text-[10px] text-slate-400 truncate">
                  {continuityMode === 'detached' ? '独立起幅重新构图' : '绑定上镜尾帧保证连贯'}
                </span>
              </div>
              <button
                type="button"
                onClick={toggleContinuityMode}
                disabled={isSelectedRunning || isGeneratingPrompt}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  continuityMode === 'detached'
                    ? 'bg-slate-200 text-slate-700 border-slate-300 hover:bg-slate-300'
                    : 'bg-emerald-600 text-white border-emerald-500 shadow-2xs hover:bg-emerald-700'
                }`}
                title="点击切换：继承上镜尾帧 ⇄ 独立机位起幅"
              >
                {isGeneratingPrompt ? (
                  <>
                    <span className="w-3 h-3 border-2 border-white/60 border-t-white rounded-full animate-spin" />
                    <span>推演中...</span>
                  </>
                ) : (
                  <span>{continuityMode === 'detached' ? '切换为承接' : '切换为独立'}</span>
                )}
              </button>
            </div>
          </div>
        )}

        {/* 极简电影调色工具（调色与色彩基调，变动时呈现高亮待生效与一键还原） */}
        {selected !== 'video' && (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                <span>🎨</span>
                <span>电影调色 (Color Grading)</span>
                {isImageDirectivesChanged && (
                  <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800 font-medium">
                    已更改待生效
                  </span>
                )}
              </span>
              {isImageDirectivesChanged && (
                <button
                  type="button"
                  onClick={() => handleImageDirectivesChange({ ...savedImageDirectives })}
                  className="text-[10px] text-amber-600 hover:text-amber-800 font-semibold cursor-pointer flex items-center gap-0.5 hover:underline"
                  title="还原电影调色为镜头原设定"
                >
                  <span>↺</span>
                  <span>还原</span>
                </button>
              )}
            </div>
            <DirectorDropdownBar
              directives={directives}
              savedDirectives={savedImageDirectives}
              onChange={handleImageDirectivesChange}
              disabled={isSelectedRunning}
            />
          </div>
        )}

        {/* 极简运镜工具（运镜轨迹，视频模式专属） */}
        {selected === 'video' && (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                <span>🎬</span>
                <span>运镜轨迹 (Camera Motion)</span>
                {isVideoDirectivesChanged && (
                  <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800 font-medium">
                    已更改待生效
                  </span>
                )}
              </span>
              {isVideoDirectivesChanged && (
                <button
                  type="button"
                  onClick={() => handleVideoDirectivesChange({ ...savedVideoDirectives })}
                  className="text-[10px] text-amber-600 hover:text-amber-800 font-semibold cursor-pointer flex items-center gap-0.5 hover:underline"
                  title="还原运镜轨迹为镜头原设定"
                >
                  <span>↺</span>
                  <span>还原</span>
                </button>
              )}
            </div>
            <DirectorVideoDropdownBar
              directives={videoDirectives}
              savedDirectives={savedVideoDirectives}
              onChange={handleVideoDirectivesChange}
              disabled={isSelectedRunning}
            />
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
            <span>📝</span>
            <span>{selected === 'video' ? '视频运镜台本' : '画面生图提示词'} (Prompt)</span>
            {isSelectedPromptExtracting ? (
              <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-indigo-100 text-indigo-700 font-semibold animate-pulse">
                {selected === 'video' ? '推演运镜词中…' : '推演首帧词中…'}
              </span>
            ) : isPromptChanged ? (
              <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800 font-medium">
                已编辑待出图
              </span>
            ) : null}
          </div>
          {selected === 'first' && (
            <button
              type="button"
              onClick={handleExtractShotPrompt}
              disabled={isPromptExtracting || isSelectedRunning}
              className="text-[10px] text-slate-400 hover:text-indigo-600 font-semibold flex items-center gap-0.5 cursor-pointer disabled:opacity-40"
              title="根据剧情大纲与定妆资产重新推演首关键帧纯中文生图词"
            >
              <span>✨</span>
              <span>{isPromptExtracting ? '推演中…' : '重新推演首帧'}</span>
            </button>
          )}
          {selected === 'video' && (
            <button
              type="button"
              onClick={handleExtractShotMotion}
              disabled={isMotionExtracting || isSelectedRunning}
              className="text-[10px] text-slate-400 hover:text-indigo-600 font-semibold flex items-center gap-0.5 cursor-pointer disabled:opacity-40"
              title="根据上镜动量与二元正交动量规范重新推演影视运镜台本"
            >
              <span>🎬</span>
              <span>{isMotionExtracting ? '推演中…' : '重新推演运镜'}</span>
            </button>
          )}
        </div>

        {isSelectedPromptExtracting ? (
          <div className="mt-2 p-3 rounded-xl border border-indigo-200/80 bg-indigo-50/30 space-y-2 animate-pulse">
            <div className="h-3 bg-indigo-100 rounded w-4/5" />
            <div className="h-3 bg-indigo-50 rounded w-full" />
            <div className="h-3 bg-slate-100 rounded w-2/3" />
            <div className="flex items-center gap-1.5 pt-1 text-[10px] font-semibold text-indigo-600">
              <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
              <span>
                {selected === 'video'
                  ? 'AI 正在推演影视运镜轨迹与动量接戏提示词...'
                  : 'AI 正在推演首关键帧分镜构图与生图提示词...'}
              </span>
            </div>
          </div>
        ) : (
          <div className={`mt-2 ${isSelectedRunning ? 'pointer-events-none opacity-70' : ''}`}>
            <TiptapMentionEditor
              value={draftPrompt}
              entities={editorEntities}
              onChange={(val) => setDraftPrompt(val)}
              isModified={isPromptChanged}
              minRows={5}
              placeholder={
                selected === 'video'
                  ? '输入视听动态运镜与物理动作描述（输入 @ 快速选择定妆资产）...'
                  : '输入画面分镜构图与光影人物描述（输入 @ 快速选择定妆资产）...'
              }
            />
          </div>
        )}

        <button
          type="button"
          onClick={runSelected}
          disabled={isBusy || isSelectedRunning || isSelectedPromptExtracting}
          className={`mt-5 w-full rounded-xl text-white text-xs font-bold py-2.5 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition cursor-pointer shadow-sm hover:shadow-md ${
            isAnyChanged
              ? 'bg-gradient-to-r from-amber-600 to-indigo-600 hover:from-amber-500 hover:to-indigo-500 ring-2 ring-amber-400/30'
              : 'bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600'
          }`}
        >
          {isSelectedRunning && !isSelectedUpscaling && (
            <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          )}
          <span>
            {isSelectedRunning && !isSelectedUpscaling
              ? selectedActiveTask?.progress?.message || `正在生成${labels[selected]}...`
              : isSelectedPromptExtracting
              ? selected === 'video'
                ? '⏳ 运镜台本推演中...'
                : '⏳ 首帧提示词推演中...'
              : isAnyChanged
              ? `✨ 应用修改并${mediaUrl(selected) ? '重新生成' : '生成'}${labels[selected]}`
              : mediaUrl(selected)
              ? `重新生成${labels[selected]}`
              : `生成${labels[selected]}`}
          </span>
        </button>

        {selected !== 'video' && mediaUrl(selected) && (
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[11px] font-semibold text-slate-700 shrink-0">高清超分（SeedVR2）</span>
                {selectedUpscale && (
                  <span
                    className="px-1.5 py-0.5 rounded-md bg-emerald-600 text-white text-[10px] font-mono font-bold shrink-0"
                    title={`当前${labels[selected]}已完成 ${selectedUpscale.multiplier}× 高清超分`}
                  >
                    ✓ 已超分 {selectedUpscale.multiplier}×
                  </span>
                )}
              </div>
              <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200 shrink-0">
                {([2, 4] as const).map((factor) => (
                  <button
                    key={factor}
                    type="button"
                    onClick={() => setUpscaleMultiplier(factor)}
                    disabled={isBusy || isSelectedRunning}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition cursor-pointer ${
                      upscaleMultiplier === factor
                        ? 'bg-white text-emerald-700 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {factor}×
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={runUpscaleSelected}
              disabled={isBusy || isSelectedRunning}
              className={`w-full rounded-xl border text-xs font-semibold py-2.5 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition cursor-pointer ${
                selectedUpscale
                  ? 'bg-emerald-600 hover:bg-emerald-700 border-emerald-600 text-white shadow-2xs'
                  : 'bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-700'
              }`}
            >
              {isSelectedUpscaling && (
                <span
                  className={`w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin ${
                    selectedUpscale ? 'border-white' : 'border-emerald-600'
                  }`}
                />
              )}
              <span>
                {isSelectedUpscaling
                  ? selectedActiveTask?.progress?.message || `正在高清超分 (${upscaleMultiplier}×)...`
                  : selectedUpscale
                  ? `重新超分当前${labels[selected]} (${upscaleMultiplier}×)`
                  : `✨ 高清超分当前${labels[selected]} (${upscaleMultiplier}×)`}
              </span>
            </button>
          </div>
        )}
      </aside>
      )}
    </div>
  );
};
