/**
 * client/src/components/studio/chat/PlannerChat.tsx
 * 工序 1 专属故事总监对话座舱 (Planner Specialist Chat SSOT)
 *
 * 核心微内核法典：
 * 1. 认知与状态驱动：故事总监天然感知【工序 1 制片 SOP 与工程状态机看板】；
 * 2. 人在回路优雅交互：消灭气泡卡片，底部集成建议条与常驻批准按钮；
 * 3. 跨阶段工序流转：支持 action: 'run_tool' 与 action: 'next_stage'，无缝推进至 Stage 02。
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { ProjectData, TaskRecord } from '../../../types/index.js';
import {
  PlannerChatSessionClient,
  type ChatMessageItem,
  type PlannerActionIntent,
} from '../../../lib/ChatSession.js';

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
  onSelectStage,
  isBusy,
}) => {
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingTargetId, setStreamingTargetId] = useState<string | null>(null);
  const [streamingAppendContent, setStreamingAppendContent] = useState<string>('');

  // 核心微内核：高内聚工序 1 专属故事总监会话 (面向对象实例化，多个对话彻底解耦)
  const session = useMemo(() => new PlannerChatSessionClient(projectId || ''), [projectId]);

  // 真实任务生命周期监控（彻底杜绝刚提交就显示成功的假收敛）
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeToolName, setActiveToolName] = useState<string>('');
  const [activeActionTitle, setActiveActionTitle] = useState<string>('');
  const [showDoneNotice, setShowDoneNotice] = useState(false);
  const summarizedTaskIdRef = useRef<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. 自动滚动到最新消息
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent]);

  // 2. 加载项目历史会话（与现有物理资产对齐自愈）
  useEffect(() => {
    if (!projectId) return;

    let isMounted = true;
    session.getHistory().then((history) => {
      if (!isMounted) return;
      if (Array.isArray(history) && history.length > 0) {
        const hasScreenplay = Boolean(
          projectData?.screenplay ||
          projectData?.artifacts?.screenplay
        );
        const hasPrd = Boolean(
          projectData?.prd ||
          projectData?.artifacts?.prd ||
          projectData?.artifacts?.prdMarkdown
        );

        setMessages(
          history.map((h: any) => {
            let isResolved = Boolean(h.proposalResolved);
            // 源头资产对齐：若磁盘已有剧本或 PRD，历史生成提案不再判定为未决待审
            if (h.proposal?.tool === 'planner.screenplay_writer' && hasScreenplay) {
              isResolved = true;
            } else if (h.proposal?.tool === 'planner.script_to_prd' && hasPrd) {
              isResolved = true;
            }

            return {
              id: h.id || `msg_${Math.random()}`,
              role: h.role === 'user' ? 'user' : 'assistant',
              content: h.content,
              createdAt: h.createdAt || new Date().toISOString(),
              proposal: h.proposal,
              proposalState: h.proposal ? (isResolved ? 'completed' : 'pending') : undefined,
              taskId: h.taskId,
              taskTool: h.taskTool,
              taskTitle: h.taskTitle,
              taskStatus: h.taskStatus,
              taskProgress: h.taskProgress,
              taskDurationMs: h.taskDurationMs,
              taskOutputSummary: h.taskOutputSummary,
              taskError: h.taskError,
            };
          })
        );
      } else {
        // 初始迎宾消息
        setMessages([
          {
            id: 'welcome_msg',
            role: 'assistant',
            content:
              '你好，我是你的专属故事总监。我负责为你构建本互动影游的世界观大纲、人物动机与多结局分支因果树。\n你可以直接向我描述故事设想，也可以点击下方的灵感预设开始构思。',
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [session, projectId, projectData]);

  // 3. 真实任务生命周期对齐与 SSE 联动
  const activeTask = tasks.find((t) => t.taskId === activeTaskId);
  const isTaskRunning = Boolean(activeTask && (activeTask.status === 'running' || activeTask.status === 'pending'));
  const isTaskCompleted = Boolean(activeTask && activeTask.status === 'completed');
  const isTaskFailed = Boolean(activeTask && activeTask.status === 'failed');

  // 当后台任务落盘完成后，由故事总监基于当前最新看板出具阶段复盘与下一步提案（直接追加入同一个任务对话消息中，同 taskId 合一）
  const triggerPostTaskSummary = async (toolName: string, actionTitle: string, targetMsgId?: string) => {
    if (targetMsgId) {
      setStreamingTargetId(targetMsgId);
      setStreamingAppendContent('');
    } else {
      setIsStreaming(true);
      setStreamingContent('');
    }

    const triggerPrompt = `【制片工序事件】工序【${actionTitle || toolName}】已圆满执行并物理落盘！请你对照当前【工序 1 制片管线与实时状态看板】，为创作者出具阶段收官复盘，并主动提出下一步推进提案。`;

    const summaryHistory = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let currentAccumulated = '';

    await session.streamChat({
      message: triggerPrompt,
      history: summaryHistory,
      isSystemTrigger: true, // 核心：系统内部阶段收官驱动，不伪造用户发言入库
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

        if (targetMsgId) {
          // 核心：直接追加入上面的同一个任务消息内，同一个 taskId 回复合体！
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id === targetMsgId || (m.taskId && `msg_task_${m.taskId}` === targetMsgId)) {
                const combined = m.content
                  ? `${m.content}\n\n---\n\n${finalSummaryText}`
                  : finalSummaryText;
                return {
                  ...m,
                  content: combined,
                  taskStatus: 'completed',
                  taskProgress: { percent: 100, message: '推演完成' },
                  proposal: intent || undefined,
                  proposalState: intent ? 'pending' : undefined,
                };
              }
              return m;
            })
          );
        } else {
          const astMsg: ChatMessageItem = {
            id: `ast_summary_${Date.now()}`,
            role: 'assistant',
            content: finalSummaryText,
            createdAt: new Date().toISOString(),
            proposal: intent || undefined,
            proposalState: intent ? 'pending' : undefined,
          };
          setMessages((prev) => [...prev, astMsg]);
        }

        // 核心体验：工序 1 剧本与策划全部落盘收官后，自动平滑切入下一阶段 (Stage 02 视觉资产工坊)
        const isStageCompleted = toolName.includes('prd') || intent?.action === 'next_stage';
        if (isStageCompleted) {
          const targetStage = intent?.stage || 'visual';
          setTimeout(() => {
            onSelectStage?.(targetStage);
          }, 1200);
        }
      },
      onError: (err) => {
        setStreamingTargetId(null);
        setStreamingAppendContent('');
        setIsStreaming(false);
        setStreamingContent('');
        console.error('[PlannerChat] 总结推演出错:', err);
      },
    });
  };

  // 当服务端真实完成了后台物理落盘后，更新卡片终态成果，并出具阶段复盘与下一步提案
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

      // 1. 本地更新卡片消息的终态状态
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

      // 2. 自动触发故事总监阶段收敛总结并追加入同一个任务对话中 (同 taskId 回复)
      triggerPostTaskSummary(activeToolName, activeActionTitle, targetMsgId);
    }
  }, [activeTaskId, isTaskCompleted, activeToolName, activeActionTitle, tasks, session, onAssetProduced]);

  // 当服务端真实判定后台任务执行失败时，同步更新卡片失败终态并刚性落盘入会话
  const failedTaskIdRef = useRef<string | null>(null);
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
          console.warn('[PlannerChat] 同步任务失败状态至会话异常:', err);
        });
    }
  }, [activeTaskId, isTaskFailed, tasks, session]);

  // 仅获取当前最新一轮总监回复中产出的待审提案（避免历史陈旧提案跨轮次悬挂）
  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant');
  const pendingProposal =
    lastAssistantMsg?.proposal && lastAssistantMsg.proposalState === 'pending'
      ? lastAssistantMsg.proposal
      : undefined;


  // 4. 创作者批准执行提案 (人在回路物理落地，零废话对话转发)
  const handleConfirmProposal = async (proposal: ActionIntent) => {
    // 跨工序进入视觉工坊：纯前端视图切换功能，绝不发送任何聊天消息 (SSOT)
    if (proposal.action === 'next_stage') {
      const targetStage = proposal.stage || 'visual';
      onSelectStage?.(targetStage);
      return;
    }

    if (proposal.action !== 'run_tool' || !proposal.tool) {
      return;
    }

    const tool = proposal.tool;
    const params = {
      ...(proposal.params || {}),
      projectId,
    };
    const title = proposal.title || '制片工序任务';

    setActiveToolName(tool);
    setActiveActionTitle(title);

    try {
      // 标记会话内待审提案已解决
      session.markProposalsResolved().catch(() => {});

      // 触发物理算力任务执行
      const task = await onRunTool(tool, params);
      const taskId = task?.taskId || task?.id;

      if (taskId) {
        setActiveTaskId(taskId);

        // 核心：在会话中就地将该待审提案转化为绑定 taskId 的真实任务流水卡片 (原地升级 SSOT，绝不 appendMessage)
        const targetPendingMsg = messages.find((m) => m.proposal && m.proposalState === 'pending');
        const targetMsgId = targetPendingMsg?.id || `msg_task_${taskId}`;

        setMessages((prev) =>
          prev.map((m) =>
            m.id === targetMsgId || (m.proposal?.tool === tool && m.proposalState === 'pending')
              ? {
                  ...m,
                  content: m.content || `创作者已批准执行【${title}】。`,
                  proposalState: 'completed' as const,
                  taskId,
                  taskTool: tool,
                  taskTitle: title,
                  taskStatus: 'running',
                  taskProgress: { percent: 15, message: '任务已启动，正在编排剧情大纲与因果分支...' },
                }
              : m
          )
        );

        if (targetPendingMsg?.id) {
          try {
            await session.updateMessage(targetPendingMsg.id, {
              taskId,
              taskTool: tool,
              taskTitle: title,
              taskStatus: 'running',
              taskProgress: { percent: 15, message: '任务已启动，正在编排剧情大纲与因果分支...' },
            });
          } catch (err) {
            console.warn('[PlannerChat] 原地更新任务消息失败:', err);
          }
        }
      }
    } catch (err: any) {
      console.error('[PlannerChat] 启动任务失败:', err);
      alert(`启动任务失败: ${err?.message || err}`);
    }
  };

  const handleIgnoreProposal = () => {
    setMessages((prev) =>
      prev.map((m, idx) =>
        idx === prev.length - 1 && m.proposal
          ? { ...m, proposalState: 'ignored' }
          : m
      )
    );
  };

  // 5. 发送自然语言消息并触发流式推演（模型负责提议，人类负责裁决，彻底杜绝前端硬编码猜词）
  const handleSendMessage = async (textToSend?: string) => {
    const content = (textToSend || inputText).trim();
    if (!content || isStreaming || isBusy || isTaskRunning) return;

    setInputText('');
    const userMsgId = `user_${Date.now()}`;
    const userMsg: ChatMessageItem = {
      id: userMsgId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setIsStreaming(true);
    setStreamingContent('');

    // 格式化历史用于传递给服务端
    const historyPayload = nextMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let currentAccumulated = '';

    await session.streamChat({
      message: content,
      history: historyPayload,
      onTextChunk: (chunk) => {
        currentAccumulated += chunk;
        setStreamingContent(currentAccumulated);
      },
      onDone: async ({ cleanText, intent, messageId }) => {
        setIsStreaming(false);
        setStreamingContent('');

        const finalReplyText = cleanText || currentAccumulated;

        // 场景 A: 大模型通过自然语言理解识别创作者授权批准，直接推进物理执行 (零多余确认)
        if (
          intent &&
          (intent.action === 'approve' ||
            (pendingProposal && intent.tool === pendingProposal.tool && intent.action === 'run_tool'))
        ) {
          const targetTool = intent.tool || pendingProposal?.tool;
          if (targetTool) {
            const targetTitle = intent.title || pendingProposal?.title || '制片工序任务';
            const targetParams = {
              ...(pendingProposal?.params || {}),
              ...(intent.params || {}),
              projectId,
            };

            setActiveToolName(targetTool);
            setActiveActionTitle(targetTitle);

            try {
              session.markProposalsResolved().catch(() => {});
              const task = await onRunTool(targetTool, targetParams);
              const taskId = task?.taskId || task?.id;

              if (taskId) {
                setActiveTaskId(taskId);
                const activeMsgId = messageId || `msg_assistant_${Date.now()}`;

                const taskMsg: ChatMessageItem = {
                  id: activeMsgId,
                  role: 'assistant',
                  content: finalReplyText,
                  taskId,
                  taskTool: targetTool,
                  taskTitle: targetTitle,
                  taskStatus: 'running',
                  taskProgress: { percent: 15, message: '任务已启动，正在编排剧情大纲与因果分支...' },
                  createdAt: new Date().toISOString(),
                };

                // 原地升级视图消息：若有挂起的前序待审卡片，直接原地升级该卡片；若无则挂载单任务卡片 (唯一单气泡，杜绝双胞胎)
                setMessages((prev) => {
                  const hasPending = prev.some((m) => m.proposal && m.proposalState === 'pending');
                  if (hasPending) {
                    return prev.map((m) =>
                      m.proposal && m.proposalState === 'pending'
                        ? {
                            ...m,
                            content: finalReplyText || m.content || `创作者已批准执行【${targetTitle}】。`,
                            proposalState: 'completed' as const,
                            taskId,
                            taskTool: targetTool,
                            taskTitle: targetTitle,
                            taskStatus: 'running' as const,
                            taskProgress: { percent: 15, message: '任务已启动，正在编排剧情大纲与因果分支...' },
                          }
                        : m
                    );
                  }
                  return [...prev, taskMsg];
                });

                // 原地更新服务端数据库消息属性：绑定 taskId，绝不重复调用 appendMessage 落盘第二条！
                if (messageId) {
                  try {
                    await session.updateMessage(messageId, {
                      taskId,
                      taskTool: targetTool,
                      taskTitle: targetTitle,
                      taskStatus: 'running',
                      taskProgress: { percent: 15, message: '任务已启动，正在编排剧情大纲与因果分支...' },
                    });
                  } catch (err) {
                    console.warn('[PlannerChat] 原地更新任务消息失败:', err);
                  }
                }
                return;
              }
            } catch (err: any) {
              console.error('[PlannerChat] 启动任务失败:', err);
            }
          }
        }

        // 场景 B: 初次出具方案、参数修改或阶段流转，作为待审卡片呈现给创作者审阅
        const astMsg: ChatMessageItem = {
          id: messageId || `ast_${Date.now()}`,
          role: 'assistant',
          content: finalReplyText,
          createdAt: new Date().toISOString(),
          proposal: intent || undefined,
          proposalState: intent ? 'pending' : undefined,
        };
        setMessages((prev) => [...prev, astMsg]);
      },
      onError: (err) => {
        setIsStreaming(false);
        setStreamingContent('');
        const errorMsg: ChatMessageItem = {
          id: `ast_err_${Date.now()}`,
          role: 'assistant',
          content: `⚠️ 推演中断: ${err.message}`,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      },
    });
  };

  // 灵感预设胶囊
  const quickPrompts = [
    '题材：科幻生存，空间站引力异常，舰长在副手与AI间抉择',
    '题材：末日悬疑，记忆被篡改的侦探调查避难所谋杀案',
    '在第二幕增加一个关于氧气配给的高风险道德难题',
    '直接为我推演完整的全景互动剧本',
  ];

  // 灵感预设胶囊可见性控制：
  // 1. 创作者输入框中有文字（正在打字）时立即隐藏，专注输入体验；
  // 2. 项目已有推演对话历史（创作者已打字发送过或已有交互）后自动永久隐藏；
  // 3. 仅在全新初始空白引导态且输入框为空时呈现。
  const hasUserInteracted = messages.some((m) => m.role === 'user') || messages.length > 1;
  const isInputting = inputText.trim().length > 0;
  const showQuickPrompts = !hasUserInteracted && !isInputting && quickPrompts.length > 0;

  const isNextStageAction = pendingProposal?.action === 'next_stage';
  const actionButtonText = isNextStageAction ? '✨ 进入视觉资产工坊' : '✨ 批准执行';

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
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => {
          // 刚性过滤无内容无任务无提案的空消息，彻底消灭幽灵圆圈 (图2 源头防御)
          if (!msg.content?.trim() && !msg.taskId && !msg.proposal) {
            return null;
          }

          const isUser = msg.role === 'user';
          const hasTask = Boolean(msg.taskId);
          const liveTask = hasTask ? tasks.find((t) => t.taskId === msg.taskId) : undefined;
          const status = liveTask?.status || msg.taskStatus || (msg.taskProgress?.percent === 100 ? 'completed' : 'completed');
          const isRunning = status === 'running' || status === 'pending';
          const isFailed = status === 'failed';
          const isCompleted = status === 'completed';
          const duration = liveTask?.durationMs || msg.taskDurationMs;
          const durationSec = duration ? (duration / 1000).toFixed(1) : undefined;
          const percent = liveTask?.progress?.percent ?? msg.taskProgress?.percent ?? (isCompleted ? 100 : isRunning ? 45 : 0);
          const progressMsg = liveTask?.progress?.message || msg.taskProgress?.message || (isRunning ? '正在后台执行物理推演与结构化落盘...' : isCompleted ? '推演完成并物理落盘' : '执行失败');

          // 将对白正文与落盘后的执行结果/复盘文本拆分：
          // 前置对白 (preSpeech，如 "**授权确认，开跑。**") 放置在进度条上方；
          // 后置执行结果 (postSummary，如阶段收官复盘) 放置在进度条下方。
          const contentParts = (msg.content || '').split('\n\n---\n\n');
          const preSpeech = contentParts[0] || '';
          const postSummary = contentParts.slice(1).join('\n\n---\n\n');

          // 核心特性：人在回路任务绑定卡片 (生动展示进行中、进度、终态，完成态样式保持一致，复盘对白追加在气泡内部)
          if (hasTask) {
            return (
              <div key={msg.id} className="flex flex-col items-start space-y-1.5">
                <div className="flex items-center space-x-1.5 px-1">
                  <span className="text-[10px] font-medium text-slate-400">故事总监</span>
                </div>

                <div className="max-w-[88%] p-3.5 rounded-2xl rounded-tl-xs bg-slate-50/80 border border-slate-200/80 text-xs text-slate-800 leading-relaxed shadow-2xs space-y-2.5">
                  {/* 1. 顶部紧凑任务状态行 */}
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200/60 text-[11px]">
                    <div className="flex items-center space-x-1.5 font-bold text-slate-800">
                      <span>{msg.taskTool?.includes('screenplay') ? '📜' : msg.taskTool?.includes('prd') ? '📑' : '🎬'}</span>
                      <span>【{msg.taskTitle || '制片工序任务'}】</span>
                    </div>

                    {/* 状态徽标 */}
                    {isRunning && (
                      <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-ping"></span>
                        <span>推演中 ({percent}%)</span>
                      </span>
                    )}
                    {isCompleted && (
                      <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600 text-[10px] font-medium">
                        <span>✓ 已完成</span>
                        {durationSec ? <span className="font-mono text-[9px] text-slate-400">({durationSec}s)</span> : null}
                      </span>
                    )}
                    {isFailed && (
                      <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-medium">
                        <span>✕ 执行失败</span>
                      </span>
                    )}
                  </div>

                  {/* 2. 前置授权与说明对白（严格位于进度条上方） */}
                  {preSpeech && (
                    <div className="whitespace-pre-wrap leading-relaxed text-slate-800">
                      {preSpeech}
                    </div>
                  )}

                  {/* 3. 极细进度条（推演中动态呈现）/ 轻盈分割线（完成态呈现） */}
                  {isRunning && (
                    <div className="w-full h-1 bg-slate-200/60 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-600 transition-all duration-300 animate-pulse rounded-full"
                        style={{ width: `${Math.max(8, Math.min(100, percent))}%` }}
                      />
                    </div>
                  )}
                  {isCompleted && (postSummary || (streamingTargetId === msg.id && streamingAppendContent)) && (
                    <div className="border-t border-slate-200/60 my-1" />
                  )}

                  {/* 4. 执行结果与收官复盘（严格位于进度条下方） */}
                  {/* 实时流式打字追加区域（当正在流式生成该任务的复盘时呈现） */}
                  {streamingTargetId === msg.id && streamingAppendContent && (
                    <div className="text-slate-800">
                      <div className="whitespace-pre-wrap leading-relaxed">{streamingAppendContent}</div>
                      <span className="inline-block w-1.5 h-3 bg-indigo-600 ml-1 animate-pulse align-middle"></span>
                    </div>
                  )}

                  {/* 已落盘物理固化的收官复盘结果 */}
                  {postSummary && (
                    <div className="whitespace-pre-wrap leading-relaxed text-slate-800">
                      {postSummary}
                    </div>
                  )}

                  {/* 失败重试 */}
                  {isFailed && (
                    <div className="pt-2 border-t border-rose-100 flex items-center justify-between text-rose-700 text-[11px]">
                      <span>{liveTask?.error || msg.taskError || '算力或网络异常'}</span>
                      <button
                        type="button"
                        onClick={() => handleConfirmProposal({ tool: msg.taskTool, title: msg.taskTitle || '重试工序', params: {}, action: 'run_tool' })}
                        className="underline font-bold text-rose-600 shrink-0 ml-2"
                      >
                        重试
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          }

          // 普通文本对白气泡
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

              {/* 对话气泡（纯文本对白呈现，消灭气泡卡片） */}
              <div
                className={`max-w-[88%] p-3.5 rounded-2xl text-xs leading-relaxed break-words shadow-2xs ${
                  isUser
                    ? 'bg-slate-800 text-white rounded-tr-xs'
                    : 'bg-slate-50/80 border border-slate-200/80 text-slate-800 rounded-tl-xs'
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
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

      {/* 快捷灵感词胶囊：仅在初始空白引导阶段且未打字时呈现，打字或已有对话后自动隐藏 */}
      {showQuickPrompts && (
        <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/40 flex items-center space-x-1.5 overflow-x-auto flex-shrink-0 text-nowrap">
          <span className="text-[10px] text-slate-400 font-medium mr-1">灵感:</span>
          {quickPrompts.map((p, idx) => (
            <button
              key={idx}
              onClick={() => handleSendMessage(p)}
              disabled={isStreaming || isBusy || isTaskRunning}
              className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-600 text-[10px] rounded-full border border-slate-200 shadow-2xs transition disabled:opacity-40"
            >
              {p.length > 18 ? `${p.slice(0, 18)}...` : p}
            </button>
          ))}
        </div>
      )}

      {/* 底部输入框与人在回路真实状态操作条 */}
      <div className="p-3.5 border-t border-slate-100 bg-white flex-shrink-0">
        {/* 输入框与控制按钮 */}
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

          {/* 发送按钮旁的快捷推进按钮 */}
          {pendingProposal && !isTaskRunning && (
            <button
              type="button"
              onClick={() => handleConfirmProposal(pendingProposal)}
              disabled={isStreaming || isBusy}
              className="px-3.5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-xs transition shadow-xs flex items-center space-x-1.5 shrink-0 active:scale-[0.99] disabled:opacity-40"
              title={`点击立即执行: ${pendingProposal.title}`}
            >
              <span>{actionButtonText}</span>
            </button>
          )}

          <button
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || isStreaming || isBusy || isTaskRunning}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl text-xs transition disabled:opacity-40 shadow-xs active:scale-[0.99] flex-shrink-0"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
};
