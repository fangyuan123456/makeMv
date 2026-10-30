'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  BookOpen,
  Edit3,
  Save,
  RefreshCw,
  Lock,
  Unlock,
  Play,
  CheckCircle2,
  Users,
  Target,
  Clock,
  Sparkles,
  FileText,
  Plus,
  Trash2,
  Eye,
  Check,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  AlertCircle,
  Upload
} from 'lucide-react';
import type { StageViewProps } from './types';
import StageProgress from './StageProgress';
import StageActions from './StageActions';
import StoryGraphViewer from './StoryGraphViewer';

import { uploadArtifactImage } from '@/lib/workflowApi';

interface CharacterProfile {
  name: string;
  role: string;
  personality: string;
  motivation?: string;
  appearance?: string;
  imageUrl?: string;
  selected?: string;
  versions?: string[];
  referenceImageUrl?: string;
}

interface EpisodePlan {
  episodeNumber: number;
  title: string;
  logline: string;
  cliffhanger?: string;
  targetDuration: number;
  status?: 'planned' | 'running' | 'completed';
  content?: string;
  scenes?: any[];
}

interface ScriptBible {
  title: string;
  theme: string;
  style?: string;
  logline: string;
  sellingPoints: string[];
  characters: CharacterProfile[];
  episodePlans: EpisodePlan[];
  isLocked?: boolean;
  genreId?: string;
  genreName?: string;
  genreReason?: string;
}

interface ScriptData {
  title?: string;
  theme?: string;
  style?: string;
  logline?: string;
  sellingPoints?: string[];
  bible?: ScriptBible;
  characters?: CharacterProfile[];
  episodes?: EpisodePlan[];
  characterNames?: string[];
  locations?: string[];
  scriptText?: string;
  rawText?: string;
  isLocked?: boolean;
  genreId?: string;
  genreName?: string;
  genreReason?: string;
  activeEpisodeNumber?: number;
  [key: string]: any;
}

/**
 * Ensures a robust StoryBible & EpisodePlans object even for legacy projects
 */
function normalizeScriptData(data: ScriptData): {
  bible: ScriptBible;
  episodes: EpisodePlan[];
  isLocked: boolean;
} {
  const isLocked = Boolean(data.isLocked || data.bible?.isLocked || (data.episodes || []).some(ep => ep.status === 'completed' || ep.content));

  const rawCharacters = data.characters?.length
    ? data.characters
    : data.bible?.characters?.length
    ? data.bible.characters
    : (data.characterNames || []).map((name) => ({
        name,
        role: '主要角色',
        personality: '性格鲜明，行事果决',
        motivation: '推进核心主线任务',
      }));

  const characters: CharacterProfile[] = rawCharacters.map((c: any) => {
    const versions: string[] = Array.isArray(c.versions)
      ? [...c.versions]
      : (c.selected || c.imageUrl ? [c.selected || c.imageUrl] : []);
    const selected = c.selected || c.imageUrl || versions[0] || '';
    return {
      ...c,
      selected,
      imageUrl: selected,
      versions,
      referenceImageUrl: c.referenceImageUrl || '',
    };
  });

  const sellingPoints: string[] = data.sellingPoints?.length
    ? data.sellingPoints
    : data.bible?.sellingPoints?.length
    ? data.bible.sellingPoints
    : ['电影级视听冲击与紧凑节奏', '鲜明对立的角色性格与交锋', '环环相扣的情节反转与悬念断章'];

  const rawEpisodes = data.episodes?.length ? data.episodes : data.bible?.episodePlans || [];
  const episodes: EpisodePlan[] = rawEpisodes.map((ep: any, idx: number) => ({
    episodeNumber: ep.episodeNumber || ep.episode_number || idx + 1,
    title: ep.title || ep.act_title || `第${idx + 1}集`,
    logline: ep.logline || (ep.scenes?.[0]?.title ? `核心事件：${ep.scenes[0].title}` : '本集核心冲突与剧情推进'),
    cliffhanger: ep.cliffhanger || '',
    targetDuration: Number(ep.targetDuration) || 60,
    status: ep.content || ep.scenes?.length ? 'completed' : (ep.status || 'planned'),
    content: ep.content || '',
    scenes: ep.scenes || [],
  }));

  const bible: ScriptBible = {
    title: data.bible?.title || data.title || '未命名短片',
    theme: data.bible?.theme || data.theme || '科幻惊悚',
    style: data.style || 'realistic',
    logline: data.bible?.logline || data.logline || '人类与不可名状的远古威能发生激突，引发不可逆转的地质与命运连锁反应。',
    sellingPoints,
    characters,
    episodePlans: episodes,
    isLocked,
    genreId: data.bible?.genreId || data.genreId,
    genreName: data.bible?.genreName || data.genreName,
    genreReason: data.bible?.genreReason || data.genreReason,
  };

  return { bible, episodes, isLocked };
}

export default function ScriptStage({
  state,
  sessionId,
  onConfirm,
  onIntervene,
  onRegenerate,
  onUpdateArtifact,
  showConfirm,
  isRunning,
  hasPendingItems,
  hasNextStageStarted,
}: StageViewProps) {
  const lastArtifactRef = useRef<any>(state?.artifact);
  const initialData = useMemo(() => normalizeScriptData(state?.artifact || {}), []);

  // Editable draft states for the Bible
  const [bibleDraft, setBibleDraft] = useState<ScriptBible>(initialData.bible);
  const [episodesDraft, setEpisodesDraft] = useState<EpisodePlan[]>(initialData.episodes);
  const [isLocked, setIsLocked] = useState<boolean>(initialData.isLocked);

  const [isSavingBible, setIsSavingBible] = useState<boolean>(false);
  const [saveBibleSuccess, setSaveBibleSuccess] = useState<boolean>(false);
  const [isRegeneratingBible, setIsRegeneratingBible] = useState<boolean>(false);
  const [showBibleDetails, setShowBibleDetails] = useState<boolean>(true);

  const [isGeneratingImages, setIsGeneratingImages] = useState<boolean>(false);
  const [aiRevisionPrompt, setAiRevisionPrompt] = useState<string>('');
  const [isRevisingWithAI, setIsRevisingWithAI] = useState<boolean>(false);

  // Check whether all characters have generated concept art images
  const allCharactersHaveImages = useMemo(() => {
    return (
      bibleDraft.characters.length > 0 &&
      bibleDraft.characters.every((c) => Boolean(c.imageUrl))
    );
  }, [bibleDraft.characters]);

  const charactersWithImageCount = useMemo(() => {
    return bibleDraft.characters.filter((c) => Boolean(c.imageUrl)).length;
  }, [bibleDraft.characters]);

  // Keep in sync with incoming backend updates (guarded against re-render loop)
  useEffect(() => {
    if (!state?.artifact || state.artifact === lastArtifactRef.current) return;
    lastArtifactRef.current = state.artifact;

    const norm = normalizeScriptData(state.artifact);
    setBibleDraft(norm.bible);
    setEpisodesDraft(norm.episodes);
    setIsLocked(norm.isLocked);
    setIsGeneratingImages(false);
    setIsRevisingWithAI(false);
  }, [state?.artifact]);

  // Apply AI natural language revision to the Story Bible
  const handleApplyAiRevision = () => {
    if (isLocked || !aiRevisionPrompt.trim() || isRevisingWithAI || isRunning) return;
    setIsRevisingWithAI(true);
    onIntervene({
      action: 'revise_bible',
      instruction: aiRevisionPrompt.trim(),
    });
  };

  // Generate character images for all characters
  const handleGenerateAllCharacterImages = () => {
    setIsGeneratingImages(true);
    onIntervene({ action: 'generate_character_images' });
  };

  // Generate character image for a single character
  const handleGenerateSingleCharacterImage = (characterName: string) => {
    setIsGeneratingImages(true);
    onIntervene({ action: 'generate_character_images', characterName });
  };

  const [uploadingState, setUploadingState] = useState<{ charName: string; type: 'final' | 'reference' } | null>(null);

  // Switch / Select active character image version (多选一)
  const handleSelectCharacterVersion = async (charName: string, versionUrl: string) => {
    const updatedChars = bibleDraft.characters.map((c) => {
      if (c.name === charName) {
        return {
          ...c,
          imageUrl: versionUrl,
          selected: versionUrl,
        };
      }
      return c;
    });

    setBibleDraft((prev) => ({ ...prev, characters: updatedChars }));

    if (sessionId) {
      try {
        const selections: Record<string, string> = {};
        selections[charName] = versionUrl;

        await fetch(`/api/project/${sessionId}/artifact/script_generation`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            characters: updatedChars,
            selections,
          }),
        });
      } catch (err) {
        console.error('Failed to save character version selection:', err);
      }
    }
  };

  // Upload custom local image for a character (supports both 'final' and 'reference')
  const handleUploadCharacterImage = async (
    charName: string,
    file: File,
    type: 'final' | 'reference' = 'final'
  ) => {
    if (!sessionId) return;
    setUploadingState({ charName, type });
    try {
      const res = await uploadArtifactImage(sessionId, 'script_generation', type, charName, file);
      const webPath = res.path;
      if (webPath) {
        const updatedChars = bibleDraft.characters.map((c) => {
          if (c.name === charName) {
            if (type === 'reference') {
              return {
                ...c,
                referenceImageUrl: webPath,
              };
            } else {
              const versions = c.versions ? [webPath, ...c.versions.filter((v) => v !== webPath)] : [webPath];
              return {
                ...c,
                imageUrl: webPath,
                selected: webPath,
                versions,
              };
            }
          }
          return c;
        });
        setBibleDraft((prev) => ({ ...prev, characters: updatedChars }));
      }
    } catch (err) {
      console.error(`Failed to upload ${type} image:`, err);
      alert(`上传${type === 'reference' ? '参考图' : '成品图'}失败，请重试`);
    } finally {
      setUploadingState(null);
    }
  };

  // Remove reference image
  const handleRemoveReferenceImage = async (charName: string) => {
    const updatedChars = bibleDraft.characters.map((c) => {
      if (c.name === charName) {
        return {
          ...c,
          referenceImageUrl: '',
        };
      }
      return c;
    });
    setBibleDraft((prev) => ({ ...prev, characters: updatedChars }));
    if (sessionId) {
      try {
        await fetch(`/api/project/${sessionId}/artifact/script_generation`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ characters: updatedChars }),
        });
      } catch (err) {
        console.error('Failed to remove reference image:', err);
      }
    }
  };

  // 自动保存状态与计时器
  const isInitialMount = useRef(true);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('saved');

  // 当大纲或集数草稿修改时，自动防抖保存
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (!sessionId || isLocked) return;

    setAutoSaveStatus('saving');
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        const patch = {
          title: bibleDraft.title,
          theme: bibleDraft.theme,
          logline: bibleDraft.logline,
          sellingPoints: bibleDraft.sellingPoints,
          characters: bibleDraft.characters,
          episodes: episodesDraft,
          bible: {
            ...bibleDraft,
            episodePlans: episodesDraft,
          },
        };

        const res = await fetch(`/api/project/${sessionId}/artifact/script_generation`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });

        if (res.ok) {
          const data = await res.json();
          onUpdateArtifact?.(data.artifact || patch);
          setAutoSaveStatus('saved');
        } else {
          setAutoSaveStatus('idle');
        }
      } catch (err) {
        console.error('Auto-save Bible error:', err);
        setAutoSaveStatus('idle');
      }
    }, 1000);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [bibleDraft, episodesDraft, sessionId, isLocked, onUpdateArtifact]);

  // Save Bible modifications
  const handleSaveBible = async () => {
    if (!sessionId || isLocked) return;
    setIsSavingBible(true);
    setSaveBibleSuccess(false);
    setAutoSaveStatus('saving');
    try {
      const patch = {
        title: bibleDraft.title,
        theme: bibleDraft.theme,
        logline: bibleDraft.logline,
        sellingPoints: bibleDraft.sellingPoints,
        characters: bibleDraft.characters,
        episodes: episodesDraft,
        bible: {
          ...bibleDraft,
          episodePlans: episodesDraft,
        },
      };

      const res = await fetch(`/api/project/${sessionId}/artifact/script_generation`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });

      if (res.ok) {
        const data = await res.json();
        onUpdateArtifact?.(data.artifact || patch);
        setSaveBibleSuccess(true);
        setAutoSaveStatus('saved');
        setTimeout(() => setSaveBibleSuccess(false), 2000);
      }
    } catch (err) {
      console.error('Failed to save Bible:', err);
      setAutoSaveStatus('idle');
    } finally {
      setIsSavingBible(false);
    }
  };

  // Re-generate outline
  const handleRegenerateBible = () => {
    if (isLocked) return;
    if (window.confirm('确认重新策划大纲吗？当前未保存的大纲修改将被覆盖。')) {
      setIsRegeneratingBible(true);
      onIntervene({ action: 'regenerate_bible' });
    }
  };



  return (
    <div className="flex h-full min-w-0 flex-col bg-slate-50">
      <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto w-full space-y-6">

        {/* 顶部标题与状态指示 */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold">
                <BookOpen className="w-4 h-4" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">剧本大纲与分集工作台</h2>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              第一步确立全局大纲、看点与人物性格；确认后点击任一分集的「开始生成」锁定大纲并展开详写制作。
            </p>
          </div>

          {/* 右侧：状态指示 */}
          <div className="flex items-center gap-2">
            {isLocked ? (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 shadow-2xs">
                <Lock className="w-3.5 h-3.5 text-amber-600" />
                <span>大纲已锁定（分集制作中）</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 shadow-2xs">
                {autoSaveStatus === 'saving' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                    <span>自动保存中...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>更改自动保存</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 运行中进度条 */}
        {state.status === 'running' && (
          <StageProgress
            message={state.progressMessage}
            fallback="正在根据大纲进行剧本推演与制作..."
            progress={state.progress}
            color="blue"
          />
        )}

        {/* 错误提示 */}
        {state.error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-4 rounded-xl">
            {state.error}
          </div>
        )}

        {/* ========================================================================= */}
        {/* 模块 A：全局剧本大纲 (Story Bible) - 可编辑/再次生成，一旦点击分集生成即锁定 */}
        {/* ========================================================================= */}
        <div className={`border rounded-2xl transition-all shadow-sm ${
          isLocked
            ? 'bg-slate-100/90 border-slate-300 opacity-95'
            : 'bg-white border-blue-200 ring-2 ring-blue-50'
        }`}>
          {/* 大纲卡片头部 */}
          <div className="p-5 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex items-center justify-center w-6 h-6 rounded-md bg-blue-100 text-blue-700 text-xs font-bold">1</span>
              <h3 className="text-base font-bold text-gray-900">故事企划大纲 (Story Bible)</h3>
              {isLocked ? (
                <span className="text-xs text-slate-500 italic flex items-center gap-1">
                  <Lock className="w-3 h-3 text-slate-400" /> 已锁定（防止角色人设与剧情冲突）
                </span>
              ) : (
                <span className="text-xs text-blue-600 font-medium bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                  支持页面内编辑修改
                </span>
              )}
              {bibleDraft.genreName && (
                <span
                  className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-indigo-50 text-indigo-700 border border-indigo-200/80 flex items-center gap-1 shadow-sm"
                  title={bibleDraft.genreReason ? `判定依据: ${bibleDraft.genreReason}` : undefined}
                >
                  <span className="opacity-70">🎯 范式:</span>
                  <span className="font-semibold">{bibleDraft.genreName}</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowBibleDetails(!showBibleDetails)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                title={showBibleDetails ? '收起大纲详情' : '展开大纲详情'}
              >
                {showBibleDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* 大纲表单区域（锁定状态下所有输入框被 disabled） */}
          {showBibleDetails && (
            <div className="p-5 sm:p-6 space-y-5">
              {/* 片名与类型 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">片名标题</label>
                  <input
                    disabled={isLocked}
                    value={bibleDraft.title}
                    onChange={(e) => setBibleDraft(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full text-sm font-bold text-gray-900 border rounded-lg px-3 py-2 bg-white disabled:bg-slate-100 disabled:text-slate-600 outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="输入剧作名称"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">题材类型标签</label>
                  <input
                    disabled={isLocked}
                    value={bibleDraft.theme}
                    onChange={(e) => setBibleDraft(prev => ({ ...prev, theme: e.target.value }))}
                    className="w-full text-sm text-gray-800 border rounded-lg px-3 py-2 bg-white disabled:bg-slate-100 disabled:text-slate-600 outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="如：硬核科幻 / 怪兽灾难 / 悬疑谍战"
                  />
                </div>
              </div>

              {/* 整体故事简介 (Logline) */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  整体故事情节简介 (Story Synopsis)
                </label>
                {!isLocked ? (
                  <textarea
                    rows={Math.max(4, Math.ceil((bibleDraft.logline || '').length / 45))}
                    value={bibleDraft.logline}
                    onChange={(e) => setBibleDraft(prev => ({ ...prev, logline: e.target.value }))}
                    className="w-full text-xs sm:text-sm leading-relaxed text-gray-800 border border-gray-200 rounded-xl p-3.5 bg-white outline-none focus:ring-2 focus:ring-blue-200 overflow-hidden"
                    placeholder="概述全剧的核心危机、主要冲突与结局走向..."
                  />
                ) : (
                  <div className="w-full text-xs sm:text-sm leading-relaxed text-gray-800 border border-slate-200/80 rounded-xl p-3.5 bg-slate-50/70 whitespace-pre-wrap select-text">
                    {bibleDraft.logline}
                  </div>
                )}
              </div>

              {/* 核心商业看点 (Selling Points) */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  核心商业看点 / 戏剧钩子 (Hooks)
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {bibleDraft.sellingPoints.map((sp, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-50/50 border border-amber-200/70 shadow-2xs"
                    >
                      <span className="w-5 h-5 rounded-full bg-amber-200 text-amber-900 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {idx + 1}
                      </span>
                      <textarea
                        disabled={isLocked}
                        rows={2}
                        value={sp}
                        onChange={(e) => {
                          const updated = [...bibleDraft.sellingPoints];
                          updated[idx] = e.target.value;
                          setBibleDraft(prev => ({ ...prev, sellingPoints: updated }));
                        }}
                        className="w-full text-xs text-gray-800 bg-transparent border-0 p-0 outline-none resize-none leading-relaxed overflow-hidden"
                        placeholder={`看点 ${idx + 1}`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* 核心出场人物与身份 (Key Characters) */}
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                  <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-blue-600" />
                    <span>出场主要角色/生物 (Key Characters)</span>
                    <span className="ml-1 text-[11px] font-normal px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                      共 {bibleDraft.characters.length} 位
                    </span>
                  </label>
                  <span className="text-xs text-gray-400">
                    此处仅确立角色名与身份定位；详细外貌体征与性格特质将在下一阶段「角色设计」中自动推演生成
                  </span>
                </div>

                {/* 紧凑通透的人物卡片网格 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {bibleDraft.characters.map((char, cIdx) => (
                    <div
                      key={cIdx}
                      className="p-3.5 rounded-xl border border-gray-200 bg-white hover:border-blue-300 shadow-2xs flex items-center gap-3 transition-all"
                    >
                      <span className="w-7 h-7 rounded-lg bg-blue-50 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0 border border-blue-100">
                        {cIdx + 1}
                      </span>
                      <div className="flex-1 min-w-0 space-y-1">
                        <input
                          disabled={isLocked}
                          value={char.name}
                          onChange={(e) => {
                            const updated = [...bibleDraft.characters];
                            updated[cIdx].name = e.target.value;
                            setBibleDraft(prev => ({ ...prev, characters: updated }));
                          }}
                          className="w-full font-bold text-sm text-gray-900 bg-transparent border-0 p-0 outline-none focus:ring-1 focus:ring-blue-300 rounded"
                          placeholder="角色/生物名称"
                        />
                        <input
                          disabled={isLocked}
                          value={char.role}
                          onChange={(e) => {
                            const updated = [...bibleDraft.characters];
                            updated[cIdx].role = e.target.value;
                            setBibleDraft(prev => ({ ...prev, characters: updated }));
                          }}
                          className="w-full text-xs text-gray-500 bg-transparent border-0 p-0 outline-none focus:ring-1 focus:ring-blue-300 rounded"
                          placeholder="身份定位 / 戏剧功能"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* 模块 B：各集大纲规划与故事简介列表 (Episode Summaries & Cliffhanger Targets) */}
        {/* ========================================================================= */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-md bg-purple-100 text-purple-700 text-xs font-bold">2</span>
              <h3 className="text-base font-bold text-gray-900">分集大纲简介与断章规划</h3>
            </div>
            <span className="text-xs text-gray-500">
              共 {episodesDraft.length} 集 · 确立每集核心冲突与预期断章钩子
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3.5">
            {episodesDraft.map((ep, epIdx) => (
              <div
                key={ep.episodeNumber}
                className="p-4 sm:p-5 rounded-2xl border border-gray-200 bg-white hover:border-gray-300 transition-all shadow-xs space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-slate-900 text-white text-xs font-bold rounded">
                      第 {ep.episodeNumber} 集
                    </span>
                    <input
                      disabled={isLocked}
                      value={ep.title}
                      onChange={(e) => {
                        const updated = [...episodesDraft];
                        updated[epIdx].title = e.target.value;
                        setEpisodesDraft(updated);
                      }}
                      className="text-base font-bold text-gray-900 bg-transparent border-0 p-0 outline-none focus:ring-1 focus:ring-blue-300 rounded"
                      placeholder="分集标题"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
                    <Clock className="w-3 h-3 text-slate-400" />
                    <span>预估时长：</span>
                    <input
                      type="number"
                      disabled={isLocked}
                      value={ep.targetDuration || 60}
                      onChange={(e) => {
                        const updated = [...episodesDraft];
                        updated[epIdx].targetDuration = Number(e.target.value) || 60;
                        setEpisodesDraft(updated);
                      }}
                      className="w-12 text-center font-bold text-gray-800 bg-transparent border-0 p-0 outline-none"
                    />
                    <span>秒</span>
                  </div>
                </div>

                {/* 本集故事简介 */}
                <div className="text-xs sm:text-sm text-gray-700">
                  <div className="flex items-center gap-1 text-gray-500 font-semibold mb-1.5 text-xs">
                    <span>本集故事简介：</span>
                  </div>
                  {!isLocked ? (
                    <textarea
                      rows={Math.max(3, Math.ceil((ep.logline || '').length / 42))}
                      value={ep.logline}
                      onChange={(e) => {
                        const updated = [...episodesDraft];
                        updated[epIdx].logline = e.target.value;
                        setEpisodesDraft(updated);
                      }}
                      className="w-full text-xs sm:text-sm text-gray-800 bg-slate-50/70 p-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-blue-100 leading-relaxed overflow-hidden"
                      placeholder="输入本集核心事件与剧情简介..."
                    />
                  ) : (
                    <div className="text-xs sm:text-sm text-gray-800 bg-slate-50/70 p-3.5 rounded-xl border border-gray-100 leading-relaxed whitespace-pre-wrap select-text">
                      {ep.logline}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200/60 text-xs text-blue-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold">下一步提示：</span>
              <span>确认大纲与各集规划后，点击右下方「确认并继续」，进入【角色】定妆工坊；定妆完成后将在【分集】阶段展开详写长文本剧本与钩子。</span>
            </div>
          </div>
        </div>

        {/* 模块 C：网状互动叙事拓扑图 (Story Graph) */}
        <div className="border border-indigo-200 bg-white rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-6 h-6 rounded-md bg-indigo-100 text-indigo-700 text-xs font-bold">3</span>
            <h3 className="text-base font-bold text-gray-900">网状互动拓扑图谱 (Narrative Graph)</h3>
            <span className="text-xs text-indigo-600 font-medium bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
              影游分支决策树
            </span>
          </div>

          <StoryGraphViewer
            graph={state?.artifact?.storyGraph || state?.artifact?.bible?.storyGraph}
            onRegenerateGraph={() => onIntervene({ action: 'generate_story_graph' })}
            onValidateGraph={() => onIntervene({ action: 'validate_story_graph' })}
            isRunning={isRunning}
          />
        </div>
      </div>

      {/* 底部浮动控制栏 */}
      <StageActions
        status={state.status}
        stageId="script_generation"
        showConfirm={showConfirm}
        onConfirm={onConfirm}
        isRunning={isRunning}
        hasPendingItems={hasPendingItems}
        hasNextStageStarted={hasNextStageStarted}
        autoSaveStatus={autoSaveStatus}
      />
    </div>
  );
}
