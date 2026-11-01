'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  getProjectStatus,
  uploadArtifactImage,
  saveSelections,
} from '@/lib/workflowApi';
import {
  fetchChatSessions,
  createChatSession,
  fetchChatMessages,
  streamDirectorChat,
  streamSkillExecute,
  dismissChatProposal,
  sendCriticReviewDialog,
  type ActionProposal,
} from '@/lib/chatApi';
import { ChatMessageItem } from './studio.types';
import StudioHeader, { HistoryItem } from './StudioHeader';
import ChatPanel from './ChatPanel';
import GameDisplayPanel from './GameDisplayPanel';

interface StudioWorkspaceProps {
  sessionId: string | null; // 权威定义：外部传入的 session 参数即为 projectId (SSOT)
  onNewProject: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onStartProject: (idea: string) => Promise<void>;
  history: HistoryItem[];
}

const WELCOME_MESSAGE: ChatMessageItem = {
  id: 'welcome_init',
  sender: 'agent',
  senderName: 'AI 影游总制作人',
  content: '🎬 **你好！我是你的 AI 互动影游制作人。**\n\n告诉我你想创作什么故事或游戏构思（例如：*赛博朋克风格的记忆神偷，调查一起跨国企业意识篡改案*）。\n\n我将为你全自动推演网状互动剧情、角色人设、分镜故事板与关键帧，直至打包生成可交互的影视游戏！成片将直接在右侧游戏视窗实时上映并可即时试玩。',
  timestamp: '刚刚',
};

const STAGE_TO_SKILL_MAP: Record<string, { skill: string; label: string }> = {
  narrative_design: { skill: 'story-bible', label: '故事世界观圣经推演' },
  character_design: { skill: 'character-portrait', label: '全剧核心角色定妆照生成' },
  scene_script: { skill: 'scene-script', label: '全剧分场多分支剧本扩写' },
  storyboard: { skill: 'storyboard', label: '导演视听机位分镜表切分' },
  keyframe_reference: { skill: 'keyframe-reference', label: '分镜头首帧高清参考图批量渲染' },
  video_production: { skill: 'video-production', label: '动态视频切片批量生成与渲染' },
  fmv_packaging: { skill: 'fmv-packaging', label: '母带工程混音与交互播放器打包' },
};

export default function StudioWorkspace({
  sessionId, // projectId
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
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);

  // 可拖拽分屏调节宽度（默认左边更大：56%）
  const [leftWidthPercent, setLeftWidthPercent] = useState<number>(56);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 真正有产物且当前推演已结束时，允许快速推进
  const hasDeliverables = Object.keys(artifacts).length > 0;
  const isWaitingForConfirmation =
    !isRunning &&
    hasDeliverables &&
    (status === 'waiting' || status === 'waiting_for_intervention' || status === 'idle');

  // 1. Fetch & refresh project status from ProjectStore
  const fetchStatus = useCallback(async () => {
    if (!sessionId) return;
    try {
      const data = (await getProjectStatus(sessionId)) as any;
      const proj = data?.project || data?.session || data;
      if (proj) {
        setProjectTitle(proj.title || proj.meta?.idea || '未命名短剧');
        const projectStatus = proj.status || 'idle';
        setStatus(projectStatus);

        if (proj.currentStage) {
          setCurrentStage(proj.currentStage);
        }
        if (proj.stageArtifacts || data.artifacts) {
          setArtifacts(proj.stageArtifacts || data.artifacts || {});
        }
      }
    } catch (err) {
      console.warn('[StudioWorkspace] Status fetch error:', err);
    }
  }, [sessionId]);

  // 2. 初始化或恢复项目的活跃对话会话 (SessionStore SSOT)
  const initChatSession = useCallback(async (projectId: string) => {
    try {
      const sessions = await fetchChatSessions(projectId);
      let targetSessionId = '';

      if (sessions.length > 0) {
        targetSessionId = sessions[sessions.length - 1].sessionId;
      } else {
        const newSession = await createChatSession(projectId, '主线创作会话', currentStage);
        targetSessionId = newSession.sessionId;
      }

      setActiveChatSessionId(targetSessionId);

      // 拉取该会话的消息历史流
      const rawMessages = await fetchChatMessages(projectId, targetSessionId);
      if (rawMessages.length > 0) {
        const mappedMessages: ChatMessageItem[] = rawMessages.map((m) => ({
          id: m.id,
          sender: m.role === 'user' ? 'user' : 'agent',
          senderName: m.role === 'user' ? '我 (创作者)' : 'AI 影游总制作人',
          content: m.content,
          actionProposal: m.actionProposal,
          timestamp: m.createdAt ? (m.createdAt.includes('T') ? m.createdAt.slice(11, 16) : m.createdAt) : '刚刚',
        }));
        setMessages(mappedMessages);
      }
    } catch (err) {
      console.warn('[StudioWorkspace] 恢复会话历史失败:', err);
    }
  }, [currentStage]);

  // Handle project change or reset
  useEffect(() => {
    if (sessionId) {
      fetchStatus();
      initChatSession(sessionId);
    } else {
      setProjectTitle('新建互动影游');
      setStatus('idle');
      setIsRunning(false);
      setArtifacts({});
      setMessages([WELCOME_MESSAGE]);
      setCurrentStage('narrative_design');
      setActiveChatSessionId(null);
    }
  }, [sessionId, fetchStatus, initChatSession]);

  // 动态心跳轮询：静止时 6s
  useEffect(() => {
    if (!sessionId) return;
    const timer = setInterval(fetchStatus, 6000);
    return () => clearInterval(timer);
  }, [sessionId, fetchStatus]);

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

  // 🌟 3. 核心声明式工序技能执行中枢 (Skill Execution SSOT)
  const handleExecuteSkill = async (skillName: string, params: Record<string, any> = {}) => {
    if (!sessionId || isRunning) return;
    setIsRunning(true);

    const progressMsgId = `skill_prog_${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: progressMsgId,
        sender: 'agent',
        senderName: 'AI 影游总制作人',
        content: `⚡ 正在启动工序技能 [${skillName}]...`,
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);

    try {
      await streamSkillExecute(
        sessionId,
        skillName,
        activeChatSessionId || undefined,
        params,
        {
          onProgress: (percent, msg) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === progressMsgId
                  ? { ...m, content: `⚡ [${percent}%] ${msg}` }
                  : m
              )
            );
          },
          onDone: async (result) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === progressMsgId
                  ? { ...m, content: result.summary || `✔ 技能 [${skillName}] 执行完成！` }
                  : m
              )
            );
            setIsRunning(false);
            await fetchStatus();
          },
          onError: (err) => {
            setMessages((prev) => [
              ...prev,
              {
                id: `err_${Date.now()}`,
                sender: 'system',
                content: `❌ 工序执行遇到问题: ${err.message}`,
                timestamp: new Date().toLocaleTimeString(),
              },
            ]);
            setIsRunning(false);
          },
        }
      );
    } catch (err: any) {
      console.error('[StudioWorkspace] 技能执行失败:', err);
      setIsRunning(false);
    }
  };

  // 4. Action: User confirms current milestone and proceeds to next
  const handleConfirmNext = async () => {
    const currentSkillInfo = STAGE_TO_SKILL_MAP[currentStage] || { skill: 'story-bible' };
    await handleExecuteSkill(currentSkillInfo.skill);
  };

  // 5. Action: Execute autonomous ActionProposal from Director (显式透传 actionId SSOT)
  const handleExecuteProposal = async (proposal: ActionProposal) => {
    const targetSkill = proposal.skill || STAGE_TO_SKILL_MAP[currentStage]?.skill || 'story-bible';
    await handleExecuteSkill(targetSkill, {
      actionId: proposal.actionId,
      ...(proposal.payload || {}),
    });
  };

  // 🌟 5.1 Action: Dismiss ActionProposal
  const handleDismissProposal = async (actionId: string) => {
    if (!sessionId || !activeChatSessionId) return;
    try {
      await dismissChatProposal(sessionId, activeChatSessionId, actionId);
      setMessages((prev) =>
        prev.map((m) =>
          m.actionProposal?.actionId === actionId
            ? {
                ...m,
                actionProposal: {
                  ...m.actionProposal,
                  status: 'dismissed',
                },
              }
            : m
        )
      );
    } catch (err) {
      console.warn('[StudioWorkspace] 废弃提案失败:', err);
    }
  };

  // 🌟 5.2 Action: Trigger Critic Reviewer Audit
  const handleTriggerCriticReview = async () => {
    await handleExecuteSkill('critic-review', { targetStage: currentStage });
  };

  // 🌟 5.3 Action: Dialog / Debate with Critic Reviewer (完整透传 sessionId 与阶段)
  const handleCriticDialog = async (message: string) => {
    if (!sessionId) return undefined;
    return await sendCriticReviewDialog(sessionId, message, currentStage, activeChatSessionId || undefined);
  };

  // 🌟 6. Action: User sends natural language to DirectorAgent (真流式打字机推进)
  const handleSendMessage = async (text: string) => {
    if (isRunning) return;
    setIsRunning(true);

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

    // 确保有可用的 chatSessionId
    let targetSessionId = activeChatSessionId;
    if (!targetSessionId) {
      try {
        const newSession = await createChatSession(sessionId, '主线创作会话', currentStage);
        targetSessionId = newSession.sessionId;
        setActiveChatSessionId(targetSessionId);
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          {
            id: `err_${Date.now()}`,
            sender: 'system',
            content: `❌ 初始化会话失败: ${err.message}`,
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
        setIsRunning(false);
        return;
      }
    }

    const userMsgId = `user_${Date.now()}`;
    const asstMsgId = `asst_${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        sender: 'user',
        content: text,
        timestamp: new Date().toLocaleTimeString(),
      },
      {
        id: asstMsgId,
        sender: 'agent',
        senderName: 'AI 影游总制作人',
        content: '',
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);

    try {
      await streamDirectorChat(
        sessionId,
        targetSessionId,
        text,
        {
          onToken: (token) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstMsgId ? { ...m, content: m.content + token } : m
              )
            );
          },
          onProposal: (proposal) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstMsgId ? { ...m, actionProposal: proposal } : m
              )
            );
          },
          onDone: (result) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstMsgId
                  ? {
                      ...m,
                      content: result.message.content || m.content,
                      actionProposal: result.proposal || m.actionProposal,
                    }
                  : m
              )
            );
            setIsRunning(false);
            fetchStatus();
          },
          onError: (err) => {
            setMessages((prev) => [
              ...prev,
              {
                id: `err_${Date.now()}`,
                sender: 'system',
                content: `❌ 导演思考遇到问题: ${err.message}`,
                timestamp: new Date().toLocaleTimeString(),
              },
            ]);
            setIsRunning(false);
          },
        }
      );
    } catch (err: any) {
      console.error('[StudioWorkspace] 对话流异常:', err);
      setIsRunning(false);
    }
  };

  // 7. Action: Trigger AI character portrait generation
  const handleTriggerCharacterGen = async (characterIds: string[]) => {
    await handleExecuteSkill('character-portrait', { targetCharacterNames: characterIds });
  };

  // 8. Action: Upload target or reference image for character
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

  // 9. Action: Switch selected version of a character
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

  // 10. Action: Regenerate single character
  const handleRegenerateSingleCharacter = async (
    charId: string,
    instruction?: string,
    baseVersion?: string,
    editedPrompt?: string
  ) => {
    await handleExecuteSkill('character-portrait', {
      targetCharacterNames: [charId],
      userFeedback: instruction,
      editedPrompt,
    });
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
            onExecuteProposal={handleExecuteProposal}
            onDismissProposal={handleDismissProposal}
            onTriggerCriticReview={handleTriggerCriticReview}
            onCriticDialog={handleCriticDialog}
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
