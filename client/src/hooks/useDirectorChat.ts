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
}

export interface StartedTaskEvent {
  runId: string;
  stage: 'plan_gdd' | 'build_text_game';
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
    async (response: Response, targetMsgId: string, initialContent: string = '') => {
      if (!response.body) {
        throw new Error(`流式响应体为空: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedText = initialContent;

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
            } else if (parsed.type === 'error') {
              accumulatedText += `\n[导演总控提示: ${parsed.error}]`;
              setMessages((prev) =>
                prev.map((m) => (m.id === targetMsgId ? { ...m, content: accumulatedText } : m))
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

  const sendMessage = useCallback(async (text: string) => {
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
    const priorHistory = messages
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
    setMessages([...messages, userMsg, assistantMsg]);
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

      await consumeSseStream(response, assistantMsgId);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? { ...m, content: m.content + `\n[网络或服务异常: ${err.message}]` }
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
  }, [projectId, messages, isStreaming, consumeSseStream]);

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
                ? { ...m, content: m.content + `\n[流式续传异常: ${err.message}]` }
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
    resumeStream,
    clearChat,
    hydrateMessages,
    setActiveProposal,
    appendMessages,
    patchMessage,
  };
}
