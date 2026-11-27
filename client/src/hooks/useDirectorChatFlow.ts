import { useState, useEffect, useRef, useMemo, useCallback, type ClipboardEvent } from 'react';
import type { TaskRecord } from '../types/index.js';
import type {
  DirectorConversationClient,
  ConversationMessage,
  ChatImageAttachment,
  BaseActionIntent,
  AgentFocusContext,
} from '../lib/DirectorConversation.js';
import { isConversationTaskRunning } from '../lib/taskUtils.js';
import { cancelTask, retryTask } from '../lib/api.js';
import { formatFocusLabel, useActiveFocus } from './StudioFocusContext.js';

export function computeSimulatedProgress(startTimeMs: number, nowMs: number, backendPercent?: number): number {
  const elapsedSec = Math.max(0, (nowMs - startTimeMs) / 1000);
  let simulated: number;
  if (elapsedSec <= 2) simulated = 15 + (elapsedSec / 2) * 17;
  else if (elapsedSec <= 10) simulated = 32 + ((elapsedSec - 2) / 8) * 36;
  else if (elapsedSec <= 30) simulated = 68 + ((elapsedSec - 10) / 20) * 18;
  else if (elapsedSec <= 60) simulated = 86 + ((elapsedSec - 30) / 30) * 8;
  else simulated = 94 + 2 * (1 - Math.exp(-(elapsedSec - 60) / 40));
  const rounded = Math.min(96, Math.round(simulated));
  return backendPercent && backendPercent > rounded ? Math.min(96, backendPercent) : rounded;
}

export interface UseDirectorChatFlowOptions<TIntent extends BaseActionIntent = BaseActionIntent> {
  projectId: string;
  session: DirectorConversationClient<TIntent>;
  tasks?: TaskRecord[];
  /** 对话派发/完成任务后同步刷新外层项目资产与任务总线 */
  onRefreshProject?: () => void;
  /** 可选显式覆盖焦点；不传时自动订阅全局 StudioFocusContext 栈顶焦点 */
  focus?: AgentFocusContext;
  defaultWelcomeMessage: string;
  welcomeMessageId?: string;
  mode?: 'lookdev' | 'storyboard' | 'planner' | string;
  clipId?: string;
}

export function useDirectorChatFlow<TIntent extends BaseActionIntent = BaseActionIntent>(
  options: UseDirectorChatFlowOptions<TIntent>,
) {
  const { projectId, session, tasks = [], onRefreshProject, focus: explicitFocus, defaultWelcomeMessage, welcomeMessageId = 'init_welcome' } = options;
  const onRefreshProjectRef = useRef(onRefreshProject);
  onRefreshProjectRef.current = onRefreshProject;
  const contextFocus = useActiveFocus();
  const activeFocus = explicitFocus ?? contextFocus;
  const focusLabel = useMemo(() => formatFocusLabel(activeFocus), [activeFocus]);
  const [messages, setMessages] = useState<ConversationMessage<TIntent>[]>([]);
  const [inputText, setInputText] = useState('');
  const [pendingImages, setPendingImages] = useState<ChatImageAttachment[]>([]);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [summaryStream, setSummaryStream] = useState<{ messageId: string; text: string } | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const historyLoadKeyRef = useRef<string | null>(null);

  const reloadHistory = useCallback(async () => {
    const key = `${session.projectId}:${session.sessionId}`;
    const welcome: ConversationMessage<TIntent> = {
      id: welcomeMessageId,
      role: 'assistant',
      content: defaultWelcomeMessage,
      createdAt: new Date().toISOString(),
    };
    try {
      const history = await session.getHistory();
      if (historyLoadKeyRef.current !== key) return;
      setHistoryFailed(false);
      setMessages(history.length ? history : [welcome]);
    } catch {
      if (historyLoadKeyRef.current !== key) return;
      setHistoryFailed(true);
      setMessages((prev) => prev.length ? prev : [welcome]);
    }
  }, [session, welcomeMessageId, defaultWelcomeMessage]);

  useEffect(() => {
    if (!projectId) return;
    const key = `${projectId}:${session.sessionId}`;
    if (historyLoadKeyRef.current === key) return;
    historyLoadKeyRef.current = key;
    setMessages([]);
    setSummaryStream(null);
    setHistoryFailed(false);
    void reloadHistory();
  }, [projectId, session, reloadHistory]);

  useEffect(() => {
    if (!projectId) return;
    let disposed = false;
    let hasConnectedOnce = false;
    let events: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let lastActivityAt = Date.now();

    const markAlive = () => {
      lastActivityAt = Date.now();
    };

    const handleConnected = () => {
      markAlive();
      if (hasConnectedOnce) {
        void reloadHistory();
        onRefreshProjectRef.current?.();
      } else {
        hasConnectedOnce = true;
      }
    };

    const onTaskEvent = (raw: MessageEvent) => {
      markAlive();
      try {
        const event = JSON.parse(raw.data);
        if (event?.projectId !== projectId) return;
        if (event?.input?.__chatContext?.sessionId !== session.sessionId) return;
        if (event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled') {
          onRefreshProjectRef.current?.();
          void reloadHistory();
        }
      } catch {
        // 忽略格式异常事件
      }
    };

    const onSummaryEvent = (raw: MessageEvent) => {
      markAlive();
      let event: {
        projectId: string;
        sessionId: string;
        messageId: string;
        type: 'start' | 'snapshot' | 'chunk' | 'done' | 'error';
        text?: string;
        offset?: number;
      };
      try {
        event = JSON.parse(raw.data);
      } catch {
        return;
      }
      if (event.projectId !== projectId || event.sessionId !== session.sessionId) return;
      if (event.type === 'start') {
        setSummaryStream({ messageId: event.messageId, text: '' });
        void reloadHistory();
      } else if (event.type === 'snapshot') {
        setSummaryStream({ messageId: event.messageId, text: event.text || '' });
        void reloadHistory();
      } else if (event.type === 'chunk') {
        setSummaryStream((previous) => {
          const current = previous?.messageId === event.messageId ? previous.text : '';
          const offset = event.offset ?? current.length;
          return { messageId: event.messageId, text: current.slice(0, offset) + (event.text || '') };
        });
      } else {
        onRefreshProjectRef.current?.();
        void reloadHistory().finally(() => {
          setSummaryStream((previous) => previous?.messageId === event.messageId ? null : previous);
        });
      }
    };

    const closeCurrent = () => {
      if (!events) return;
      events.removeEventListener('connected', handleConnected);
      events.removeEventListener('ping', markAlive);
      events.removeEventListener('task_event', onTaskEvent);
      events.removeEventListener('summary_event', onSummaryEvent);
      events.close();
      events = null;
    };

    const scheduleReconnect = (delayMs = 2000) => {
      if (disposed || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delayMs);
    };

    const connect = () => {
      if (disposed) return;
      closeCurrent();
      lastActivityAt = Date.now();
      const es = new EventSource(`/api/events?projectId=${encodeURIComponent(projectId)}`);
      events = es;
      es.addEventListener('connected', handleConnected);
      es.addEventListener('ping', markAlive);
      es.addEventListener('task_event', onTaskEvent);
      es.addEventListener('summary_event', onSummaryEvent);
      es.onerror = () => {
        if (disposed) return;
        if (es.readyState === EventSource.CLOSED) {
          closeCurrent();
          scheduleReconnect(2000);
        }
      };
    };

    // 心跳看门狗：后端每 15s 发 ping，超过 35s 无响应说明连接假死，强制重连并补拉历史
    const watchdogTimer = setInterval(() => {
      if (disposed) return;
      if (Date.now() - lastActivityAt > 35000) {
        closeCurrent();
        connect();
        void reloadHistory();
        onRefreshProjectRef.current?.();
      }
    }, 10000);

    connect();

    return () => {
      disposed = true;
      clearInterval(watchdogTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      closeCurrent();
    };
  }, [projectId, session.sessionId, reloadHistory]);

  const hasPendingSummary = messages.some((message) =>
    message.metadata?.summaryStatus === 'pending' || message.metadata?.summaryStatus === 'running'
  );
  const hasUnsettledTaskMessage = useMemo(
    () =>
      messages.some((message) => {
        if (Array.isArray(message.planSteps) && message.planSteps.length > 0) {
          return message.planSteps.some((step) => {
            const live = tasks.find((t) => t.taskId === step.taskId);
            const st = live?.status || step.status;
            return st === 'pending' || st === 'running';
          });
        }
        if (!message.taskId) return false;
        const live = tasks.find((t) => t.taskId === message.taskId);
        const st = live?.status || message.taskStatus;
        return st === 'pending' || st === 'running';
      }),
    [messages, tasks]
  );

  const isTaskRunning = useMemo(() => {
    // 1. 全局 tasks 中本会话/本工序/本分幕/本聚焦实体的活跃物理任务
    if (
      isConversationTaskRunning(tasks, session.sessionId, {
        mode: options.mode,
        clipId: options.clipId,
        focusTargetId: activeFocus?.target?.id,
      })
    ) {
      return true;
    }
    // 2. 消息流中未结算的任务卡片（多步 Plan 正在进行中）
    if (hasUnsettledTaskMessage) return true;
    // 3. 正在等待或流式推演复盘
    if (hasPendingSummary) return true;
    return false;
  }, [
    tasks,
    session.sessionId,
    options.mode,
    options.clipId,
    activeFocus?.target?.id,
    hasUnsettledTaskMessage,
    hasPendingSummary,
  ]);

  // 当全局 tasks 中本会话任务从运行态切换至全部终态时，立即刷新对话历史同步最新卡片与复盘
  const prevTaskRunningRef = useRef(isTaskRunning);
  useEffect(() => {
    if (prevTaskRunningRef.current && !isTaskRunning) {
      void reloadHistory();
    }
    prevTaskRunningRef.current = isTaskRunning;
  }, [isTaskRunning, reloadHistory]);

  useEffect(() => {
    if (!summaryStream) return;
    const message = messages.find((item) => item.id === summaryStream.messageId);
    // 只有当消息已处于终态，且已成功持有落盘的 postSummarySpeech（或非 completed 终态）时，才平滑解散流式打字状态
    if (
      message &&
      ['completed', 'failed', 'skipped'].includes(message.metadata?.summaryStatus) &&
      (message.postSummarySpeech || message.metadata?.summaryStatus !== 'completed')
    ) {
      setSummaryStream(null);
    }
  }, [messages, summaryStream]);

  useEffect(() => {
    if (!isTaskRunning) return;
    const timer = setInterval(() => setNowTick(Date.now()), 300);
    return () => clearInterval(timer);
  }, [isTaskRunning]);

  useEffect(() => {
    if ((!hasPendingSummary && !hasUnsettledTaskMessage) || isStreaming) return;
    const timer = setInterval(() => {
      void reloadHistory();
      onRefreshProjectRef.current?.();
    }, 2000);
    return () => clearInterval(timer);
  }, [hasPendingSummary, hasUnsettledTaskMessage, isStreaming, reloadHistory]);

  useEffect(() => {
    if (!historyFailed || isStreaming) return;
    const timer = setInterval(() => void reloadHistory(), 2000);
    return () => clearInterval(timer);
  }, [historyFailed, isStreaming, reloadHistory]);

  const pendingProposalMsg = useMemo(() => [...messages].reverse().find((message) =>
    message.proposal && !message.proposalResolved && message.proposalState === 'pending'
  ), [messages]);

  const computeDisplayPercent = useCallback((message: ConversationMessage<TIntent>) => {
    if (Array.isArray(message.planSteps) && message.planSteps.length > 0) {
      const total = message.planSteps.length;
      let progressSum = 0;
      for (const step of message.planSteps) {
        const live = tasks.find((item) => item.taskId === step.taskId);
        const st = live?.status || step.status;
        if (st === 'completed' || st === 'failed' || st === 'cancelled') {
          progressSum += 100;
        } else if (st === 'running') {
          const startTime = live?.startedAt || live?.createdAt || new Date(message.createdAt).getTime();
          progressSum += computeSimulatedProgress(
            startTime,
            nowTick,
            live?.progress?.percent ?? step.progress?.percent
          );
        }
      }
      return Math.min(100, Math.round(progressSum / total));
    }

    if (!message.taskId) return 0;
    const task = tasks.find((item) => item.taskId === message.taskId);
    const status = task?.status || message.taskStatus;
    if (status === 'completed') return 100;
    if (status !== 'pending' && status !== 'running') return 0;
    const startTime = task?.startedAt || task?.createdAt || new Date(message.createdAt).getTime();
    return computeSimulatedProgress(startTime, nowTick, task?.progress?.percent ?? message.taskProgress?.percent);
  }, [tasks, nowTick]);

  const handleRetryTask = useCallback(async (taskId: string) => {
    if (!taskId) return;
    try {
      await retryTask(taskId);
      onRefreshProjectRef.current?.();
      await reloadHistory();
    } catch (err) {
      console.error('[DirectorChat] 单步重试任务失败:', err);
    }
  }, [reloadHistory]);

  const handleCancelPlan = useCallback(async (taskIds: string[]) => {
    if (!taskIds.length) return;
    try {
      await Promise.allSettled(taskIds.map((id) => cancelTask(id)));
      onRefreshProjectRef.current?.();
      await reloadHistory();
    } catch (err) {
      console.error('[DirectorChat] 取消计划失败:', err);
    }
  }, [reloadHistory]);

  const handleAddImages = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files || []).filter((f) => f && f.type.startsWith('image/'));
    if (!fileArr.length || !projectId) return;

    const remainingSlots = Math.max(0, 4 - pendingImages.length);
    if (remainingSlots <= 0) {
      alert('单条消息最多附带 4 张图片');
      return;
    }

    setIsUploadingImage(true);
    try {
      const uploaded: ChatImageAttachment[] = [];
      for (const file of fileArr.slice(0, remainingSlots)) {
        const att = await session.uploadChatImage(file);
        uploaded.push(att);
      }
      if (uploaded.length > 0) {
        setPendingImages((prev) => [...prev, ...uploaded].slice(0, 4));
      }
    } catch (err) {
      console.error('[DirectorChat] 上传聊天图片失败:', err);
      alert(`上传图片失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsUploadingImage(false);
    }
  }, [pendingImages.length, projectId, session]);

  const handleRemovePendingImage = useCallback((url: string) => {
    setPendingImages((prev) => prev.filter((item) => item.url !== url));
  }, []);

  const handlePasteImages = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items?.length) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      void handleAddImages(imageFiles);
    }
  }, [handleAddImages]);

  const handleSendMessage = useCallback(async (textToSend?: string) => {
    const text = (textToSend !== undefined ? textToSend : inputText).trim();
    const attachmentsToSend = textToSend !== undefined ? [] : pendingImages;
    if ((!text && attachmentsToSend.length === 0) || isStreaming || isUploadingImage || isTaskRunning || !projectId) return;

    const displayText = text || '请查看我发送的图片';
    if (textToSend === undefined) {
      setInputText('');
      setPendingImages([]);
    }
    setMessages((prev) => [...prev, {
      id: `msg_user_${Date.now()}`,
      role: 'user',
      content: displayText,
      ...(attachmentsToSend.length ? { attachments: attachmentsToSend } : {}),
      createdAt: new Date().toISOString(),
    }]);
    setIsStreaming(true);
    setStreamingContent('');

    await session.streamMessage({
      message: text,
      attachments: attachmentsToSend.length ? attachmentsToSend : undefined,
      focus: activeFocus,
      onTextChunk: (chunk) => setStreamingContent((prev) => prev + chunk),
      onDone: async () => {
        onRefreshProjectRef.current?.();
        await reloadHistory();
        setIsStreaming(false);
        setStreamingContent('');
      },
      onError: async (err) => {
        setIsStreaming(false);
        setStreamingContent('');
        console.error('[DirectorChat] 会话请求失败:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        try {
          await reloadHistory();
        } catch {}
        setMessages((prev) => [
          ...prev,
          {
            id: `err_${Date.now()}`,
            role: 'assistant',
            content: `⚠ 服务响应异常：${errMsg}。请重试或检查后台服务。`,
            createdAt: new Date().toISOString(),
          },
        ]);
      },
    });
  }, [inputText, pendingImages, isStreaming, isUploadingImage, isTaskRunning, projectId, session, activeFocus, reloadHistory]);

  const handleApproveProposal = useCallback(async (proposalId: string) => {
    if (isStreaming || isApproving || isTaskRunning || !projectId) return;
    setIsApproving(true);
    try {
      await session.approveProposal(proposalId);
    } catch (err) {
      console.error('[DirectorChat] 批准提案失败:', err);
      alert(`批准执行失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      onRefreshProjectRef.current?.();
      await reloadHistory();
      setIsApproving(false);
    }
  }, [isStreaming, isApproving, isTaskRunning, projectId, session, reloadHistory]);

  return {
    messages,
    inputText,
    setInputText,
    pendingImages,
    isUploadingImage,
    isStreaming,
    isApproving,
    streamingContent,
    streamingTargetId: summaryStream?.messageId || null,
    streamingAppendContent: summaryStream?.text || '',
    nowTick,
    isTaskRunning,
    pendingProposalMsg,
    activeFocus,
    focusLabel,
    computeDisplayPercent,
    handleAddImages,
    handleRemovePendingImage,
    handlePasteImages,
    handleSendMessage,
    handleApproveProposal,
    handleRetryTask,
    handleCancelPlan,
  };
}
