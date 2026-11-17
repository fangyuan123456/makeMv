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
import type { ProjectData, TaskRecord } from '../../../types/index.js';
import {
  PlannerChatSessionClient,
  type ChatMessageItem,
  type PlannerActionIntent,
} from '../../../lib/ChatSession.js';
import { useDirectorChatFlow } from '../../../hooks/useDirectorChatFlow.js';
import { DirectorTaskCard } from './DirectorTaskCard.js';
import { ProposalCard } from './ProposalCard.js';

export type ActionIntent = PlannerActionIntent;
export type { ChatMessageItem };

interface PlannerChatProps {
  projectId: string;
  projectData: ProjectData | null;
  onRunTool: (toolName: string, input: Record<string, any>) => Promise<TaskRecord | any>;
  tasks?: TaskRecord[];
  onAssetProduced?: (type: 'screenplay' | 'prd') => void;
  onSelectStage?: (stage: string) => void;
  isBusy: boolean;
}

export const PlannerChat: React.FC<PlannerChatProps> = ({
  projectId,
  projectData,
  onRunTool,
  tasks = [],
  onAssetProduced,
  isBusy,
}) => {
  const session = useMemo(() => new PlannerChatSessionClient(projectId || ''), [projectId]);

  const defaultWelcome =
    '你好，我是你的专属故事总监。我负责为你构建本互动影游的世界观大纲、人物动机与多结局分支因果树。\n你可以直接向我描述故事设想，也可以点击下方的灵感预设开始构思。';

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
    onRefreshProject: () => {},
    isBusy,
    defaultWelcomeMessage: defaultWelcome,
    welcomeMessageId: 'welcome_msg',
    resolveHistoricalProposals: (h, data) => {
      // 仅凭资产已存在不能判定提案已执行；未绑定任务的最新修改提案必须保留待审卡片。
      // 旧提案本身已有 proposalResolved 标记时，历史加载器会直接使用该标记。
      if (!h.taskId && h.taskStatus !== 'completed') return false;
      const hasScreenplay = Boolean(data?.screenplay || data?.artifacts?.screenplay);
      const hasPrd = Boolean(data?.prd || data?.artifacts?.prd || data?.artifacts?.prdMarkdown);
      if (h.proposal?.action === 'next_stage') return true;
      if (h.proposal?.tool === 'planner.screenplay_writer' && hasScreenplay) return true;
      if (h.proposal?.tool === 'planner.script_to_prd' && hasPrd) return true;
      return false;
    },
    generatePostTaskTriggerPrompt: (toolName, actionTitle) => {
      const isStage1AllCompleted = toolName.includes('prd');
      return isStage1AllCompleted
        ? `【制片工序事件】工序【${actionTitle || toolName}】已圆满执行并物理落盘！剧本与 PRD 双基准均已收敛，工序 1 全线完工。请你对照当前【工序 1 制片管线与实时状态看板】，为创作者出具工序 1 全景收官总纲复盘。`
        : `【制片工序事件】工序【${actionTitle || toolName}】已圆满执行并物理落盘！请你对照当前【工序 1 制片管线与实时状态看板】，为创作者出具阶段复盘，并阐述下一步 PRD 分幕拓扑拆解方案。`;
    },
    onAssetProduced: onAssetProduced ? (type) => onAssetProduced(type as any) : undefined,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
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

  // 灵感预设胶囊
  const quickPrompts = [
    '题材：科幻生存，空间站引力异常，舰长在副手与AI间抉择',
    '题材：末日悬疑，记忆被篡改的侦探调查避难所谋杀案',
    '在第二幕增加一个关于氧气配给的高风险道德难题',
    '直接为我推演完整的全景互动剧本',
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
            <p className="text-[10px] text-slate-400 mt-0.5">工序 1 专属互动叙事架构师</p>
          </div>
        </div>

        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white text-slate-500 border border-slate-200/70 shadow-2xs">
          STAGE 01 COPILOT
        </span>
      </div>

      {/* 消息对话流视窗 */}
      <div ref={messagesViewportRef} onScroll={handleMessagesScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => {
          // 刚性过滤无内容无任务无提案的空消息，彻底消灭幽灵圆圈
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
                proposalAccentClassName="bg-indigo-600 hover:bg-indigo-700"
                directorRoleName="故事总监"
                progressGradientClass="from-indigo-500 via-indigo-600 to-purple-600"
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
                <div className="whitespace-pre-wrap">{msg.content}</div>
                {msg.proposal && msg.proposalState === 'pending' && pendingProposalMsg?.id === msg.id && (
                  <ProposalCard
                    proposal={msg.proposal}
                    onApprove={() => handleSendMessage('同意')}
                    disabled={isStreaming || isBusy || isTaskRunning}
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
                disabled={isStreaming || isBusy || isTaskRunning}
                className="text-left px-2.5 py-1.5 bg-white hover:bg-indigo-50/80 hover:border-indigo-200 hover:text-indigo-700 text-slate-700 text-[11px] rounded-xl border border-slate-200/90 shadow-2xs transition-all leading-relaxed disabled:opacity-40 cursor-pointer"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 底部输入框与人在回路真实状态操作条 */}
      <div className="p-3.5 border-t border-slate-100 bg-white flex-shrink-0">
        <div className="flex items-center space-x-2">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder={
              isTaskRunning
                ? '后台任务正在执行，请稍候...'
                : '描述你的剧情构想、修改意见或向总监提问 (Enter 发送)...'
            }
            rows={1}
            disabled={isStreaming || isTaskRunning}
            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100 transition resize-none leading-relaxed shadow-2xs disabled:opacity-50"
          />

          <button
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || isStreaming || isBusy || isTaskRunning}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl text-xs transition disabled:opacity-40 shadow-xs active:scale-[0.99] flex-shrink-0 cursor-pointer"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
};
