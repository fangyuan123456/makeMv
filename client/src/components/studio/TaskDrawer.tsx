/**
 * client/src/components/studio/TaskDrawer.tsx
 * 全局任务监控抽屉组件 (Task Center)
 */

import React, { useState, useMemo } from 'react';
import type { TaskRecord } from '../../types/index.js';
import { upsertTaskRecords } from '../../lib/taskUtils.js';

interface TaskDrawerProps {
  tasks: TaskRecord[];
  onRefreshTasks?: () => void;
  onCancelTask?: (taskId: string) => Promise<void>;
}

const FAILURE_TYPE_MAP: Record<string, { label: string; className: string }> = {
  llm_contract_error: { label: 'LLM契约误差', className: 'bg-purple-50 text-purple-700 border-purple-200' },
  media_service_error: { label: '媒体服务异常', className: 'bg-orange-50 text-orange-700 border-orange-200' },
  system_interrupted: { label: '服务重启中断', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  transient_network_error: { label: '网络抖动', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  system_fault: { label: '系统异常', className: 'bg-rose-50 text-rose-700 border-rose-200' },
};

export const TaskDrawer: React.FC<TaskDrawerProps> = ({
  tasks,
  onRefreshTasks,
  onCancelTask,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  // 严格基于 taskId 执行单一事实来源（SSOT）去重，杜绝任何 key 冲突与重复卡片渲染
  const uniqueTasks = useMemo(() => upsertTaskRecords([], tasks), [tasks]);

  const runningCount = uniqueTasks.filter((t) => t.status === 'running' || t.status === 'pending').length;
  const failedCount = uniqueTasks.filter((t) => t.status === 'failed').length;

  return (
    <>
      {/* 悬浮任务触发条 */}
      <div className="fixed bottom-5 right-5 z-[75]">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-full shadow-[0_4px_20px_-2px_rgba(15,23,42,0.12)] border text-xs font-bold transition-all backdrop-blur-xl cursor-pointer active:scale-95 ${
            runningCount > 0
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-indigo-600/30 animate-pulse'
              : failedCount > 0
              ? 'bg-white text-rose-600 border-rose-200 shadow-rose-500/10 hover:bg-rose-50/50'
              : 'bg-white/95 text-slate-800 border-slate-200/90 hover:bg-slate-50'
          }`}
        >
          <span>⚡ 任务中心</span>
          {runningCount > 0 && (
            <span className="w-5 h-5 rounded-full bg-white text-indigo-700 text-[10px] font-black flex items-center justify-center shadow-xs">
              {runningCount}
            </span>
          )}
          {runningCount === 0 && failedCount > 0 && (
            <span className="w-5 h-5 rounded-full bg-rose-100 text-rose-600 text-[10px] font-bold flex items-center justify-center">
              !
            </span>
          )}
          <span className="text-slate-400 text-[10px]">{isOpen ? '▼' : '▲'}</span>
        </button>
      </div>

      {/* 展开的任务面板 (高优先级 z-[80]，自适应视口高度，杜绝局部导航栏或悬浮球遮挡穿透) */}
      {isOpen && (
        <div className="fixed bottom-18 right-5 w-96 max-h-[min(580px,calc(100vh-6rem))] bg-white/95 border border-slate-200/90 rounded-3xl shadow-[0_20px_60px_-15px_rgba(15,23,42,0.18)] z-[80] flex flex-col overflow-hidden backdrop-blur-xl ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-black text-slate-900 tracking-tight">任务调度总览</span>
              <span className="text-xs font-mono font-semibold text-slate-400">({uniqueTasks.length})</span>
            </div>
            <div className="flex items-center space-x-1.5">
              {onRefreshTasks && (
                <button
                  onClick={onRefreshTasks}
                  className="text-xs text-slate-600 hover:text-slate-900 p-1.5 rounded-lg bg-white border border-slate-200 shadow-2xs transition cursor-pointer"
                  title="刷新任务列表"
                >
                  🔄
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-xs p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
            {uniqueTasks.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-xs">
                <span className="text-2xl block mb-1 opacity-60">📋</span>
                暂无任务记录，点击上方工具按钮发起任务
              </div>
            ) : (
              uniqueTasks.map((task) => {
                const isRunning = task.status === 'running' || task.status === 'pending';
                const isSuccess = task.status === 'completed';
                const isFailed = task.status === 'failed';
                const isCancelled = task.status === 'cancelled';

                return (
                  <div
                    key={task.taskId}
                    className="p-3 rounded-xl bg-slate-50/60 border border-slate-200/80 text-xs hover:border-slate-300 transition"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono font-bold text-slate-800">
                        {task.toolName}
                      </span>
                      <div className="flex items-center space-x-1.5">
                        {isRunning && onCancelTask && (
                          <button
                            onClick={() => onCancelTask(task.taskId)}
                            className="px-2 py-0.5 rounded text-[10px] bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 font-medium transition cursor-pointer"
                            title="中止任务"
                          >
                            取消
                          </button>
                        )}
                        {task.failureType && FAILURE_TYPE_MAP[task.failureType] && (
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${FAILURE_TYPE_MAP[task.failureType].className}`}>
                            {FAILURE_TYPE_MAP[task.failureType].label}
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                            isRunning
                              ? 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse'
                              : isSuccess
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : isFailed
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : isCancelled
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {isCancelled ? '已取消' : task.status}
                        </span>
                      </div>
                    </div>

                    <div className="text-[10px] text-slate-400 font-mono truncate">
                      {task.taskId}
                    </div>

                    {task.durationMs !== undefined && (
                      <div className="text-[10px] text-slate-500 font-medium mt-1">
                        耗时: {(task.durationMs / 1000).toFixed(1)}s
                      </div>
                    )}

                    {task.error && (
                      <div className="text-[10px] text-rose-700 bg-rose-50/80 border border-rose-200 p-2 rounded-lg mt-2 break-words">
                        {task.lastFailure?.attempt && task.lastFailure.attempt > 1 && (
                          <span className="font-bold mr-1">[已重试 {task.lastFailure.attempt - 1} 次]</span>
                        )}
                        {task.error}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </>
  );
};
