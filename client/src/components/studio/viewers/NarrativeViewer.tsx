import { useState } from 'react';
import {
  BookOpen,
  GitFork,
  Sparkles,
  ShieldCheck,
  Flame,
  Clock,
  Zap,
  Swords,
  Film,
  Users,
  Heart,
  Palette,
  Copy,
  Check,
} from 'lucide-react';
import StoryGraphViewer from '../../stages/StoryGraphViewer';
import StoryGraphErrorBoundary from '../../stages/StoryGraphErrorBoundary';

interface NarrativeViewerProps {
  artifact?: any;
  onRevise?: (instruction: string) => void;
  isRunning?: boolean;
}

const ACT_BADGES = [
  {
    prefix: '起',
    label: '危机爆发与悬念开启',
    color: 'from-amber-950/40 to-slate-900 text-amber-200 border-amber-800/80',
    tagColor: 'bg-amber-950 text-amber-300 border-amber-800',
    iconColor: 'text-amber-400',
  },
  {
    prefix: '承',
    label: '矛盾升级与阵营撕裂',
    color: 'from-blue-950/40 to-slate-900 text-blue-200 border-blue-800/80',
    tagColor: 'bg-blue-950 text-blue-300 border-blue-800',
    iconColor: 'text-blue-400',
  },
  {
    prefix: '转',
    label: '戏剧反转与惊天真相',
    color: 'from-purple-950/40 to-slate-900 text-purple-200 border-purple-800/80',
    tagColor: 'bg-purple-950 text-purple-300 border-purple-800',
    iconColor: 'text-purple-400',
  },
  {
    prefix: '合',
    label: '决胜巅峰与多线终局',
    color: 'from-emerald-950/40 to-slate-900 text-emerald-200 border-emerald-800/80',
    tagColor: 'bg-emerald-950 text-emerald-300 border-emerald-800',
    iconColor: 'text-emerald-400',
  },
];

export default function NarrativeViewer({ artifact }: NarrativeViewerProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'spine' | 'characters' | 'graph'>('all');
  const [copiedCharId, setCopiedCharId] = useState<string | null>(null);

  const handleCopyPrompt = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCharId(id);
    setTimeout(() => setCopiedCharId(null), 2000);
  };

  if (!artifact) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 text-slate-500">
        <BookOpen className="w-12 h-12 mb-3 text-slate-600 animate-pulse" />
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
    <div className="flex flex-col h-full overflow-y-auto p-6 pb-48 space-y-6 bg-slate-950 text-slate-200">
      {/* 1. 故事概览总头卡 */}
      <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800 shadow-xl space-y-4 shrink-0">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">
                {genreName}
              </span>
              {theme && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
                  {theme}
                </span>
              )}
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                黄金主干已锁定
              </span>
            </div>
            <h2 className="text-2xl font-black text-slate-100 tracking-tight">{title}</h2>
            {style && (
              <p className="text-xs text-slate-400 flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span>视觉调性：{style}</span>
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 self-start">
            <div className="flex rounded-lg bg-slate-800 p-0.5 border border-slate-700 text-xs font-medium">
              <button
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                  activeTab === 'all'
                    ? 'bg-indigo-600 text-white shadow-2xs font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                全景概览
              </button>
              <button
                onClick={() => setActiveTab('spine')}
                className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                  activeTab === 'spine'
                    ? 'bg-indigo-600 text-white shadow-2xs font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                四幕剧本原案
              </button>
              <button
                onClick={() => setActiveTab('characters')}
                className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                  activeTab === 'characters'
                    ? 'bg-indigo-600 text-white shadow-2xs font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                核心角色档案 ({characters.length})
              </button>
              <button
                onClick={() => setActiveTab('graph')}
                className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                  activeTab === 'graph'
                    ? 'bg-indigo-600 text-white shadow-2xs font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                网状拓扑图
              </button>
            </div>
          </div>
        </div>

        {logline && (
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-200 leading-relaxed shadow-2xs">
            <span className="font-bold text-indigo-400 mr-2 flex-inline items-center gap-1">
              <BookOpen className="w-3.5 h-3.5 inline mr-1 text-indigo-400" />
              【核心剧情大纲 (Logline)】:
            </span>
            {logline}
          </div>
        )}

        {/* 核心看点 */}
        {sellingPoints.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
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
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs shadow-2xs"
                  >
                    <div className="font-bold text-amber-300 mb-0.5 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>{titlePart}</span>
                    </div>
                    {descPart && <p className="text-slate-400 text-[11px] leading-relaxed pl-5">{descPart}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 2. 黄金故事主干：四幕戏剧弧线 */}
      {(activeTab === 'all' || activeTab === 'spine') && goldenSpine.length > 0 && (
        <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800 shadow-xl space-y-4 shrink-0">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-indigo-400" />
                <span>📖 黄金主干剧本原案 · 四幕起承转合戏剧弧线</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                严密遵循经典电影戏剧节奏，锁死单幕 25~30 秒的高密度剧情爆点与第一视角抉择
              </p>
            </div>
            <span className="text-xs font-bold text-slate-400 bg-slate-800 px-2.5 py-1 rounded-full">
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
                    <div className="flex items-start justify-between gap-2 border-b border-white/10 pb-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-6 h-6 rounded-full flex items-center justify-center font-black text-xs border ${badge.tagColor}`}
                        >
                          {badge.prefix}
                        </span>
                        <div>
                          <h4 className="font-bold text-sm text-slate-100">{act.name}</h4>
                          <span className="text-[10px] text-slate-400 font-medium">
                            {act.dramaticFunction || badge.label}
                          </span>
                        </div>
                      </div>
                      {act.targetDurationSec && (
                        <span className="text-[11px] font-mono font-bold text-slate-300 bg-slate-800/80 px-2 py-0.5 rounded-full border border-slate-700 flex items-center gap-1 shrink-0">
                          <Clock className="w-3 h-3 text-slate-400" />
                          {act.targetDurationSec}s
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed pt-0.5">
                      {act.summary}
                    </p>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-white/10 text-[11px]">
                    {act.coreConflict && (
                      <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800 flex items-start gap-1.5">
                        <Swords className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
                        <div>
                          <strong className="text-indigo-300 font-bold mr-1">核心冲突:</strong>
                          <span className="text-slate-400">{act.coreConflict}</span>
                        </div>
                      </div>
                    )}
                    {act.cliffhanger && (
                      <div className="bg-amber-950/40 p-2 rounded-lg border border-amber-800/60 flex items-start gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5 fill-amber-500" />
                        <div>
                          <strong className="text-amber-300 font-bold mr-1">卡点悬念:</strong>
                          <span className="text-amber-200">{act.cliffhanger}</span>
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
        <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800 shadow-xl space-y-4 shrink-0">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Users className="w-4 h-4 text-purple-400" />
                <span>👥 核心登场人物档案与好感度体系 ({characters.length} 位角色)</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                深度绑定中盘抉择、审讯对质与多结局走向，已全面预置 8K 电影级视觉定妆提示词
              </p>
            </div>
            <span className="text-xs font-bold text-purple-300 bg-purple-950 border border-purple-800 px-2.5 py-1 rounded-full">
              已对齐 Stage 2 视觉定妆标准
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {characters.map((c: any, idx: number) => {
              const roleColor =
                idx === 0
                  ? 'bg-indigo-950 text-indigo-300 border-indigo-800'
                  : idx === 1
                  ? 'bg-teal-950 text-teal-300 border-teal-800'
                  : idx === 2
                  ? 'bg-rose-950 text-rose-300 border-rose-800'
                  : 'bg-purple-950 text-purple-300 border-purple-800';

              return (
                <div
                  key={c.id || idx}
                  className="rounded-xl p-4.5 border border-slate-800 bg-slate-950/60 hover:bg-slate-950 transition-colors shadow-2xs space-y-3 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2.5">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-black text-base text-slate-100">{c.name}</h4>
                          {(c.gender || c.age) && (
                            <span className="text-[11px] font-medium text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                              {c.gender} {c.age ? `· ${c.age}岁` : ''}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          {c.role}
                        </p>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${roleColor}`}>
                        {idx === 0 ? '主角/玩家视角' : idx === 1 ? '核心同盟' : idx === 2 ? '对立主谋' : '残响引路人'}
                      </span>
                    </div>

                    {c.personality && (
                      <div className="text-[11px] leading-relaxed text-slate-300 bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                        <strong className="text-slate-100 font-bold mr-1">🎭 性格弧光:</strong>
                        <span>{c.personality}</span>
                      </div>
                    )}

                    {c.motivation && (
                      <div className="text-[11px] leading-relaxed text-slate-300 bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                        <strong className="text-indigo-300 font-bold mr-1">🎯 核心动机:</strong>
                        <span>{c.motivation}</span>
                      </div>
                    )}

                    {c.affinityTrigger && (
                      <div className="text-[11px] leading-relaxed text-rose-200 bg-rose-950/40 p-2.5 rounded-lg border border-rose-800/60">
                        <strong className="font-bold mr-1 flex-inline items-center gap-1 text-rose-300">
                          <Heart className="w-3 h-3 inline mr-0.5 text-rose-400 fill-rose-400" />
                          好感增减规则:
                        </strong>
                        <span>{c.affinityTrigger}</span>
                      </div>
                    )}
                  </div>

                  {c.visualPrompt && (
                    <div className="pt-2 border-t border-slate-800 space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span className="font-bold flex items-center gap-1 text-purple-300">
                          <Palette className="w-3 h-3 text-purple-400" />
                          8K 电影级视觉定妆 Prompt
                        </span>
                        <button
                          onClick={() => handleCopyPrompt(c.id || idx, c.visualPrompt)}
                          className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer font-medium"
                        >
                          {copiedCharId === (c.id || idx) ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-400">已复制</span>
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
        <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800 shadow-xl flex flex-col w-full max-w-full space-y-4 shrink-0">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <GitFork className="w-4 h-4 text-indigo-400" />
                网状互动故事拓扑图谱 (Interactive Story Graph)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                包含网状互动节点、核心选择分支与多结局收敛点
              </p>
            </div>
          </div>

          <div className="w-full shrink-0">
            <StoryGraphViewer graph={storyGraph} />
          </div>
        </div>
      )}
    </div>
  );
}
