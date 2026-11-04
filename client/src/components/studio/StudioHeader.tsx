import { useState, useRef, useEffect } from 'react';
import {
  CheckCircle2,
  Clock,
  Plus,
  FolderOpen,
  Trash2,
  ChevronDown,
  Sparkles,
  Gamepad2,
  Workflow,
} from 'lucide-react';
import { HistoryItem } from './viewers/WelcomeViewer';

interface StudioHeaderProps {
  projectTitle: string;
  sessionId: string | null;
  onNewProject: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onOpenStudioDrawer?: () => void;
  history: HistoryItem[];
  status: string;
}

export default function StudioHeader({
  projectTitle,
  sessionId,
  onNewProject,
  onSelectSession,
  onDeleteSession,
  onOpenStudioDrawer,
  history,
  status,
}: StudioHeaderProps) {
  const [showHistory, setShowHistory] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowHistory(false);
      }
    }
    if (showHistory) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showHistory]);

  const getStatusBadge = () => {
    if (!sessionId) {
      return (
        <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800 flex items-center gap-1.5 shadow-2xs">
          <Sparkles className="w-3 h-3 text-indigo-400" />
          <span>准备就绪</span>
        </span>
      );
    }
    if (status === 'waiting' || status === 'waiting_for_intervention') {
      return (
        <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-950 text-amber-300 border border-amber-800 animate-pulse flex items-center gap-1.5 shadow-2xs">
          <Clock className="w-3 h-3 text-amber-400" />
          <span>等待您的确认</span>
        </span>
      );
    }
    if (status === 'running') {
      return (
        <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800 flex items-center gap-1.5 shadow-2xs">
          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
          <span>AI 导演制作中...</span>
        </span>
      );
    }
    if (status === 'completed') {
      return (
        <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1.5 shadow-2xs">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          <span>影游已就绪</span>
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-800 text-slate-300 border border-slate-700 shadow-2xs">
        就绪
      </span>
    );
  };

  return (
    <header className="bg-slate-900 border-b border-slate-800 h-14 px-6 flex items-center justify-between shrink-0 z-30 relative shadow-md">
      {/* 左侧：Logo & 项目名 & 历史下拉 */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-md shadow-indigo-600/30">
          <Gamepad2 className="w-4 h-4" />
        </div>

        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-slate-800 text-slate-200 transition-all cursor-pointer group"
          >
            <h1 className="text-sm font-bold truncate max-w-[280px] tracking-tight">
              {sessionId ? (projectTitle || '互动影游项目') : '新建互动影游'}
            </h1>
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 group-hover:text-slate-200 transition-transform ${
                showHistory ? 'rotate-180' : ''
              }`}
            />
          </button>

          {/* 历史项目下拉浮窗 */}
          {showHistory && (
            <div className="absolute left-0 top-full mt-2 w-84 bg-slate-900 rounded-2xl shadow-2xl border border-slate-800 p-2.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="px-3 py-2 flex items-center justify-between border-b border-slate-800 mb-1.5">
                <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
                  历史创作项目 ({history.length})
                </span>
                <button
                  onClick={() => {
                    onNewProject();
                    setShowHistory(false);
                  }}
                  className="text-[11px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> 新建
                </button>
              </div>

              <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
                {history.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-500">暂无历史项目</div>
                ) : (
                  history.map((item) => {
                    const isCurrent = item.id === sessionId;
                    return (
                      <div
                        key={item.id}
                        className={`group flex items-center justify-between p-2.5 rounded-xl text-xs transition-all cursor-pointer ${
                          isCurrent
                            ? 'bg-indigo-950 text-indigo-300 font-bold border border-indigo-800'
                            : 'hover:bg-slate-800 text-slate-300 hover:text-white'
                        }`}
                        onClick={() => {
                          onSelectSession(item.id);
                          setShowHistory(false);
                        }}
                      >
                        <div className="min-w-0 pr-2">
                          <p className="truncate font-medium">{item.idea || '未命名短剧'}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">{item.date || '近期'}</p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm('确认删除该历史项目？')) {
                              onDeleteSession(item.id);
                            }
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-all"
                          title="删除项目"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {getStatusBadge()}
      </div>

      {/* 右侧：新建创作 & 历史项目快捷按钮 & Mastra Studio 入口 */}
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenStudioDrawer}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-indigo-500/30 text-indigo-300 text-xs font-bold transition-all cursor-pointer shadow-2xs group"
          title="打开 Mastra Studio 智能座舱"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 group-hover:animate-ping" />
          <Workflow className="w-3.5 h-3.5 text-indigo-400" />
          <span>Mastra Studio</span>
        </button>

        <button
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-bold transition-all cursor-pointer shadow-2xs"
        >
          <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
          <span>历史项目</span>
        </button>

        <button
          onClick={onNewProject}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>新建创作</span>
        </button>
      </div>
    </header>
  );
}
