/**
 * client/src/components/studio/chat/DirectorFloatingBubble.tsx
 * 视听工坊专属悬浮对话机器人 (支持定妆空间总监与分幕分镜导演彻底解耦)
 *
 * 核心微内核架构：
 * 1. 【专职多智能体泛化】支持 mode: 'lookdev' (定妆空间) 与 mode: 'storyboard' (分幕分镜)；
 * 2. 【分幕物理隔离】分镜模式下按 clipId 独立落盘 (chat/storyboard_<clipId>.json)，各幕历史绝不串台；
 * 3. 【非侵入式悬浮球】固定于右下角，完全不占用主画布网格空间，一键展开/收起；
 * 4. 【人在回路单活动提案】无硬编码正则，大模型定案后出具唯一可点击卡片，一键调度后台工具并联动画布刷新。
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { ProjectData, TaskRecord } from '../../../types/index.js';
import {
  LookdevChatSessionClient,
  StoryboardChatSessionClient,
  type ChatMessageItem,
} from '../../../lib/ChatSession.js';

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
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [hasUnread, setHasUnread] = useState(false);

  // 1. 核心解耦：根据 mode 与 clipId 动态挂载对应的专属会话客户端 (各幕独立会话)
  const session = useMemo(() => {
    if (mode === 'lookdev') {
      return new LookdevChatSessionClient(projectId || '');
    }
    return new StoryboardChatSessionClient(projectId || '', clipId);
  }, [mode, projectId, clipId]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
      setHasUnread(false);
    }
  }, [isOpen, messages, streamingContent]);

  // 计算全消息流中最后一个带有效未决 proposal 的消息 ID，杜绝多个确认按钮并存
  const latestProposalMsgId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.proposal && m.proposalState !== 'completed') {
        return m.id;
      }
    }
    return null;
  }, [messages]);

  // 2. 初始化拉取当前专属会话的历史对白 (切换分幕时自动更新)
  useEffect(() => {
    if (!projectId) return;
    let isMounted = true;

    session.getHistory().then((history) => {
      if (!isMounted) return;
      if (Array.isArray(history) && history.length > 0) {
        setMessages(history);
      } else {
        // 各自专属的初始欢迎语
        const defaultWelcome =
          mode === 'lookdev'
            ? `你好，我是你的 **定妆空间总监**。🎨\n\n我专注全剧的角色定妆、服装设计与场景空间光影美学：\n- **角色微调**：“把林薇的白大褂改成黑色风衣”、“陈默脸上的伤痕稍微浅一点”\n- **场景微调**：“安全屋更阴暗一些，加两盏闪烁荧光灯”\n\n有任何外貌与光影修改想法随时告诉我！`
            : `你好，我是【${clipId || '本幕'} · ${clipTitle || '分镜台本'}】的 **分镜执行导演**。🎬\n\n我专门负责本幕剧情的镜头切分、视听节拍与摄影机调度：\n- **机位景别**：“第3镜改成特写，聚焦颤抖的手指”、“增加一个主观视角”\n- **节奏运镜**：“这一幕剪辑节奏再加快一点”、“陈默冲出后门的运镜改为手持跟摇”\n\n有任何镜头与蒙太奇想法随时告诉我！`;

        setMessages([
          {
            id: `init_welcome_${mode}_${clipId || ''}`,
            role: 'assistant',
            content: defaultWelcome,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [projectId, session, mode, clipId, clipTitle]);

  // 3. 发送消息
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text || isStreaming || !projectId) return;

    setInputText('');

    const contextPrefix =
      mode === 'storyboard' && clipId
        ? `[创作者当前正在检视分幕: ${clipId} · ${clipTitle || clipId}] `
        : `[创作者当前正在检视全剧视觉定妆资产] `;

    const fullPrompt = `${contextPrefix}${text}`;

    const userMsg: ChatMessageItem = {
      id: `msg_user_${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);
    setStreamingContent('');

    // 服务端 BaseChatSession.stream 已自动原子落盘，前端避免重复写入
    session.markProposalsResolved().catch(() => {});

    let accumulated = '';

    await session.streamChat({
      message: fullPrompt,
      history: messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content })),
      onTextChunk: (chunk) => {
        accumulated += chunk;
        setStreamingContent(accumulated);
      },
      onDone: ({ cleanText, intent }) => {
        setIsStreaming(false);
        setStreamingContent('');

        const assistantMsg: ChatMessageItem = {
          id: `msg_asst_${Date.now()}`,
          role: 'assistant',
          content: cleanText || accumulated,
          createdAt: new Date().toISOString(),
          proposal: intent || undefined,
          proposalState: intent ? 'pending' : undefined,
        };

        setMessages((prev) => [...prev, assistantMsg]);

        if (!isOpen) {
          setHasUnread(true);
        }
      },
      onError: (err) => {
        setIsStreaming(false);
        setStreamingContent('');
        const errorMsg: ChatMessageItem = {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: `⚠️ 对话推演异常: ${err.message || '未知错误'}`,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      },
    });
  };

  // 4. 执行行动提案
  const handleExecuteProposal = async (msg: ChatMessageItem) => {
    if (!msg.proposal || !msg.proposal.tool) return;

    // 工具名称标准化映射
    let tool = msg.proposal.tool;
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

    const params = { ...(msg.proposal.params || {}) };
    if (tool === 'film.character_portrait' || tool === 'film.scene_atmosphere') {
      params.force = true;
    }
    // 若在分镜模式，强制保证 clipId 传给后台
    if (tool === 'film.storyboard_planning' && clipId && !params.clipId) {
      params.clipId = clipId;
    }

    try {
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, proposalState: 'running' } : m))
      );

      const task = await onRunTool(tool, params);

      session.markProposalsResolved().catch(() => {});

      setMessages((prev) =>
        prev.map((m) =>
          m.id === msg.id
            ? {
                ...m,
                proposalState: 'completed',
                taskId: task?.taskId,
                taskTitle: msg.proposal?.title,
                taskStatus: 'completed',
              }
            : m
        )
      );

      onRefreshProject?.();
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msg.id ? { ...m, proposalState: 'failed', taskError: err?.message || '执行失败' } : m
        )
      );
    }
  };

  // 5. 各自专属的快捷场景感知推荐词
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
  const buttonGradient = isLookdev
    ? 'from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700'
    : 'from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700';

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
          <div className="w-[420px] h-[600px] max-h-[82vh] bg-white/95 backdrop-blur-xl border border-slate-200/90 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-300 ring-1 ring-black/5">
            {/* 顶部标题栏 */}
            <div className={`px-4 py-3 bg-gradient-to-r ${headerGradient} text-white flex items-center justify-between shadow-sm select-none`}>
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

            {/* 消息滚动区 */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3.5 bg-slate-50/50">
              {messages.map((msg) => {
                const isUser = msg.role === 'user';
                return (
                  <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`max-w-[88%] text-xs leading-relaxed px-3.5 py-2.5 rounded-2xl shadow-sm ${
                        isUser
                          ? isLookdev
                            ? 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white rounded-br-none'
                            : 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-br-none'
                          : 'bg-white text-slate-800 border border-slate-200/80 rounded-bl-none'
                      }`}
                    >
                      <div className="whitespace-pre-wrap">{msg.content}</div>

                      {/* 行动提案交互卡片 */}
                      {msg.proposal && (
                        <div className="mt-3 pt-2.5 border-t border-slate-200 bg-slate-100/70 -mx-1 px-3 py-2 rounded-xl border text-slate-800">
                          <div className="flex items-center justify-between text-xs font-bold text-slate-900">
                            <span className="flex items-center space-x-1">
                              <span>🎯</span>
                              <span>{msg.proposal.title}</span>
                            </span>
                          </div>
                          {msg.proposal.description && (
                            <div className="text-[11px] text-slate-600 mt-1">{msg.proposal.description}</div>
                          )}

                          <div className="mt-2.5 flex items-center justify-end space-x-2">
                            {msg.proposalState === 'completed' ? (
                              <span className="text-[11px] text-emerald-600 font-bold flex items-center space-x-1">
                                <span>✓</span>
                                <span>已调度执行</span>
                              </span>
                            ) : msg.proposalState === 'running' ? (
                              <span className="text-[11px] text-indigo-600 font-bold flex items-center space-x-1 animate-pulse">
                                <span>⏳</span>
                                <span>正在执行任务...</span>
                              </span>
                            ) : msg.id !== latestProposalMsgId ? (
                              <span className="text-[10px] text-slate-400 bg-slate-200/80 px-2 py-0.5 rounded border border-slate-300/60">
                                提案已由后续对话取代
                              </span>
                            ) : (
                              <button
                                onClick={() => handleExecuteProposal(msg)}
                                disabled={isBusy}
                                className={`px-3 py-1 bg-gradient-to-r ${buttonGradient} active:scale-95 text-white text-xs font-bold rounded-lg shadow transition-all cursor-pointer disabled:opacity-50`}
                              >
                                确认微调执行
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 mt-1 px-1">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                );
              })}

              {/* 流式打字中气泡 */}
              {isStreaming && (
                <div className="flex flex-col items-start">
                  <div className="max-w-[88%] text-xs leading-relaxed px-3.5 py-2.5 rounded-2xl bg-white text-slate-800 border border-slate-200/80 rounded-bl-none shadow-sm">
                    <div className="whitespace-pre-wrap">{streamingContent}</div>
                    <span className="inline-block w-1.5 h-3.5 bg-emerald-500 animate-pulse ml-1 align-middle"></span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* 快捷推荐词 Pills */}
            <div className="px-3 py-2 bg-slate-100/70 border-t border-slate-200 flex items-center space-x-1.5 overflow-x-auto no-scrollbar">
              {quickPills.map((pill, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessage(pill)}
                  disabled={isStreaming}
                  className="shrink-0 text-[11px] px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 rounded-full transition-colors cursor-pointer disabled:opacity-50 shadow-2xs"
                >
                  {pill}
                </button>
              ))}
            </div>

            {/* 底部输入框 */}
            <div className="p-3 bg-white border-t border-slate-200 flex items-center space-x-2">
              <input
                ref={inputRef}
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                disabled={isStreaming}
                placeholder={
                  mode === 'storyboard'
                    ? `对分幕 ${clipId || '当前幕'} 提镜头调度意见...`
                    : '对角色立绘外貌或场景空间提意见...'
                }
                className="flex-1 text-xs px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-all disabled:bg-slate-50"
              />
              <button
                onClick={() => handleSendMessage()}
                disabled={!inputText.trim() || isStreaming}
                className={`px-3.5 py-2 bg-gradient-to-r ${buttonGradient} text-white text-xs font-bold rounded-xl shadow transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer`}
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
