'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  FileText,
  Play,
  RefreshCw,
  Edit3,
  Save,
  CheckCircle2,
  Clock,
  Zap,
  ShieldAlert,
  ArrowRight,
  ChevronRight,
  BookOpen,
} from 'lucide-react';
import type { StageViewProps } from './types';
import StageProgress from './StageProgress';
import StageActions from './StageActions';


interface EpisodePlan {
  episodeNumber: number;
  title: string;
  logline: string;
  cliffhanger?: string;
  targetDuration?: number;
  status?: 'planned' | 'running' | 'completed';
  content?: string;
  scenes?: any[];
}

export default function EpisodeStage({
  state,
  sessionId,
  onConfirm,
  onIntervene,
  onRegenerate,
  showConfirm,
  isRunning,
  hasPendingItems,
  hasNextStageStarted,
  artifacts,
  scriptArtifact: passedScriptArtifact,
}: StageViewProps) {
  // Merge script data from state.artifact or passed scriptArtifact
  const scriptData = state?.artifact || passedScriptArtifact || artifacts?.script_generation;
  const lastScriptDataRef = useRef<any>(scriptData);

  const rawEpisodes: EpisodePlan[] = useMemo(() => {
    if (!scriptData) return [];
    return (scriptData.episodes || scriptData.bible?.episodePlans || []).map((ep: any, idx: number) => ({
      episodeNumber: ep.episodeNumber || ep.episode_number || idx + 1,
      title: ep.title || ep.act_title || `第${idx + 1}集`,
      logline: ep.logline || '',
      cliffhanger: ep.cliffhanger || '',
      targetDuration: Number(ep.targetDuration) || 60,
      status: ep.content || ep.scenes?.length ? 'completed' : (ep.status || 'planned'),
      content: ep.content || '',
      scenes: ep.scenes || [],
    }));
  }, [scriptData]);

  const [episodesDraft, setEpisodesDraft] = useState<EpisodePlan[]>(rawEpisodes);
  const [activeEpisodeNum, setActiveEpisodeNum] = useState<number>(rawEpisodes[0]?.episodeNumber || 1);
  const [activeEpisodeText, setActiveEpisodeText] = useState<string>('');
  const [isEditingEpScript, setIsEditingEpScript] = useState<boolean>(false);
  const [generatingEpNum, setGeneratingEpNum] = useState<number | null>(null);

  useEffect(() => {
    if (!scriptData || scriptData === lastScriptDataRef.current) return;
    lastScriptDataRef.current = scriptData;

    if (rawEpisodes.length > 0) {
      setEpisodesDraft(rawEpisodes);
      const active = rawEpisodes.find(e => e.episodeNumber === activeEpisodeNum) || rawEpisodes[0];
      if (active) {
        setActiveEpisodeText(active.content || '');
      }
    }
  }, [scriptData, rawEpisodes, activeEpisodeNum]);

  const activeEpisode = episodesDraft.find(e => e.episodeNumber === activeEpisodeNum) || episodesDraft[0];
  const prevEpisode = activeEpisodeNum > 1 ? episodesDraft.find(e => e.episodeNumber === activeEpisodeNum - 1) : null;
  const nextEpisode = episodesDraft.find(e => e.episodeNumber === activeEpisodeNum + 1);

  // Generate or regenerate single episode
  const handleStartEpisodeGeneration = (epNum: number) => {
    if (isRunning) return;
    setGeneratingEpNum(epNum);
    setActiveEpisodeNum(epNum);
    onIntervene?.({
      action: 'expand_episode',
      episodeNumber: epNum,
    });
  };

  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('saved');
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 监听剧本改动，防抖自动保存
  useEffect(() => {
    if (!isEditingEpScript || !sessionId) return;
    setAutoSaveStatus('saving');
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    autoSaveTimerRef.current = setTimeout(async () => {
      const updatedEpisodes = episodesDraft.map(ep =>
        ep.episodeNumber === activeEpisodeNum ? { ...ep, content: activeEpisodeText, status: 'completed' as const } : ep
      );
      setEpisodesDraft(updatedEpisodes);

      try {
        await fetch(`/api/project/${sessionId}/artifact/script_generation`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            episodes: updatedEpisodes,
            scriptText: activeEpisodeText,
            isLocked: true,
          }),
        });
        setAutoSaveStatus('saved');
      } catch (err) {
        console.error('Failed to auto save episode text:', err);
        setAutoSaveStatus('idle');
      }
    }, 1000);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [activeEpisodeText, isEditingEpScript, sessionId, activeEpisodeNum]);

  // Save manual edits to active episode screenplay
  const handleSaveActiveEpisodeText = async () => {
    if (!sessionId) return;
    setAutoSaveStatus('saving');
    const updatedEpisodes = episodesDraft.map(ep =>
      ep.episodeNumber === activeEpisodeNum ? { ...ep, content: activeEpisodeText, status: 'completed' as const } : ep
    );
    setEpisodesDraft(updatedEpisodes);

    try {
      await fetch(`/api/project/${sessionId}/artifact/script_generation`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodes: updatedEpisodes,
          scriptText: activeEpisodeText,
          isLocked: true,
        }),
      });
      setIsEditingEpScript(false);
      setAutoSaveStatus('saved');
    } catch (err) {
      console.error('Failed to save episode text:', err);
      setAutoSaveStatus('idle');
    }
  };

  const completedCount = episodesDraft.filter(e => e.status === 'completed' || Boolean(e.content)).length;

  return (
    <div className="flex h-full min-w-0 flex-col bg-slate-50">
      <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto w-full space-y-6">

        {/* 顶部标题与阶段说明 */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold">
                <FileText className="w-4 h-4" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">分集剧本创作工作室</h2>
              {(scriptData?.genreName || scriptData?.bible?.genreName) && (
                <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-2xs">
                  🎯 范式: {scriptData?.genreName || scriptData?.bible?.genreName}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              深入单集详写具体场次、动作与对白；严格遵循已匹配题材的视听语言与分集叙事节拍，无缝继承战损与世界状态。
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
              已完成 {completedCount} / {episodesDraft.length} 集
            </span>
          </div>
        </div>

        {/* 运行中进度 */}
        {state.status === 'running' && (
          <StageProgress
            message={state.progressMessage}
            fallback={`正在创作第 ${generatingEpNum || activeEpisodeNum} 集长文本剧本...`}
            progress={state.progress}
            color="violet"
          />
        )}

        {/* 分集导航选择横条 */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none border-b border-gray-200">
          {episodesDraft.map((ep) => {
            const isCompleted = Boolean(ep.content || ep.scenes?.length);
            const isSelected = ep.episodeNumber === activeEpisodeNum;

            return (
              <button
                key={ep.episodeNumber}
                onClick={() => {
                  setActiveEpisodeNum(ep.episodeNumber);
                  setActiveEpisodeText(ep.content || '');
                  setIsEditingEpScript(false);
                }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer border ${
                  isSelected
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : isCompleted
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
                }`}
              >
                <span>第 {ep.episodeNumber} 集</span>
                <span className="font-normal opacity-90 max-w-[120px] truncate">{ep.title}</span>
                {isCompleted ? (
                  <CheckCircle2 className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-emerald-600'}`} />
                ) : (
                  <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-white' : 'bg-gray-300'}`} />
                )}
              </button>
            );
          })}
        </div>

        {/* 当前选中集的核心信息与单集钩子卡片 */}
        {activeEpisode && (
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-slate-900 text-white text-xs font-bold rounded">
                    第 {activeEpisode.episodeNumber} 集
                  </span>
                  <h3 className="text-lg font-bold text-gray-900">{activeEpisode.title}</h3>
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                    <Clock className="w-3 h-3 text-slate-400" />
                    预估 {activeEpisode.targetDuration} 秒
                  </span>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">
                  <span className="font-semibold text-gray-500">本集大纲简介：</span>
                  {activeEpisode.logline}
                </p>
              </div>

              {/* 单集操作按钮 */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleStartEpisodeGeneration(activeEpisode.episodeNumber)}
                  disabled={isRunning}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {activeEpisode.content ? <RefreshCw className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-white" />}
                  <span>{activeEpisode.content ? '重新生成本集' : '开始生成本集剧本'}</span>
                </button>
              </div>
            </div>

            {/* 短剧钩子与战损状态指引 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              {/* 开篇黄金3秒钩子承接 */}
              <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-100 text-xs text-blue-900 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-blue-800">
                  <Zap className="w-3.5 h-3.5 text-blue-600" />
                  <span>黄金 3 秒抓眼钩子（开篇）</span>
                </div>
                <p className="text-blue-700 leading-relaxed">
                  {prevEpisode ? (
                    <>无缝承接第 {prevEpisode.episodeNumber} 集结尾断章：<span className="font-semibold">“{prevEpisode.cliffhanger || '危机高潮'}”</span>，零铺垫直接爆发后续冲突。</>
                  ) : (
                    <>全剧第 1 集首场戏前 3 秒以极高危机或奇观抓眼，把观众瞬间锁定在屏幕前。</>
                  )}
                </p>
              </div>

              {/* 结尾卡点断章钩子 */}
              <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200/70 text-xs text-amber-900 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-amber-800">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                  <span>卡点断章悬念钩子（结尾）</span>
                </div>
                <p className="text-amber-800 leading-relaxed">
                  {activeEpisode.cliffhanger ? (
                    <span>断章目标：<span className="font-semibold">{activeEpisode.cliffhanger}</span>（停留在戏剧最高峰，制造强烈的秒看下集冲动）。</span>
                  ) : (
                    <span>最后一场戏卡在未知势力出现、底牌暴露或生死悬念瞬间戛然而止。</span>
                  )}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 剧本正文呈现与编辑器 */}
        {activeEpisode && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-indigo-600" />
                <h4 className="text-sm font-bold text-gray-900">
                  第 {activeEpisode.episodeNumber} 集长文本影视剧本正文
                </h4>
              </div>

              {activeEpisode.content && (
                <div className="flex items-center gap-2">
                  {!isEditingEpScript ? (
                    <button
                      onClick={() => setIsEditingEpScript(true)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      修改剧本对白动作
                    </button>
                  ) : (
                    <button
                      onClick={handleSaveActiveEpisodeText}
                      className="inline-flex items-center gap-1 px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-xs"
                    >
                      <Save className="w-3.5 h-3.5" />
                      保存剧本修改
                    </button>
                  )}
                </div>
              )}
            </div>

            {activeEpisode.content ? (
              isEditingEpScript ? (
                <textarea
                  rows={18}
                  value={activeEpisodeText}
                  onChange={(e) => setActiveEpisodeText(e.target.value)}
                  className="w-full font-mono text-sm leading-relaxed text-gray-800 p-4 border border-gray-200 rounded-xl bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-300"
                  placeholder="在此修改本集剧本正文..."
                />
              ) : (
                <div className="bg-slate-50/80 p-6 rounded-xl border border-slate-100 text-sm font-sans text-gray-800 leading-relaxed whitespace-pre-wrap font-mono">
                  {activeEpisode.content}
                </div>
              )
            ) : (
              <div className="py-16 text-center text-gray-400 space-y-3">
                <Clock className="w-10 h-10 mx-auto text-gray-300" />
                <p className="text-sm text-gray-600 font-medium">
                  第 {activeEpisode.episodeNumber} 集长文本剧本尚未生成。
                </p>
                <p className="text-xs text-gray-400 max-w-md mx-auto">
                  点击下方按钮，AI 将根据全剧故事圣经与本集大纲，编写出具备黄金 3 秒抓眼与断章钩子的单集长文本影视剧本。
                </p>
                <button
                  onClick={() => handleStartEpisodeGeneration(activeEpisode.episodeNumber)}
                  disabled={isRunning}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 shadow-sm cursor-pointer disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  立即开始生成第 {activeEpisode.episodeNumber} 集剧本
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部动作控制栏 */}
      <StageActions
        status={state.status}
        stageId="episode_script"
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
