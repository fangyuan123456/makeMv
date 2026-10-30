'use client';

import React, { useState } from 'react';
import {
  BookOpen,
  GitFork,
  Sparkles,
  ShieldCheck,
  Flame,
  Clock,
  Zap,
  Target,
  Swords,
  HelpCircle,
  Eye,
  Film,
  Layers,
  ChevronRight,
  CheckCircle2,
  Users,
  Heart,
  Palette,
  Copy,
  Check,
} from 'lucide-react';
import StoryGraphViewer from '../../stages/StoryGraphViewer';

interface NarrativeViewerProps {
  artifact?: any;
  onRevise?: (instruction: string) => void;
  isRunning?: boolean;
}

const ACT_BADGES = [
  {
    prefix: '起',
    label: '危机爆发与悬念开启',
    color: 'from-amber-500/20 to-orange-500/10 text-amber-900 border-amber-300/80',
    tagColor: 'bg-amber-100 text-amber-800 border-amber-300',
    iconColor: 'text-amber-600',
  },
  {
    prefix: '承',
    label: '矛盾升级与阵营撕裂',
    color: 'from-blue-500/20 to-indigo-500/10 text-indigo-900 border-indigo-300/80',
    tagColor: 'bg-blue-100 text-blue-800 border-blue-300',
    iconColor: 'text-blue-600',
  },
  {
    prefix: '转',
    label: '戏剧反转与惊天真相',
    color: 'from-purple-500/20 to-fuchsia-500/10 text-purple-900 border-purple-300/80',
    tagColor: 'bg-purple-100 text-purple-800 border-purple-300',
    iconColor: 'text-purple-600',
  },
  {
    prefix: '合',
    label: '决胜巅峰与多线终局',
    color: 'from-emerald-500/20 to-teal-500/10 text-emerald-900 border-emerald-300/80',
    tagColor: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    iconColor: 'text-emerald-600',
  },
];

export default function NarrativeViewer({ artifact, onRevise, isRunning }: NarrativeViewerProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'spine' | 'characters' | 'graph'>('all');
  const [copiedCharId, setCopiedCharId] = useState<string | null>(null);

  const handleCopyPrompt = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCharId(id);
    setTimeout(() => setCopiedCharId(null), 2000);
  };

  if (!artifact) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 text-gray-400">
        <BookOpen className="w-12 h-12 mb-3 text-gray-300 animate-pulse" />
        <p className="text-sm font-medium">正在由【叙事架构师】构建网状互动世界观与故事大纲...</p>
      </div>
    );
  }

  const title = artifact.title || artifact.bible?.title || '未命名互动短剧';
  const theme = artifact.theme || artifact.bible?.theme || '';
  const style = artifact.style || artifact.bible?.style || '';
  const logline = artifact.logline || artifact.bible?.logline || '';
  const sellingPoints = artifact.sellingPoints || artifact.bible?.sellingPoints || [];
  const genreName = artifact.genreName || artifact.bible?.genreName || '互动影游';
  const storyGraph = artifact.storyGraph || artifact.bible?.storyGraph;
  const goldenSpine = artifact.goldenSpine || artifact.bible?.goldenSpine || [];
  const characters = artifact.characters || artifact.bible?.characters || [];

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 space-y-6 bg-slate-50">
      {/* 1. 故事概览总头卡 */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                {genreName}
              </span>
              {theme && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                  {theme}
                </span>
              )}
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                黄金主干已锁定
              </span>
            </div>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight">{title}</h2>
            {style && (
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>视觉调性：{style}</span>
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 self-start">
            <div className="flex rounded-lg bg-slate-100 p-0.5 border border-slate-200 text-xs font-medium">
              <button
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                  activeTab === 'all'
                    ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                全景概览
              </button>
              <button
                onClick={() => setActiveTab('spine')}
                className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                  activeTab === 'spine'
                    ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                四幕剧本原案
              </button>
              <button
                onClick={() => setActiveTab('characters')}
                className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                  activeTab === 'characters'
                    ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                核心角色档案 ({characters.length})
              </button>
              <button
                onClick={() => setActiveTab('graph')}
                className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                  activeTab === 'graph'
                    ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                网状拓扑图
              </button>
            </div>
          </div>
        </div>

        {logline && (
          <div className="p-4 rounded-xl bg-gradient-to-r from-slate-50 to-indigo-50/30 border border-slate-200/70 text-sm text-gray-800 leading-relaxed shadow-2xs">
            <span className="font-bold text-indigo-950 mr-2 flex-inline items-center gap-1">
              <BookOpen className="w-3.5 h-3.5 inline mr-1 text-indigo-600" />
              【核心剧情大纲 (Logline)】:
            </span>
            {logline}
          </div>
        )}

        {/* 核心看点与交互卖点 */}
        {sellingPoints.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-amber-500 fill-amber-500" />
              <span>4 大互动影游核心玩法与视听卖点</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {sellingPoints.map((point: string, idx: number) => {
                const parts = point.split('——');
                const titlePart = parts[0] || point;
                const descPart = parts[1] || '';
                return (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-amber-50/40 hover:bg-amber-50/80 transition-colors border border-amber-200/70 text-xs shadow-2xs"
                  >
                    <div className="font-bold text-amber-950 mb-0.5 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>{titlePart}</span>
                    </div>
                    {descPart && <p className="text-slate-600 text-[11px] leading-relaxed pl-5">{descPart}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 2. 黄金故事主干：四幕电影级戏剧弧线 (The Golden Spine) */}
      {(activeTab === 'all' || activeTab === 'spine') && goldenSpine.length > 0 && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-indigo-600" />
                <span>📖 黄金主干剧本原案 · 四幕起承转合戏剧弧线</span>
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                严密遵循经典电影戏剧节奏，锁死单幕 25~30 秒的高密度剧情爆点与第一视角抉择
              </p>
            </div>
            <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
              全剧总时长：约 120 秒 (2分钟电影感短剧)
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {goldenSpine.map((act: any, idx: number) => {
              const badge = ACT_BADGES[idx] || ACT_BADGES[0];
              return (
                <div
                  key={idx}
                  className={`rounded-xl p-4 border bg-gradient-to-b ${badge.color} space-y-3 shadow-2xs flex flex-col justify-between`}
                >
                  <div className="space-y-2">
                    {/* 幕次与戏剧功能头 */}
                    <div className="flex items-start justify-between gap-2 border-b border-black/5 pb-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-6 h-6 rounded-full flex items-center justify-center font-black text-xs border ${badge.tagColor}`}
                        >
                          {badge.prefix}
                        </span>
                        <div>
                          <h4 className="font-bold text-sm text-slate-900">{act.name}</h4>
                          <span className="text-[10px] text-slate-500 font-medium">
                            {act.dramaticFunction || badge.label}
                          </span>
                        </div>
                      </div>
                      {act.targetDurationSec && (
                        <span className="text-[11px] font-mono font-bold text-slate-600 bg-white/80 px-2 py-0.5 rounded-full border border-slate-200/60 flex items-center gap-1 shrink-0">
                          <Clock className="w-3 h-3 text-slate-500" />
                          {act.targetDurationSec}s
                        </span>
                      )}
                    </div>

                    {/* 核心故事总述 */}
                    <p className="text-xs text-slate-700 leading-relaxed pt-0.5">
                      {act.summary}
                    </p>
                  </div>

                  {/* 核心冲突与卡点悬念 */}
                  <div className="space-y-1.5 pt-2 border-t border-black/5 text-[11px]">
                    {act.coreConflict && (
                      <div className="bg-white/80 p-2 rounded-lg border border-slate-200/50 flex items-start gap-1.5">
                        <Swords className="w-3.5 h-3.5 text-indigo-600 shrink-0 mt-0.5" />
                        <div>
                          <strong className="text-indigo-950 font-bold mr-1">核心冲突:</strong>
                          <span className="text-slate-600">{act.coreConflict}</span>
                        </div>
                      </div>
                    )}
                    {act.cliffhanger && (
                      <div className="bg-amber-50/70 p-2 rounded-lg border border-amber-200/60 flex items-start gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5 fill-amber-500" />
                        <div>
                          <strong className="text-amber-950 font-bold mr-1">卡点悬念:</strong>
                          <span className="text-amber-900">{act.cliffhanger}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. 核心登场角色与 8K 视觉定妆设定 */}
      {(activeTab === 'all' || activeTab === 'characters') && characters.length > 0 && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-purple-600" />
                <span>👥 核心登场人物档案与好感度体系 ({characters.length} 位角色)</span>
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                深度绑定中盘抉择、审讯对质与多结局走向，已全面预置 8K 电影级视觉定妆提示词
              </p>
            </div>
            <span className="text-xs font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2.5 py-1 rounded-full">
              已对齐 Stage 2 视觉定妆标准
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {characters.map((c: any, idx: number) => {
              const roleColor =
                idx === 0
                  ? 'bg-indigo-100 text-indigo-800 border-indigo-200'
                  : idx === 1
                  ? 'bg-teal-100 text-teal-800 border-teal-200'
                  : idx === 2
                  ? 'bg-rose-100 text-rose-800 border-rose-200'
                  : 'bg-purple-100 text-purple-800 border-purple-200';

              return (
                <div
                  key={c.id || idx}
                  className="rounded-xl p-4.5 border border-slate-200/85 bg-slate-50/50 hover:bg-slate-50 transition-colors shadow-2xs space-y-3 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    {/* 头部：姓名、性别、年龄、身份标签 */}
                    <div className="flex items-start justify-between gap-2 border-b border-slate-200/60 pb-2.5">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-black text-base text-slate-900">{c.name}</h4>
                          {(c.gender || c.age) && (
                            <span className="text-[11px] font-medium text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                              {c.gender} {c.age ? `· ${c.age}岁` : ''}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-600 leading-relaxed">
                          {c.role}
                        </p>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${roleColor}`}>
                        {idx === 0 ? '主角/玩家视角' : idx === 1 ? '核心同盟' : idx === 2 ? '对立主谋' : '残响引路人'}
                      </span>
                    </div>

                    {/* 性格特质与微动作 */}
                    {c.personality && (
                      <div className="text-[11px] leading-relaxed text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200/60">
                        <strong className="text-slate-900 font-bold mr-1">🎭 性格弧光:</strong>
                        <span>{c.personality}</span>
                      </div>
                    )}

                    {/* 核心动机 */}
                    {c.motivation && (
                      <div className="text-[11px] leading-relaxed text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200/60">
                        <strong className="text-indigo-950 font-bold mr-1">🎯 核心动机:</strong>
                        <span>{c.motivation}</span>
                      </div>
                    )}

                    {/* 好感度触发偏好 */}
                    {c.affinityTrigger && (
                      <div className="text-[11px] leading-relaxed text-rose-900 bg-rose-50/60 p-2.5 rounded-lg border border-rose-200/60">
                        <strong className="font-bold mr-1 flex-inline items-center gap-1 text-rose-950">
                          <Heart className="w-3 h-3 inline mr-0.5 text-rose-600 fill-rose-600" />
                          好感增减规则:
                        </strong>
                        <span>{c.affinityTrigger}</span>
                      </div>
                    )}
                  </div>

                  {/* 8K 视觉提示词 */}
                  {c.visualPrompt && (
                    <div className="pt-2 border-t border-slate-200/60 space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span className="font-bold flex items-center gap-1 text-purple-900">
                          <Palette className="w-3 h-3 text-purple-600" />
                          8K 电影级视觉定妆 Prompt
                        </span>
                        <button
                          onClick={() => handleCopyPrompt(c.id || idx, c.visualPrompt)}
                          className="text-[10px] text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer font-medium"
                        >
                          {copiedCharId === (c.id || idx) ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-600" />
                              <span className="text-emerald-600">已复制</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>复制提示词</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div className="bg-slate-900 text-slate-300 font-mono text-[10px] p-2.5 rounded-lg max-h-24 overflow-y-auto leading-relaxed border border-slate-800">
                        {c.visualPrompt}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. 网状故事拓扑可视化 */}
      {(activeTab === 'all' || activeTab === 'graph') && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs flex-1 flex flex-col min-h-[520px]">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
            <div>
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <GitFork className="w-4 h-4 text-indigo-600" />
                网状互动故事拓扑图谱 (Interactive Story Graph)
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                包含 10 个网状互动节点、微交互搜查/对质元数据、好感度判定与 4 大分支终局
              </p>
            </div>
          </div>

          <div className="flex-1 min-h-[440px] rounded-xl border border-gray-200/80 overflow-hidden bg-slate-900">
            <StoryGraphViewer graph={storyGraph} />
          </div>
        </div>
      )}
    </div>
  );
}
