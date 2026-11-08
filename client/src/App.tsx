import { STAGE } from './lib/stages';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  mastraStudioApi,
  MASTRA_SERVER_URL,
} from './lib/mastra';
import { mergeTaskSnapshot } from './lib/taskSnapshot';
import {
  StudioHeader,
  ChatPanel,
  GameDisplayPanel,
  MastraStudioDrawer,
  MILESTONES,
  type MilestoneId,
  type ChatMessageItem,
  type TaskItem,
  type HistoryItem,
  NarrativeViewer,
  PrevisViewer,
  AssetProductionViewer,
  VideoProductionViewer,
  FMVPlaygroundViewer,
} from './components/studio';
import { type CinematicParams } from './components/CinematicControls';

const DEFAULT_WELCOME_MESSAGE: ChatMessageItem = {
  id: 'welcome_1',
  sender: 'agent',
  senderName: 'AI 影游总导演',
  content: '🎬 **你好！我是你的 AI 互动影游总导演**。\n\n请在下方输入您的影视构思（如：*赛博朋克风悬疑短剧，记忆神偷潜入财阀调查脑机意识篡改案*）。我将为您推演四幕起承转合大纲、角色视觉定妆、视听分镜直至动态视频切片与交互影游！',
  timestamp: '刚刚',
};

export function App() {
  const [projectId, setProjectId] = useState<string>('');
  const [projectTitle, setProjectTitle] = useState<string>('新建互动影游');
  const [projectStatus, setProjectStatus] = useState<string>('idle');
  const [currentStage, setCurrentStage] = useState<string>(STAGE.NARRATIVE_DESIGN);
  const [activeMilestoneId, setActiveMilestoneId] = useState<MilestoneId | 'live_monitor'>('live_monitor');
  const [artifacts, setArtifacts] = useState<Record<string, any>>({});
  // 任务仓库快照：唯一状态来源（对话只保存 taskId 引用）
  const [tasks, setTasks] = useState<Record<string, TaskItem>>({});
  const [historyProjects, setHistoryProjects] = useState<HistoryItem[]>([]);
  const [messages, setMessages] = useState<ChatMessageItem[]>([DEFAULT_WELCOME_MESSAGE]);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  // SSE 流式打字中：只驱动气泡末尾的打字机光标，与「任务执行中」（isRunning）是两回事
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [leftWidthPercent, setLeftWidthPercent] = useState<number>(50);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isStudioDrawerOpen, setIsStudioDrawerOpen] = useState<boolean>(false);
  const [cinematicOverrides, setCinematicOverrides] = useState<Record<string, CinematicParams>>({});

  const containerRef = useRef<HTMLDivElement | null>(null);
  // 任务快照镜像：轮询需要读取「当前快照」做合并，state 闭包拿不到最新值
  const tasksRef = useRef<Record<string, TaskItem>>({});
  const pollingTimerRef = useRef<any>(null);
  const settleRefreshRef = useRef<any>(null);
  const isStreamingRef = useRef<boolean>(false);
  // 已结算任务基线：避免刷新/切项目时重复触发「生成完成自动跳转」
  const settledTaskRef = useRef<{ pid: string; ids: Set<string> }>({ pid: '', ids: new Set() });

  /**
   * 任务快照唯一写入口：同步 ref 与 state，引用未变则不触发渲染。
   * 所有写入（初次加载 / SSE 推送 / 轮询合并 / 乐观更新 / 清空）都必须走这里，
   * 否则 tasksRef 与 state 会失配，轮询合并就会基于过期快照做判断。
   */
  const applyTasks = useCallback((next: Record<string, TaskItem>) => {
    if (next === tasksRef.current) return;
    tasksRef.current = next;
    setTasks(next);
  }, []);

  // 1. 获取项目详情 + 任务仓库快照（状态唯一来源）
  const fetchProjectData = useCallback(async (pId: string) => {
    if (!pId) return;
    try {
      const [proj, taskList] = await Promise.all([
        mastraStudioApi.getProject(pId),
        mastraStudioApi.getTasks(pId).catch(() => [] as TaskItem[]),
      ]);

      // 任务快照先落地：气泡渲染只依赖它
      const taskMap: Record<string, TaskItem> = {};
      for (const t of taskList || []) taskMap[t.taskId] = t;

      // 工序导航智能跳转：任务第一次结算为 succeeded 且带产物（生成好了）→ 顶部跳到对应工序。
      // 基线策略：首次加载/切换项目只记录基线不跳转（不被老项目拉走），之后只对新增完成的任务跳转。
      const settled = settledTaskRef.current;
      const sameProject = settled.pid === pId;
      const finishedIds = new Set(
        (taskList || []).filter((t) => t.status === 'succeeded' || t.status === 'failed').map((t) => t.taskId)
      );
      if (settled.pid !== pId) {
        settledTaskRef.current = { pid: pId, ids: finishedIds };
      } else {
        const newlyFinished = (taskList || []).filter(
          (t) => t.status === 'succeeded' && !settled.ids.has(t.taskId) && (t.artifacts || []).length > 0
        );
        settled.ids = finishedIds;
        if (newlyFinished.length > 0) {
          const stages = newlyFinished.flatMap((t) => t.artifacts.map((a) => a.stage));
          const targets = stages
            .map((stage) => MILESTONES.find((m) => m.stages.includes(stage)))
            .filter((m): m is (typeof MILESTONES)[number] => Boolean(m));
          if (targets.length > 0) {
            const target = targets.reduce((a, b) => (b.index > a.index ? b : a));
            setActiveMilestoneId(target.id);
          }
        }
      }

      // 同项目：合并进现有快照（迟到响应不能把状态拉回去）；切项目：整份替换
      applyTasks(sameProject ? mergeTaskSnapshot(tasksRef.current, taskList || []) : taskMap);

      if (proj) {
        setProjectTitle(proj.title || proj.meta?.idea || '未命名短剧');
        setProjectStatus(proj.status || 'idle');
        if (proj.currentStage) setCurrentStage(proj.currentStage);
        if (proj.stageArtifacts) setArtifacts(proj.stageArtifacts);

        // 🌟 断线恢复：从 project.history 还原消息流
        // 关键流式守卫：当正处于大模型流式打字期间，严禁使用尚未完整的历史覆盖当前打字机消息！
        if (!isStreamingRef.current && Array.isArray(proj.history) && proj.history.length > 0) {
          const restoredMessages: ChatMessageItem[] = proj.history.map((h: any, idx: number) => ({
            id: `hist_${idx}_${h.timestamp || Date.now()}`,
            sender: (h.role === 'assistant' ? 'agent' : 'user') as 'agent' | 'user',
            senderName: h.role === 'assistant' ? 'AI 影游总导演' : '创作者',
            content: h.content || '',
            thought: h.thought,
            // 消息只带 taskId 引用，状态由 tasks 快照投影，无需任何对账回填。
            // 旧数据没有 taskId，但提案实体已迁移为任务，用 actionId 兜底接入同一条任务流。
            taskId: h.taskId || h.proposal?.actionId || h.nextProposal?.actionId,
            timestamp: h.timestamp ? new Date(h.timestamp).toLocaleTimeString() : '历史',
          }));
          setMessages(restoredMessages);
        }
      }
    } catch (err) {
      console.warn('[App] 获取项目详情异常:', err);
    }
  }, [applyTasks]);

  // 2. 轮询任务仓库：唯一轮询目标，不再改写消息
  const checkRunningTasks = useCallback(async (pId: string) => {
    if (!pId) return;
    try {
      const taskList = await mastraStudioApi.getTasks(pId);
      // 合并而非覆盖：轮询响应可能晚于 SSE 推送到达，直接替换会让进度条倒退、结算被回滚
      const merged = mergeTaskSnapshot(tasksRef.current, taskList || []);
      applyTasks(merged);

      /*
       * queued 也算「进行中」：批准后引擎尚未接管的空窗期如果不继续轮询，
       * 一旦 SSE 流已结束，气泡会永远停在「等待执行」不再刷新。
       */
      const activeTask = Object.values(merged).find(
        (t) => t.status === 'running' || t.status === 'queued'
      );
      if (activeTask) {
        setIsRunning(true);
      } else if (!isStreamingRef.current) {
        setIsRunning(false);
        // 任务收摊：停止轮询并刷新项目产物（同时结算「生成完成跳转」）
        if (pollingTimerRef.current) {
          clearInterval(pollingTimerRef.current);
          pollingTimerRef.current = null;
        }
        fetchProjectData(pId);
        // 沉降刷新：onSuccess 里还会派发「下一工序」任务，可能比终态晚一拍
        if (settleRefreshRef.current) clearTimeout(settleRefreshRef.current);
        settleRefreshRef.current = setTimeout(() => {
          settleRefreshRef.current = null;
          fetchProjectData(pId);
        }, 1500);
      }
    } catch {}
  }, [fetchProjectData, applyTasks]);

  const startPolling = useCallback((pId: string) => {
    if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    checkRunningTasks(pId);
    pollingTimerRef.current = setInterval(() => {
      checkRunningTasks(pId);
    }, 2000);
  }, [checkRunningTasks]);

  // 同步项目 ID 到浏览器地址栏 (URL SearchParams SSOT)
  const syncProjectIdToUrl = useCallback((id: string, replace = false) => {
    try {
      const url = new URL(window.location.href);
      if (!id) {
        if (url.searchParams.has('projectId')) {
          url.searchParams.delete('projectId');
          window.history.replaceState({}, '', url.toString());
        }
        return;
      }
      if (url.searchParams.get('projectId') === id) return;
      url.searchParams.set('projectId', id);
      if (replace) {
        window.history.replaceState({}, '', url.toString());
      } else {
        window.history.pushState({}, '', url.toString());
      }
    } catch {}
  }, []);

  // 重置为空白新项目状态 (SSOT)
  const resetToNewProjectState = useCallback(() => {
    setProjectId('');
    setProjectTitle('新建互动影游');
    setProjectStatus('idle');
    setCurrentStage(STAGE.NARRATIVE_DESIGN);
    setActiveMilestoneId('live_monitor');
    setArtifacts({});
    applyTasks({});
    settledTaskRef.current = { pid: '', ids: new Set() };
    setMessages([DEFAULT_WELCOME_MESSAGE]);
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
  }, []);

  // 3. 仅静默刷新历史项目列表 (绝不干扰当前 messages 对话流)
  const refreshHistoryProjectsOnly = useCallback(async () => {
    try {
      const projects = await mastraStudioApi.getProjects();
      const list = (projects || []).map((p: any) => ({
        id: p.projectId,
        idea: p.title || p.meta?.idea || '未命名短剧',
        date: p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : '近期',
        status: p.status || 'idle',
      }));
      setHistoryProjects(list);
    } catch (err) {
      console.warn('[App] 刷新历史项目列表异常:', err);
    }
  }, []);

  // 4. 初始加载全部历史项目并与 URL 双向同步
  const loadProjects = useCallback(async () => {
    try {
      await refreshHistoryProjectsOnly();

      const urlParams = new URLSearchParams(window.location.search);
      const urlProjectId = urlParams.get('projectId');

      if (urlProjectId) {
        // 优先恢复地址栏指定项目
        if (projectId !== urlProjectId) {
          setProjectId(urlProjectId);
        }
        fetchProjectData(urlProjectId);
        startPolling(urlProjectId);
      } else {
        // 地址栏无 projectId：处于新建空白项目状态，坚决不自动绑定历史老项目
        if (projectId) {
          resetToNewProjectState();
        }
      }
    } catch (err) {
      console.warn('[App] 加载项目列表异常:', err);
    }
  }, [projectId, fetchProjectData, startPolling, resetToNewProjectState]);

  useEffect(() => {
    loadProjects();
    return () => {
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
      if (settleRefreshRef.current) clearTimeout(settleRefreshRef.current);
    };
  }, [loadProjects]);

  // 监听浏览器前进/后退 (popstate)
  useEffect(() => {
    const handlePopState = () => {
      const pId = new URLSearchParams(window.location.search).get('projectId');
      if (pId && pId !== projectId) {
        setProjectId(pId);
        fetchProjectData(pId);
        startPolling(pId);
      } else if (!pId && projectId) {
        // 浏览器后退到无 projectId 的根路径
        resetToNewProjectState();
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [projectId, fetchProjectData, startPolling, resetToNewProjectState]);

  // 4. 切换项目
  const handleSelectSession = (id: string) => {
    setProjectId(id);
    syncProjectIdToUrl(id, false);
    setMessages([
      {
        id: 'welcome_1',
        sender: 'agent',
        senderName: 'AI 影游总导演',
        content: '🎬 项目已载入。您可以随时提出修改建议、调整特定镜头或启动全工序推演。',
        timestamp: '刚刚',
      },
    ]);
    fetchProjectData(id);
    startPolling(id);
  };

  // 5. 新建项目
  const handleNewProject = async () => {
    try {
      const newProj = await mastraStudioApi.createProject({ title: '全新互动影游创作' });
      const newId = newProj.projectId || `proj_${Date.now()}`;
      setProjectId(newId);
      syncProjectIdToUrl(newId, false);
      setProjectTitle(newProj.title || '全新互动影游创作');
      setArtifacts({});
      setMessages([
        {
          id: 'new_init',
          sender: 'agent',
          senderName: 'AI 影游总导演',
          content: '🎬 **全新项目已就绪！**\n\n请在下方输入您的故事大纲或灵感题材（例如：古代悬疑、暴雨密室杀人案），我们将为您开始影视工程推演。',
          timestamp: '刚刚',
        },
      ]);
      loadProjects();
    } catch {}
  };

  // 6. 删除项目
  const handleDeleteSession = async (id: string) => {
    try {
      await mastraStudioApi.deleteProject(id);
      if (projectId === id) {
        resetToNewProjectState();
        syncProjectIdToUrl('', true);
      }
      loadProjects();
    } catch {}
  };

  // 7. 发送对话 (统一基于 mastraStudioApi.streamChat)
  const handleSendMessage = async (
    text: string,
    options?: { approvedTaskId?: string; overrideParameters?: Record<string, any> }
  ) => {
    if (!text.trim() || isRunning || projectStatus === 'running') return;

    let activeProjectId = projectId;

    const userMsg: ChatMessageItem = {
      id: `msg_u_${Date.now()}`,
      sender: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    const assistantMsgId = `msg_a_${Date.now()}`;
    const assistantPlaceholder: ChatMessageItem = {
      id: assistantMsgId,
      sender: 'agent',
      senderName: 'AI 影游总导演',
      content: '',
      thought: '',
      timestamp: new Date().toLocaleTimeString(),
    };
    setMessages((prev) => [...prev, assistantPlaceholder]);
    setIsRunning(true);
    isStreamingRef.current = true;
    setIsStreaming(true);

    try {
      await mastraStudioApi.streamChat(
        projectId,
        text,
        {
          onMeta: ({ projectId: metaPid }) => {
            if (metaPid) {
              activeProjectId = metaPid;
              if (metaPid !== projectId) {
                setProjectId(metaPid);
                syncProjectIdToUrl(metaPid, true);
                // 关键修复：仅静默刷新左侧历史项目列表，绝不重置当前正在流式打字的 messages！
                refreshHistoryProjectsOnly();
              }
            }
          },
          onChunk: (accumulated) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMsgId ? { ...m, content: accumulated } : m))
            );
          },
          onThought: (thoughtText) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, thought: (m.thought || '') + thoughtText }
                  : m
              )
            );
          },
          onTask: (task) => {
            // 任务实体单独入库；消息只挂 taskId 引用
            applyTasks({ ...tasksRef.current, [task.taskId]: task });
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMsgId ? { ...m, taskId: task.taskId } : m))
            );
          },
          onDone: ({ taskId }) => {
            if (taskId) {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantMsgId ? { ...m, taskId } : m))
              );
            }
          },
          onError: (err) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: (m.content ? m.content + '\n\n' : '') + `⚠️ 对话服务异常: ${err.message || '生成中断'}` }
                  : m
              )
            );
          },
        },
        options
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: `⚠️ 对话服务异常: ${err.message}` }
            : m
        )
      );
    } finally {
      isStreamingRef.current = false;
      setIsStreaming(false);
      fetchProjectData(activeProjectId);
      // 🌟 核心：无论创作者是点击按钮还是打字确认，对话结束后立即启动轮询，监听后台任务执行与进度落盘！
      if (activeProjectId) {
        startPolling(activeProjectId);
      }
    }
  };

  // 8. 批准并执行任务 (人在回路仲裁：点击卡片发送确认消息走对话形式)
  const handleApproveTask = async (taskId: string, overrides?: Record<string, any>) => {
    if (!projectId || !taskId) return;
    const task = tasksRef.current[taskId];

    /*
     * 乐观更新到 queued（而非 running）：服务端批准后先 queued 再由引擎接管 running，
     * 若乐观成 running，随后拉到的 queued 会把气泡打回「等待执行」再跳回执行中，来回抖动。
     */
    const current = tasksRef.current[taskId];
    if (current) {
      applyTasks({
        ...tasksRef.current,
        [taskId]: {
          ...current,
          status: 'queued',
        },
      });
    }

    startPolling(projectId);

    const confirmMessage = `批准执行任务【${task?.title || taskId}】`;
    await handleSendMessage(confirmMessage, {
      approvedTaskId: taskId,
      overrideParameters: overrides,
    });
  };

  // 9. 失败重试：复用同一任务实体（状态回到 queued 再启动）
  const handleRetryTask = async (taskId: string) => {
    if (!projectId || !taskId) return;
    // 乐观更新到 queued：立刻脱离 failed 态，避免重试按钮在轮询生效前可被重复点击
    const current = tasksRef.current[taskId];
    if (current && (current.status === 'failed' || current.status === 'cancelled')) {
      applyTasks({
        ...tasksRef.current,
        [taskId]: { ...current, status: 'queued' },
      });
    }
    try {
      await mastraStudioApi.retryTask(taskId, projectId);
      startPolling(projectId);
    } catch (err) {
      console.warn('[App] 重试任务失败:', err);
      // 失败则回滚乐观更新，让按钮重新出现
      if (current) {
        applyTasks({ ...tasksRef.current, [taskId]: current });
      }
    }
  };

  // 9.1 打开产物：跳到该产物所属工序里程碑
  const handleOpenArtifact = useCallback((stage: string) => {
    const target = MILESTONES.find((m) => m.stages.includes(stage));
    if (target) setActiveMilestoneId(target.id);
  }, []);

  // 10. 拖拽调节分屏比例
  const handleMouseDown = () => {
    setIsDragging(true);
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newPercent = ((e.clientX - rect.left) / rect.width) * 100;
      if (newPercent >= 30 && newPercent <= 75) {
        setLeftWidthPercent(newPercent);
      }
    },
    [isDragging]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans select-none">
      {/* 顶部总控台导航 Header */}
      <StudioHeader
        projectTitle={projectTitle}
        sessionId={projectId}
        onNewProject={handleNewProject}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onOpenStudioDrawer={() => setIsStudioDrawerOpen(true)}
        history={historyProjects}
        status={projectStatus}
      />

      {/* 工序导航指示条 (Milestone Bar) */}
      <div className="h-10 bg-slate-900/90 border-b border-slate-800 px-6 flex items-center justify-between shrink-0 text-xs">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => setActiveMilestoneId('live_monitor')}
            className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
              activeMilestoneId === 'live_monitor'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            📺 实时影游荧幕
          </button>

          <span className="text-slate-700">|</span>

          {MILESTONES.map((m) => {
            const isCurrent = activeMilestoneId === m.id;
            const hasDeliverable = Boolean(artifacts[m.primaryStage]);

            return (
              <button
                key={m.id}
                onClick={() => setActiveMilestoneId(m.id)}
                className={`px-3 py-1 rounded-lg font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                  isCurrent
                    ? 'bg-indigo-600 text-white font-bold shadow-xs'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <span>{m.shortName}</span>
                {hasDeliverable && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                )}
              </button>
            );
          })}
        </div>

        <div className="text-[11px] font-mono text-slate-500">
          工序: <span className="text-indigo-400 font-bold">{currentStage}</span>
        </div>
      </div>

      {/* 左右分屏中枢主体 */}
      <div ref={containerRef} className="flex-1 flex overflow-hidden relative">
        {/* 左侧：专业对话中枢座舱 */}
        <div
          style={{ width: `${leftWidthPercent}%` }}
          className="h-full border-r border-slate-800 flex flex-col overflow-hidden shrink-0"
        >
          <ChatPanel
            messages={messages}
            tasks={tasks}
            artifacts={artifacts}
            onSendMessage={handleSendMessage}
            onApproveTask={handleApproveTask}
            onRetryTask={handleRetryTask}
            onOpenArtifact={handleOpenArtifact}
            isRunning={isRunning}
            isStreaming={isStreaming}
            projectStatus={projectStatus}
            currentStage={currentStage}
            cinematicOverrides={cinematicOverrides}
            onChangeCinematicOverride={(taskId, params) =>
              setCinematicOverrides((prev) => ({ ...prev, [taskId]: params }))
            }
          />
        </div>

        {/* 可拖拽调整宽度分割手柄 */}
        <div
          onMouseDown={handleMouseDown}
          className={`w-1.5 h-full cursor-col-resize hover:bg-indigo-500 active:bg-indigo-600 transition-colors z-20 ${
            isDragging ? 'bg-indigo-600' : 'bg-transparent'
          }`}
          title="左右拖拽调整视图宽度"
        />

        {/* 右侧：多工序产物监视器视窗 */}
        <div className="flex-1 h-full overflow-hidden flex flex-col bg-slate-950">
          {activeMilestoneId === 'live_monitor' ? (
            <GameDisplayPanel
              artifacts={artifacts}
              sessionId={projectId}
              isRunning={isRunning}
            />
          ) : activeMilestoneId === 'milestone_1' ? (
            <NarrativeViewer
              artifact={artifacts[STAGE.NARRATIVE_DESIGN]}
              isRunning={isRunning}
            />
          ) : activeMilestoneId === 'milestone_2' ? (
            <AssetProductionViewer
              characterArtifact={artifacts[STAGE.CHARACTER_DESIGN]}
              scriptArtifact={artifacts[STAGE.SCENE_SCRIPT]}
              sessionId={projectId}
              onRefreshArtifacts={() => fetchProjectData(projectId)}
            />
          ) : activeMilestoneId === 'milestone_3' ? (
            <PrevisViewer
              storyboardArtifact={artifacts[STAGE.STORYBOARD]}
              referenceArtifact={artifacts[STAGE.KEYFRAME_REFERENCE]}
              isRunning={isRunning}
            />
          ) : activeMilestoneId === 'milestone_4' ? (
            <VideoProductionViewer
              videoArtifact={artifacts[STAGE.VIDEO_PRODUCTION]}
              isRunning={isRunning}
            />
          ) : (
            <FMVPlaygroundViewer
              packagerArtifact={artifacts[STAGE.FMV_PACKAGING]}
              sessionId={projectId}
            />
          )}
        </div>
      </div>

      {/* Mastra Studio 工作流与智能体全景态势抽屉 */}
      <MastraStudioDrawer
        isOpen={isStudioDrawerOpen}
        onClose={() => setIsStudioDrawerOpen(false)}
        currentStage={currentStage}
        projectId={projectId}
      />
    </div>
  );
}

export default App;
