/**
 * client/src/hooks/useDirectorChatFlow.ts
 * 全系统对话机器人统一对话生命周期微内核 Hook (Director Chat Flow SSOT)
 *
 * 核心微内核架构：
 * 1. 状态与流转单一事实来源：所有导演智能体共享相同的对话推演、意图捕获、物理工具派发与任务状态机；
 * 2. 拟合非线性时间平滑模拟算法 (computeSimulatedProgress)，结合 300ms 动态时钟与 SSE 真实落盘事件；
 * 3. 授权批准链路统一：自然语言“同意”与常驻「✨ 批准执行」按钮共用单核驱动；
 * 4. 自动阶段收官复盘总结：物理任务落盘后自动触发总监总结并追加至同一任务卡片中。
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { TaskRecord, ProjectData } from '../types/index.js';
import type { ChatSession, ChatMessageItem, BaseActionIntent } from '../lib/ChatSession.js';

/**
 * 经典非线性时间平滑模拟进度算法 (Simulated Progressive Curve)
 */
export function computeSimulatedProgress(
  startTimeMs: number,
  nowMs: number,
  backendPercent?: number
): number {
  const elapsedSec = Math.max(0, (nowMs - startTimeMs) / 1000);
  let simulated: number;

  if (elapsedSec <= 2) {
    simulated = 15 + (elapsedSec / 2) * 17;
  } else if (elapsedSec <= 10) {
    simulated = 32 + ((elapsedSec - 2) / 8) * 36;
  } else if (elapsedSec <= 30) {
    simulated = 68 + ((elapsedSec - 10) / 20) * 18;
  } else if (elapsedSec <= 60) {
    simulated = 86 + ((elapsedSec - 30) / 30) * 8;
  } else {
    simulated = 94 + 2 * (1 - Math.exp(-(elapsedSec - 60) / 40));
  }

  const rounded = Math.min(96, Math.round(simulated));
  if (backendPercent && backendPercent > rounded) {
    return Math.min(96, backendPercent);
  }
  return rounded;
}

export interface UseDirectorChatFlowOptions<TIntent extends BaseActionIntent = BaseActionIntent> {
  projectId: string;
  projectData?: ProjectData | null;
  session: ChatSession<TIntent>;
  tasks?: TaskRecord[];
  onRunTool: (toolName: string, input: Record<string, any>) => Promise<TaskRecord | any>;
  onRefreshProject?: () => void;
  isBusy?: boolean;
  defaultWelcomeMessage: string;
  welcomeMessageId?: string;
  contextPrefix?: string;
  resolveHistoricalProposals?: (msg: any, projectData?: ProjectData | null) => boolean;
  toolMapper?: (tool: string, params: Record<string, any>) => { tool: string; params: Record<string, any>; title?: string };
  generatePostTaskTriggerPrompt: (toolName: string, actionTitle: string) => string;
  onAssetProduced?: (type: string) => void;
}

export function useDirectorChatFlow<TIntent extends BaseActionIntent = BaseActionIntent>(
  options: UseDirectorChatFlowOptions<TIntent>
) {
  const {
    projectId,
    projectData,
    session,
    tasks = [],
    onRunTool,
    onRefreshProject,
    isBusy,
    defaultWelcomeMessage,
    welcomeMessageId = 'init_welcome',
    contextPrefix = '',
    resolveHistoricalProposals,
    toolMapper,
    generatePostTaskTriggerPrompt,
    onAssetProduced,
  } = options;

  const [messages, setMessages] = useState<ChatMessageItem<TIntent>[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingTargetId, setStreamingTargetId] = useState<string | null>(null);
  const [streamingAppendContent, setStreamingAppendContent] = useState<string>('');

  // 任务生命周期追踪
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeToolName, setActiveToolName] = useState<string>('');
  const [activeActionTitle, setActiveActionTitle] = useState<string>('');
  const summarizedTaskIdRef = useRef<string | null>(null);
  const failedTaskIdRef = useRef<string | null>(null);

  // 300ms 心跳时钟
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  const hasAnyRunningTask = useMemo(() => {
    return (
      tasks.some((t) => t.status === 'running' || t.status === 'pending') ||
      messages.some((m) => m.taskStatus === 'running' || m.taskStatus === 'pending')
    );
  }, [tasks, messages]);

  useEffect(() => {
    if (!hasAnyRunningTask) return;
    const timer = setInterval(() => {
      setNowTick(Date.now());
    }, 300);
    return () => clearInterval(timer);
  }, [hasAnyRunningTask]);

  // 1. 初始化拉取会话历史
  useEffect(() => {
    if (!projectId) return;
    let isMounted = true;

    session
      .getHistory()
      .then((history) => {
        if (!isMounted) return;
        if (Array.isArray(history) && history.length > 0) {
          setMessages(
            history.map((h: any) => {
              let isResolved = Boolean(h.proposalResolved);
              if (resolveHistoricalProposals) {
                if (resolveHistoricalProposals(h, projectData)) {
                  isResolved = true;
                }
              }

              // 对齐物理任务真实状态，以权威 tasks 列表与落盘资产为准，杜绝历史静态 running 假性死锁
              const matchedPhysicalTask = h.taskId ? tasks.find((t) => t.taskId === h.taskId) : undefined;
              let effectiveStatus = matchedPhysicalTask ? matchedPhysicalTask.status : h.taskStatus;
              if (h.taskTool?.includes('screenplay') && (projectData?.screenplay || projectData?.artifacts?.screenplay)) {
                effectiveStatus = 'completed';
              } else if (h.taskTool?.includes('prd') && (projectData?.prd || projectData?.artifacts?.prd)) {
                effectiveStatus = 'completed';
              }

              return {
                id: h.id || `msg_${Math.random().toString(36).slice(2, 6)}`,
                role: h.role === 'user' ? 'user' : 'assistant',
                content: h.content,
                createdAt: h.createdAt || new Date().toISOString(),
                proposal: h.proposal,
                proposalState: h.proposal ? (isResolved ? 'completed' : 'pending') : undefined,
                taskId: h.taskId,
                taskTool: h.taskTool,
                taskTitle: h.taskTitle,
                taskStatus: effectiveStatus,
                taskProgress:
                  matchedPhysicalTask?.progress ||
                  h.taskProgress ||
                  (effectiveStatus === 'completed' ? { percent: 100, message: '已完成' } : undefined),
                taskDurationMs: matchedPhysicalTask?.durationMs || h.taskDurationMs,
                taskOutputSummary: h.taskOutputSummary,
                taskError: matchedPhysicalTask?.error || h.taskError,
              };
            })
          );
        } else {
          setMessages([
            {
              id: welcomeMessageId,
              role: 'assistant',
              content: defaultWelcomeMessage,
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      })
      .catch((err) => {
        console.warn(`[useDirectorChatFlow] 获取历史异常:`, err);
        if (!isMounted) return;
        setMessages([
          {
            id: welcomeMessageId,
            role: 'assistant',
            content: defaultWelcomeMessage,
            createdAt: new Date().toISOString(),
          },
        ]);
      });

    return () => {
      isMounted = false;
    };
  }, [projectId, session, projectData, tasks, defaultWelcomeMessage, welcomeMessageId, resolveHistoricalProposals]);

  // 2. 任务状态计算：物理 tasks 数组为 SSOT 单一事实来源
  const activeTask = tasks.find((t) => t.taskId === activeTaskId);
  const isTaskRunning = Boolean(
    tasks.some((t) => t.status === 'running' || t.status === 'pending')
  );
  const isTaskCompleted = Boolean(activeTask && activeTask.status === 'completed');
  const isTaskFailed = Boolean(activeTask && activeTask.status === 'failed');

  // 计算指定任务卡片的实时进度百分比
  const computeDisplayPercent = useCallback(
    (msg: ChatMessageItem<TIntent>) => {
      if (!msg.taskId) return 0;
      const t = tasks.find((item) => item.taskId === msg.taskId);
      const isDone = (t?.status || msg.taskStatus) === 'completed' || msg.taskProgress?.percent === 100;
      if (isDone) return 100;
      const isRunning = (t?.status || msg.taskStatus) === 'running' || (t?.status || msg.taskStatus) === 'pending';
      if (!isRunning) return 0;

      const startTime =
        t?.startedAt ||
        t?.createdAt ||
        (msg.createdAt ? new Date(msg.createdAt).getTime() : 0) ||
        nowTick;
      const rawBackendPercent = t?.progress?.percent ?? msg.taskProgress?.percent;
      return computeSimulatedProgress(startTime, nowTick, rawBackendPercent);
    },
    [tasks, nowTick]
  );

  // 3. 触发收官复盘总结
  const triggerPostTaskSummary = useCallback(
    async (toolName: string, actionTitle: string, targetMsgId?: string) => {
      if (targetMsgId) {
        setStreamingTargetId(targetMsgId);
        setStreamingAppendContent('');
      } else {
        setIsStreaming(true);
        setStreamingContent('');
      }

      const triggerPrompt = generatePostTaskTriggerPrompt(toolName, actionTitle);
      const summaryHistory = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let currentAccumulated = '';

      await session.streamChat({
        message: triggerPrompt,
        history: summaryHistory,
        isSystemTrigger: true,
        targetMessageId: targetMsgId,
        onTextChunk: (chunk) => {
          currentAccumulated += chunk;
          if (targetMsgId) {
            setStreamingAppendContent(currentAccumulated);
          } else {
            setStreamingContent(currentAccumulated);
          }
        },
        onDone: ({ cleanText, intent }) => {
          setStreamingTargetId(null);
          setStreamingAppendContent('');
          setIsStreaming(false);
          setStreamingContent('');

          const finalSummaryText = cleanText || currentAccumulated;
          const effectiveProposal = intent?.action === 'next_stage' ? undefined : (intent || undefined);

          if (targetMsgId) {
            setMessages((prev) =>
              prev.map((m) => {
                if (
                  m.id === targetMsgId ||
                  (m.taskId && `msg_task_${m.taskId}` === targetMsgId) ||
                  (activeTaskId && m.taskId === activeTaskId)
                ) {
                  const combined = m.content
                    ? `${m.content}\n\n---\n\n${finalSummaryText}`
                    : finalSummaryText;
                  return {
                    ...m,
                    content: combined,
                    taskStatus: 'completed',
                    taskProgress: { percent: 100, message: '推演完成' },
                    proposal: effectiveProposal,
                    proposalState: effectiveProposal ? 'pending' : undefined,
                  };
                }
                return m;
              })
            );
          } else {
            const astMsg: ChatMessageItem<TIntent> = {
              id: `ast_summary_${Date.now()}`,
              role: 'assistant',
              content: finalSummaryText,
              createdAt: new Date().toISOString(),
              proposal: effectiveProposal,
              proposalState: effectiveProposal ? 'pending' : undefined,
            };
            setMessages((prev) => [...prev, astMsg]);
          }
        },
        onError: (err) => {
          setStreamingTargetId(null);
          setStreamingAppendContent('');
          setIsStreaming(false);
          setStreamingContent('');
          console.error('[useDirectorChatFlow] 总结推演出错:', err);
        },
      });
    },
    [session, messages, activeTaskId, generatePostTaskTriggerPrompt]
  );

  // 4. 后台任务物理完成监听
  useEffect(() => {
    if (activeTaskId && isTaskCompleted && summarizedTaskIdRef.current !== activeTaskId) {
      summarizedTaskIdRef.current = activeTaskId;
      const completedTask = tasks.find((t) => t.taskId === activeTaskId);
      const durationMs = completedTask?.durationMs;
      const matchedMsg = messages.find((m) => m.taskId === activeTaskId);
      const targetMsgId = matchedMsg?.id || `msg_task_${activeTaskId}`;

      if (activeToolName.includes('screenplay')) {
        onAssetProduced?.('screenplay');
      } else if (activeToolName.includes('prd')) {
        onAssetProduced?.('prd');
      }

      onRefreshProject?.();

      setMessages((prev) =>
        prev.map((m) =>
          m.taskId === activeTaskId
            ? {
                ...m,
                taskStatus: 'completed',
                taskDurationMs: durationMs,
                taskProgress: { percent: 100, message: '推演完成' },
              }
            : m
        )
      );

      triggerPostTaskSummary(activeToolName, activeActionTitle, targetMsgId);
    }
  }, [
    activeTaskId,
    isTaskCompleted,
    activeToolName,
    activeActionTitle,
    tasks,
    messages,
    onRefreshProject,
    onAssetProduced,
    triggerPostTaskSummary,
  ]);

  // 5. 后台任务失败监听
  useEffect(() => {
    if (activeTaskId && isTaskFailed && failedTaskIdRef.current !== activeTaskId) {
      failedTaskIdRef.current = activeTaskId;
      const failedTask = tasks.find((t) => t.taskId === activeTaskId);
      const targetMsgId = `msg_task_${activeTaskId}`;
      const errorMsg = failedTask?.error || '制片引擎算力或网络异常中断';

      setMessages((prev) =>
        prev.map((m) =>
          m.taskId === activeTaskId
            ? {
                ...m,
                taskStatus: 'failed',
                taskError: errorMsg,
                taskProgress: { percent: 0, message: '执行失败' },
              }
            : m
        )
      );

      session
        .updateMessage(targetMsgId, {
          taskStatus: 'failed',
          taskError: errorMsg,
          taskProgress: { percent: 0, message: '执行失败' },
        })
        .catch((err) => {
          console.warn('[useDirectorChatFlow] 同步任务失败状态异常:', err);
        });
    }
  }, [activeTaskId, isTaskFailed, tasks, session]);

  // 查找最新处于 pending 状态的待审提案
  const pendingProposalMsg = useMemo(() => {
    return [...messages].reverse().find(
      (m) => m.proposal && m.proposalState === 'pending' && m.proposal.action !== 'next_stage'
    );
  }, [messages]);

  const pendingProposal = pendingProposalMsg?.proposal;

  // 6. 发送消息总线
  const handleSendMessage = useCallback(
    async (textToSend?: string) => {
      const text = (textToSend || inputText).trim();
      if (!text || isStreaming || isBusy || isTaskRunning || !projectId) return;

      setInputText('');

      const fullPrompt = contextPrefix ? `${contextPrefix}${text}` : text;
      const userMsg: ChatMessageItem<TIntent> = {
        id: `msg_user_${Date.now()}`,
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
      };

      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      setIsStreaming(true);
      setStreamingContent('');

      let accumulated = '';

      await session.streamChat({
        message: fullPrompt,
        history: nextMessages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .slice(-10)
          .map((m) => ({ role: m.role, content: m.content })),
        onTextChunk: (chunk) => {
          accumulated += chunk;
          setStreamingContent(accumulated);
        },
        onDone: async ({ cleanText, intent, messageId }) => {
          setIsStreaming(false);
          setStreamingContent('');

          const finalReplyText = cleanText || accumulated;

          // 核心判断：大模型意图授权或创作者在有待审提案下批准执行
          const isApproval =
            intent &&
            (intent.action === 'approve' ||
              (pendingProposal && intent.tool === pendingProposal.tool && intent.action === 'run_tool'));

          if (isApproval) {
            let targetTool = intent.tool || pendingProposal?.tool;
            if (targetTool) {
              let targetTitle = intent.title || pendingProposal?.title || '制片工序任务';
              let targetParams: Record<string, any> = {
                ...(pendingProposal?.params || {}),
                ...(intent.params || {}),
                projectId,
              };

              if (toolMapper) {
                const mapped = toolMapper(targetTool, targetParams);
                targetTool = mapped.tool;
                targetParams = mapped.params;
                if (mapped.title) targetTitle = mapped.title;
              }

              setActiveToolName(targetTool);
              setActiveActionTitle(targetTitle);

              try {
                session.markProposalsResolved().catch(() => {});
                const task = await onRunTool(targetTool, targetParams);
                const taskId = task?.taskId || task?.id;

                if (taskId) {
                  setActiveTaskId(taskId);
                  const activeMsgId = messageId || `msg_asst_${Date.now()}`;

                  const taskMsg: ChatMessageItem<TIntent> = {
                    id: activeMsgId,
                    role: 'assistant',
                    content: finalReplyText,
                    taskId,
                    taskTool: targetTool,
                    taskTitle: targetTitle,
                    taskStatus: 'running',
                    taskProgress: { percent: 15, message: '任务已启动，正在调度物理引擎落盘...' },
                    createdAt: new Date().toISOString(),
                  };

                  setMessages((prev) => {
                    const resolved = prev.map((m) =>
                      m.proposal && m.proposalState === 'pending'
                        ? { ...m, proposalState: 'completed' as const }
                        : m
                    );
                    return [...resolved, taskMsg];
                  });

                  if (messageId) {
                    try {
                      await session.updateMessage(messageId, {
                        taskId,
                        taskTool: targetTool,
                        taskTitle: targetTitle,
                        taskStatus: 'running',
                        taskProgress: { percent: 15, message: '任务已启动，正在调度物理引擎落盘...' },
                      });
                    } catch (err) {
                      console.warn('[useDirectorChatFlow] 原地更新任务消息失败:', err);
                    }
                  }
                  return;
                }
              } catch (err: any) {
                console.error('[useDirectorChatFlow] 启动任务失败:', err);
              }
            }
          }

          // 普通提案或纯自然语言对白
          const isNextStage = intent?.action === 'next_stage';
          const effectiveProposal = isNextStage ? undefined : (intent || undefined);

          const astMsg: ChatMessageItem<TIntent> = {
            id: messageId || `msg_asst_${Date.now()}`,
            role: 'assistant',
            content: finalReplyText,
            createdAt: new Date().toISOString(),
            proposal: effectiveProposal,
            proposalState: effectiveProposal ? 'pending' : undefined,
          };

          setMessages((prev) => [...prev, astMsg]);
        },
        onError: (err) => {
          setIsStreaming(false);
          setStreamingContent('');
          const errorMsg: ChatMessageItem<TIntent> = {
            id: `msg_err_${Date.now()}`,
            role: 'assistant',
            content: `⚠️ 对话推演异常: ${err.message || '未知错误'}`,
            createdAt: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, errorMsg]);
        },
      });
    },
    [
      inputText,
      isStreaming,
      isBusy,
      isTaskRunning,
      projectId,
      contextPrefix,
      messages,
      session,
      pendingProposal,
      toolMapper,
      onRunTool,
    ]
  );

  return {
    messages,
    setMessages,
    inputText,
    setInputText,
    isStreaming,
    streamingContent,
    streamingTargetId,
    streamingAppendContent,
    nowTick,
    activeTaskId,
    activeToolName,
    activeActionTitle,
    isTaskRunning,
    isTaskCompleted,
    isTaskFailed,
    pendingProposal,
    pendingProposalMsg,
    computeDisplayPercent,
    handleSendMessage,
    triggerPostTaskSummary,
  };
}
