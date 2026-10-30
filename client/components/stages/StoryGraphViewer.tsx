'use client';

import React, { useState } from 'react';
import {
  GitBranch,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  Zap,
  ShieldAlert,
  Trophy,
  ArrowRight,
  TrendingDown,
  RefreshCw,
  LayoutGrid,
  Network,
} from 'lucide-react';
import InteractiveTopologyCanvas from './InteractiveTopologyCanvas';

interface StoryNode {
  id: string;
  type: string;
  title: string;
  summary: string;
  location?: string;
  characters?: string[];
  estimatedDurationSec?: number;
}

interface StoryChoice {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  choiceText: string;
  timeoutSeconds?: number;
  isTimeoutDefault?: boolean;
}

interface GraphValidation {
  isPass: boolean;
  convergenceRate: number;
  totalEstimatedDurationSec: number;
  issues: string[];
  warnings: string[];
}

interface InteractiveStoryGraph {
  startNodeId: string;
  nodes: StoryNode[];
  choices: StoryChoice[];
  validation?: GraphValidation;
}

interface StoryGraphViewerProps {
  graph?: InteractiveStoryGraph;
  onRegenerateGraph?: () => void;
  onValidateGraph?: () => void;
  isRunning?: boolean;
}

export default function StoryGraphViewer({
  graph,
  onRegenerateGraph,
  onValidateGraph,
  isRunning,
}: StoryGraphViewerProps) {
  const [viewMode, setViewMode] = useState<'canvas' | 'cards'>('canvas');

  if (!graph || !graph.nodes || graph.nodes.length === 0) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-dashed border-gray-200">
        <GitBranch className="w-10 h-10 text-gray-300 mx-auto mb-2" />
        <h4 className="text-xs font-bold text-gray-600">尚未生成网状拓扑图</h4>
        <p className="text-[11px] text-gray-400 mt-1 max-w-xs mx-auto">
          点击下方按钮，由叙事架构智能体自动根据故事圣经构建分支图谱。
        </p>
        {onRegenerateGraph && (
          <button
            onClick={onRegenerateGraph}
            disabled={isRunning}
            className="mt-4 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5" />
            一键规划分支拓扑
          </button>
        )}
      </div>
    );
  }

  const validation = graph.validation;
  const nodes = graph.nodes;
  const choices = graph.choices || [];

  const getNodeBadge = (type: string) => {
    switch (type) {
      case 'decision':
        return { label: '决策点', bg: 'bg-indigo-50 text-indigo-700 border-indigo-200', icon: GitBranch };
      case 'qte':
        return { label: '限时 QTE', bg: 'bg-rose-50 text-rose-700 border-rose-200', icon: Zap };
      case 'converge':
        return { label: '菱形收束', bg: 'bg-teal-50 text-teal-700 border-teal-200', icon: TrendingDown };
      case 'bad_end':
        return { label: '死亡结局', bg: 'bg-red-50 text-red-700 border-red-200', icon: ShieldAlert };
      case 'true_end':
        return { label: '胜利结局', bg: 'bg-amber-50 text-amber-700 border-amber-200', icon: Trophy };
      default:
        return { label: '剧情主干', bg: 'bg-slate-50 text-slate-700 border-slate-200', icon: Clock };
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* 顶部质检看板仪表盘 */}
      <div className="p-4 bg-white rounded-2xl border border-gray-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
              validation?.isPass
                ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                : 'bg-amber-50 border-amber-200 text-amber-600'
            }`}
          >
            {validation?.isPass ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : (
              <AlertTriangle className="w-5 h-5" />
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-bold text-gray-800">
                拓扑图静态质检：{validation?.isPass ? '合格' : '发现潜在风险'}
              </h4>
              <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-bold border border-indigo-100">
                共 {nodes.length} 个场景节点
              </span>
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">
              菱形收束率: {((validation?.convergenceRate || 0) * 100).toFixed(0)}% ·
              总预估时长: {Math.round((validation?.totalEstimatedDurationSec || 0) / 60)} 分钟
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 视图双模切换 */}
          <div className="flex items-center rounded-lg bg-gray-100 p-0.5 border border-gray-200 text-xs">
            <button
              onClick={() => setViewMode('canvas')}
              className={`px-2.5 py-1 rounded-md transition-all cursor-pointer flex items-center gap-1 ${
                viewMode === 'canvas'
                  ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              <span>全景拓扑图</span>
            </button>
            <button
              onClick={() => setViewMode('cards')}
              className={`px-2.5 py-1 rounded-md transition-all cursor-pointer flex items-center gap-1 ${
                viewMode === 'cards'
                  ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>卡片清单</span>
            </button>
          </div>

          {onValidateGraph && (
            <button
              onClick={onValidateGraph}
              disabled={isRunning}
              className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-gray-700 transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-gray-400" />
              重新检测
            </button>
          )}

          {onRegenerateGraph && (
            <button
              onClick={onRegenerateGraph}
              disabled={isRunning}
              className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
              重新规划拓扑
            </button>
          )}
        </div>
      </div>

      {/* 质检问题告警条 */}
      {validation?.issues && validation.issues.length > 0 && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold">发现逻辑死锁或孤立节点：</span>
            {validation.issues.map((iss, i) => (
              <p key={i} className="text-[11px] text-rose-700">· {iss}</p>
            ))}
          </div>
        </div>
      )}

      {/* 核心展示区：大拓扑全景图 vs 卡片列表 */}
      {viewMode === 'canvas' ? (
        <div className="w-full h-[560px] rounded-2xl overflow-hidden border border-slate-800 shadow-xl relative">
          <InteractiveTopologyCanvas graph={graph as any} className="w-full h-full" />
        </div>
      ) : (
        /* 节点树网格列表 */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {nodes.map((node, index) => {
            const badge = getNodeBadge(node.type);
            const BadgeIcon = badge.icon;
            const outgoingChoices = choices.filter((c) => c.fromNodeId === node.id);

            return (
              <div
                key={node.id}
                className="p-4 bg-white rounded-2xl border border-gray-200/90 shadow-2xs hover:border-indigo-300 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[11px] font-mono font-bold text-gray-400">
                      #{index + 1} {node.id}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold border flex items-center gap-1 ${badge.bg}`}
                    >
                      <BadgeIcon className="w-3 h-3" />
                      {badge.label}
                    </span>
                  </div>

                  <h4 className="text-xs font-bold text-gray-800 tracking-tight">
                    {node.title}
                  </h4>
                  <p className="text-[11px] text-gray-500 mt-1 line-clamp-3 leading-relaxed">
                    {node.summary}
                  </p>
                </div>

                {/* 分支走向条 */}
                {outgoingChoices.length > 0 && (
                  <div className="mt-3.5 pt-3 border-t border-gray-100 flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      分支抉择 ({outgoingChoices.length})
                    </span>
                    {outgoingChoices.map((c, i) => (
                      <div
                        key={c.id || i}
                        className="px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-100 text-[11px] text-gray-700 flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{c.choiceText}</span>
                        <div className="flex items-center gap-1 shrink-0 text-indigo-600 font-mono text-[10px]">
                          <ArrowRight className="w-3 h-3" />
                          <span>{c.toNodeId}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
