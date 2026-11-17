/**
 * client/src/components/studio/chat/DirectorFloatingBubble.tsx
 * 视听工坊专属悬浮对话机器人 (支持定妆空间总监与分幕分镜导演彻底解耦)
 *
 * 核心微内核架构：
 * 1. 采用全系统统一对话生命周期微内核 (useDirectorChatFlow) 与统一任务卡片 (DirectorTaskCard)；
 * 2. 对话流程 100% 对齐故事总监标杆体系：提议 ➔ 待审 ➔ 自然语言“同意” ➔ 平滑推演 ➔ 物理落盘 ➔ 自动收官复盘；
 * 3. 专职多智能体泛化：支持 mode: 'lookdev' (定妆空间) 与 mode: 'storyboard' (分幕分镜按 clipId 独立落盘)；
 * 4. 非侵入式悬浮球，支持展开/收起，灵感词在对话开启后自动隐匿。
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { ProjectData, TaskRecord } from '../../../types/index.js';
import {
  LookdevChatSessionClient,
  StoryboardChatSessionClient,
  type ChatMessageItem,
} from '../../../lib/ChatSession.js';
import { useDirectorChatFlow } from '../../../hooks/useDirectorChatFlow.js';
import { DirectorTaskCard } from './DirectorTaskCard.js';
import { ProposalCard } from './ProposalCard.js';

export interface DirectorFloatingBubbleProps {
  projectId: string;
  projectData: ProjectData | null;
  tasks?: TaskRecord[];
  onRunTool: (toolName: string, input: Record<string, any>) => Promise<TaskRecord | any>;
  onRefreshProject?: () => void;
  isBusy: boolean;
  // 核心解耦模式：'lookdev' (定妆空间总监) | 'storyboard' (分幕分镜导演)
  mode: 'lookdev' | 'storyboard';
  // 分幕模式下必传当前分幕标识与标题
  clipId?: string;
  clipTitle?: string;
}

export const DirectorFloatingBubble: React.FC<DirectorFloatingBubbleProps> = ({
  projectId,
  projectData,
  tasks = [],
  onRunTool,
  onRefreshProject,
  isBusy,
  mode,
  clipId,
  clipTitle,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);

  // 1. 核心解耦：根据 mode 与 clipId 动态挂载对应的专属会话客户端 (各幕独立会话)
  const session = useMemo(() => {
    if (mode === 'lookdev') {
      return new LookdevChatSessionClient(projectId || '');
    }
    return new StoryboardChatSessionClient(projectId || '', clipId);
  }, [mode, projectId, clipId]);

  const defaultWelcome = useMemo(() => {
    return mode === 'lookdev'
      ? `你好，我是你的 **定妆空间总监**。🎨\n\n我专注全剧的角色定妆、服装设计与场景空间光影美学：\n- **角色微调**：“把林薇的白大褂改成黑色风衣”、“陈默脸上的伤痕稍微浅一点”\n- **场景微调**：“安全屋更阴暗一些，加两盏闪烁荧光灯”\n\n有任何外貌与光影修改想法随时告诉我！`
      : `你好，我是【${clipId || '本幕'} · ${clipTitle || '分镜台本'}】的 **分镜执行导演**。🎬\n\n我专门负责本幕剧情的镜头切分、视听节拍与摄影机调度：\n- **机位景别**：“第3镜改成特写，聚焦颤抖的手指”、“增加一个主观视角”\n- **节奏运镜**：“这一幕剪辑节奏再加快一点”、“陈默冲出后门的运镜改为手持跟摇”\n\n有任何镜头与蒙太奇想法随时告诉我！`;
  }, [mode, clipId, clipTitle]);

  const contextPrefix = useMemo(() => {
    return mode === 'storyboard' && clipId
      ? `[创作者当前正在检视分幕: ${clipId} · ${clipTitle || clipId}] `
      : `[创作者当前正在检视全剧视觉定妆资产] `;
  }, [mode, clipId, clipTitle]);

  // 2. 接入全系统统一对话微内核 Hook
  const {
    messages,
    inputText,
    setInputText,
    isStreaming,
    streamingContent,
    streamingTargetId,
    streamingAppendContent,
    nowTick,
    isTaskRunning,
    pendingProposalMsg,
    computeDisplayPercent,
    handleSendMessage,
  } = useDirectorChatFlow({
    projectId,
    projectData,
    session,
    tasks,
    onRunTool,
    onRefreshProject,
    isBusy,
    defaultWelcomeMessage: defaultWelcome,
    welcomeMessageId: `init_welcome_${mode}_${clipId || ''}`,
    contextPrefix,
    toolMapper: (targetTool, targetParams) => {
      let tool = targetTool;
      const toolMap: Record<string, string> = {
        'lookdev.character_portrait': 'film.character_portrait',
        'character_portrait': 'film.character_portrait',
        'lookdev.location_concept': 'film.scene_atmosphere',
        'scene_atmosphere': 'film.scene_atmosphere',
        'film.location_concept': 'film.scene_atmosphere',
        'film.character_lookdev': 'film.character_portrait',
        'storyboard_planning': 'film.storyboard_planning',
      };
      if (toolMap[tool]) {
        tool = toolMap[tool];
      }
      const params = { ...targetParams };
      if (tool === 'film.character_portrait' || tool === 'film.scene_atmosphere') {
        params.force = true;
      }
      if (tool === 'film.storyboard_planning' && clipId && !params.clipId) {
        params.clipId = clipId;
      }
      return { tool, params };
    },
    generatePostTaskTriggerPrompt: (toolName, actionTitle) => {
      return mode === 'lookdev'
        ? `【制片工序事件】视觉资产工序【${actionTitle || toolName}】已圆满执行并物理落盘！请你对照当前【定妆空间与场景空间视觉资产】，为创作者出具阶段复盘与审视总结，指出已完成的定妆效果要点与后续创作建议。`
        : `【制片工序事件】分幕分镜工序【${actionTitle || toolName}】已圆满执行并物理落盘！请你对照分幕【${clipId || '当前幕'}】的分镜切分与关键帧，为创作者出具镜头节拍复盘与视听呈现建议。`;
    },
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleMessagesScroll = () => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    shouldAutoScrollRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 20;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  };

  useEffect(() => {
    if (isOpen) {
      if (shouldAutoScrollRef.current) scrollToBottom();
      setHasUnread(false);
    }
  }, [isOpen, messages, streamingContent, streamingAppendContent]);

  // 新消息未读提示
  useEffect(() => {
    if (!isOpen && messages.length > 1) {
      setHasUnread(true);
    }
  }, [messages.length, isOpen]);

  // 3. 各自专属的快捷场景感知推荐词
  const quickPills = useMemo(() => {
    if (mode === 'storyboard') {
      return [
        `🎬 增加一个主观视角特写`,
        `⚡ 加快本幕剪辑节奏`,
        `🎭 强化情绪对峙张力`,
        `📝 微调镜头台词与表演`,
      ];
    }
    return [
      `👔 换一套更有质感的服装`,
      `🎨 增强高对比度电影光影`,
      `🌆 调整场景色调与氛围`,
      `✨ 重新生成当前定妆立绘`,
    ];
  }, [mode]);

  const isLookdev = mode === 'lookdev';
  const themeGradient = isLookdev
    ? 'from-emerald-600 via-teal-600 to-cyan-500'
    : 'from-purple-600 via-indigo-600 to-blue-500';
  const headerGradient = isLookdev
    ? 'from-slate-900 via-teal-950 to-slate-900'
    : 'from-slate-900 via-indigo-950 to-slate-900';
  const tagBg = isLookdev
    ? 'bg-teal-500/30 text-teal-200 border-teal-400/30'
    : 'bg-purple-500/30 text-purple-200 border-purple-400/30';
  // 灵感胶囊仅在初始未开始对话阶段展示；一旦创作者开始对话或正在打字，立即自动隐藏
  const hasUserDialogue = useMemo(() => messages.some((m) => m.role === 'user'), [messages]);
  const isInputting = inputText.trim().length > 0;
  const showQuickPrompts = !hasUserDialogue && !isInputting && quickPills.length > 0 && !isTaskRunning;

  return (
    <>
      {/* ─── 悬浮气泡球 (Bubble Button) ─── */}
      <div className="fixed bottom-20 right-6 z-40 flex flex-col items-end">
        {!isOpen && (
          <div className="group relative">
            <button
              onClick={() => setIsOpen(true)}
              className={`relative flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-tr ${themeGradient} text-white shadow-xl hover:shadow-2xl hover:scale-105 active:scale-95 transition-all duration-300 ring-4 ring-white/80 cursor-pointer`}
              title={isLookdev ? '点击唤起 定妆空间总监' : `点击唤起 分镜导演 (${clipId})`}
            >
              <span className="text-2xl animate-pulse">{isLookdev ? '🎨' : '🎬'}</span>
              {hasUnread && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500 text-[9px] font-bold text-white items-center justify-center">
                    !
                  </span>
                </span>
              )}
            </button>
            <div className="absolute right-16 top-1/2 -translate-y-1/2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-slate-900/90 text-white text-xs font-medium px-3 py-1.5 rounded-lg whitespace-nowrap shadow-lg backdrop-blur">
              {isLookdev ? '定妆空间总监 · 角色与场景' : `分镜导演 · ${clipTitle || clipId}`}
            </div>
          </div>
        )}

        {/* ─── 展开卡片面板 (Floating Panel) ─── */}
        {isOpen && (
          <div className="w-[430px] h-[620px] max-h-[84vh] bg-white border border-slate-200/90 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-300 ring-1 ring-black/5">
            {/* 顶部标题栏 */}
            <div className={`px-4 py-3 bg-gradient-to-r ${headerGradient} text-white flex items-center justify-between shadow-sm select-none flex-shrink-0`}>
              <div className="flex items-center space-x-2">
                <span className="text-xl">{isLookdev ? '🎨' : '🎬'}</span>
                <div>
                  <div className="text-sm font-bold flex items-center space-x-1.5">
                    <span>{isLookdev ? '定妆空间总监' : '电影分镜执行导演'}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tagBg}`}>
                      {isLookdev ? 'Lookdev' : clipId || 'Storyboard'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-300 flex items-center space-x-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span>
                      {isLookdev
                        ? '专注全剧角色定妆与场景空间'
                        : `检视中: ${clipId} · ${clipTitle || '当前分幕'}`}
                    </span>
                  </div>
                </div>
              </div>

              {/* 操作按钮区 */}
              <div className="flex items-center space-x-1 text-slate-300">
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                  title="最小化收起"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* 消息对话流视窗（与故事工坊 100% 对齐） */}
            <div ref={messagesViewportRef} onScroll={handleMessagesScroll} className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-50/50">
              {messages.map((msg) => {
                // 刚性过滤无内容无任务无提案的空消息
                if (!msg.content?.trim() && !msg.taskId && !msg.proposal) {
                  return null;
                }

                const isUser = msg.role === 'user';
                const hasTask = Boolean(msg.taskId);

                // 统一任务推演卡片
                if (hasTask) {
                  return (
                    <DirectorTaskCard
                      key={msg.id}
                      msg={msg}
                      tasks={tasks}
                      nowTick={nowTick}
                      displayPercent={computeDisplayPercent(msg)}
                      streamingTargetId={streamingTargetId}
                      streamingAppendContent={streamingAppendContent}
                      onRetry={() => handleSendMessage('重试本工序')}
                      onApprove={() => handleSendMessage('同意')}
                      canApprove={pendingProposalMsg?.id === msg.id}
                      proposalAccentClassName={isLookdev ? 'bg-teal-600 hover:bg-teal-700' : 'bg-indigo-600 hover:bg-indigo-700'}
                      directorRoleName={isLookdev ? '定妆空间总监' : '电影分镜执行导演'}
                      progressGradientClass={
                        isLookdev
                          ? 'from-teal-500 via-emerald-600 to-cyan-600'
                          : 'from-purple-600 via-indigo-600 to-blue-500'
                      }
                    />
                  );
                }

                // 普通文本对白气泡（纯文本对白呈现，消灭气泡卡片）
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1.5`}
                  >
                    <div className="flex items-center space-x-1.5 px-1">
                      <span className="text-[10px] font-medium text-slate-400">
                        {isUser ? '创作者' : isLookdev ? '定妆空间总监' : '电影分镜执行导演'}
                      </span>
                    </div>

                    <div
                      className={`max-w-[90%] p-3.5 rounded-2xl text-xs leading-relaxed break-words shadow-2xs ${
                        isUser
                          ? isLookdev
                            ? 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white rounded-tr-xs'
                            : 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-tr-xs'
                          : 'bg-white border border-slate-200/80 text-slate-800 rounded-tl-xs'
                      }`}
                    >
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                      {msg.proposal && msg.proposalState === 'pending' && pendingProposalMsg?.id === msg.id && (
                        <ProposalCard
                          proposal={msg.proposal}
                          onApprove={() => handleSendMessage('同意')}
                          disabled={isStreaming || isBusy || isTaskRunning}
                          accentClassName={isLookdev ? 'bg-teal-600 hover:bg-teal-700' : 'bg-indigo-600 hover:bg-indigo-700'}
                        />
                      )}
                    </div>
                  </div>
                );
              })}

              {/* 流式打字中占位 */}
              {isStreaming && (
                <div className="flex flex-col items-start space-y-1">
                  <span className="text-[10px] font-medium text-slate-400 px-1">
                    {isLookdev ? '定妆空间总监' : '电影分镜执行导演'}
                  </span>
                  <div className="max-w-[90%] p-3.5 rounded-2xl rounded-tl-xs bg-white text-slate-800 border border-slate-200/80 text-xs leading-relaxed shadow-sm">
                    <div className="whitespace-pre-wrap">{streamingContent}</div>
                    <span className={`inline-block w-1.5 h-3.5 ${isLookdev ? 'bg-emerald-500' : 'bg-indigo-600'} ml-1 animate-pulse align-middle`}></span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* 快捷推荐词 Pills：仅在初始空白引导阶段展示，对话开启后自动隐匿 */}
            {showQuickPrompts && (
              <div className="px-3 py-2 bg-slate-100/70 border-t border-slate-200 flex flex-wrap gap-1.5 flex-shrink-0">
                {quickPills.map((pill, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSendMessage(pill)}
                    disabled={isStreaming || isBusy || isTaskRunning}
                    className="text-left text-[11px] px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 rounded-xl transition-colors cursor-pointer disabled:opacity-50 shadow-2xs leading-relaxed"
                  >
                    {pill}
                  </button>
                ))}
              </div>
            )}

            {/* 底部输入框与人在回路真实状态操作条（与故事工坊 100% 对齐） */}
            <div className="p-3 bg-white border-t border-slate-200 flex items-center space-x-2 flex-shrink-0">
              <textarea
                ref={inputRef}
                rows={1}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                disabled={isStreaming || isTaskRunning}
                placeholder={
                  isTaskRunning
                    ? '后台任务正在执行，请稍候...'
                    : mode === 'storyboard'
                    ? `对分幕 ${clipId || '当前幕'} 提镜头调度意见 (Enter 发送)...`
                    : '对角色立绘外貌或场景空间提意见 (Enter 发送)...'
                }
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100 transition resize-none leading-relaxed shadow-2xs disabled:opacity-50"
              />

              <button
                onClick={() => handleSendMessage()}
                disabled={!inputText.trim() || isStreaming || isBusy || isTaskRunning}
                className={`px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl shadow transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0`}
              >
                发送
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
