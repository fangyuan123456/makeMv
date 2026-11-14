/**
 * client/src/hooks/useDirectorChat.ts
 * AI 视听总导演 SSE 流式对话与断线续传 Hook (Director Stream Hook)
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type { ActionProposal, StageTaskView } from '../types/index.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  /** AI 提出的人在这条气泡上的确认意图 */
  proposal?: ActionProposal;
  /** 已授权：保留历史痕迹但不再渲染可点按钮 */
  proposalResolved?: boolean;
  /** 确认后这条 AI 回复气泡承载的阶段任务（进度条 / 成果 / 下一个确认意图） */
  task?: StageTaskView;
  /** 本轮失败：气泡上挂一条带「重试」的错误提示，不写进正文，方便随时摘掉 */
  error?: {
    /** 完整展示文案 */
    message: string;
    /** 触发本轮失败的创作者原文，点「重试」时原样重发 */
    retryText: string;
  };
}

/** 清掉所有气泡上的错误提示：用户一打字 / 点重试 / 新一轮开始回复，旧报错就不再挂着 */
function withoutErrors(list: ChatMessage[]): ChatMessage[] {
  return list.some((m) => m.error)
    ? list.map((m) => (m.error ? { ...m, error: undefined } : m))
    : list;
}

/** 失败气泡前面最近的一条创作者发言，就是本轮要重发的原文 */
function findRetryText(list: ChatMessage[], targetMsgId: string): string {
  const idx = list.findIndex((m) => m.id === targetMsgId);
  for (let i = idx - 1; i >= 0; i--) {
    if (list[i].role === 'user' && list[i].content.trim()) return list[i].content;
  }
  return '';
}

export interface StartedTaskEvent {
  runId: string;
  stage: 'plan_gdd' | 'extract_visual_spec' | 'build_text_game' | 'compile_film';
  title?: string;
  status?: string;
  ownerMessageId?: string;
}

export interface UseDirectorChatOptions {
  /** 开始发送首轮或后续聊天时回调（用于同步 URL projectId 等副作用） */
  onChatStart?: (projectId: string) => void;
  /** 本轮 SSE 回复完成时回调（用于刷新右侧工程列表/元数据） */
  onChatFinish?: (projectId: string) => void;
  /** 对话中识别到 approve_stage 并由服务端自动启动/推进任务时回调 */
  onTaskStarted?: (info: StartedTaskEvent & { messageId: string }) => void;
}

export function useDirectorChat(projectId: string, options?: UseDirectorChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeProposal, setActiveProposal] = useState<ActionProposal | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingLockRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;
  const onChatStartRef = useRef(options?.onChatStart);
  const onChatFinishRef = useRef(options?.onChatFinish);
  const onTaskStartedRef = useRef(options?.onTaskStarted);
  onChatStartRef.current = options?.onChatStart;
  onChatFinishRef.current = options?.onChatFinish;
  onTaskStartedRef.current = options?.onTaskStarted;

  // 只在真正切换项目时中断未完成请求并清空对话（URL 同步不变更 projectId 时不抹掉气泡）
  const prevProjectIdRef = useRef(projectId);
  useEffect(() => {
    if (prevProjectIdRef.current === projectId) return;
    prevProjectIdRef.current = projectId;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    streamingLockRef.current = false;
    setIsStreaming(false);
    setMessages([]);
    setActiveProposal(null);
  }, [projectId]);

  /** 用服务端落盘记录一次性水合当前会话气泡与待决提案 */
  const hydrateMessages = useCallback(
    (restored: ChatMessage[], pendingProposal: ActionProposal | null) => {
      setMessages(restored);
      setActiveProposal(pendingProposal);
    },
    []
  );

  /** 追加消息：用于「确认动作」+「AI 承接回复」两条气泡 */
  const appendMessages = useCallback((...items: ChatMessage[]) => {
    setMessages((prev) => [...prev, ...items]);
  }, []);

  /** 就地更新某条气泡（任务进度 / 成果 / 下一确认意图都写回同一气泡；未变更则保留原引用防无效重绘） */
  const patchMessage = useCallback(
    (id: string, updater: (message: ChatMessage) => ChatMessage) => {
      setMessages((prev) => {
        let changed = false;
        const next = prev.map((m) => {
          if (m.id !== id) return m;
          const updated = updater(m);
          if (updated !== m) changed = true;
          return updated;
        });
        return changed ? next : prev;
      });
    },
    []
  );

  /** 共用 SSE 消费循环：支持首连增量 delta，以及断线重连后的全量 snapshot + 后续 delta */
  const consumeSseStream = useCallback(
    async (
      response: Response,
      targetMsgId: string,
      initialContent: string = '',
      retryText: string = ''
    ) => {
      if (!response.body) {
        throw new Error(`流式响应体为空: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedText = initialContent;
      let clearedErrors = false;
      /** 本轮一旦又开始出内容（打字 / 提案 / 任务），旧的报错提示就撤掉 */
      const clearStaleErrorsOnce = () => {
        if (clearedErrors) return;
        clearedErrors = true;
        setMessages((prev) => withoutErrors(prev));
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.replace(/^data:\s*/, '');
          if (payload === '[DONE]') {
            break;
          }

          try {
            const parsed = JSON.parse(payload);
            if (parsed.type !== 'error') clearStaleErrorsOnce();
            if (parsed.type === 'snapshot') {
              accumulatedText = typeof parsed.content === 'string' ? parsed.content : '';
              setMessages((prev) =>
                prev.map((m) => (m.id === targetMsgId ? { ...m, content: accumulatedText } : m))
              );
            } else if (parsed.type === 'text' && parsed.delta) {
              accumulatedText += parsed.delta;
              setMessages((prev) =>
                prev.map((m) => (m.id === targetMsgId ? { ...m, content: accumulatedText } : m))
              );
            } else if (parsed.type === 'proposal' && parsed.proposal) {
              setActiveProposal(parsed.proposal);
              setMessages((prev) =>
                prev.map((m) => (m.id === targetMsgId ? { ...m, proposal: parsed.proposal } : m))
              );
            } else if (parsed.type === 'task' && parsed.task) {
              const t = parsed.task as StartedTaskEvent;
              const nowIso = new Date().toISOString();
              const existingOwner = messagesRef.current.find(
                (m) =>
                  (t.ownerMessageId && m.id === t.ownerMessageId) ||
                  (m.task?.runId === t.runId && m.task?.stage === t.stage)
              );
              const ownerMsgId = existingOwner ? existingOwner.id : targetMsgId;

              setActiveProposal(null);
              setMessages((prev) =>
                prev.map((m) => {
                  const withResolvedProposal =
                    m.proposal && !m.proposalResolved ? { ...m, proposalResolved: true } : m;
                  const withResolvedNext =
                    withResolvedProposal.task?.nextProposal &&
                    !withResolvedProposal.task.nextProposalResolved
                      ? {
                          ...withResolvedProposal,
                          task: { ...withResolvedProposal.task, nextProposalResolved: true },
                        }
                      : withResolvedProposal;

                  if (withResolvedNext.id === ownerMsgId) {
                    return {
                      ...withResolvedNext,
                      proposal: undefined,
                      proposalResolved: undefined,
                      task: {
                        runId: t.runId,
                        stage: t.stage,
                        title:
                          t.title ||
                          existingOwner?.task?.title ||
                          (t.stage === 'build_text_game'
                            ? '装配互动文游 (index.html)'
                            : '推演游戏策划案 (GDD)'),
                        status: 'running',
                        percent: 0,
                        note: existingOwner
                          ? '已恢复执行，流水线继续推进中…'
                          : '已通过对话授权，流水线接管推进中…',
                        startedAt: nowIso,
                      },
                    };
                  }

                  if (withResolvedNext.id === targetMsgId) {
                    return {
                      ...withResolvedNext,
                      proposal: undefined,
                      proposalResolved: undefined,
                    };
                  }

                  return withResolvedNext;
                })
              );
              onTaskStartedRef.current?.({ ...t, messageId: ownerMsgId });
            } else if (parsed.type === 'remove' && parsed.messageId) {
              // 服务端判定本轮意图已落到既有任务气泡上：整轮撤销。
              // 服务端记录 id 与前端乐观气泡 id 不同源，因此 turn 级撤销要按本地
              // 「本轮 assistant 占位 + 其前一条创作者发言」一并回收；
              // 承载任务面板的气泡永不删除，避免面板凭空消失。
              const removedId = String(parsed.messageId);
              setMessages((prev) => {
                const drop = new Set<string>([removedId]);
                if (parsed.turn) {
                  const idx = prev.findIndex((m) => m.id === targetMsgId);
                  if (idx >= 0) {
                    drop.add(prev[idx].id);
                    for (let i = idx - 1; i >= 0; i--) {
                      if (prev[i].role === 'user') {
                        drop.add(prev[i].id);
                        break;
                      }
                    }
                  }
                }
                return prev.filter((m) => !drop.has(m.id) || Boolean(m.task));
              });
            } else if (parsed.type === 'error') {
              // 报错不写进正文：单独挂错误提示 + 重试按钮，后续一有新动作就整块摘掉
              const original = retryText || findRetryText(messagesRef.current, targetMsgId);
              setMessages((prev) =>
                withoutErrors(prev).map((m) =>
                  m.id === targetMsgId
                    ? {
                        ...m,
                        error: {
                          message: `[导演总控提示: ${String(parsed.error || '总控对话异常')}]`,
                          retryText: original,
                        },
                      }
                    : m
                )
              );
            }
          } catch {
            // 忽略非 JSON 行
          }
        }
      }
    },
    []
  );

  /** 发起一轮对话；baseMessages 由调用方给定，重试时可以先回收失败轮的气泡 */
  const startTurn = useCallback(async (text: string, baseMessages: ChatMessage[]) => {
    if (!text.trim() || isStreaming || streamingLockRef.current) return;

    streamingLockRef.current = true;
    onChatStartRef.current?.(projectId);

    const userMsgId = 'msg_' + Date.now();
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };

    const assistantMsgId = 'msg_asst_' + Date.now();
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    };

    // 乐观更新消息列表（发给服务端的 history 保留关联任务元数据，让 AI 看见 taskId 与实时状态）
    const priorHistory = baseMessages
      .filter((m) => m.content.trim().length > 0 || Boolean(m.task))
      .map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.task
          ? {
              task: {
                runId: m.task.runId,
                stage: m.task.stage,
                status: m.task.status,
                title: m.task.title,
                note: m.task.note,
              },
            }
          : {}),
      }));
    setMessages([...baseMessages, userMsg, assistantMsg]);
    setIsStreaming(true);
    setActiveProposal(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(`/api/chat/${encodeURIComponent(projectId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: priorHistory,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`连接总导演中枢失败: ${response.statusText}`);
      }

      await consumeSseStream(response, assistantMsgId, '', text);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  error: {
                    message: `[网络或服务异常: ${err.message}]`,
                    retryText: text,
                  },
                }
              : m
          )
        );
      }
    } finally {
      streamingLockRef.current = false;
      setIsStreaming(false);
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (!controller.signal.aborted) {
        onChatFinishRef.current?.(projectId);
      }
    }
  }, [projectId, isStreaming, consumeSseStream]);

  const sendMessage = useCallback(
    (text: string) => startTurn(text, withoutErrors(messagesRef.current)),
    [startTurn]
  );

  /** 点错误提示上的「重试」：回收失败轮的创作者发言 + 错误气泡，原样重发一次 */
  const retryFailed = useCallback(
    (messageId: string) => {
      if (isStreaming || streamingLockRef.current) return;
      const list = messagesRef.current;
      const idx = list.findIndex((m) => m.id === messageId);
      const text = list[idx]?.error?.retryText || findRetryText(list, messageId);
      if (!text.trim()) return;

      const drop = new Set<string>([messageId]);
      for (let i = idx - 1; i >= 0; i--) {
        if (list[i].role === 'user') {
          drop.add(list[i].id);
          break;
        }
      }
      return startTurn(text, withoutErrors(list.filter((m) => !drop.has(m.id))));
    },
    [isStreaming, startTurn]
  );

  /** 创作者在下面开始打字：旧报错与重试按钮立即收起 */
  const dismissErrors = useCallback(() => {
    setMessages((prev) => withoutErrors(prev));
  }, []);

  /** 刷新恢复中途：若服务端仍在流式生成，自动挂载 GET /stream 续打字直到提案落位 */
  const resumeStream = useCallback(
    async (targetMsgId: string, initialContent: string = '') => {
      if (streamingLockRef.current) return;
      streamingLockRef.current = true;
      setIsStreaming(true);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await fetch(`/api/chat/${encodeURIComponent(projectId)}/stream`, {
          method: 'GET',
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`重连总导演流失败: ${response.statusText}`);
        }
        await consumeSseStream(response, targetMsgId, initialContent);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === targetMsgId
                ? {
                    ...m,
                    error: {
                      message: `[流式续传异常: ${err.message}]`,
                      retryText: findRetryText(prev, targetMsgId),
                    },
                  }
                : m
            )
          );
        }
      } finally {
        streamingLockRef.current = false;
        setIsStreaming(false);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        if (!controller.signal.aborted) {
          onChatFinishRef.current?.(projectId);
        }
      }
    },
    [projectId, consumeSseStream]
  );

  const clearChat = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    streamingLockRef.current = false;
    setIsStreaming(false);
    setMessages([]);
    setActiveProposal(null);
  }, []);

  return {
    messages,
    isStreaming,
    activeProposal,
    sendMessage,
    retryFailed,
    dismissErrors,
    resumeStream,
    clearChat,
    hydrateMessages,
    setActiveProposal,
    appendMessages,
    patchMessage,
  };
}
