/**
 * client/src/components/studio/StudioApp.tsx
 * 现代 Tool-First 互动影游导演工坊根组件 (Studio SSOT)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ProjectData, ProjectMetadata, TaskRecord } from '../../types/index.js';
import {
  fetchProjects,
  fetchProject,
  createProject,
  runTask,
  cancelTask,
  fetchTasks,
} from '../../lib/api.js';
import { upsertTaskRecords } from '../../lib/taskUtils.js';
import { PipelineStepper, type StudioStage } from './PipelineStepper.js';
import { TaskDrawer } from './TaskDrawer.js';
import { PlannerStage } from './stages/PlannerStage.js';
import { VisualStage } from './stages/VisualStage.js';
import { GameStage } from './stages/GameStage.js';

// 从浏览器地址栏解析当前 projectId
function getUrlProjectId(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('projectId') || '';
  } catch {
    return '';
  }
}

// 将当前选中的 projectId 实时同步回浏览器地址栏
function syncUrlProjectId(pid: string): void {
  if (!pid) return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('projectId') !== pid) {
      url.searchParams.set('projectId', pid);
      window.history.replaceState({ projectId: pid }, '', url.toString());
    }
  } catch (err) {
    console.warn('[Studio] 同步 URL 失败:', err);
  }
}

export function StudioApp() {
  const [projects, setProjects] = useState<ProjectMetadata[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string>(() => getUrlProjectId());
  const [projectData, setProjectData] = useState<ProjectData | null>(null);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [currentStage, setCurrentStage] = useState<StudioStage>('planner');
  const [isBusy, setIsBusy] = useState(false);
  const initializedStageProjectRef = useRef<string | null>(null);
  const selectedProjectIdRef = useRef(currentProjectId);
  selectedProjectIdRef.current = currentProjectId;

  // 1. 初始化项目列表与会话路由判定（无参数时一律作为全新创作会话，绝不隐式回填旧项目）
  const refreshProjects = useCallback(async () => {
    try {
      const urlPid = getUrlProjectId();
      const list = await fetchProjects();

      if (urlPid && list.some((p) => p.projectId === urlPid)) {
        // A. 若 URL 显式指定了存在的 projectId，精准加载该历史项目
        setProjects(list);
        setCurrentProjectId(urlPid);
      } else if (!urlPid) {
        // B. 若 URL 无参数（创作者清空参数刷新，或访问根路径），视为开启全新创作会话
        const newProj = await createProject('全新互动影游项目');
        setProjects([newProj, ...list]);
        setCurrentProjectId(newProj.projectId);
        syncUrlProjectId(newProj.projectId);
        setProjectData(null);
        setTasks([]);
      } else if (list.length > 0) {
        // C. URL 中带了无效的 pid，兜底回退第一个有效项目
        setProjects(list);
        setCurrentProjectId(list[0].projectId);
        syncUrlProjectId(list[0].projectId);
      }
    } catch (err) {
      console.error('[Studio] 加载项目列表失败:', err);
    }
  }, []);

  // 2. 状态变化时实时同步到地址栏
  useEffect(() => {
    if (currentProjectId) {
      syncUrlProjectId(currentProjectId);
    }
  }, [currentProjectId]);

  // 3. 监听浏览器前进/后退
  useEffect(() => {
    const handlePopState = () => {
      const pid = getUrlProjectId();
      if (pid && pid !== currentProjectId) {
        setCurrentProjectId(pid);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [currentProjectId]);

  // 4. 加载当前项目数据与任务列表
  const refreshCurrentProject = useCallback(async (pid: string) => {
    try {
      const [pData, tList] = await Promise.all([
        fetchProject(pid).catch(() => null),
        fetchTasks(pid).catch(() => []),
      ]);
      if (selectedProjectIdRef.current !== pid) return;
      setProjectData(pData);
      setTasks((prev) => upsertTaskRecords(prev, tList));
    } catch (err) {
      console.error('[Studio] 刷新项目详情失败:', err);
    }
  }, []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    if (currentProjectId) {
      refreshCurrentProject(currentProjectId);
    }
  }, [currentProjectId, refreshCurrentProject]);

  // 3. 建立 SSE 实时长连接
  useEffect(() => {
    if (!currentProjectId) return;

    const eventSource = new EventSource(`/api/events?projectId=${encodeURIComponent(currentProjectId)}`);

    eventSource.addEventListener('task_event', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        console.log('[SSE Task Event]:', payload);

        // 权威状态跃迁合并 (SSOT)
        setTasks((prev) => upsertTaskRecords(prev, payload));

        // 若任务完成，自动刷新全局资产黑板
        if (payload.status === 'completed' || payload.status === 'failed') {
          refreshCurrentProject(currentProjectId);
          setIsBusy(false);
        }
      } catch (err) {
        console.error('[SSE] 解析任务事件失败:', err);
      }
    });

    return () => {
      eventSource.close();
    };
  }, [currentProjectId, refreshCurrentProject]);

  // 4. 派发执行任务工具 (异步排队模型，派发成功后立即释放派发锁，由 tasks 驱动各卡片生命周期)
  const handleRunTool = async (toolName: string, input: Record<string, any>): Promise<TaskRecord | undefined> => {
    if (!currentProjectId) return undefined;
    setIsBusy(true);
    try {
      const task = await runTask(currentProjectId, toolName, input);
      setTasks((prev) => upsertTaskRecords(prev, task));
      setIsBusy(false);
      return task;
    } catch (err: any) {
      setIsBusy(false);
      alert(`任务派发失败: ${err?.message || err}`);
      throw err;
    }
  };

  const activeProject = projectData?.meta.projectId === currentProjectId ? projectData : null;
  const prd = activeProject?.prd || activeProject?.artifacts?.prd || activeProject?.artifacts?.gdd;
  const hasPrd = Boolean(prd?.startNodeId && prd?.clips?.length && prd?.wiring?.length);
  const clips = activeProject?.artifacts?.film_spec?.clips || activeProject?.storyboards || [];
  const canEnterVisual = hasPrd;
  const canEnterGame = hasPrd && prd.clips.every((clip: { id: string }) => {
    const storyboard = clips.find((item: any) => item.clipId === clip.id || item.sourceNodeId === clip.id);
    return Boolean(storyboard && (storyboard.videoUrl ||
      (storyboard.shots?.length && storyboard.shots.every((shot: any) => Boolean(shot.videoUrl)))));
  });
  const allowedStage = (stage: StudioStage): StudioStage => {
    if (stage === 'game' && !canEnterGame) return canEnterVisual ? 'visual' : 'planner';
    if (stage === 'visual' && !canEnterVisual) return 'planner';
    return stage;
  };
  const visibleStage = allowedStage(currentStage);
  const handleSelectStage = (stage: StudioStage) => {
    if (allowedStage(stage) === stage) setCurrentStage(stage);
  };

  useEffect(() => {
    setCurrentStage('planner');
    initializedStageProjectRef.current = null;
  }, [currentProjectId]);

  // 项目数据首次加载完成后，刷新/切换项目默认进入当前已解锁的最深阶段。
  // 只在该项目本次加载的第一次数据落地时执行，避免任务完成后自动抢走用户当前视图。
  useEffect(() => {
    if (!currentProjectId || !projectData || projectData.meta?.projectId !== currentProjectId) return;
    if (initializedStageProjectRef.current === currentProjectId) return;
    initializedStageProjectRef.current = currentProjectId;
    setCurrentStage(canEnterGame ? 'game' : canEnterVisual ? 'visual' : 'planner');
  }, [currentProjectId, projectData, canEnterGame, canEnterVisual]);
  const hasEntities = Boolean(
    projectData?.entities?.characters?.length ||
      projectData?.artifacts?.lookdev_entities?.characters?.length
  );
  const hasStoryboards = Boolean(
    projectData?.storyboards?.length ||
      projectData?.artifacts?.film_spec?.clips?.length ||
      projectData?.artifacts?.film_spec?.slices?.length
  );
  const hasGame = Boolean(
    projectData?.meta?.currentStage === 'completed' ||
      projectData?.artifacts?.hasStandaloneGame
  );

  const handleCreateProject = async () => {
    try {
      const meta = await createProject('全新互动影游项目');
      setProjects((prev) => [meta, ...prev]);
      setCurrentProjectId(meta.projectId);
      setProjectData(null);
      setTasks([]);
    } catch (err) {
      console.error('[Studio] 创建项目失败:', err);
    }
  };

  const handleCancelTask = async (taskId: string) => {
    try {
      await cancelTask(taskId);
      if (currentProjectId) refreshCurrentProject(currentProjectId);
    } catch (err) {
      console.error('[Studio] 取消任务失败:', err);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-50 text-slate-800 font-sans overflow-hidden select-none">
      {/* 顶部管线步进 */}
      <PipelineStepper
        currentStage={visibleStage}
        onSelectStage={handleSelectStage}
        canEnterVisual={canEnterVisual}
        canEnterGame={canEnterGame}
        hasPrd={hasPrd}
        hasEntities={hasEntities}
        hasStoryboards={hasStoryboards}
        hasGame={hasGame}
        projects={projects}
        currentProjectId={currentProjectId}
        onSelectProject={setCurrentProjectId}
        onCreateProject={handleCreateProject}
      />

      {/* 工序主工作区 */}
      <main className="flex-1 overflow-hidden relative">
        {visibleStage === 'planner' && (
          <PlannerStage
            projectId={currentProjectId}
            projectData={projectData}
            onRunTool={handleRunTool}
            tasks={tasks}
            onSelectStage={handleSelectStage}
            isBusy={isBusy}
          />
        )}
        {visibleStage === 'visual' && (
          <VisualStage
            projectId={currentProjectId}
            projectData={projectData}
            tasks={tasks}
            onRunTool={handleRunTool}
            onRefreshProject={() => currentProjectId && refreshCurrentProject(currentProjectId)}
            isBusy={isBusy}
          />
        )}
        {visibleStage === 'game' && (
          <GameStage
            projectId={currentProjectId}
            projectData={projectData}
            onRunTool={handleRunTool}
            isBusy={isBusy}
          />
        )}
      </main>

      {/* 全局任务抽屉 */}
      <TaskDrawer
        tasks={tasks}
        onRefreshTasks={() => currentProjectId && refreshCurrentProject(currentProjectId)}
        onCancelTask={handleCancelTask}
      />
    </div>
  );
}
