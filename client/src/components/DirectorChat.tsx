/**
 * client/src/components/DirectorChat.tsx
 * AI 视听总导演对话中枢视窗
 *
 * 单气泡口径（对齐旧版 ChatPanel）：
 * 「AI 回复 + 人在回路确认卡」「确认后的 AI 回复 + 任务进度条 + 完成内容 + 下一个确认意图」
 * 都收在同一个对话气泡里，任务状态由 App 轮询后端后写回该气泡。
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { ChatMessage } from '../hooks/useDirectorChat.js';
import type { ActionProposal, StageTaskView } from '../types/index.js';
import { getProposalButtonLabel } from './ProposalCard.js';

export interface ProposalApprovalContext {
  messageId: string;
  /** true = 来自任务成果区的「下一个确认意图」，false = 气泡初始确认卡 */
  fromTask: boolean;
}

interface DirectorChatProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  activeProposal: ActionProposal | null;
  onSendMessage: (msg: string) => void;
  onApproveProposal: (proposal: ActionProposal, ctx: ProposalApprovalContext) => void;
  onCancelTask?: (runId: string) => void;
  onOpenGame?: (url: string) => void;
  /** 点报错提示里的「重试」：原样重发失败那一轮的发言 */
  onRetry: (messageId: string) => void;
  /** 创作者在下面开始打字：撤掉旧报错与重试按钮 */
  onDismissErrors: () => void;
  /** 任务面板执行失败后重试：复用同一 runId 从已完成工序继续 */
  onRetryTask: (runId: string, messageId: string) => void;
  isExecutingProposal?: boolean;
}

/** 执行中计时：只在 running 态起表，结束后不再跳动 */
function useElapsedSeconds(startedAt: string, active: boolean) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = new Date(startedAt).getTime();
    const compute = () => setSec(Math.max(0, Math.round((Date.now() - start) / 1000)));
    compute();
    const timer = window.setInterval(compute, 500);
    return () => window.clearInterval(timer);
  }, [startedAt, active]);
  return sec;
}

interface InlineTaskPanelProps {
  task: StageTaskView;
  onOpenGame: (url: string) => void;
  onCancelTask?: (runId: string) => void;
  onRetryTask?: (runId: string) => void;
}

/** 气泡内任务面板：排队 / 进度条 / 完成内容 + 已授权标记 / 失败 / 已取消 */
function InlineTaskPanel({
  task,
  onOpenGame,
  onCancelTask,
  onRetryTask,
}: InlineTaskPanelProps) {
  const elapsed = useElapsedSeconds(task.startedAt, task.status === 'running');
  const percent = Math.min(100, Math.max(4, task.percent));

  const head = {
    queued: { icon: '⏳', label: `已授权，等待执行：${task.title}`, badge: 'QUEUED' },
    running: { icon: '⚙️', label: `执行中：${task.title}`, badge: `${percent}% · ${elapsed}s` },
    succeeded: { icon: '✅', label: `已完成：${task.title}`, badge: 'DONE' },
    failed: { icon: '⚠️', label: `执行失败：${task.title}`, badge: 'FAILED' },
    cancelled: { icon: '⏹️', label: `已取消：${task.title}`, badge: 'CANCELLED' },
  }[task.status];

  const canCancel = (task.status === 'running' || task.status === 'queued') && Boolean(task.runId) && Boolean(onCancelTask);

  return (
    <div className={`inline-task inline-task--${task.status}`}>
      <div className="inline-task-head">
        <span className="inline-task-icon">{head.icon}</span>
        <span className="inline-task-title">{head.label}</span>
        <span className="inline-task-badge">{head.badge}</span>
        {canCancel && (
          <button
            type="button"
            className="btn-cancel-inline"
            title="中止当前运行中任务"
            onClick={() => onCancelTask?.(task.runId)}
          >
            停止
          </button>
        )}
      </div>

      {task.status === 'queued' && (
        <p className="inline-task-note">已排入执行队列，引擎接管后即开始推进…</p>
      )}

      {task.status === 'running' && (
        <>
          <div className="task-progress-track">
            <div className="task-progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <p className="inline-task-note">{task.note}</p>
        </>
      )}

      {task.status === 'succeeded' && (
        <>
          {task.resultSummary && <p className="task-result">{task.resultSummary}</p>}

          {task.gameUrl && (
            <div className="task-artifact-row">
              <span className="task-artifact-label">产物</span>
              <button
                type="button"
                className="task-artifact-link"
                onClick={() => onOpenGame(task.gameUrl!)}
              >
                🎮 index.html 游戏
              </button>
              <span className="task-artifact-hint">可直接试玩，玩家修改后续接入</span>
            </div>
          )}

          {task.nextProposal && task.nextProposalResolved && (
            <div className="proposal-resolved">✅ 已授权进入下一阶段</div>
          )}
        </>
      )}

      {task.status === 'failed' && (
        <>
          <p className="task-error">{task.note}</p>
          {task.runId && onRetryTask && (
            <div className="task-retry-row">
              <button
                type="button"
                className="btn-retry-inline"
                title="复用这个任务，从上次完成的工序继续跑"
                onClick={() => onRetryTask(task.runId)}
              >
                ↻ 重试
              </button>
              <span className="task-retry-hint">从已完成工序继续，不重跑已有产物</span>
            </div>
          )}
        </>
      )}
      {task.status === 'cancelled' && <p className="inline-task-note">{task.note}</p>}
    </div>
  );
}

export const DirectorChat: React.FC<DirectorChatProps> = ({
  messages,
  isStreaming,
  activeProposal,
  onSendMessage,
  onApproveProposal,
  onCancelTask,
  onOpenGame,
  onRetry,
  onDismissErrors,
  onRetryTask,
  isExecutingProposal = false,
}) => {
  const [input, setInput] = useState('');
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const prevFirstMsgIdRef = useRef<string | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isTaskRunning = messages.some(
    (m) => m.task?.status === 'running' || m.task?.status === 'queued'
  );
  const isBusy = isStreaming || isTaskRunning || isExecutingProposal;

  /** 任务已经接管推进，说明旧报错被后续动作盖过了，直接收起提示 */
  useEffect(() => {
    if (isTaskRunning) onDismissErrors();
  }, [isTaskRunning, onDismissErrors]);

  /** 检查是否处于流式且最新一条 assistant 消息尚未输出任何内容（思考中） */
  const isThinking = useMemo(() => {
    if (!isStreaming) return false;
    const lastMsg = messages[messages.length - 1];
    return Boolean(lastMsg && lastMsg.role === 'assistant' && !lastMsg.content.trim() && !lastMsg.task);
  }, [isStreaming, messages]);

  /** 待审确认动作统一收口到底部输入栏「发送」旁，避免占满气泡空间 */
  const pendingConfirmation = useMemo<{
    proposal: ActionProposal;
    ctx: ProposalApprovalContext;
  } | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.task?.status === 'succeeded' && m.task.nextProposal && !m.task.nextProposalResolved) {
        return { proposal: m.task.nextProposal, ctx: { messageId: m.id, fromTask: true } };
      }
      if (m.proposal && !m.proposalResolved) {
        return { proposal: m.proposal, ctx: { messageId: m.id, fromTask: false } };
      }
    }
    return null;
  }, [messages]);

  const handleChatScroll = () => {
    const el = chatContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceToBottom <= 80;
  };

  useEffect(() => {
    const firstId = messages[0]?.id;
    const isFreshConversation =
      messages.length === 0 || (firstId !== undefined && firstId !== prevFirstMsgIdRef.current);
    prevFirstMsgIdRef.current = firstId;
    if (isFreshConversation) {
      shouldAutoScrollRef.current = true;
    }

    const el = chatContainerRef.current;
    if (!el || !shouldAutoScrollRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming, activeProposal, pendingConfirmation]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(54, Math.min(el.scrollHeight, 160))}px`;
  }, [input]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isBusy) return;
    shouldAutoScrollRef.current = true;
    onDismissErrors();
    onSendMessage(input);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="director-pane">
      <div className="pane-header">
        <div className="pane-title">
          <span>🧠</span>
          <span>AI 视听总导演 (Director)</span>
        </div>
        {isThinking && (
          <span className="indicator-pill thinking">
            <span className="thinking-dot-pulse" />
            🧠 总导演思考中...
          </span>
        )}
        {!isThinking && isStreaming && (
          <span className="indicator-pill ready">⚡ 流式打字中...</span>
        )}
        {!isStreaming && (pendingConfirmation || activeProposal) && (
          <span className="indicator-pill ready">🙋 等待创作者确认</span>
        )}
      </div>

      <div ref={chatContainerRef} className="chat-messages" onScroll={handleChatScroll}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '40px', fontSize: '13px' }}>
            <p style={{ marginBottom: '12px' }}>👋 我是您的 AI 视听总导演兼系统架构师。</p>
            <p>告诉我想象中的题材或核心悬念，我将为您推演世界观并直接产出可玩文游。</p>
            <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                className="btn btn-secondary"
                style={{ fontSize: '12px', textAlign: 'left' }}
                onClick={() => {
                  shouldAutoScrollRef.current = true;
                  onSendMessage('构思一个废土赛博朋克深海潜艇的封闭悬疑博弈互动文游');
                }}
              >
                💡 废土深海潜艇悬疑剧本
              </button>
              <button
                className="btn btn-secondary"
                style={{ fontSize: '12px', textAlign: 'left' }}
                onClick={() => {
                  shouldAutoScrollRef.current = true;
                  onSendMessage('构思一个古风中式悬疑雨夜山庄密室逃脱文游');
                }}
              >
                💡 中式悬疑山庄密室逃脱
              </button>
            </div>
          </div>
        )}

        {messages.map((m, idx) => {
          const isLast = idx === messages.length - 1;
          const isStreamingPlaceholder =
            isStreaming && isLast && m.role === 'assistant' && !m.content.trim() && !m.task;
          // 既无正文、任务面板、报错提示的气泡（如服务端已撤销的寒暄回复）不渲染空框
          if (!m.content.trim() && !m.task && !m.error && !isStreamingPlaceholder) return null;

          return (
          <div key={m.id} className={`message-row ${m.role}`}>
            <div className="message-meta">
              <span>{m.role === 'user' ? '👤 创作者' : '🎬 视听总导演'}</span>
              <span>{new Date(m.createdAt).toLocaleTimeString()}</span>
            </div>

            {/* 单气泡：正文 + 已授权记录 + 任务进度 / 成果（未确认操作统一放到输入框发送旁） */}
            <div className={`message-bubble${m.task ? ' has-panel' : ''}`}>
              {m.content ? (
                m.content
              ) : isStreamingPlaceholder ? (
                <div className="director-thinking">
                  <div className="thinking-icon-glow">
                    <span className="thinking-sparkle">🧠</span>
                  </div>
                  <div className="thinking-text-wrap">
                    <span className="thinking-text">总导演正在思考中</span>
                    <span className="thinking-dots">
                      <span className="dot" />
                      <span className="dot" />
                      <span className="dot" />
                    </span>
                  </div>
                </div>
              ) : (
                ''
              )}

              {m.error && (
                <div className="chat-error">
                  <span className="chat-error-text">{m.error.message}</span>
                  <button
                    type="button"
                    className="btn-retry-inline"
                    disabled={isStreaming}
                    title="重发刚才那句话，重新走一轮总导演推演"
                    onClick={() => {
                      shouldAutoScrollRef.current = true;
                      onRetry(m.id);
                    }}
                  >
                    ↻ 重试
                  </button>
                </div>
              )}

              {m.task && (
                <InlineTaskPanel
                  task={m.task}
                  onOpenGame={(url) => onOpenGame?.(url)}
                  onCancelTask={onCancelTask}
                  onRetryTask={(runId) => {
                    shouldAutoScrollRef.current = true;
                    onDismissErrors();
                    onRetryTask(runId, m.id);
                  }}
                />
              )}
            </div>
          </div>
          );
        })}
      </div>

      <form className="chat-input-area" onSubmit={handleSubmit}>
        <div className="composer-box">
          <textarea
            ref={textareaRef}
            rows={2}
            className="chat-textarea"
            placeholder={
              isTaskRunning
                ? '任务执行中，请等待当前工序完成...'
                : '与总导演探讨剧情构思、微调人设或发起工序指令...'
            }
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (e.target.value.trim()) onDismissErrors();
            }}
            onKeyDown={handleKeyDown}
            disabled={isBusy}
          />
          <div className="composer-footer">
            <div className="composer-footer-left">
              {pendingConfirmation ? (
                <button
                  type="button"
                  className="btn btn-approve-inline"
                  disabled={isBusy}
                  title={pendingConfirmation.proposal.summary}
                  onClick={() => {
                    shouldAutoScrollRef.current = true;
                    onDismissErrors();
                    onApproveProposal(pendingConfirmation.proposal, pendingConfirmation.ctx);
                  }}
                >
                  <span>{isExecutingProposal ? '⏳' : '▶'}</span>
                  <span className="btn-approve-label">
                    {isExecutingProposal
                      ? '启动中...'
                      : getProposalButtonLabel(pendingConfirmation.proposal)}
                  </span>
                </button>
              ) : (
                <span className="composer-hint">Enter 发送 · Shift+Enter 换行</span>
              )}
            </div>
            <button
              type="submit"
              className="btn btn-primary composer-send-btn"
              disabled={!input.trim() || isBusy}
            >
              发送
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
