'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  getProjectStatus,
  continueWorkflow,
  intervene,
  uploadArtifactImage,
  saveSelections,
} from '@/lib/workflowApi';
import { ChatMessageItem } from './studio.types';
import StudioHeader, { HistoryItem } from './StudioHeader';
import ChatPanel from './ChatPanel';
import GameDisplayPanel from './GameDisplayPanel';

interface StudioWorkspaceProps {
  sessionId: string | null;
  onNewProject: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onStartProject: (idea: string) => Promise<void>;
  history: HistoryItem[];
}

const WELCOME_MESSAGE: ChatMessageItem = {
  id: 'welcome_init',
  sender: 'agent',
  senderName: 'AI 叙事制作人',
  content: '🎬 **你好！我是你的 AI 互动影游制作人。**\n\n告诉我你想创作什么故事或游戏构思（例如：*赛博朋克风格的记忆神偷，调查一起跨国企业意识篡改案*）。\n\n我将为你全自动推演网状互动剧情、角色人设、分镜故事板与关键帧，直至打包生成可交互的影视游戏！成片将直接在右侧游戏视窗实时上映并可即时试玩。',
  timestamp: '刚刚',
};

export default function StudioWorkspace({
  sessionId,
  onNewProject,
  onSelectSession,
  onDeleteSession,
  onStartProject,
  history,
}: StudioWorkspaceProps) {
  const [projectTitle, setProjectTitle] = useState('新建互动影游');
  const [status, setStatus] = useState<string>('idle');
  const [currentStage, setCurrentStage] = useState<string>('narrative_design');
  const [artifacts, setArtifacts] = useState<Record<string, any>>({});
  const [messages, setMessages] = useState<ChatMessageItem[]>([WELCOME_MESSAGE]);
  const [isRunning, setIsRunning] = useState(false);

  // 可拖拽分屏调节宽度（默认左边更大：56%）
  const [leftWidthPercent, setLeftWidthPercent] = useState<number>(56);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 真正有产物且当前推演已结束、等待确认时，才显示确认推进条
  const hasDeliverables = Object.keys(artifacts).length > 0;
  const isWaitingForConfirmation =
    !isRunning &&
    hasDeliverables &&
    (status === 'waiting' || status === 'waiting_for_intervention');

  // 1. Fetch & refresh project status
  const fetchStatus = useCallback(async () => {
    if (!sessionId) return;
    try {
      const data = (await getProjectStatus(sessionId)) as any;
      const sess = data?.session || data;
      if (sess) {
        setProjectTitle(sess.title || sess.idea || '未命名短剧');
        const sessionStatus = sess.status || 'idle';
        setStatus(sessionStatus);

        // 思考推演结束判定：只要后端状态脱离 running，立刻移除“思考中”状态
        if (sessionStatus !== 'running') {
          setIsRunning(false);
        } else {
          setIsRunning(true);
        }

        if (sess.currentStage || sess.current_stage) {
          setCurrentStage(sess.currentStage || sess.current_stage);
        }
        if (sess.stageArtifacts || sess.artifacts) {
          setArtifacts(sess.stageArtifacts || sess.artifacts || {});
        }

        // Sync persistent conversation history from session
        if (Array.isArray(sess.messages) && sess.messages.length > 0) {
          setMessages(sess.messages);
        } else if (sess.currentStopPoint) {
          const sp = sess.currentStopPoint;
          setMessages((prev) => {
            if (prev.some((m) => m.stopPoint?.id === sp.id)) return prev;
            return [
              ...prev,
              {
                id: `sp_${sp.id}_${Date.now()}`,
                sender: 'agent',
                senderName: 'AI 影游总制作人',
                content: `🎯 **${sp.title}**\n\n${sp.description || '当前阶段产物已生成完毕，确认后可直接流转下一阶段。'}`,
                timestamp: new Date().toLocaleTimeString(),
                stopPoint: sp,
              },
            ];
          });
        }
      }
    } catch (err) {
      console.warn('[StudioWorkspace] Status fetch error:', err);
    }
  }, [sessionId]);

  // Handle session change or reset
  useEffect(() => {
    if (sessionId) {
      fetchStatus();
    } else {
      setProjectTitle('新建互动影游');
      setStatus('idle');
      setIsRunning(false);
      setArtifacts({});
      setMessages([WELCOME_MESSAGE]);
      setCurrentStage('narrative_design');
    }
  }, [sessionId, fetchStatus]);

  // 动态心跳轮询：运行中 1.5s 快速轮询以快速捕捉思考结束信号，静止时 5s
  useEffect(() => {
    if (!sessionId) return;
    const shouldFastPoll = isRunning || status === 'running';
    const timer = setInterval(fetchStatus, shouldFastPoll ? 1500 : 5000);
    return () => clearInterval(timer);
  }, [isRunning, status, sessionId, fetchStatus]);

  // 鼠标拖拽分屏调节
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newPercent = ((e.clientX - rect.left) / rect.width) * 100;
      // 限制左侧宽度在 32% ~ 76% 之间
      const clamped = Math.max(32, Math.min(76, newPercent));
      setLeftWidthPercent(clamped);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging]);

  // 2. Action: User confirms current milestone and proceeds to next
  const handleConfirmNext = async () => {
    if (!sessionId || isRunning) return;
    setIsRunning(true);

    try {
      await continueWorkflow(sessionId);
      await fetchStatus();
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          sender: 'system',
          content: `❌ 流转下一步遇到问题: ${err.message || '请稍后重试'}`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    } finally {
      setIsRunning(false);
    }
  };

  // 3. Action: User sends natural language feedback / instruction / starts new project
  const handleSendMessage = async (text: string) => {
    if (isRunning) return;
    setIsRunning(true);

    setMessages((prev) => [
      ...prev,
      {
        id: `user_msg_${Date.now()}`,
        sender: 'user',
        content: text,
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);

    // If no active session, start new project from chat
    if (!sessionId) {
      try {
        await onStartProject(text);
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          {
            id: `err_${Date.now()}`,
            sender: 'system',
            content: `❌ 启动失败: ${err.message || '请稍后重试'}`,
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
      } finally {
        setIsRunning(false);
      }
      return;
    }

    // If active session, send intervention feedback
    try {
      await intervene(sessionId, currentStage, { feedback: text, instruction: text });
      await fetchStatus();
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          sender: 'system',
          content: `❌ 修改执行失败: ${err.message || '系统繁忙'}`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    } finally {
      setIsRunning(false);
    }
  };

  // 4. Action: Trigger AI character portrait generation
  const handleTriggerCharacterGen = async (characterIds: string[]) => {
    if (!sessionId || isRunning) return;
    setIsRunning(true);

    setMessages((prev) => [
      ...prev,
      {
        id: `user_chargen_${Date.now()}`,
        sender: 'user',
        content: `🎨 指示：为选中的 ${characterIds.length} 个角色生成视觉定妆图...`,
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);

    try {
      await intervene(sessionId, 'character_design', { regenerate_characters: characterIds });
      await fetchStatus();
    } catch (err: any) {
      alert(`生成失败: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  // 5. Action: Upload target or reference image for character
  const handleUploadCharacterImage = async (
    charId: string,
    type: 'final' | 'reference',
    file: File
  ) => {
    if (!sessionId) return;
    const itemType = type === 'reference' ? 'reference' : 'characters';
    await uploadArtifactImage(sessionId, 'character_design', itemType, charId, file);
    await fetchStatus();
  };

  // 6. Action: Switch selected version of a character
  const handleSelectCharacterVersion = async (charId: string, versionUrl: string) => {
    if (!sessionId) return;
    try {
      await saveSelections(sessionId, 'character_design', {
        [charId]: versionUrl,
        selections: { [charId]: versionUrl },
      });
      await fetchStatus();
    } catch (err: any) {
      console.warn('Failed to switch character version:', err);
    }
  };

  // 7. Action: Regenerate single character with optional instruction, base version, and edited prompt
  const handleRegenerateSingleCharacter = async (
    charId: string,
    instruction?: string,
    baseVersion?: string,
    editedPrompt?: string
  ) => {
    if (!sessionId || isRunning) return;
    setIsRunning(true);
    try {
      await intervene(sessionId, 'character_design', {
        regenerate_characters: [charId],
        instruction: instruction || '',
        base_version: baseVersion,
        edited_prompt: editedPrompt,
      });
      await fetchStatus();
    } catch (err: any) {
      alert(`生成失败: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-100 text-slate-800">
      {/* 极简整洁明亮顶部栏 */}
      <StudioHeader
        projectTitle={projectTitle}
        sessionId={sessionId}
        onNewProject={onNewProject}
        onSelectSession={onSelectSession}
        onDeleteSession={onDeleteSession}
        history={history}
        status={status}
      />

      {/* 极简双栏布局：左侧全功能对话流 + 中间自由拖拽条 + 右侧游戏视窗 */}
      <div ref={containerRef} className="flex-1 flex overflow-hidden relative select-none bg-slate-100">
        {/* 左侧：类似和机器人对话的形态（支持自由调节宽度） */}
        <div
          style={{ width: `${leftWidthPercent}%` }}
          className="h-full shrink-0 overflow-hidden"
        >
          <ChatPanel
            messages={messages}
            sessionId={sessionId}
            artifacts={artifacts}
            onSendMessage={handleSendMessage}
            onConfirmNext={handleConfirmNext}
            onTriggerCharacterGen={handleTriggerCharacterGen}
            onRegenerateSingleCharacter={handleRegenerateSingleCharacter}
            onSelectCharacterVersion={handleSelectCharacterVersion}
            onUploadCharacterImage={handleUploadCharacterImage}
            isWaitingForConfirmation={isWaitingForConfirmation}
            isRunning={isRunning}
            currentStage={currentStage}
          />
        </div>

        {/* 中间自由拖拽调整宽度分割把手 */}
        <div
          onMouseDown={handleMouseDown}
          onDoubleClick={() => setLeftWidthPercent(56)}
          className={`w-1.5 hover:w-2 transition-all h-full bg-slate-200 hover:bg-indigo-400 cursor-col-resize shrink-0 z-20 flex items-center justify-center group ${
            isDragging ? 'bg-indigo-600 w-2 shadow-sm shadow-indigo-600/30' : ''
          }`}
          title="按住鼠标拖拽调节左右区域宽度（双击复位）"
        >
          <div className="w-0.5 h-6 rounded-full bg-slate-400 group-hover:bg-white transition-colors" />
        </div>

        {/* 右侧：纯粹的游戏视窗展示区域 */}
        <div
          style={{ width: `${100 - leftWidthPercent}%` }}
          className="h-full min-w-0 overflow-hidden bg-slate-100"
        >
          <GameDisplayPanel
            artifacts={artifacts}
            sessionId={sessionId}
            isRunning={isRunning}
          />
        </div>
      </div>
    </div>
  );
}
