/**
 * client/src/components/studio/PipelineStepper.tsx
 * 互动影游三大核心工序管线步进导航组件 (Modern Studio Light Theme)
 */

import React from 'react';

export type StudioStage = 'planner' | 'visual' | 'game';

interface PipelineStepperProps {
  currentStage: StudioStage;
  onSelectStage: (stage: StudioStage) => void;
  hasPrd: boolean;
  hasEntities: boolean;
  hasStoryboards: boolean;
  hasGame: boolean;
  canEnterVisual: boolean;
  canEnterGame: boolean;
  projects?: Array<{ projectId: string; title: string }>;
  currentProjectId?: string;
  onSelectProject?: (projectId: string) => void;
  onCreateProject?: () => void;
}

export const PipelineStepper: React.FC<PipelineStepperProps> = ({
  currentStage,
  onSelectStage,
  hasPrd,
  hasEntities,
  hasStoryboards,
  hasGame,
  canEnterVisual,
  canEnterGame,
  projects = [],
  currentProjectId,
  onSelectProject,
  onCreateProject,
}) => {
  const steps: Array<{
    id: StudioStage;
    number: string;
    title: string;
    desc: string;
    isReady: boolean;
  }> = [
    {
      id: 'planner',
      number: '01',
      title: '剧本与策划',
      desc: '创意推演 & 故事因果拓扑',
      isReady: hasPrd,
    },
    {
      id: 'visual',
      number: '02',
      title: '视听制作工坊',
      desc: '定妆母体 & 演绎片段 & 视听成片',
      isReady: hasEntities || hasStoryboards,
    },
    {
      id: 'game',
      number: '03',
      title: '互动影游总装',
      desc: '零构建代码生成 & 试玩交付',
      isReady: hasGame,
    },
  ];

  return (
    <nav className="bg-white/85 border-b border-slate-200/80 px-6 py-2.5 flex flex-wrap items-center justify-between gap-4 backdrop-blur-xl sticky top-0 z-30 shadow-[0_1px_8px_-1px_rgba(0,0,0,0.04)] select-none">
      <div className="flex items-center space-x-3.5">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-700 text-white flex items-center justify-center text-base shadow-sm ring-1 ring-indigo-600/20">
          🎬
        </div>
        <div>
          <h1 className="text-sm font-black text-slate-900 tracking-tight flex items-center gap-2">
            <span>MakeMv Studio</span>
            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded-full bg-indigo-50 text-indigo-700 font-bold border border-indigo-200/80 tracking-wide">
              DIRECTOR
            </span>
          </h1>
          <p className="text-[10px] text-slate-500 font-medium">全链路互动影游导演工坊</p>
        </div>

        {/* 项目选择与新建 */}
        <div className="flex items-center space-x-1.5 pl-4 ml-1 border-l border-slate-200/90">
          <div className="relative flex items-center">
            <span className="absolute left-2.5 text-[11px] text-slate-400 pointer-events-none">🎞️</span>
            <select
              value={currentProjectId}
              onChange={(e) => onSelectProject?.(e.target.value)}
              className="bg-slate-50/90 hover:bg-slate-100/90 border border-slate-200/90 text-xs font-semibold text-slate-800 rounded-xl pl-7 pr-3 py-1.5 focus:outline-none focus:border-indigo-400 focus:bg-white transition font-sans shadow-2xs cursor-pointer"
            >
              {projects.map((p) => (
                <option key={p.projectId} value={p.projectId}>
                  {p.title || p.projectId} ({p.projectId.slice(-6)})
                </option>
              ))}
              {projects.length === 0 && (
                <option value={currentProjectId}>{currentProjectId}</option>
              )}
            </select>
          </div>

          {onCreateProject && (
            <button
              onClick={onCreateProject}
              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold border border-slate-200 transition shadow-2xs flex items-center gap-1 cursor-pointer active:scale-95"
              title="新建项目"
            >
              <span>➕</span>
              <span>新建</span>
            </button>
          )}
        </div>
      </div>

      {/* 工序步进按钮组 */}
      <div className="flex items-center space-x-1.5 sm:space-x-2.5 bg-slate-100/60 p-1 rounded-2xl border border-slate-200/60">
        {steps.map((step, idx) => {
          const isActive = currentStage === step.id;
          const isLocked = step.id === 'visual' ? !canEnterVisual : step.id === 'game' ? !canEnterGame : false;
          const lockedReason = step.id === 'visual' ? '请先完成剧本与策划，生成结构化故事拓扑' : '请先完成视听工坊中所有剧情片段的镜头视频';
          return (
            <React.Fragment key={step.id}>
              {idx > 0 && <span className="text-slate-300 text-[10px] select-none">→</span>}
              <button
                disabled={isLocked}
                title={isLocked ? lockedReason : step.desc}
                onClick={() => onSelectStage(step.id)}
                className={`flex items-center space-x-2.5 px-3.5 py-1.5 rounded-xl text-xs transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
                  isActive
                    ? 'bg-white text-slate-900 shadow-xs border border-slate-200/90 ring-1 ring-black/5'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60 border border-transparent'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center font-mono text-[10px] transition-all ${
                    isActive
                      ? 'bg-indigo-600 text-white font-black shadow-2xs ring-2 ring-indigo-200'
                      : step.isReady
                      ? 'bg-emerald-50 text-emerald-700 font-bold border border-emerald-300'
                      : 'bg-slate-200/90 text-slate-500 font-medium'
                  }`}
                >
                  {step.isReady && !isActive ? '✓' : step.number}
                </span>
                <div className="text-left hidden md:block">
                  <div className={`font-bold leading-none ${isActive ? 'text-indigo-950' : 'text-slate-700'}`}>
                    {step.title}
                  </div>
                  <div className={`text-[9.5px] leading-tight mt-0.5 ${isActive ? 'text-indigo-600 font-medium' : 'text-slate-400'}`}>
                    {step.desc}
                  </div>
                </div>
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </nav>
  );
};
