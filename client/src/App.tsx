/**
 * client/src/App.tsx
 * makeMv 互动影游与 AI 视听总导演交互座舱 (Director Studio SSOT)
 *
 * 两段式人在回路（对齐旧版单气泡任务面板口径）：
 *   想法 → AI 回复 + 确认意图 → 确认 → 该 AI 回复气泡记录 task + 进度条
 *        → 完成内容 + 下一个确认意图 → 确认 → 第二个气泡进度条 → 直接产出 index.html 游戏
 * 角色定妆 / 关键帧不再单独走客户端确认，生图内聚在阶段二。
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ProjectMetadata, ProjectData, ActionProposal, StageTaskView } from './types/index.js';
import {
  fetchProjects,
  fetchProject,
  fetchProjectTasks,
  startWorkflow,
  resumeWorkflow,
  cancelWorkflow,
  getWorkflowState,
  fetchTask,
  buildGameUrl,
} from './lib/api.js';
import {
  createDraftProjectId,
  readProjectIdFromUrl,
  syncProjectIdToUrl,
  buildRestoredSessionState,
  type ActiveWatchTarget,
} from './lib/session.js';
import { useDirectorChat } from './hooks/useDirectorChat.js';
import type { ProposalApprovalContext } from './components/DirectorChat.js';
import { Header } from './components/Header.js';
import { DirectorChat } from './components/DirectorChat.js';
import { GddWorldBibleViewer } from './components/GddWorldBibleViewer.js';
import { TextGameCockpit } from './components/TextGameCockpit.js';
import { FilmPlayer } from './components/FilmPlayer.js';

export function App() {
  const initialUrlPid = readProjectIdFromUrl();
  const [projects, setProjects] = useState<ProjectMetadata[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string>(
    () => initialUrlPid || createDraftProjectId()
  );
  const [isProjectPersisted, setIsProjectPersisted] = useState<boolean>(() => Boolean(initialUrlPid));
  const [projectData, setProjectData] = useState<ProjectData | null>(null);
  const [activeTab, setActiveTab] = useState<'gdd' | 'text_game' | 'film'>('gdd');
  const [isExecutingProposal, setIsExecutingProposal] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [activeWatch, setActiveWatch] = useState<ActiveWatchTarget | null>(null);
  const [gameUrl, setGameUrl] = useState<string | null>(null);

  // 记录已完成对话水合的 projectId，避免刚发首条消息切换 URL 时覆写乐观消息气泡
  const hydratedProjectRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);

  const handleChatStart = useCallback((pid: string) => {
    hydratedProjectRef.current = pid;
    syncProjectIdToUrl(pid, 'replace');
    setIsProjectPersisted(true);
  }, []);

  const handleChatFinish = useCallback(async () => {
    try {
      const list = await fetchProjects();
      setProjects(list);
    } catch {
      // 忽略网络瞬断
    }
  }, []);

  const handleTaskStartedFromChat = useCallback(
    ({ runId, stage, messageId }: { runId: string; stage: 'plan_gdd' | 'build_text_game'; messageId: string }) => {
      setCurrentRunId(runId);
      setActiveTab(stage === 'build_text_game' ? 'text_game' : 'gdd');
      setActiveWatch({ runId, stage, messageId });
    },
    []
  );

  const {
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
  } = useDirectorChat(currentProjectId, {
    onChatStart: handleChatStart,
    onChatFinish: handleChatFinish,
    onTaskStarted: handleTaskStartedFromChat,
  });

  const reloadData = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    try {
      const list = await fetchProjects();
      if (seq !== loadSeqRef.current) return;
      setProjects(list);
    } catch {
      // 服务尚未启动或空列表时保持默认
    }

    if (!isProjectPersisted) {
      return;
    }

    try {
      const [data, tasks] = await Promise.all([
        fetchProject(currentProjectId),
        fetchProjectTasks(currentProjectId).catch(() => []),
      ]);
      if (seq !== loadSeqRef.current) return;
      setProjectData(data);

      if (hydratedProjectRef.current !== currentProjectId) {
        hydratedProjectRef.current = currentProjectId;
        const restored = buildRestoredSessionState(currentProjectId, data, tasks);
        hydrateMessages(restored.messages, restored.activeProposal);
        setCurrentRunId(restored.currentRunId);
        setActiveWatch(restored.activeWatch);
        setGameUrl(restored.gameUrl);
        if (restored.gameUrl) {
          setActiveTab('text_game');
        }
        if (restored.streamingMessageId) {
          void resumeStream(restored.streamingMessageId, restored.streamingContent);
        }
      }
    } catch {
      // 容错
    }
  }, [currentProjectId, isProjectPersisted, hydrateMessages, resumeStream]);

  useEffect(() => {
    reloadData();
  }, [reloadData]);

  useEffect(() => {
    const onPopState = () => {
      const urlPid = readProjectIdFromUrl();
      hydratedProjectRef.current = null;
      setProjectData(null);
      setCurrentRunId(null);
      setActiveWatch(null);
      setGameUrl(null);
      setActiveTab('gdd');
      if (urlPid) {
        setIsProjectPersisted(true);
        setCurrentProjectId(urlPid);
      } else {
        setIsProjectPersisted(false);
        setCurrentProjectId(createDraftProjectId());
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  /**
   * 轮询流水线状态 + TaskStore 进度，把结果写回「确认后那条 AI 回复气泡」。
   * 阶段一挂起 (gdd_approval) = 策划案完成；阶段二挂起 (playtest_approval) = 游戏已产出。
   */
  useEffect(() => {
    if (!activeWatch) return;
    let cancelled = false;
    const { runId, stage, messageId } = activeWatch;

    const tick = async () => {
      try {
        const [state, task] = await Promise.all([
          getWorkflowState(currentProjectId, runId),
          fetchTask(currentProjectId, runId),
        ]);
        if (cancelled) return;

        const taskCancelled = state.status === 'cancelled' || task.status === 'cancelled';
        const failed = state.status === 'failed' || task.status === 'failed';
        const pendingType = state.pendingApproval?.type;
        const isLookdevCheckpoint = stage === 'build_text_game' && pendingType === 'lookdev_approval';
        const done =
          !taskCancelled &&
          !failed &&
          (stage === 'plan_gdd'
            ? (state.status === 'suspended' && pendingType === 'gdd_approval') ||
              state.currentStage === 'build_text_game' ||
              state.currentStage === 'completed' ||
              state.status === 'succeeded'
            : pendingType === 'lookdev_approval' ||
              pendingType === 'playtest_approval' ||
              state.status === 'succeeded');
        const queued = !taskCancelled && !failed && !done && (state.status === 'queued' || task.status === 'queued');

        patchMessage(messageId, (m) => {
          if (!m.task) return m;
          const nextStatus: StageTaskView['status'] = taskCancelled
            ? 'cancelled'
            : failed
              ? 'failed'
              : done
                ? 'succeeded'
                : queued
                  ? 'queued'
                  : 'running';
          const nextPercent =
            done || failed || taskCancelled
              ? 100
              : Math.min(100, Math.max(0, task.progress?.percent ?? 0));
          const nextNote = taskCancelled
            ? state.error || task.error || '任务已被创作者主动取消'
            : failed
              ? state.error || task.error || '任务执行失败'
              : task.progress?.note || m.task.note;

          if (
            !done &&
            m.task.status === nextStatus &&
            m.task.percent === nextPercent &&
            m.task.note === nextNote
          ) {
            return m;
          }

          const next: StageTaskView = {
            ...m.task,
            status: nextStatus,
            percent: nextPercent,
            note: nextNote,
          };

          if (done && stage === 'plan_gdd') {
            const gdd = state.pendingApproval?.data;
            const beats = Array.isArray(gdd?.beatOutline) ? gdd.beatOutline.length : 0;
            const title = gdd?.title || '互动影游';
            const gate = state.pendingApproval?.validation;
            const gateNote =
              gate && gate.valid === false
                ? ` ⚠️ 拓扑门禁未通过（${gate.errors?.length ?? 0} 项），系统未阻断，请留意策划案质量。`
                : '';
            next.resultSummary =
              `《${title}》策划案已完成${beats ? `：${beats} 幕主干节拍` : ''}，` +
              `全案 PRD 与互动拓扑已落盘，可在右侧「GDD 策划案」查看。${gateNote}`;
            next.nextProposal = {
              action: 'build_text_game',
              targetStage: 'build_text_game',
              summary: `确认后先生成角色 / 道具 / 场景母本图，再装配可玩的《${title}》`,
              payload: { runId },
            };
          }

          if (done && stage === 'build_text_game') {
            if (pendingType === 'lookdev_approval') {
              const ents = state.pendingApproval?.data || {};
              const chars = Array.isArray(ents.characters) ? ents.characters.length : 0;
              const items = Array.isArray(ents.items) ? ents.items.length : 0;
              const locs = Array.isArray(ents.locations) ? ents.locations.length : 0;
              next.title = '角色 / 道具 / 场景母本图';
              next.percent = 100;
              next.resultSummary =
                `已生成 ${chars} 个角色 / ${items} 件道具 / ${locs} 个场景的母本图，母本清单已落盘；` +
                '确认后按场景装配分幕与可玩切片。';
              next.nextProposal = {
                action: 'render_images',
                targetStage: 'build_text_game',
                summary: '确认母本图，开始装配互动文游',
                payload: { runId },
              };
            } else {
              const nodes = Array.isArray(state.pendingApproval?.data?.nodes)
                ? state.pendingApproval!.data.nodes.length
                : 0;
              next.resultSummary =
                `互动文游已直接产出${nodes ? `：${nodes} 幕可玩切片` : ''}，` +
                '独立入口 game-assembly/index.html 即刻可试玩；玩家在游戏内修改后续接入。';
              next.gameUrl = buildGameUrl(currentProjectId);
            }
          }

          return { ...m, task: next };
        });

        if (done && stage === 'build_text_game' && !isLookdevCheckpoint) {
          setGameUrl(buildGameUrl(currentProjectId));
        }

        if (done || failed || taskCancelled) {
          setActiveWatch(null);
          if ((failed || taskCancelled) && stage === 'plan_gdd') {
            setCurrentRunId(null);
          }
          await reloadData();
          if (done) setActiveTab(stage === 'plan_gdd' || isLookdevCheckpoint ? 'gdd' : 'text_game');
        }
      } catch {
        // 轮询失败不打断：等服务连上或下一拍重试
      }
    };

    tick();
    const timer = window.setInterval(tick, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeWatch, currentProjectId, patchMessage, reloadData]);

  const handleCreateProject = () => {
    const newId = createDraftProjectId();
    hydratedProjectRef.current = null;
    setIsProjectPersisted(false);
    setCurrentProjectId(newId);
    setProjectData(null);
    setCurrentRunId(null);
    setActiveWatch(null);
    setGameUrl(null);
    setActiveTab('gdd');
    clearChat();
    syncProjectIdToUrl(null, 'push');
  };

  const handleSelectProject = (id: string) => {
    if (id === currentProjectId && isProjectPersisted) return;
    hydratedProjectRef.current = null;
    setIsProjectPersisted(true);
    setCurrentProjectId(id);
    setProjectData(null);
    setCurrentRunId(null);
    setActiveWatch(null);
    setGameUrl(null);
    setActiveTab('gdd');
    syncProjectIdToUrl(id, 'push');
  };

  const handleCancelTask = useCallback(
    async (runId: string) => {
      try {
        await cancelWorkflow(currentProjectId, runId, '创作者主动取消任务');
        setActiveWatch((prev) => (prev?.runId === runId ? null : prev));
        setCurrentRunId((prev) => (prev === runId && !projectData?.artifacts?.gdd ? null : prev));
        patchMessage(
          messages.find((m) => m.task?.runId === runId)?.id || '',
          (m) => ({
            ...m,
            task: m.task
              ? { ...m.task, status: 'cancelled', note: '任务已被创作者主动取消' }
              : undefined,
          })
        );
        await reloadData();
      } catch (err: any) {
        alert(`取消任务失败: ${err.message}`);
      }
    },
    [currentProjectId, messages, patchMessage, projectData?.artifacts?.gdd, reloadData]
  );

  /** 任务执行失败后重试：resume 复用同一 runId，从已完成工序继续（后端已支持 failed 恢复） */
  const handleRetryTask = useCallback(
    async (runId: string, messageId: string) => {
      const stage = messages.find((m) => m.id === messageId)?.task?.stage || 'plan_gdd';
      const now = new Date().toISOString();
      patchMessage(messageId, (m) => ({
        ...m,
        task: m.task
          ? {
              ...m.task,
              status: 'running',
              percent: 0,
              note: '已重新发起，正从上次完成的工序继续…',
              startedAt: now,
            }
          : undefined,
      }));

      try {
        await resumeWorkflow(currentProjectId, runId, {
          approved: true,
          summary: '重试失败任务',
        });
        setCurrentRunId(runId);
        setActiveWatch({ runId, stage, messageId });
        await reloadData();
      } catch (err: any) {
        patchMessage(messageId, (m) => ({
          ...m,
          task: m.task
            ? { ...m.task, status: 'failed', note: `重试启动失败：${err.message}` }
            : undefined,
        }));
        alert(`重试任务失败: ${err.message}`);
      }
    },
    [currentProjectId, messages, patchMessage, reloadData]
  );

  /** 人在回路：确认后追加「确认动作 + AI 回复」两条气泡，AI 回复气泡承载该阶段 task */
  const handleApproveProposal = async (
    proposal: ActionProposal,
    ctx: ProposalApprovalContext
  ) => {
    if (isExecutingProposal) return;

    if (proposal.action === 'modify_asset') {
      patchMessage(ctx.messageId, (m) => ({ ...m, proposalResolved: true }));
      setActiveProposal(null);
      await sendMessage(`确认修改：${proposal.summary}`);
      return;
    }

    /**
     * 定妆确认：任务在同一气泡上原地续跑（同一个 runId 的第二段），
     * 不新开气泡，避免出现两条同 runId 的任务消息。
     */
    if (proposal.action === 'render_images') {
      const runId = currentRunId || proposal.payload?.runId;
      if (!runId) {
        alert('缺少当前任务 runId，请在对话中发送「继续」由导演定位任务');
        return;
      }
      setIsExecutingProposal(true);
      patchMessage(ctx.messageId, (m) =>
        m.task
          ? {
              ...m,
              task: {
                ...m.task,
                nextProposalResolved: true,
                title: '装配互动文游',
                status: 'running',
                percent: 0,
                note: '已确认母本图，正在装配分幕…',
                startedAt: new Date().toISOString(),
              },
            }
          : m
      );
      try {
        await resumeWorkflow(currentProjectId, runId, {
          approved: true,
          summary: proposal.summary,
        });
        setActiveWatch({ runId, stage: 'build_text_game', messageId: ctx.messageId });
      } catch (err: any) {
        patchMessage(ctx.messageId, (m) =>
          m.task ? { ...m, task: { ...m.task, status: 'failed', note: `启动失败：${err.message}` } } : m
        );
        alert(`执行流水线失败: ${err.message}`);
      } finally {
        setIsExecutingProposal(false);
      }
      return;
    }

    if (!['propose_stage', 'start_pipeline', 'approve_stage', 'resume_task', 'build_text_game'].includes(proposal.action)) {
      alert(`暂不支持执行该提议（${proposal.action}），请继续与导演对话确认`);
      return;
    }
    if (gameUrl) {
      alert('index.html 游戏已产出，玩家在游戏内修改后续接入；如需重做请新建项目');
      return;
    }

    const isResumeTask = proposal.action === 'resume_task';
    const isStage2 =
      proposal.action === 'build_text_game' ||
      proposal.targetStage === 'build_text_game' ||
      (proposal.action === 'approve_stage' && Boolean(currentRunId));

    if (!isResumeTask && isStage2 && !currentRunId) {
      alert('尚未完成策划案推演，无法进入文游装配');
      return;
    }
    if (isResumeTask && !(proposal.taskId || currentRunId)) {
      alert('缺少要恢复的任务 taskId，请在对话中发送继续由导演定位任务');
      return;
    }

    // 即使跳过聊天直接批准，也确保 URL 附着当前 projectId
    hydratedProjectRef.current = currentProjectId;
    syncProjectIdToUrl(currentProjectId, 'replace');
    setIsProjectPersisted(true);
    setIsExecutingProposal(true);

    patchMessage(ctx.messageId, (m) =>
      ctx.fromTask
        ? { ...m, task: m.task ? { ...m.task, nextProposalResolved: true } : undefined }
        : { ...m, proposalResolved: true }
    );
    setActiveProposal(null);

    const now = new Date().toISOString();
    const uid = Math.random().toString(36).slice(2, 8);
    const userMsgId = `msg_confirm_${Date.now()}_${uid}`;
    const taskMsgId = `msg_task_${Date.now()}_${uid}`;
    const stage: ActiveWatchTarget['stage'] = isStage2 ? 'build_text_game' : 'plan_gdd';
    const candidateRunId = (isResumeTask ? proposal.taskId : undefined) || currentRunId || '';
    const existingOwner = isResumeTask && candidateRunId
      ? messages.find((m) => m.task?.runId === candidateRunId && m.task?.stage === stage)
      : undefined;
    const watchMsgId = existingOwner ? existingOwner.id : taskMsgId;

    if (existingOwner) {
      patchMessage(existingOwner.id, (m) => ({
        ...m,
        task: m.task
          ? {
              ...m.task,
              status: 'queued',
              note: '已恢复执行，等待流水线接管…',
              startedAt: now,
            }
          : undefined,
      }));
      appendMessages({
        id: userMsgId,
        role: 'user',
        content: `✅ 批准：${proposal.summary}`,
        createdAt: now,
      });
    } else {
      appendMessages(
        {
          id: userMsgId,
          role: 'user',
          content: `✅ 批准：${proposal.summary}`,
          createdAt: now,
        },
        {
          id: taskMsgId,
          role: 'assistant',
          // 正文留空：这一段的信息全部由任务面板承载（标题 + 进度 + 停止）
          content: '',
          createdAt: now,
          task: {
            runId: '',
            stage,
            title: isStage2 ? '装配互动文游 (index.html)' : '推演游戏策划案 (GDD)',
            status: 'queued',
            percent: 0,
            note: '已授权，等待流水线接管…',
            startedAt: now,
          },
        }
      );
    }

    try {
      let runId = candidateRunId;
      if (isResumeTask) {
        await resumeWorkflow(currentProjectId, runId, {
          approved: true,
          summary: proposal.summary,
        });
        setCurrentRunId(runId);
        setActiveTab(isStage2 ? 'text_game' : 'gdd');
      } else if (!isStage2) {
        const prompt = proposal.payload?.userPrompt || proposal.summary || '推进策划案';
        const res = await startWorkflow(currentProjectId, prompt, proposal.summary);
        runId = res.runId;
        setCurrentRunId(runId);
        setActiveTab('gdd');
      } else {
        await resumeWorkflow(currentProjectId, runId, {
          approved: true,
          summary: proposal.summary,
        });
        setActiveTab('text_game');
      }

      patchMessage(watchMsgId, (m) => ({
        ...m,
        task: m.task ? { ...m.task, runId, status: 'running' } : undefined,
      }));
      setActiveWatch({ runId, stage, messageId: watchMsgId });
    } catch (err: any) {
      patchMessage(watchMsgId, (m) => ({
        ...m,
        task: m.task
          ? { ...m.task, status: 'failed', note: `启动失败：${err.message}` }
          : undefined,
      }));
      alert(`执行流水线失败: ${err.message}`);
    } finally {
      setIsExecutingProposal(false);
    }
  };

  return (
    <div className="studio-root">
      <Header
        projects={projects}
        currentProjectId={currentProjectId}
        projectData={projectData}
        onSelectProject={handleSelectProject}
        onRefresh={reloadData}
        onCreateProject={handleCreateProject}
      />

      <div className="studio-body">
        <DirectorChat
          messages={messages}
          isStreaming={isStreaming}
          activeProposal={activeProposal}
          onSendMessage={sendMessage}
          onRetry={retryFailed}
          onDismissErrors={dismissErrors}
          onRetryTask={handleRetryTask}
          onApproveProposal={handleApproveProposal}
          onCancelTask={handleCancelTask}
          onOpenGame={(url) => {
            setGameUrl(url);
            setActiveTab('text_game');
          }}
          isExecutingProposal={isExecutingProposal}
        />

        <div className="workspace-pane">
          <nav className="tab-nav">
            <button
              className={`tab-button ${activeTab === 'gdd' ? 'active' : ''}`}
              onClick={() => setActiveTab('gdd')}
            >
              <span>📜</span>
              <span>GDD 策划案与世界观圣经</span>
              {projectData?.artifacts?.gdd && <span style={{ color: 'var(--accent-emerald)', fontSize: '11px' }}>●</span>}
            </button>

            <button
              className={`tab-button ${activeTab === 'text_game' ? 'active' : ''}`}
              onClick={() => setActiveTab('text_game')}
            >
              <span>🎮</span>
              <span>互动游戏组装器 (index.html)</span>
              {projectData?.artifacts?.text_game && <span style={{ color: 'var(--accent-emerald)', fontSize: '11px' }}>●</span>}
            </button>

            <button
              className={`tab-button ${activeTab === 'film' ? 'active' : ''}`}
              onClick={() => setActiveTab('film')}
            >
              <span>🎬</span>
              <span>影游切片播放器与视听总监</span>
              {projectData?.artifacts?.film_spec?.slices?.length ? (
                <span style={{ color: 'var(--accent-emerald)', fontSize: '11px' }}>●</span>
              ) : null}
            </button>
          </nav>

          <div className="workspace-content">
            {activeTab === 'gdd' && (
              <GddWorldBibleViewer gdd={projectData?.artifacts?.gdd} />
            )}

            {activeTab === 'text_game' && (
              <TextGameCockpit
                projectId={currentProjectId}
                textGame={projectData?.artifacts?.text_game}
                gameUrl={gameUrl}
                onRefreshProject={reloadData}
              />
            )}

            {activeTab === 'film' && (
              <FilmPlayer slices={projectData?.artifacts?.film_spec?.slices} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
export default App;
