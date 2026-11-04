import React, { useState, useMemo, useEffect } from 'react';
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
  Maximize2,
} from 'lucide-react';
import StoryGraphSvgDiagram from './StoryGraphSvgDiagram';
import StoryGraphModal from './StoryGraphModal';

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
  const [isModalOpen, setIsModalOpen] = useState(false);

  // 调试诊断：控制台打印接收到的 graph 数据
  useEffect(() => {
    console.log('[StoryGraphViewer] graph prop:', graph);
  }, [graph]);

  if (!graph || !graph.nodes || graph.nodes.length === 0) {
    return (
      <div className="p-8 text-center bg-slate-900 rounded-2xl border border-dashed border-slate-700">
        <GitBranch className="w-10 h-10 text-slate-500 mx-auto mb-2" />
        <h4 className="text-xs font-bold text-slate-300">尚未生成网状拓扑图</h4>
        <p className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto">
          由叙事架构智能体自动根据故事圣经构建分支图谱。
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
  const nodes = useMemo(() => {
    return (graph.nodes || []).map((n: any) => ({
      ...n,
      type: n.type || (n.isEnding ? (n.endingType === 'bad' ? 'bad_end' : 'true_end') : (n.choices && n.choices.length > 1 ? 'decision' : 'plot')),
    }));
  }, [graph.nodes]);

  const choices: StoryChoice[] = useMemo(() => {
    if (graph.choices && graph.choices.length > 0) return graph.choices;
    const list: StoryChoice[] = [];
    (graph.nodes || []).forEach((n: any) => {
      if (Array.isArray(n.choices)) {
        n.choices.forEach((c: any, idx: number) => {
          list.push({
            id: c.id || `${n.id}_c_${idx}`,
            fromNodeId: n.id,
            toNodeId: c.targetNodeId || c.toNodeId,
            choiceText: c.text || c.choiceText || '分支路线',
            timeoutSeconds: c.timeoutSeconds,
            isTimeoutDefault: c.isTimeoutDefault,
          });
        });
      }
    });
    return list;
  }, [graph.choices, graph.nodes]);

  const getNodeBadge = (type: string) => {
    switch (type) {
      case 'decision':
        return { label: '决策点', bg: 'bg-indigo-900/60 text-indigo-300 border-indigo-700', icon: GitBranch };
      case 'qte':
        return { label: '限时 QTE', bg: 'bg-rose-900/60 text-rose-300 border-rose-700', icon: Zap };
      case 'converge':
        return { label: '菱形收束', bg: 'bg-teal-900/60 text-teal-300 border-teal-700', icon: TrendingDown };
      case 'bad_end':
        return { label: '死亡结局', bg: 'bg-red-900/60 text-red-300 border-red-700', icon: ShieldAlert };
      case 'true_end':
        return { label: '胜利结局', bg: 'bg-amber-900/60 text-amber-300 border-amber-700', icon: Trophy };
      default:
        return { label: '剧情主干', bg: 'bg-slate-800 text-slate-300 border-slate-700', icon: Clock };
    }
  };

  return (
    <div className="flex flex-col gap-4 w-full max-w-full overflow-hidden">
      {/* 顶部质检看板仪表盘 */}
      <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
              validation?.isPass
                ? 'bg-emerald-950 border-emerald-800 text-emerald-400'
                : 'bg-amber-950 border-amber-800 text-amber-400'
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
              <h4 className="text-xs font-bold text-slate-100">
                拓扑图静态质检：{validation?.isPass ? '合格' : '结构正常'}
              </h4>
              <span className="px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 text-[10px] font-bold border border-indigo-800">
                共 {nodes.length} 个场景节点
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              菱形收束率: {((validation?.convergenceRate || 0) * 100).toFixed(0)}% ·
              总预估时长: {Math.round((validation?.totalEstimatedDurationSec || 0) / 60)} 分钟
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 视图双模切换 */}
          <div className="flex items-center rounded-lg bg-slate-800 p-0.5 border border-slate-700 text-xs">
            <button
              onClick={() => setViewMode('canvas')}
              className={`px-2.5 py-1 rounded-md transition-all cursor-pointer flex items-center gap-1 ${
                viewMode === 'canvas'
                  ? 'bg-indigo-600 text-white shadow-2xs font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              <span>全景拓扑</span>
            </button>
            <button
              onClick={() => setViewMode('cards')}
              className={`px-2.5 py-1 rounded-md transition-all cursor-pointer flex items-center gap-1 ${
                viewMode === 'cards'
                  ? 'bg-indigo-600 text-white shadow-2xs font-bold'
                  : 'text-slate-400 hover:text-slate-200'
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
              className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs font-semibold text-slate-300 transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-slate-400" />
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
        <div className="p-3 bg-rose-950/60 border border-rose-800/80 rounded-xl text-xs text-rose-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold">发现逻辑死锁或孤立节点：</span>
            {validation.issues.map((iss, i) => (
              <p key={i} className="text-[11px] text-rose-300">· {iss}</p>
            ))}
          </div>
        </div>
      )}

      {/* 核心展示区 */}
      {viewMode === 'canvas' ? (
        <div className="w-full max-w-full min-h-[420px] h-[440px] rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 shadow-xl relative group flex flex-col">
          {/* 右上角悬浮的【放大查看】按钮 */}
          <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
            <button
              onClick={() => setIsModalOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400/40 text-xs font-bold shadow-lg transition-all flex items-center gap-1.5 cursor-pointer backdrop-blur-md"
              title="点击全屏高清放大查看"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>放大查看</span>
            </button>
          </div>

          {/* SVG 自适应全景流程图 (点击整图触发大图放大) */}
          <div
            onClick={() => setIsModalOpen(true)}
            className="flex-1 w-full h-full p-3 cursor-zoom-in flex items-center justify-center transition-opacity hover:opacity-95"
            title="点击放大查看全景图"
          >
            <StoryGraphSvgDiagram graph={graph as any} className="w-full h-full" />
          </div>

          {/* 底部悬浮提示 */}
          <div className="py-2.5 px-4 text-center text-[11px] text-slate-400 border-t border-slate-900 bg-slate-950/90 shrink-0 flex items-center justify-between">
            <span>💡 故事拓扑全景预览（共 {nodes.length} 个场景节点 · {choices.length} 条分支走向）</span>
            <span className="text-indigo-400 font-bold flex items-center gap-1">点击任意处可全屏大图查看 ↗</span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {nodes.map((node, index) => {
            const badge = getNodeBadge(node.type);
            const BadgeIcon = badge.icon;
            const outgoingChoices = choices.filter((c) => c.fromNodeId === node.id);

            return (
              <div
                key={node.id}
                className="p-4 bg-slate-900 rounded-2xl border border-slate-800 shadow-2xs hover:border-indigo-500 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[11px] font-mono font-bold text-slate-400">
                      #{index + 1} {node.id}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold border flex items-center gap-1 ${badge.bg}`}
                    >
                      <BadgeIcon className="w-3 h-3" />
                      {badge.label}
                    </span>
                  </div>

                  <h5 className="text-xs font-bold text-slate-200 mb-1">{node.title}</h5>
                  <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                    {node.summary}
                  </p>
                </div>

                <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-500">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>预计 {node.estimatedDurationSec || 60}s</span>
                  </div>
                  <div>
                    {outgoingChoices.length > 0 ? (
                      <span className="text-indigo-400 font-medium flex items-center gap-0.5">
                        {outgoingChoices.length} 条分支
                        <ArrowRight className="w-2.5 h-2.5" />
                      </span>
                    ) : (
                      <span className="text-amber-400 font-bold">最终结局</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 点击放大查看模态弹窗 */}
      <StoryGraphModal
        graph={graph as any}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}
