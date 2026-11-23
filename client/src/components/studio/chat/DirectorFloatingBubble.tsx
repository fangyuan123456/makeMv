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
import type { TaskRecord } from '../../../types/index.js';
import {
  LookdevConversationClient,
  StoryboardConversationClient,
  type ConversationMessage,
} from '../../../lib/DirectorConversation.js';
import { useDirectorChatFlow } from '../../../hooks/useDirectorChatFlow.js';
import { DirectorTaskCard } from './DirectorTaskCard.js';
import { ProposalCard } from './ProposalCard.js';
import { ChatAttachmentStrip } from './ChatAttachmentStrip.js';

export interface DirectorFloatingBubbleProps {
  projectId: string;
  tasks?: TaskRecord[];
  onRefreshProject?: () => void;
  // 核心解耦模式：'lookdev' (定妆空间总监) | 'storyboard' (分幕分镜导演)
  mode: 'lookdev' | 'storyboard';
  // 分幕模式下必传当前分幕标识与标题
  clipId?: string;
  clipTitle?: string;
}

export const DirectorFloatingBubble: React.FC<DirectorFloatingBubbleProps> = ({
  projectId,
  tasks = [],
  onRefreshProject,
  mode,
  clipId,
  clipTitle,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);

  // ─── 悬浮机器人可拖动与智能吸边状态机 ───
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [dockSide, setDockSide] = useState<'left' | 'right'>('right');
  const [isDragging, setIsDragging] = useState(false);

  // 初始化位置（优先从持久化缓存恢复，缺省贴靠右下角）
  useEffect(() => {
    const saved = localStorage.getItem('makemv_director_bubble_pos');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (typeof parsed.yRatio === 'number' && (parsed.dockSide === 'left' || parsed.dockSide === 'right')) {
          const winW = window.innerWidth;
          const winH = window.innerHeight;
          const targetX = parsed.dockSide === 'left' ? 24 : winW - 56 - 24;
          const targetY = Math.min(Math.max(64, parsed.yRatio * winH), winH - 56 - 80);
          setPosition({ x: targetX, y: targetY });
          setDockSide(parsed.dockSide);
          return;
        }
      } catch {}
    }
    const defaultX = window.innerWidth - 56 - 24;
    const defaultY = window.innerHeight - 56 - 80;
    setPosition({ x: defaultX, y: defaultY });
    setDockSide('right');
  }, []);

  // 窗口缩放自适应保护
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => {
        if (!prev) return prev;
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        const targetX = dockSide === 'left' ? 24 : winW - 56 - 24;
        const targetY = Math.min(Math.max(64, prev.y), winH - 56 - 80);
        return { x: targetX, y: targetY };
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [dockSide]);

  // 指针拖拽与吸边物理计算
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startPosX: number;
    startPosY: number;
    hasMoved: boolean;
    pointerId: number | null;
  }>({
    startX: 0,
    startY: 0,
    startPosX: 0,
    startPosY: 0,
    hasMoved: false,
    pointerId: null,
  });

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const btn = e.currentTarget;
    btn.setPointerCapture(e.pointerId);
    const curPos = position || {
      x: window.innerWidth - 56 - 24,
      y: window.innerHeight - 56 - 80,
    };
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: curPos.x,
      startPosY: curPos.y,
      hasMoved: false,
      pointerId: e.pointerId,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current.pointerId !== e.pointerId) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (!dragRef.current.hasMoved && Math.hypot(dx, dy) > 5) {
      dragRef.current.hasMoved = true;
      setIsDragging(true);
    }
    if (dragRef.current.hasMoved) {
      const winW = window.innerWidth;
      const winH = window.innerHeight;
      const newX = Math.min(Math.max(8, dragRef.current.startPosX + dx), winW - 56 - 8);
      const newY = Math.min(Math.max(48, dragRef.current.startPosY + dy), winH - 56 - 48);
      setPosition({ x: newX, y: newY });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current.pointerId !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    dragRef.current.pointerId = null;

    if (dragRef.current.hasMoved) {
      // 发生实质位移：执行智能边缘吸附
      const winW = window.innerWidth;
      const winH = window.innerHeight;
      const curX = position ? position.x : e.clientX - 28;
      const curY = position ? position.y : e.clientY - 28;
      const centerX = curX + 28;
      const side: 'left' | 'right' = centerX < winW / 2 ? 'left' : 'right';
      const snappedX = side === 'left' ? 24 : winW - 56 - 24;
      const clampedY = Math.min(Math.max(64, curY), winH - 56 - 80);

      setDockSide(side);
      setPosition({ x: snappedX, y: clampedY });
      setIsDragging(false);

      localStorage.setItem(
        'makemv_director_bubble_pos',
        JSON.stringify({
          dockSide: side,
          yRatio: clampedY / winH,
        })
      );
    } else {
      // 微小位移判定为纯点击：触发展开
      setIsDragging(false);
      setIsOpen(true);
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current.pointerId === e.pointerId) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      dragRef.current.pointerId = null;
      setIsDragging(false);
    }
  };

  // 1. 核心解耦：根据 mode 与 clipId 动态挂载对应的专属会话客户端 (各幕独立会话)
  const session = useMemo(() => {
    if (mode === 'lookdev') {
      return new LookdevConversationClient(projectId || '');
    }
    return new StoryboardConversationClient(projectId || '', clipId);
  }, [mode, projectId, clipId]);

  const defaultWelcome = useMemo(() => {
    return mode === 'lookdev'
      ? `你好，我是你的 **定妆空间总监**。🎨\n\n我专注全剧的角色定妆、服装设计与场景空间光影美学：\n- **角色/场景微调**：“把林薇的白大褂改成黑色风衣”、“安全屋更阴暗一些”\n- **高清超分变清晰**：“把当前这张图变清晰”、“把所有角色定妆都超分一下”\n\n有任何外貌、光影或清晰度提升想法随时告诉我！`
      : `你好，我是【${clipId || '本幕'} · ${clipTitle || '分镜台本'}】的 **分镜执行导演**。🎬\n\n我专门负责本幕剧情的镜头切分、视听节拍与关键帧清晰度：\n- **机位与节奏**：“第3镜改成特写，聚焦颤抖的手指”、“这一幕剪辑节奏再加快一点”\n- **高清超分变清晰**：“把当前首帧变清晰”、“把本幕所有已生成的首帧超分到2倍”\n\n有任何镜头与画质提升想法随时告诉我！`;
  }, [mode, clipId, clipTitle]);

  // 2. 接入全系统统一对话微内核 Hook
  const {
    messages,
    inputText,
    setInputText,
    pendingImages,
    isUploadingImage,
    isStreaming,
    isApproving,
    streamingContent,
    streamingTargetId,
    streamingAppendContent,
    isTaskRunning,
    pendingProposalMsg,
    focusLabel,
    computeDisplayPercent,
    handleAddImages,
    handleRemovePendingImage,
    handlePasteImages,
    handleSendMessage,
    handleApproveProposal,
    handleRetryTask,
    handleCancelPlan,
  } = useDirectorChatFlow({
    projectId,
    session,
    tasks,
    onRefreshProject,
    defaultWelcomeMessage: defaultWelcome,
    welcomeMessageId: `init_welcome_${mode}_${clipId || ''}`,
    mode,
    clipId,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
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

  const prevMessageCountRef = useRef(0);

  // 新消息未读提示（仅在气泡折叠状态下收到新增消息时点亮，避免关闭气泡误触红点）
  useEffect(() => {
    if (isOpen) {
      prevMessageCountRef.current = messages.length;
      setHasUnread(false);
      return;
    }
    if (prevMessageCountRef.current > 0 && messages.length > prevMessageCountRef.current) {
      setHasUnread(true);
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length, isOpen]);

  // 3. 各自专属的快捷场景感知推荐词（全面对齐影视视听语言与底层物理工具）
  const quickPills = useMemo(() => {
    if (mode === 'storyboard') {
      return [
        `🎥 将当前镜头运镜改为好莱坞环绕巡视`,
        `⚡ 动态幅度调整为电影级平缓 (5/10)`,
        `🎨 将本幕色调统一为好莱坞青橙冷暖`,
        `✨ 保留原图机位与光影，定向微调局部细节`,
        `📐 镜头机位换为低机位仰拍英雄视角`,
        `✨ 使用 SeedVR2 对关键帧进行 4× 高清超分`,
      ];
    }
    return [
      `✨ 使用 SeedVR2 对当前定妆图进行 4× 高清超分`,
      `👔 为核心角色生成正侧背三视图立绘定妆`,
      `🧥 优化角色的服装纹理材质与光影质感`,
      `🌆 强化场景母本底图的空间纵深与光影层次`,
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

  // 计算展开面板的视口停靠与自适应边界
  const winW = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const panelW = Math.min(430, winW - 32);
  const panelH = Math.min(620, winH * 0.84);
  const bubbleY = position ? position.y : winH - 136;
  const panelLeft = dockSide === 'left' ? 24 : Math.max(16, winW - panelW - 24);
  const idealTop = bubbleY + 56 - panelH;
  const panelTop = Math.min(Math.max(60, idealTop), winH - panelH - 24);

  return (
    <>
      {/* ─── 悬浮机器人气泡球 (可拖拽与自动吸边) ─── */}
      {!isOpen && position && (
        <div
          style={{
            left: `${position.x}px`,
            top: `${position.y}px`,
            transition: isDragging
              ? 'none'
              : 'left 0.35s cubic-bezier(0.18, 0.89, 0.32, 1.28), top 0.25s ease-out',
            touchAction: 'none',
          }}
          className="fixed z-[70] select-none"
        >
          <div className="group relative">
            <button
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              className={`relative flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-tr ${themeGradient} text-white shadow-xl ${
                isDragging
                  ? 'scale-110 shadow-2xl ring-4 ring-indigo-400 cursor-grabbing'
                  : 'hover:shadow-2xl hover:scale-105 active:scale-95 ring-4 ring-white/80 cursor-grab'
              } transition-transform duration-200`}
              title={isLookdev ? '按住可拖动吸边，点击唤起定妆空间总监' : `按住可拖动吸边，点击唤起分镜导演 (${clipId})`}
            >
              <span className={`text-2xl ${isDragging ? '' : 'animate-pulse'}`}>{isLookdev ? '🎨' : '🎬'}</span>
              {hasUnread && !isDragging && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500 text-[9px] font-bold text-white items-center justify-center">
                    !
                  </span>
                </span>
              )}
            </button>
            {!isDragging && (
              <div
                className={`absolute ${
                  dockSide === 'left' ? 'left-16' : 'right-16'
                } top-1/2 -translate-y-1/2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-slate-900/90 text-white text-xs font-medium px-3 py-1.5 rounded-lg whitespace-nowrap shadow-lg backdrop-blur`}
              >
                {focusLabel
                  ? `🎯 聚焦: ${focusLabel}`
                  : isLookdev
                  ? '定妆空间总监 · 角色与场景'
                  : `分镜导演 · ${clipTitle || clipId}`}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── 展开卡片面板 (Floating Panel 智能贴边，高优先级 z-[70] 杜绝画布控制栏遮挡穿透) ─── */}
      {isOpen && (
        <div
          style={{
            left: `${panelLeft}px`,
            top: `${panelTop}px`,
            width: `${panelW}px`,
          }}
          className="fixed z-[70] h-[620px] max-h-[84vh] bg-white border border-slate-200/90 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-300 ring-1 ring-black/5"
        >
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
                      {focusLabel
                        ? `🎯 当前聚焦: ${focusLabel}`
                        : isLookdev
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
                // 刚性过滤无内容无附件无任务无提案的空消息
                if (!msg.content?.trim() && !msg.attachments?.length && !msg.taskId && !msg.planSteps?.length && !msg.proposal) {
                  return null;
                }

                const isUser = msg.role === 'user';
                const hasTask = Boolean(msg.taskId || (msg.planSteps && msg.planSteps.length > 0));

                // 统一任务推演卡片（同时支持单步原子任务与多步 Plan 执行清单）
                if (hasTask) {
                  return (
                    <DirectorTaskCard
                      key={msg.id}
                      msg={msg}
                      tasks={tasks}
                      displayPercent={computeDisplayPercent(msg)}
                      streamingTargetId={streamingTargetId}
                      streamingAppendContent={streamingAppendContent}
                      onRetry={() => (msg.taskId ? handleRetryTask(msg.taskId) : handleSendMessage('重试本工序'))}
                      onRetryTask={handleRetryTask}
                      onCancelPlan={handleCancelPlan}
                      directorRoleName={isLookdev ? '定妆空间总监' : '电影分镜执行导演'}
                      progressGradientClass={
                        isLookdev
                          ? 'from-teal-500 via-emerald-600 to-cyan-600'
                          : 'from-purple-600 via-indigo-600 to-blue-500'
                      }
                      onApproveProposal={handleApproveProposal}
                      isApproving={isApproving}
                      isStreaming={isStreaming}
                      isTaskRunning={isTaskRunning}
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
                      {msg.attachments && msg.attachments.length > 0 && (
                        <ChatAttachmentStrip
                          attachments={msg.attachments}
                          variant="message"
                          size="sm"
                          className="mb-2"
                        />
                      )}
                      {msg.content && <div className="whitespace-pre-wrap">{msg.content}</div>}
                      {msg.proposal && !msg.taskId && (!msg.planSteps || msg.planSteps.length === 0) && msg.proposalState === 'pending' && pendingProposalMsg?.id === msg.id && (
                        <ProposalCard
                          proposal={msg.proposal}
                          onApprove={() => handleApproveProposal(msg.id)}
                          disabled={isStreaming || isApproving || isTaskRunning}
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
                    disabled={isStreaming || isTaskRunning}
                    className="text-left text-[11px] px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 rounded-xl transition-colors cursor-pointer disabled:opacity-50 shadow-2xs leading-relaxed"
                  >
                    {pill}
                  </button>
                ))}
              </div>
            )}

            {/* 底部输入框与人在回路真实状态操作条（与故事工坊 100% 对齐） */}
            <div className="p-3 bg-white border-t border-slate-200 space-y-2 flex-shrink-0">
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) void handleAddImages(e.target.files);
                  e.target.value = '';
                }}
              />

              {pendingImages.length > 0 && (
                <ChatAttachmentStrip
                  attachments={pendingImages}
                  variant="pending"
                  size="sm"
                  onRemove={handleRemovePendingImage}
                />
              )}

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isStreaming || isTaskRunning || isUploadingImage || pendingImages.length >= 4}
                  className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 rounded-xl text-xs transition disabled:opacity-40 cursor-pointer shrink-0"
                  title="发送参考图片（支持多选，也可直接 Ctrl+V 粘贴截图）"
                >
                  {isUploadingImage ? '⏳' : '🖼️'}
                </button>

                <textarea
                  ref={inputRef}
                  rows={1}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onPaste={handlePasteImages}
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
                      ? `对分幕 ${clipId || '当前幕'} 提意见或贴参考图 (Enter)...`
                      : '提外貌/场景意见，或 Ctrl+V 贴参考图 (Enter)...'
                  }
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100 transition resize-none leading-relaxed shadow-2xs disabled:opacity-50"
                />

                <button
                  onClick={() => handleSendMessage()}
                  disabled={(!inputText.trim() && pendingImages.length === 0) || isStreaming || isUploadingImage || isTaskRunning}
                  className={`px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl shadow transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0`}
                >
                  发送
                </button>
              </div>
            </div>
          </div>
        )}
    </>
  );
};
