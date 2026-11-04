import { useState, useEffect, useRef, useCallback } from 'react';
import {
  mastraStudioApi,
  MASTRA_SERVER_URL,
} from './lib/mastra';
import {
  StudioHeader,
  ChatPanel,
  GameDisplayPanel,
  MastraStudioDrawer,
  MILESTONES,
  type MilestoneId,
  type ChatMessageItem,
  type ActionProposal,
  type HistoryItem,
  NarrativeViewer,
  PrevisViewer,
  AssetProductionViewer,
  VideoProductionViewer,
  FMVPlaygroundViewer,
} from './components/studio';
import { type CinematicParams } from './components/CinematicControls';

export function App() {
  const [projectId, setProjectId] = useState<string>('');
  const [projectTitle, setProjectTitle] = useState<string>('新建互动影游');
  const [projectStatus, setProjectStatus] = useState<string>('idle');
  const [currentStage, setCurrentStage] = useState<string>('narrative_design');
  const [activeMilestoneId, setActiveMilestoneId] = useState<MilestoneId | 'live_monitor'>('live_monitor');
  const [artifacts, setArtifacts] = useState<Record<string, any>>({});
  const [historyProjects, setHistoryProjects] = useState<HistoryItem[]>([]);
  const [messages, setMessages] = useState<ChatMessageItem[]>([
    {
      id: 'welcome_1',
      sender: 'agent',
      senderName: 'AI 影游总导演',
      content: '🎬 **你好！我是你的 AI 互动影游总导演**。\n\n请在下方输入您的影视构思（如：*赛博朋克风悬疑短剧，记忆神偷潜入财阀调查脑机意识篡改案*）。我将为您推演四幕起承转合大纲、角色视觉定妆、视听分镜直至动态视频切片与交互影游！',
      timestamp: '刚刚',
    },
  ]);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [leftWidthPercent, setLeftWidthPercent] = useState<number>(50);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isStudioDrawerOpen, setIsStudioDrawerOpen] = useState<boolean>(false);
  const [cinematicOverrides, setCinematicOverrides] = useState<Record<string, CinematicParams>>({});

  const containerRef = useRef<HTMLDivElement | null>(null);
  const pollingTimerRef = useRef<any>(null);

  // 1. 获取项目详情与工序产物 (基于 mastraStudioApi SSOT)
  const fetchProjectData = useCallback(async (pId: string) => {
    if (!pId) return;
    try {
      const proj = await mastraStudioApi.getProject(pId);
      if (proj) {
        setProjectTitle(proj.title || proj.meta?.idea || '未命名短剧');
        setProjectStatus(proj.status || 'idle');
        if (proj.currentStage) setCurrentStage(proj.currentStage);
        if (proj.stageArtifacts) {
          setArtifacts(proj.stageArtifacts);
          // 视听工作台大屏智能联动：若故事圣经已就绪且当前处于默认待机屏，自动聚焦【叙事架构】
          setActiveMilestoneId((prev) => {
            if (prev === 'live_monitor' && proj.stageArtifacts?.narrative_design && !proj.stageArtifacts?.video_production) {
              return 'milestone_1';
            }
            return prev;
          });
        }

        // 🌟 断线恢复：从 project.history 还原消息流 (解除 prev.length <= 1 僵硬死锁)
        if (Array.isArray(proj.history) && proj.history.length > 0) {
          const restoredMessages: ChatMessageItem[] = proj.history.map((h: any, idx: number) => ({
            id: `hist_${idx}_${h.timestamp || Date.now()}`,
            sender: (h.role === 'assistant' ? 'agent' : 'user') as 'agent' | 'user',
            senderName: h.role === 'assistant' ? 'AI 影游总导演' : '创作者',
            content: h.content || '',
            thought: h.thought,
            actionProposal: h.proposal,
            timestamp: h.timestamp ? new Date(h.timestamp).toLocaleTimeString() : '历史',
          }));
          setMessages(restoredMessages);
        }
      }
    } catch (err) {
      console.warn('[App] 获取项目详情异常:', err);
    }
  }, []);

  // 2. 轮询监听 running 状态的提案任务
  const checkRunningProposals = useCallback(async (pId: string) => {
    if (!pId) return;
    try {
      const proposals = await mastraStudioApi.getProposals(pId);
      const running = proposals.find((p) => p.status === 'running');

      // 更新 messages 中卡片状态与细粒度进度 (lastMessage)
      if (proposals.length > 0) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.actionProposal) {
              const latest = proposals.find((p) => p.actionId === m.actionProposal?.actionId);
              if (latest) {
                return { ...m, actionProposal: latest };
              }
            }
            return m;
          })
        );
      }

      if (running) {
        setIsRunning(true);
      } else {
        setIsRunning(false);
        // 任务完成：停止轮询并刷新项目产物
        if (pollingTimerRef.current) {
          clearInterval(pollingTimerRef.current);
          pollingTimerRef.current = null;
        }
        fetchProjectData(pId);
      }
    } catch {}
  }, [fetchProjectData]);

  const startPolling = useCallback((pId: string) => {
    if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    checkRunningProposals(pId);
    pollingTimerRef.current = setInterval(() => {
      checkRunningProposals(pId);
    }, 2000);
  }, [checkRunningProposals]);

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

  // 3. 初始加载全部历史项目并与 URL 双向同步
  const loadProjects = useCallback(async () => {
    try {
      const projects = await mastraStudioApi.getProjects();
      const list = (projects || []).map((p: any) => ({
        id: p.projectId,
        idea: p.title || p.meta?.idea || '未命名短剧',
        date: p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : '近期',
        status: p.status || 'idle',
      }));
      setHistoryProjects(list);

      const urlParams = new URLSearchParams(window.location.search);
      const urlProjectId = urlParams.get('projectId');

      if (urlProjectId) {
        // 优先恢复地址栏指定项目
        if (projectId !== urlProjectId) {
          setProjectId(urlProjectId);
        }
        fetchProjectData(urlProjectId);
        startPolling(urlProjectId);
      } else if (list.length > 0 && !projectId) {
        // 无参数时加载首个项目并写入地址栏
        const firstId = list[0].id;
        setProjectId(firstId);
        syncProjectIdToUrl(firstId, true);
        fetchProjectData(firstId);
        startPolling(firstId);
      }
    } catch (err) {
      console.warn('[App] 加载项目列表异常:', err);
    }
  }, [projectId, fetchProjectData, startPolling, syncProjectIdToUrl]);

  useEffect(() => {
    loadProjects();
    return () => {
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
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
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [projectId, fetchProjectData, startPolling]);

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
        setProjectId('');
        syncProjectIdToUrl('', true);
      }
      loadProjects();
    } catch {}
  };

  // 7. 发送对话 (统一基于 mastraStudioApi.streamChat)
  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isRunning) return;

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

    try {
      await mastraStudioApi.streamChat(projectId, text, {
        onMeta: ({ projectId: metaPid }) => {
          if (metaPid) {
            activeProjectId = metaPid;
            if (metaPid !== projectId) {
              setProjectId(metaPid);
              syncProjectIdToUrl(metaPid, true);
              loadProjects();
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
        onProposal: (proposal) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, actionProposal: proposal } : m))
          );
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
      });
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: `⚠️ 对话服务异常: ${err.message}` }
            : m
        )
      );
    } finally {
      setIsRunning(false);
      fetchProjectData(activeProjectId);
    }
  };

  // 8. 批准并执行提案 (人在回路仲裁)
  const handleExecuteProposal = async (proposal: ActionProposal, overrides?: Record<string, any>) => {
    if (!projectId || !proposal.actionId) return;

    // 立即乐观更新卡片为 running
    setMessages((prev) =>
      prev.map((m) => {
        if (m.actionProposal?.actionId === proposal.actionId) {
          return {
            ...m,
            actionProposal: {
              ...m.actionProposal,
              status: 'running',
              lastMessage: '⚡ 正在调度 Mastra 影视工作流，即将开始渲染...',
            },
          };
        }
        return m;
      })
    );
    setIsRunning(true);

    try {
      await mastraStudioApi.approveProposal(proposal.actionId, overrides);
      // 启动轮询监听执行进度
      startPolling(projectId);
    } catch (err: any) {
      alert(`启动任务异常: ${err.message}`);
      setIsRunning(false);
      fetchProjectData(projectId);
    }
  };

  // 9. 忽略提案
  const handleDismissProposal = async (actionId: string) => {
    if (!projectId || !actionId) return;
    try {
      await mastraStudioApi.rejectProposal(actionId);
      setMessages((prev) =>
        prev.map((m) =>
          m.actionProposal?.actionId === actionId
            ? { ...m, actionProposal: { ...m.actionProposal, status: 'dismissed' } }
            : m
        )
      );
    } catch {}
  };

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
            sessionId={projectId}
            artifacts={artifacts}
            onSendMessage={handleSendMessage}
            onExecuteProposal={handleExecuteProposal}
            onDismissProposal={handleDismissProposal}
            isRunning={isRunning}
            currentStage={currentStage}
            cinematicOverrides={cinematicOverrides}
            onChangeCinematicOverride={(actionId, params) =>
              setCinematicOverrides((prev) => ({ ...prev, [actionId]: params }))
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
              artifact={artifacts['narrative_design']}
              isRunning={isRunning}
            />
          ) : activeMilestoneId === 'milestone_2' ? (
            <AssetProductionViewer
              characterArtifact={artifacts['character_design']}
              scriptArtifact={artifacts['scene_script']}
              sessionId={projectId}
              onRefreshArtifacts={() => fetchProjectData(projectId)}
            />
          ) : activeMilestoneId === 'milestone_3' ? (
            <PrevisViewer
              storyboardArtifact={artifacts['storyboard']}
              referenceArtifact={artifacts['keyframe_reference']}
              isRunning={isRunning}
            />
          ) : activeMilestoneId === 'milestone_4' ? (
            <VideoProductionViewer
              videoArtifact={artifacts['video_production']}
              isRunning={isRunning}
            />
          ) : (
            <FMVPlaygroundViewer
              packagerArtifact={artifacts['fmv_packaging']}
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
