/**
 * client/src/components/studio/MastraStudioDrawer.tsx
 * Mastra Studio 微内核全景拓扑与开发者座舱抽屉组件 (SSOT)
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Workflow,
  Bot,
  Layers,
  Activity,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  GitBranch,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import {
  mastraStudioApi,
  MASTRA_SERVER_URL,
  type WorkflowSummary,
  type AgentSummary,
} from '../../lib/mastra';

interface MastraStudioDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  currentStage?: string;
  projectId?: string;
}

export function MastraStudioDrawer({
  isOpen,
  onClose,
  currentStage,
  projectId,
}: MastraStudioDrawerProps) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [expandedWf, setExpandedWf] = useState<Record<string, boolean>>({});

  const refreshData = async () => {
    setLoading(true);
    try {
      const [health, wfs, ags] = await Promise.all([
        mastraStudioApi.checkHealth(),
        mastraStudioApi.getWorkflows(),
        mastraStudioApi.getAgents(),
      ]);
      setIsOnline(health.online);
      setWorkflows(wfs);
      setAgents(ags);
    } catch {
      setIsOnline(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      refreshData();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const pipelineWf = workflows.find((w) => w.type === 'pipeline');
  const subWorkflows = workflows.filter((w) => w.type === 'subworkflow');

  const toggleExpand = (id: string) => {
    setExpandedWf((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-xs flex justify-end animate-fadeIn">
      <div className="w-full max-w-xl bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl">
        {/* 抽屉顶栏 */}
        <div className="h-14 px-6 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
              <Workflow className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-100 text-sm">Mastra Studio 智能座舱</span>
                <span
                  className={`w-2 h-2 rounded-full ${
                    isOnline ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50 animate-pulse' : 'bg-rose-500'
                  }`}
                />
              </div>
              <p className="text-[11px] text-slate-400 font-mono">微内核端口: {MASTRA_SERVER_URL}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={refreshData}
              disabled={loading}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title="刷新工作流拓扑"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <a
              href={`${MASTRA_SERVER_URL}/swagger`}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-300 hover:bg-slate-800 transition-colors"
              title="查看 OpenAPI / Swagger"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 抽屉主体内容 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* 1. 微内核运行状态卡片 */}
          <div className="rounded-xl p-4 bg-slate-950/40 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-indigo-400" />
              <div>
                <span className="text-xs font-semibold text-slate-200">
                  {isOnline ? 'Mastra 官方微内核已连接' : 'Mastra 服务离线'}
                </span>
                <p className="text-[11px] text-slate-500">
                  当前绑定项目: <span className="font-mono text-slate-300">{projectId || '未选择'}</span>
                </p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-indigo-950/80 text-indigo-300 border border-indigo-800/80">
              Vercel AI SDK + Mastra Core
            </span>
          </div>

          {/* 2. 总导演智能体 (Agents) */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Bot className="w-4 h-4 text-indigo-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                已挂载多智能体 (Agents)
              </h3>
            </div>
            <div className="space-y-2">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="rounded-xl p-3 bg-slate-800/50 border border-slate-700/60 hover:border-slate-600 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-200">{agent.name}</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-indigo-300 border border-slate-700">
                      ID: {agent.id}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">{agent.description}</p>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="text-[10px] text-slate-500">高阶元工具:</span>
                    {agent.tools.map((t) => (
                      <span
                        key={t}
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900/80 text-slate-300 border border-slate-800"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 3. 宏观全流程工作流 (Macro Pipeline) */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Layers className="w-4 h-4 text-indigo-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                影视宏观全流程流水线 (Macro Pipeline)
              </h3>
            </div>
            {pipelineWf && (
              <div className="rounded-xl p-4 bg-slate-800/50 border border-slate-700/60">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-slate-200">{pipelineWf.name}</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                    {pipelineWf.id}
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed mb-3">{pipelineWf.description}</p>

                {/* 阶段工序流转图 */}
                <div className="space-y-1.5 pt-2 border-t border-slate-700/50">
                  <span className="text-[11px] font-semibold text-slate-400">8 大制作工序步骤拓扑:</span>
                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    {pipelineWf.stepIds.map((stepId, idx) => {
                      const isCurrent = currentStage && stepId.toLowerCase().includes(currentStage.toLowerCase().replace('_', '-'));
                      return (
                        <div
                          key={stepId}
                          className={`p-2 rounded-lg text-[11px] font-mono flex items-center gap-2 border ${
                            isCurrent
                              ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200 shadow-xs'
                              : 'bg-slate-900/60 border-slate-800 text-slate-400'
                          }`}
                        >
                          <span className="w-4 h-4 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center text-[9px] shrink-0 font-bold">
                            {idx + 1}
                          </span>
                          <span className="truncate">{stepId}</span>
                          {isCurrent && <Zap className="w-3 h-3 text-indigo-400 ml-auto shrink-0 animate-bounce" />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 4. 微观子工作流群 (Micro Sub-Workflows) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  视听微观子工作流群 (断点恢复与单步回退)
                </h3>
              </div>
              <span className="text-[10px] text-slate-400 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span>秒级断点复用</span>
              </span>
            </div>

            <div className="space-y-2">
              {subWorkflows.map((wf) => {
                const isExpanded = Boolean(expandedWf[wf.id]);
                return (
                  <div
                    key={wf.id}
                    className="rounded-xl border border-slate-700/60 bg-slate-800/40 overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggleExpand(wf.id)}
                      className="w-full p-3 flex items-center justify-between hover:bg-slate-800/70 transition-colors text-left"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-200">{wf.name}</span>
                          <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-slate-900 text-emerald-400 border border-emerald-900/50">
                            {wf.id}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{wf.description}</p>
                      </div>
                      <div className="flex items-center gap-2 text-slate-400 shrink-0">
                        <span className="text-[10px] text-slate-500 font-mono">{wf.stepsCount} 个原子 Step</span>
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="p-3 bg-slate-950/40 border-t border-slate-800 space-y-1.5">
                        <span className="text-[10px] text-slate-500 font-semibold uppercase">原子步骤序列:</span>
                        {wf.stepIds.map((step, sIdx) => (
                          <div
                            key={step}
                            className="flex items-center gap-2 p-1.5 rounded bg-slate-900/80 border border-slate-800/80 text-[11px] font-mono text-slate-300"
                          >
                            <span className="w-3.5 h-3.5 rounded bg-slate-800 text-slate-400 flex items-center justify-center text-[9px] font-bold shrink-0">
                              {sIdx + 1}
                            </span>
                            <span className="truncate">{step}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 抽屉底部 */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">Mastra 微内核状态感知座舱 SSOT</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
