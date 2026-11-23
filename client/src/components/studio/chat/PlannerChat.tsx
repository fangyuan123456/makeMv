/**
 * client/src/components/studio/chat/PlannerChat.tsx
 * 工序 1 专属故事总监对话座舱 (Planner Specialist Chat SSOT)
 *
 * 核心微内核架构：
 * 1. 采用全系统统一对话生命周期微内核 (useDirectorChatFlow)；
 * 2. 采用全系统统一任务推演卡片 (DirectorTaskCard)；
 * 3. 初始引导灵感胶囊在对话开启后自动隐匿，界面高度聚焦；
 * 4. 仅通过自然语言“同意”完成提案批准。
 */

import React, { useRef, useEffect, useMemo } from 'react';
import type { TaskRecord } from '../../../types/index.js';
import {
  PlannerConversationClient,
  type ConversationMessage,
  type PlannerActionIntent,
} from '../../../lib/DirectorConversation.js';
import { useDirectorChatFlow } from '../../../hooks/useDirectorChatFlow.js';
import { DirectorTaskCard } from './DirectorTaskCard.js';
import { ProposalCard } from './ProposalCard.js';
import { ChatAttachmentStrip } from './ChatAttachmentStrip.js';

export type ActionIntent = PlannerActionIntent;
export type { ConversationMessage };

interface PlannerChatProps {
  projectId: string;
  tasks?: TaskRecord[];
  onRefreshProject?: () => void;
}

export const PlannerChat: React.FC<PlannerChatProps> = ({
  projectId,
  tasks = [],
  onRefreshProject,
}) => {
  const session = useMemo(() => new PlannerConversationClient(projectId || ''), [projectId]);

  const defaultWelcome =
    '你好，我是你的专属故事总监。我负责为你构建本互动影游的世界观大纲、人物动机与多结局分支因果树。\n你可以直接向我描述故事设想，也可以点击下方的灵感预设开始构思。';

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
    welcomeMessageId: 'welcome_msg',
    mode: 'planner',
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const shouldAutoScrollRef = useRef(true);

  const handleMessagesScroll = () => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    shouldAutoScrollRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 20;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  };

  useEffect(() => {
    if (shouldAutoScrollRef.current) scrollToBottom();
  }, [messages, streamingContent, streamingAppendContent]);

  // 灵感预设胶囊（题材中立，聚焦网状叙事与互动影游核心戏剧决策）
  const quickPrompts = [
    '🎲 规划包含多重结局分支的网状互动剧本',
    '⚡ 在核心分幕设计一个关乎生死的高压道德难题',
    '🎭 梳理各阵营核心人物的隐秘动机与对立冲突',
    '🎬 为各分幕拆解电影级戏剧节拍与互动规则',
  ];

  // 灵感胶囊仅在初始未开始对话阶段展示；一旦创作者开始对话或正在打字，立即自动隐藏
  const hasUserDialogue = useMemo(() => messages.some((m) => m.role === 'user'), [messages]);
  const isInputting = inputText.trim().length > 0;
  const showQuickPrompts = !hasUserDialogue && !isInputting && quickPrompts.length > 0 && !isTaskRunning;

  return (
    <div className="flex flex-col h-full bg-white border border-slate-200/90 rounded-2xl shadow-sm overflow-hidden">
      {/* 顶部总监状态栏 */}
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/60 flex-shrink-0">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-base shadow-2xs">
            🎭
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-slate-900 tracking-tight">故事总监</span>
              <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200/80 text-[10px] text-emerald-700 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>在线指导</span>
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {focusLabel ? `🎯 当前聚焦: ${focusLabel}` : '工序 1 专属互动叙事架构师'}
            </p>
          </div>
        </div>

        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white text-slate-500 border border-slate-200/70 shadow-2xs">
          STAGE 01 COPILOT
        </span>
      </div>

      {/* 消息对话流视窗 */}
      <div ref={messagesViewportRef} onScroll={handleMessagesScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => {
          // 刚性过滤无内容无附件无任务无提案的空消息，彻底消灭幽灵圆圈
          if (!msg.content?.trim() && !msg.attachments?.length && !msg.taskId && !msg.planSteps?.length && !msg.proposal) {
            return null;
          }

          const isUser = msg.role === 'user';
          const hasTask = Boolean(msg.taskId || (msg.planSteps && msg.planSteps.length > 0));

          // 统一任务推演卡片（支持单步原子任务与多步 Plan 执行清单）
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
                directorRoleName="故事总监"
                progressGradientClass="from-indigo-500 via-indigo-600 to-purple-600"
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
                  {isUser ? '创作者' : '故事总监'}
                </span>
              </div>

              <div
                className={`max-w-[88%] p-3.5 rounded-2xl text-xs leading-relaxed break-words shadow-2xs ${
                  isUser
                    ? 'bg-slate-800 text-white rounded-tr-xs'
                    : 'bg-slate-50/80 border border-slate-200/80 text-slate-800 rounded-tl-xs'
                }`}
              >
                {msg.attachments && msg.attachments.length > 0 && (
                  <ChatAttachmentStrip
                    attachments={msg.attachments}
                    variant="message"
                    size="md"
                    className="mb-2"
                  />
                )}
                {msg.content && <div className="whitespace-pre-wrap">{msg.content}</div>}
                {msg.proposal && !msg.taskId && (!msg.planSteps || msg.planSteps.length === 0) && msg.proposalState === 'pending' && pendingProposalMsg?.id === msg.id && (
                  <ProposalCard
                    proposal={msg.proposal}
                    onApprove={() => handleApproveProposal(msg.id)}
                    disabled={isStreaming || isApproving || isTaskRunning}
                  />
                )}
              </div>
            </div>
          );
        })}

        {/* 流式打字中占位 */}
        {isStreaming && (
          <div className="flex flex-col items-start space-y-1">
            <span className="text-[10px] font-medium text-slate-400 px-1">故事总监</span>
            <div className="max-w-[88%] p-3.5 rounded-2xl rounded-tl-xs bg-slate-50/80 border border-slate-200/80 text-xs text-slate-800 leading-relaxed shadow-2xs">
              <div className="whitespace-pre-wrap">{streamingContent}</div>
              <span className="inline-block w-1.5 h-3.5 bg-indigo-600 ml-1 animate-pulse align-middle"></span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 快捷灵感词胶囊：仅在初始空白引导阶段展示，对话开启后自动隐匿 */}
      {showQuickPrompts && (
        <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/50 flex flex-col gap-1.5 flex-shrink-0">
          <div className="flex items-center space-x-1 text-[11px] font-semibold text-slate-500">
            <span>💡</span>
            <span>灵感预设与建议构想:</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {quickPrompts.map((p, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSendMessage(p)}
                disabled={isStreaming || isTaskRunning}
                className="text-left px-2.5 py-1.5 bg-white hover:bg-indigo-50/80 hover:border-indigo-200 hover:text-indigo-700 text-slate-700 text-[11px] rounded-xl border border-slate-200/90 shadow-2xs transition-all leading-relaxed disabled:opacity-40 cursor-pointer"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 底部输入框与人在回路真实状态操作条 */}
      <div className="p-3.5 border-t border-slate-100 bg-white flex-shrink-0 space-y-2">
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
            size="md"
            onRemove={handleRemovePendingImage}
          />
        )}

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={isStreaming || isTaskRunning || isUploadingImage || pendingImages.length >= 4}
            className="p-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 rounded-xl text-xs transition disabled:opacity-40 cursor-pointer flex-shrink-0"
            title="发送图片（支持多选，也可直接 Ctrl+V 粘贴截图）"
          >
            {isUploadingImage ? '⏳' : '🖼️'}
          </button>

          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onPaste={handlePasteImages}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder={
              isTaskRunning
                ? '后台任务正在执行，请稍候...'
                : '描述你的剧情构想、修改意见，或粘贴参考图 (Enter 发送)...'
            }
            rows={1}
            disabled={isStreaming || isTaskRunning}
            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100 transition resize-none leading-relaxed shadow-2xs disabled:opacity-50"
          />

          <button
            onClick={() => handleSendMessage()}
            disabled={(!inputText.trim() && pendingImages.length === 0) || isStreaming || isUploadingImage || isTaskRunning}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl text-xs transition disabled:opacity-40 shadow-xs active:scale-[0.99] flex-shrink-0 cursor-pointer"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
};
