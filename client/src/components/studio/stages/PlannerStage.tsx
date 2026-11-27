/**
 * client/src/components/studio/stages/PlannerStage.tsx
 * 工序 1：剧本与策划工坊 (Planner Studio SSOT)
 *
 * 核心架构与资产职责分工：
 * 1. 【🗺️ 故事拓扑图】：基于结构化剧本 JSON (screenplay.json) 纯代码绘制的自上而下交互故事流向图谱与 JSON 结构预览；
 * 2. 【📖 故事剧本】：文学创作连贯主干剧本阅读与在线微调编辑，以及按幕呈现的 S1~Sn 结构化分幕卡片视图。
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import type {
  ProjectData,
  TaskRecord,
  UniversalPrdSpec,
  PrdClipNode,
  PrdInteractionNode,
  PrdEndingNode,
} from '../../../types/index.js';
import { PlannerChat } from '../chat/PlannerChat.js';
import { PlannerTopologyDiagram } from './planner/PlannerTopologyDiagram.js';
import { ScreenplayReviewActionButton } from './planner/ScreenplayReviewActionButton.js';
import { useReportFocus } from '../../../hooks/StudioFocusContext.js';
import { saveScreenplay, triggerScreenplayReview } from '../../../lib/api.js';
import { resolveClientStorySource } from '../../../lib/storySource.js';

interface PlannerStageProps {
  projectId: string;
  projectData: ProjectData | null;
  onRunTool: (toolName: string, input: Record<string, any>) => Promise<any>;
  onRefreshProject?: () => void;
  tasks?: TaskRecord[];
  isBusy: boolean;
}

export const PlannerStage: React.FC<PlannerStageProps> = ({
  projectId,
  projectData,
  onRunTool,
  onRefreshProject,
  tasks = [],
  isBusy,
}) => {
  // 顶级双页签：PRD / Story
  const [activeMainTab, setActiveMainTab] = useState<'prd' | 'story'>('prd');

  // PRD 内部双视图模式：topology 故事拓扑图 / markdown 文档全文
  const [prdSubMode, setPrdSubMode] = useState<'topology' | 'markdown'>('topology');

  // 拓扑图当前选中节点 ID
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Story 内部核心双分支：original 故事原文 (Tool 1) / sliced 故事分幕切片 (Tool 2)
  const [storyTabType, setStoryTabType] = useState<'original' | 'sliced'>('original');

  // 故事原文内部模式：reading 阅读 / editing 编辑
  const [originalMode, setOriginalMode] = useState<'reading' | 'editing'>('reading');

  // 故事分幕切片内部模式：cards 卡片流 / markdown 全文
  const [slicedMode, setSlicedMode] = useState<'cards' | 'markdown'>('cards');

  const [screenplayMarkdown, setScreenplayMarkdown] = useState('');
  const [storyMarkdown, setStoryMarkdown] = useState('');
  const [copiedSliced, setCopiedSliced] = useState(false);

  // 剧本质量审查与手动修复状态
  const [isSavingScript, setIsSavingScript] = useState(false);
  const [editingActNumber, setEditingActNumber] = useState<number | null>(null);
  const [editingSceneHeader, setEditingSceneHeader] = useState('');
  const [editingNarrativeBody, setEditingNarrativeBody] = useState('');
  const [editingEndings, setEditingEndings] = useState<
    Array<{ actNumber: number; outcomeKey: string; title: string; endingType: string; narrativeText: string }>
  >([]);
  const [isTriggeringReview, setIsTriggeringReview] = useState(false);
  const [isFixingIssues, setIsFixingIssues] = useState(false);
  const [reviewActionError, setReviewActionError] = useState<string | null>(null);
  const pendingFixTaskIdRef = useRef<string | null>(null);
  const screenplayReview = projectData?.screenplayReview;

  // 感知当前是否有正在执行的剧本生成或局部修改任务
  const activeScreenplayTask = useMemo(() => {
    return tasks.find(
      (t) =>
        (t.toolName === 'planner.screenplay_writer' || t.toolName.includes('screenplay')) &&
        (t.status === 'running' || t.status === 'pending')
    );
  }, [tasks]);
  const isScreenplayRunning = Boolean(activeScreenplayTask) || isFixingIssues;

  // 若后台正在执行剧本审查，温和轮询刷新直至结束
  useEffect(() => {
    if (screenplayReview?.status !== 'reviewing' || !onRefreshProject) return;
    const timer = setInterval(() => {
      onRefreshProject();
    }, 2500);
    return () => clearInterval(timer);
  }, [screenplayReview?.status, onRefreshProject]);

  // 监听一键修复任务完成：刷新最新剧本（不自动触发重审，由创作者按需手动重审）
  useEffect(() => {
    if (!pendingFixTaskIdRef.current) return;
    const targetTask = tasks.find((t) => t.taskId === pendingFixTaskIdRef.current);
    if (!targetTask) return;

    if (targetTask.status === 'completed') {
      pendingFixTaskIdRef.current = null;
      setIsFixingIssues(false);
      onRefreshProject?.();
    } else if (targetTask.status === 'failed') {
      pendingFixTaskIdRef.current = null;
      setIsFixingIssues(false);
      setReviewActionError(`修复任务执行失败: ${targetTask.error || targetTask.lastFailure?.error || '大模型未能返回有效的修改内容'}`);
    }
  }, [tasks, onRefreshProject]);

  // 1. 水合剧本资产 (以全局权威黑板 projectData 为唯一优先 SSOT，仅在尚未返回时用最新任务产物兜底)
  useEffect(() => {
    const latestScreenplayTask = tasks.find(
      (t) =>
        (t.toolName === 'planner.screenplay_writer' || t.toolName.includes('screenplay')) &&
        t.status === 'completed' &&
        (t.output?.scriptMarkdown || t.output?.screenplay)
    );
    const taskScript = latestScreenplayTask?.output?.scriptMarkdown || latestScreenplayTask?.output?.screenplay;
    const remoteScript =
      projectData?.screenplay ||
      projectData?.artifacts?.screenplay ||
      taskScript ||
      '';

    if (remoteScript && typeof remoteScript === 'string') {
      setScreenplayMarkdown(remoteScript);
    } else if (!projectData && !taskScript) {
      setScreenplayMarkdown('');
    }

    const remoteStory =
      projectData?.story ||
      projectData?.artifacts?.story ||
      '';

    if (remoteStory && typeof remoteStory === 'string') {
      setStoryMarkdown(remoteStory);
    } else if (!projectData) {
      setStoryMarkdown('');
    }
  }, [
    projectId,
    tasks,
    projectData?.screenplay,
    projectData?.story,
    projectData?.artifacts?.screenplay,
    projectData?.artifacts?.story,
  ]);

  const latestScreenplayDoc = tasks.find(
    (t) =>
      (t.toolName === 'planner.screenplay_writer' || t.toolName.includes('screenplay')) &&
      t.status === 'completed' &&
      t.output?.screenplayDocument
  )?.output?.screenplayDocument;

  const screenplayJson =
    projectData?.screenplayJson ||
    projectData?.artifacts?.screenplay_json ||
    latestScreenplayDoc;

  const prd: UniversalPrdSpec | undefined =
    projectData?.prd || projectData?.artifacts?.prd;
  const prdMarkdown: string =
    projectData?.prdMarkdown ||
    projectData?.artifacts?.prdMarkdown ||
    '';

  const storySource: UniversalPrdSpec | undefined = useMemo(
    () => resolveClientStorySource(projectData, screenplayJson),
    [projectData, screenplayJson]
  );

  const clips: PrdClipNode[] = storySource?.clips || (storySource as any)?.scenes || [];
  const interactions: PrdInteractionNode[] = storySource?.interactions || [];
  const endings: PrdEndingNode[] = storySource?.endings || [];

  // 智能切页自适应：若尚未有结构化分幕拓扑，先切到故事原文
  useEffect(() => {
    const hasOriginal = Boolean(screenplayMarkdown);
    const hasTopology = Boolean(storySource && clips.length > 0);
    if (hasOriginal && !hasTopology) {
      setActiveMainTab('story');
      setStoryTabType('original');
      setOriginalMode('reading');
    }
  }, [Boolean(screenplayMarkdown), Boolean(storySource && clips.length > 0)]);

  // 上报策划工坊当前页签与 PRD 拓扑选中节点焦点
  const plannerFocus = useMemo(() => {
    if (activeMainTab === 'story') {
      return {
        location:
          storyTabType === 'original'
            ? `策划工坊 · 故事原文 (${originalMode === 'editing' ? '编辑中' : '阅读'})`
            : '策划工坊 · 故事分幕切片',
      };
    }
    const location = prdSubMode === 'topology' ? '策划工坊 · PRD 故事拓扑图' : '策划工坊 · PRD 策划案文档';
    if (prdSubMode === 'topology' && selectedNodeId) {
      const nodeLabel =
        clips.find((c) => c.id === selectedNodeId)?.title ||
        interactions.find((i) => i.id === selectedNodeId)?.prompt ||
        endings.find((e) => e.id === selectedNodeId)?.title ||
        selectedNodeId;
      return {
        location,
        target: {
          kind: 'prd_node',
          id: selectedNodeId,
          label: `${selectedNodeId} · ${nodeLabel}`,
        },
      };
    }
    return { location };
  }, [activeMainTab, storyTabType, originalMode, prdSubMode, selectedNodeId, clips, interactions, endings]);
  useReportFocus(plannerFocus);

  // 保存手动编辑的剧本（不自动触发大模型重审，由系统自动比对指纹标脏）
  const handleSaveEditedScreenplay = async () => {
    if (!screenplayMarkdown.trim()) return;
    setIsSavingScript(true);
    setReviewActionError(null);
    try {
      await saveScreenplay(projectId, screenplayMarkdown);
      setOriginalMode('reading');
      onRefreshProject?.();
    } catch (err: any) {
      setReviewActionError(err?.message || '保存剧本失败');
    } finally {
      setIsSavingScript(false);
    }
  };

  // 开始结构化编辑某一幕卡片
  const handleStartEditActCard = (actNumber: number) => {
    const actObj = (screenplayJson?.acts || []).find((a: any) => a.actNumber === actNumber);
    const clipObj = clips.find((c) => c.id === `c${actNumber}`);
    const fallbackBody = (clipObj?.narrativeText || '').replace(/^【场景[：:][^\n】]+】\s*/, '').trim();
    const actEndings = (screenplayJson?.endings || [])
      .filter((e: any) => e.actNumber === actNumber)
      .map((e: any) => ({
        actNumber: e.actNumber,
        outcomeKey: e.outcomeKey,
        title: e.title || '专有终局',
        endingType: e.endingType || 'BE',
        narrativeText: e.summary || e.narrativeText || '',
      }));

    setEditingActNumber(actNumber);
    setEditingSceneHeader(actObj?.sceneHeader || (clipObj as any)?.location || '');
    setEditingNarrativeBody(actObj?.narrativeBody || fallbackBody);
    setEditingEndings(actEndings);
  };

  // 保存结构化单幕修改（直接传结构化字段给服务端更新 screenplay.json）
  const handleSaveActCard = async () => {
    if (!editingActNumber) return;
    setIsSavingScript(true);
    setReviewActionError(null);
    try {
      await saveScreenplay(projectId, {
        actUpdate: {
          actNumber: editingActNumber,
          sceneHeader: editingSceneHeader,
          narrativeBody: editingNarrativeBody,
        },
        endingUpdates: editingEndings.map((e) => ({
          actNumber: e.actNumber,
          outcomeKey: e.outcomeKey,
          narrativeText: e.narrativeText,
        })),
      });
      setEditingActNumber(null);
      onRefreshProject?.();
    } catch (err: any) {
      setReviewActionError(err?.message || '保存分幕修改失败');
    } finally {
      setIsSavingScript(false);
    }
  };

  // 手动触发剧本重审
  const handleTriggerReview = async () => {
    if (!screenplayMarkdown.trim()) return;
    setIsTriggeringReview(true);
    setReviewActionError(null);
    try {
      await triggerScreenplayReview(projectId, screenplayMarkdown);
      onRefreshProject?.();
    } catch (err: any) {
      setReviewActionError(err?.message || '触发审查失败');
    } finally {
      setIsTriggeringReview(false);
    }
  };

  // 一键修复全部审查问题（调用局部 Patch 手术工具，完成后自动触发重审闭环）
  const handleFixAllIssues = async () => {
    const issues = screenplayReview?.report?.issues || [];
    if (issues.length === 0) return;
    setReviewActionError(null);
    setIsFixingIssues(true);

    try {
      const mergedInstruction = issues
        .map((issue, idx) => {
          const loc = issue.actNumber ? `【第 ${issue.actNumber} 幕】` : '';
          return `${idx + 1}. ${loc}[${issue.category}] ${issue.fixInstruction}`;
        })
        .join('\n');

      const task = await onRunTool('planner.screenplay_writer', {
        instruction: `请严格根据以下剧本质量审查问题逐一执行精准局部修复，未涉及的情节与台词保持不变：\n${mergedInstruction}`,
      });

      if (task?.taskId) {
        pendingFixTaskIdRef.current = task.taskId;
      }
    } catch (err: any) {
      setIsFixingIssues(false);
      setReviewActionError(err?.message || '发起修复任务失败');
    }
  };

  const handleCopySliced = async () => {
    const content = storyMarkdown || (clips.length > 0 ? clips.map(c => `## ${c.id}｜${c.title}\n\n${c.narrativeText || ''}`).join('\n\n') : '');
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopiedSliced(true);
      setTimeout(() => setCopiedSliced(false), 2000);
    } catch (err) {
      console.error('复制故事分幕切片失败:', err);
    }
  };

  return (
    <div className="h-full flex flex-col lg:flex-row gap-6 p-6 overflow-hidden">
      {/* 左侧：故事总监专属 Copilot 座舱 */}
      <div className="w-full lg:w-5/12 flex flex-col h-full flex-shrink-0">
        <PlannerChat
          projectId={projectId}
          tasks={tasks}
          onRefreshProject={onRefreshProject}
        />
      </div>

      {/* 右侧：PRD / Story 双顶级页签工坊 */}
      <div className="flex-1 w-full lg:w-7/12 flex flex-col h-full overflow-hidden">
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-sm flex flex-col h-full overflow-hidden">
          {/* 顶栏：顶级切页器与右侧操作 (强制 flex-nowrap 单行不折行) */}
          <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-slate-100 flex-nowrap flex-shrink-0 min-w-0 overflow-x-auto no-scrollbar">
            {/* 核心顶级双页签：故事剧本 (左) 与 PRD 策划案 (右) */}
            <div className="flex items-center p-0.5 bg-slate-100/80 rounded-xl border border-slate-200/70 space-x-0.5 shadow-2xs flex-shrink-0">
              <button
                type="button"
                onClick={() => setActiveMainTab('story')}
                className={`flex items-center space-x-1 px-3 py-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                  activeMainTab === 'story'
                    ? 'bg-white text-indigo-600 shadow-xs border border-slate-200/60'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>📜</span>
                <span>故事剧本</span>
                {screenplayMarkdown && (
                  <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200/70 text-slate-600 font-medium">
                    {screenplayMarkdown.length}字
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveMainTab('prd')}
                className={`flex items-center space-x-1 px-3 py-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                  activeMainTab === 'prd'
                    ? 'bg-white text-indigo-600 shadow-xs border border-slate-200/60'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>🗺️</span>
                <span>故事拓扑图</span>
                {clips.length > 0 && (
                  <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-50 text-indigo-600 font-semibold">
                    {clips.length}幕
                  </span>
                )}
              </button>
            </div>

            {/* 顶栏右侧：根据激活页签呈现对应工具与指示 (严格单行对齐) */}
            <div className="flex items-center space-x-1.5 flex-nowrap flex-shrink-0">
              {activeMainTab === 'prd' ? (
                <>
                  {/* 拓扑与结构化 JSON 双视图切换 */}
                  {storySource && (
                    <div className="flex items-center bg-slate-50 border border-slate-200/80 rounded-lg p-0.5 space-x-0.5 text-[11px] font-medium mr-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setPrdSubMode('topology')}
                        className={`px-2.5 py-1 rounded-md transition ${
                          prdSubMode === 'topology'
                            ? 'bg-white text-indigo-700 shadow-2xs font-semibold'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        🗺️ 故事拓扑图
                      </button>
                      <button
                        type="button"
                        onClick={() => setPrdSubMode('markdown')}
                        className={`px-2.5 py-1 rounded-md transition ${
                          prdSubMode === 'markdown'
                            ? 'bg-white text-indigo-700 shadow-2xs font-semibold'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        📄 结构化 JSON
                      </button>
                    </div>
                  )}

                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-mono font-medium whitespace-nowrap flex-shrink-0 ${
                      storySource
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80'
                        : 'bg-slate-100 text-slate-500 border border-slate-200'
                    }`}
                  >
                    {storySource
                      ? `${clips.length} 幕 · ${interactions.length} 互动 · ${endings.length} 结局`
                      : '待生成'}
                  </span>
                </>
              ) : (
                <>
                  {/* Story 顶栏二级分段导航：故事原文 vs 分幕切片 */}
                  <div className="flex items-center bg-slate-100/90 border border-slate-200 rounded-lg p-0.5 space-x-0.5 text-xs font-semibold flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => setStoryTabType('original')}
                      className={`flex items-center space-x-1 px-3 py-1 rounded-md transition whitespace-nowrap ${
                        storyTabType === 'original'
                          ? 'bg-white text-indigo-700 shadow-2xs'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <span>📖</span>
                      <span>故事原文</span>
                      {screenplayMarkdown && (
                        <span className="text-[10px] text-indigo-600 font-mono font-normal">
                          {screenplayMarkdown.length}字
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setStoryTabType('sliced')}
                      className={`flex items-center space-x-1 px-3 py-1 rounded-md transition whitespace-nowrap ${
                        storyTabType === 'sliced'
                          ? 'bg-white text-indigo-700 shadow-2xs'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <span>🎬</span>
                      <span>分幕切片</span>
                      {clips.length > 0 && (
                        <span className="text-[10px] text-emerald-600 font-mono font-bold">
                          {clips.length}幕
                        </span>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 切页主视窗 */}
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {/* ══════════════ TAB 1: 故事拓扑与策划视图 ══════════════ */}
            {activeMainTab === 'prd' && (
              <div className="flex-1 overflow-hidden flex flex-col h-full min-h-0">
                {!storySource && !prdMarkdown ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-xs py-20">
                    <div className="w-14 h-14 rounded-2xl bg-indigo-50/70 border border-indigo-100 flex items-center justify-center text-2xl mb-3 shadow-2xs">
                      📊
                    </div>
                    <span className="font-semibold text-slate-700 text-sm">尚未生成结构化剧本拓扑</span>
                    <span className="text-[11px] text-slate-400 mt-1 max-w-sm text-center leading-relaxed">
                      请在左侧与故事总监对话推演互动全景剧本，完成后将自动生成分幕故事与因果拓扑图
                    </span>
                  </div>
                ) : prdSubMode === 'topology' ? (
                  /* 模式 1：原生 SVG 故事流向拓扑图 (全景沉浸有向图谱) */
                  <div className="flex-1 overflow-hidden flex flex-col h-full min-h-0 relative">
                    {storySource ? (
                      <PlannerTopologyDiagram
                        prd={storySource}
                        storySections={projectData?.storySections}
                        selectedNodeId={selectedNodeId}
                        onSelectNode={(nodeId) => setSelectedNodeId(nodeId)}
                        onClearSelection={() => setSelectedNodeId(null)}
                      />
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">
                        暂无拓扑图数据，请先生成剧本
                      </div>
                    )}
                    {/* 节点点击详情浮层卡片 (现代优雅亮色系) */}
                    {selectedNodeId && storySource && (
                      <div className="absolute bottom-3 left-4 right-4 bg-white/95 border border-slate-200/90 rounded-xl p-3.5 text-xs text-slate-800 shadow-xl backdrop-blur-md flex items-center justify-between z-20">
                        <div className="flex items-center space-x-3 overflow-hidden">
                          <span className="font-mono px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold border border-indigo-200/80 shrink-0">
                            {selectedNodeId}
                          </span>
                          <span className="font-bold text-slate-900 truncate">
                            {clips.find(c => c.id === selectedNodeId)?.title ||
                             interactions.find(i => i.id === selectedNodeId)?.prompt ||
                             endings.find(e => e.id === selectedNodeId)?.title ||
                             '选中节点'}
                          </span>
                          <span className="text-slate-600 text-[11px] truncate hidden md:inline">
                            {clips.find(c => c.id === selectedNodeId)?.narrativeText ||
                             endings.find(e => e.id === selectedNodeId)?.summary ||
                             interactions.find(i => i.id === selectedNodeId)?.outcomes?.map(o => `[${o.key}] ${o.label}`).join(' ｜ ') ||
                             ''}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedNodeId(null)}
                          className="text-slate-400 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-100 transition text-xs font-mono ml-3 shrink-0"
                          title="关闭详情卡片"
                        >
                          ✕ 关闭
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  /* 模式 2：结构化剧本 JSON 呈现 */
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                    <div className="p-4 bg-slate-50/90 rounded-2xl border border-slate-200 text-xs font-mono text-slate-800 leading-relaxed shadow-2xs">
                      <pre className="whitespace-pre-wrap font-mono text-xs text-slate-800 leading-relaxed">
                        {screenplayJson
                          ? JSON.stringify(screenplayJson, null, 2)
                          : prdMarkdown || (prd ? JSON.stringify(prd, null, 2) : '暂无结构化剧本数据')}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ══════════════ TAB 2: Story (故事剧本) ══════════════ */}
            {activeMainTab === 'story' && (
              <div className="flex-1 flex flex-col h-full min-h-0 space-y-2">
                {/* 视图 1：故事原文 (Tool 1 产物) */}
                {storyTabType === 'original' && (
                  <div className="flex-1 flex flex-col h-full min-h-0 space-y-2">
                    {/* 故事原文专属头部操作栏 (审查一键修复与编辑操作归位于此，仅本页显示) */}
                    <div className="flex items-center justify-between flex-shrink-0 pb-1.5 border-b border-slate-100">
                      <span className="font-medium text-slate-600 flex items-center gap-1.5 text-xs">
                        <span>📖</span>
                        <span>
                          {originalMode === 'reading'
                            ? '故事原文 · 未切分的文学全景剧本与故事长文'
                            : '故事剧本 · 在线微调编辑'}
                        </span>
                        {screenplayMarkdown && (
                          <span className="font-mono text-[10px] text-indigo-600 bg-indigo-50 px-1.5 py-0.2 rounded font-semibold">
                            {screenplayMarkdown.length} 字
                          </span>
                        )}
                      </span>

                      {/* 右侧专属操作区：审核修复按钮 + 阅读/编辑切换 + 保存按钮 */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {screenplayMarkdown && (
                          <ScreenplayReviewActionButton
                            review={screenplayReview}
                            isReviewing={screenplayReview?.status === 'reviewing' || isTriggeringReview}
                            isFixing={isScreenplayRunning}
                            fixError={reviewActionError}
                            onFixAll={handleFixAllIssues}
                            onTriggerReview={handleTriggerReview}
                          />
                        )}

                        <div className="flex items-center bg-slate-100 border border-slate-200/80 rounded-lg p-0.5 space-x-0.5 text-[11px] font-medium">
                          <button
                            type="button"
                            onClick={() => setOriginalMode('reading')}
                            className={`px-2.5 py-0.5 rounded-md transition whitespace-nowrap ${
                              originalMode === 'reading'
                                ? 'bg-white text-indigo-700 shadow-2xs font-semibold'
                                : 'text-slate-500 hover:text-slate-800'
                            }`}
                          >
                            阅读
                          </button>
                          <button
                            type="button"
                            onClick={() => setOriginalMode('editing')}
                            className={`px-2.5 py-0.5 rounded-md transition whitespace-nowrap ${
                              originalMode === 'editing'
                                ? 'bg-white text-indigo-700 shadow-2xs font-semibold'
                                : 'text-slate-500 hover:text-slate-800'
                            }`}
                          >
                            编辑
                          </button>
                        </div>

                        {originalMode === 'editing' && (
                          <button
                            type="button"
                            onClick={handleSaveEditedScreenplay}
                            disabled={isSavingScript || isBusy}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-2xs transition active:scale-95 disabled:opacity-40 whitespace-nowrap"
                          >
                            {isSavingScript ? '保存中...' : '💾 保存'}
                          </button>
                        )}
                      </div>
                    </div>

                    {originalMode === 'reading' ? (
                      /* 故事原文高保真文章阅读器 */
                      <div className="flex-1 overflow-y-auto p-5 bg-slate-50/90 rounded-2xl border border-slate-200 text-xs font-mono text-slate-800 leading-relaxed shadow-2xs">
                        <pre className="whitespace-pre-wrap font-sans text-xs text-slate-800 leading-relaxed">
                          {screenplayMarkdown ||
                            '当前项目暂无故事剧本原文。请在左侧与故事总监对话构思剧情，或切换到「编辑」模式直接粘贴正文。'}
                        </pre>
                      </div>
                    ) : (
                      /* 剧本在线微调编辑输入框 */
                      <textarea
                        value={screenplayMarkdown}
                        onChange={(e) => setScreenplayMarkdown(e.target.value)}
                        placeholder="尚未生成分幕故事剧本。在左侧与「故事总监」对话构思剧情，或直接在此粘贴/编写 Markdown 剧本文本..."
                        className="flex-1 w-full bg-slate-50/70 border border-slate-200 rounded-xl p-4 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100 transition resize-none font-mono leading-relaxed shadow-2xs overflow-y-auto"
                      />
                    )}
                  </div>
                )}

                {/* 视图 2：故事分幕切片 (Tool 2 产物) */}
                {storyTabType === 'sliced' && (
                  <div className="flex-1 flex flex-col h-full min-h-0 space-y-2">
                    {/* 故事分幕切片专属头部操作栏 */}
                    <div className="flex items-center justify-between flex-shrink-0 pb-1.5 border-b border-slate-100">
                      <span className="font-medium text-slate-600 flex items-center gap-1.5 text-xs">
                        <span>🎬</span>
                        <span>故事分幕切片 · S1~Sn 切片正文与分支走向</span>
                        {clips.length > 0 && (
                          <span className="font-mono text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.2 rounded font-bold">
                            {clips.length} 幕
                          </span>
                        )}
                      </span>

                      {/* 故事切片专属操作：卡片/Markdown 切换 + 复制切片 */}
                      {(clips.length > 0 || storyMarkdown) && (
                        <div className="flex items-center space-x-1.5 flex-shrink-0">
                          <div className="flex items-center bg-slate-100 border border-slate-200/80 rounded-lg p-0.5 space-x-0.5 text-[11px] font-medium">
                            <button
                              type="button"
                              onClick={() => setSlicedMode('cards')}
                              className={`px-2.5 py-0.5 rounded-md transition whitespace-nowrap ${
                                slicedMode === 'cards'
                                  ? 'bg-white text-indigo-700 shadow-2xs font-semibold'
                                  : 'text-slate-500 hover:text-slate-800'
                              }`}
                            >
                              分幕卡片
                            </button>
                            <button
                              type="button"
                              onClick={() => setSlicedMode('markdown')}
                              className={`px-2.5 py-0.5 rounded-md transition whitespace-nowrap ${
                                slicedMode === 'markdown'
                                  ? 'bg-white text-indigo-700 shadow-2xs font-semibold'
                                  : 'text-slate-500 hover:text-slate-800'
                              }`}
                            >
                              Markdown 全文
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={handleCopySliced}
                            className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-medium rounded-lg border border-slate-200 shadow-2xs transition active:scale-95 whitespace-nowrap"
                            title="复制故事分幕切片"
                          >
                            {copiedSliced ? '✅ 已复制' : '📋 复制切片'}
                          </button>
                        </div>
                      )}
                    </div>

                    {clips.length === 0 && !storyMarkdown ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-xs py-20">
                        <div className="w-14 h-14 rounded-2xl bg-indigo-50/70 border border-indigo-100 flex items-center justify-center text-2xl mb-3 shadow-2xs">
                          🎬
                        </div>
                        <span className="font-semibold text-slate-700 text-sm">尚未切分故事分幕</span>
                        <span className="text-[11px] text-slate-400 mt-1 max-w-sm text-center leading-relaxed">
                          请先在左侧与故事总监对话生成互动全景剧本，系统将自动输出 S1~Sn 结构化分幕卡片！
                        </span>
                      </div>
                    ) : slicedMode === 'cards' ? (
                      /* 卡片流视图：支持结构化按幕编辑正文与终局文案，分支选项锁死只读 */
                      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                        {clips.map((c, idx) => {
                          const actNum = Number(String(c.id || '').replace(/^c/i, '')) || idx + 1;
                          const isEditingThis = editingActNumber === actNum;
                          const actEndings = (screenplayJson?.endings || []).filter(
                            (e: any) => e.actNumber === actNum
                          );
                          const clipInteraction = (c as any).interaction;
                          return (
                            <div
                              key={c.id || idx}
                              className="p-4 bg-slate-50/90 rounded-2xl border border-slate-200 text-xs space-y-2.5 transition hover:border-indigo-200 hover:bg-slate-50 shadow-2xs"
                            >
                              <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                                <div className="flex items-center space-x-2">
                                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-lg bg-indigo-100 text-indigo-700">
                                    {c.id}
                                  </span>
                                  <span className="font-bold text-slate-900 text-xs">
                                    《{c.title}》
                                  </span>
                                </div>
                                <div className="flex items-center space-x-1.5">
                                  <span className="text-[10px] font-mono text-slate-400 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                                    对应视频: {c.video || `${c.id}.mp4`}
                                  </span>
                                  {screenplayJson && !isEditingThis && (
                                    <button
                                      type="button"
                                      onClick={() => handleStartEditActCard(actNum)}
                                      disabled={isBusy || isSavingScript}
                                      className="px-2 py-0.5 bg-white hover:bg-indigo-50 text-indigo-600 text-[11px] font-semibold rounded-md border border-indigo-200 transition disabled:opacity-40"
                                    >
                                      ✏️ 编辑
                                    </button>
                                  )}
                                  {isEditingThis && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => setEditingActNumber(null)}
                                        disabled={isSavingScript}
                                        className="px-2 py-0.5 bg-white hover:bg-slate-100 text-slate-600 text-[11px] font-medium rounded-md border border-slate-200"
                                      >
                                        取消
                                      </button>
                                      <button
                                        type="button"
                                        onClick={handleSaveActCard}
                                        disabled={isSavingScript}
                                        className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold rounded-md shadow-2xs disabled:opacity-40"
                                      >
                                        {isSavingScript ? '保存中...' : '💾 保存'}
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>

                              {isEditingThis ? (
                                <div className="space-y-2.5">
                                  <div>
                                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                                      母场景与光影定调
                                    </label>
                                    <input
                                      type="text"
                                      value={editingSceneHeader}
                                      onChange={(e) => setEditingSceneHeader(e.target.value)}
                                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                                      本幕戏剧正文
                                    </label>
                                    <textarea
                                      rows={6}
                                      value={editingNarrativeBody}
                                      onChange={(e) => setEditingNarrativeBody(e.target.value)}
                                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500 leading-relaxed resize-y"
                                    />
                                  </div>
                                  {editingEndings.length > 0 && (
                                    <div className="space-y-2 pt-1 border-t border-slate-200/70">
                                      <div className="text-[11px] font-semibold text-slate-500">
                                        本幕关联终局文案
                                      </div>
                                      {editingEndings.map((ed, eIdx) => (
                                        <div key={`${ed.actNumber}_${ed.outcomeKey}`} className="bg-white p-2.5 rounded-xl border border-slate-200 space-y-1">
                                          <div className="text-[11px] font-semibold text-rose-700">
                                            【终局：{ed.title}（{ed.endingType}）| 触发：{ed.outcomeKey}】
                                          </div>
                                          <textarea
                                            rows={3}
                                            value={ed.narrativeText}
                                            onChange={(e) => {
                                              const next = [...editingEndings];
                                              next[eIdx] = { ...next[eIdx], narrativeText: e.target.value };
                                              setEditingEndings(next);
                                            }}
                                            className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-indigo-500 leading-relaxed"
                                          />
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <>
                                  {/* 分幕正文 */}
                                  <div className="text-slate-800 text-xs leading-relaxed font-sans bg-white p-3 rounded-xl border border-slate-200/70 whitespace-pre-wrap">
                                    {c.narrativeText || '（暂无分幕剧情文本）'}
                                  </div>

                                  {/* 互动节点只读锁定提示 */}
                                  {clipInteraction && (
                                    <div className="text-[11px] text-indigo-700 bg-indigo-50/60 px-3 py-1.5 rounded-lg border border-indigo-100 flex flex-wrap items-center gap-2">
                                      <span className="font-semibold">
                                        {clipInteraction.isBranching ? '🔀 命运分支' : '🎯 单线互动'} ({clipInteraction.kind}
                                        {clipInteraction.timeoutSec ? ` · ${clipInteraction.timeoutSec}s` : ''})：
                                      </span>
                                      <span>
                                        {(clipInteraction.outcomes || [])
                                          .map((o: any) => `[${o.key}] ${o.label}`)
                                          .join(' ｜ ')}
                                      </span>
                                    </div>
                                  )}

                                  {/* 终局结算展示 */}
                                  {actEndings.length > 0 && (
                                    <div className="space-y-1.5">
                                      {actEndings.map((ed: any) => (
                                        <div
                                          key={ed.id || `${ed.actNumber}_${ed.outcomeKey}`}
                                          className="text-[11px] bg-rose-50/60 border border-rose-200/70 rounded-xl px-3 py-2 text-slate-700"
                                        >
                                          <span className="font-bold text-rose-700 mr-1.5">
                                            【终局：{ed.title}（{ed.endingType}）】
                                          </span>
                                          <span>{ed.summary}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      /* Markdown 全文视图：原汁原味展示 story.md */
                      <div className="flex-1 overflow-y-auto p-5 bg-slate-50/90 rounded-2xl border border-slate-200 text-xs font-mono text-slate-800 leading-relaxed shadow-2xs">
                        <pre className="whitespace-pre-wrap font-sans text-xs text-slate-800 leading-relaxed">
                          {storyMarkdown ||
                            clips
                              .map(
                                (c) =>
                                  `## ${c.id}｜${c.title}\n\n${c.narrativeText || '（无剧本正文）'}`
                              )
                              .join('\n\n')}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
