import { useState, useRef, useEffect } from 'react';
import {
  Send,
  Sparkles,
  Bot,
  User,
  CheckCircle2,
  Loader2,
  ChevronDown,
  Brain,
  Play,
  AlertTriangle,
  RotateCw,
  FileText,
  XCircle,
  Clock,
} from 'lucide-react';
import { ChatMessageItem, TaskItem, TaskArtifact, MILESTONES } from './studio.types';
import CriticAuditCard from './CriticAuditCard';
import { type CinematicParams } from '../CinematicControls';

/* ─── 常量定义 ─── */

const QUICK_INSPIRATIONS = [
  '赛博朋克悬疑，记忆神偷潜入脑机财阀调查意识篡改案',
  '暴雨孤立客栈，十位旅人午夜遭遇连环命案找真凶',
  '硬科幻惊悚，废弃科考舰遭遇深空异变与失控AI',
  '都市奇幻，平民职员觉醒五分钟时空回溯逆袭商战',
];

/** 工序键位 → 中文短名（产物链接与进度描述展示用） */
function stageLabel(stage: string): string {
  const hit = MILESTONES.find((m) => m.stages.includes(stage));
  return hit?.shortName || stage;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 1. 子组件：深度思考折叠条 (DeepSeek 风格，极简通透细线排版)
 * ══════════════════════════════════════════════════════════════════════════════ */

function DirectorThoughtBlock({ thought, isLive }: { thought: string; isLive?: boolean }) {
  const [isOpen, setIsOpen] = useState(isLive ?? false);

  useEffect(() => {
    if (isLive) setIsOpen(true);
  }, [isLive]);

  return (
    <div className="mb-2.5 max-w-2xl select-text">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="group inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors py-1 cursor-pointer select-none"
      >
        <span className="flex items-center gap-1.5 font-medium">
          {isLive ? (
            <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
          ) : (
            <Brain className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 transition-colors" />
          )}
          <span>{isLive ? 'thinking...' : 'think'}</span>
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-500 group-hover:text-slate-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="relative pl-3.5 my-1.5 border-l-2 border-slate-700/60 text-slate-400 text-xs leading-relaxed max-w-2xl whitespace-pre-wrap">
          <div className="max-h-72 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-800">
            {thought}
            {isLive && (
              <span className="inline-block w-1 h-3 ml-1 bg-indigo-400/80 animate-pulse align-middle" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 2. 子组件：气泡内任务面板（未开始 / 执行中 / 已结束 四态共用一套渲染）
 *
 * 口径：任务才是状态载体。气泡正文只负责「导演说了什么」，任务面板按 taskId
 * 从任务仓库实时投影：未开始给审批按钮、执行中给进度条、结束给成果与产物链接、
 * 失败给原因与重试。同一任务只在其最后一条关联气泡上渲染，避免一任务多卡。
 * ══════════════════════════════════════════════════════════════════════════════ */

/** 统一耗时计时器：未结束时按秒轮询；已结束时取固定差值 */
function useElapsedSeconds(startedAt?: string, endedAt?: string) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const start = startedAt ? new Date(startedAt).getTime() : Date.now();
    const end = endedAt ? new Date(endedAt).getTime() : NaN;
    const isEnded = Number.isFinite(end);
    const compute = () => setSec(Math.max(0, Math.round(((isEnded ? end : Date.now()) - start) / 1000)));
    compute();
    if (isEnded) return;
    const timer = setInterval(compute, 500);
    return () => clearInterval(timer);
  }, [startedAt, endedAt]);
  return sec;
}

interface InlineTaskPanelProps {
  task: TaskItem;
  onApprove: (taskId: string) => void;
  onRetry: (taskId: string) => void;
  onOpenArtifact?: (stage: string) => void;
}

function InlineTaskPanel({ task, onApprove, onRetry, onOpenArtifact }: InlineTaskPanelProps) {
  const elapsed = useElapsedSeconds(task.startedAt, task.finishedAt);

  /* 未开始（待确认）：审批按钮 */
  if (task.status === 'proposed') {
    return (
      <div className="mt-2.5 pt-2.5 border-t border-slate-700/60 whitespace-normal">
        <div className="flex items-center gap-1.5 mb-1">
          <Clock className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
          <span className="text-[11px] font-bold text-indigo-200 truncate">未开始：{task.title}</span>
          <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-mono bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 shrink-0">
            PENDING
          </span>
        </div>
        {task.description && (
          <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2 mb-2">{task.description}</p>
        )}
        <button
          type="button"
          onClick={() => onApprove(task.taskId)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-md shadow-indigo-600/25 transition-all active:scale-95 cursor-pointer"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>批准并启动</span>
        </button>
      </div>
    );
  }

  /*
   * 已批准、引擎还没接上：这是「点了同意到首帧产出」之间的空窗。
   * 必须与 proposed 分开——按钮已失效不能再渲染，进度条也不该动，
   * 否则用户会以为卡死或者重复点击启动。
   */
  if (task.status === 'queued') {
    return (
      <div className="mt-2.5 pt-2.5 border-t border-slate-700/60 whitespace-normal">
        <div className="flex items-center gap-1.5 mb-1">
          <Clock className="w-3.5 h-3.5 text-indigo-300/70 shrink-0" />
          <span className="text-[11px] font-bold text-indigo-200/90 truncate">已批准，等待执行：{task.title}</span>
          <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-700/40 text-slate-300 border border-slate-600/50 shrink-0">
            QUEUED
          </span>
        </div>
        <p className="text-[10px] text-slate-500 font-mono leading-relaxed">
          已排入执行队列，引擎接管后即开始推进…
        </p>
      </div>
    );
  }

  /* 执行中：进度条 */
  if (task.status === 'running') {
    const progress = task.progress;
    const percent = Math.min(100, Math.max(4, progress?.percent ?? 8));
    const stepLabel =
      progress && progress.total > 1 && progress.total <= 20 && progress.current > 0
        ? `第 ${progress.current}/${progress.total} 步 · ${percent}%`
        : `${percent}%`;

    return (
      <div className="mt-2.5 pt-2.5 border-t border-slate-700/60 whitespace-normal">
        <div className="flex items-center gap-2 mb-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400 shrink-0" />
          <span className="text-[11px] font-bold text-indigo-200 truncate">执行中：{task.title}</span>
          <span className="ml-auto text-[10px] font-mono text-indigo-300/90 shrink-0">
            {stepLabel} · {elapsed}s
          </span>
        </div>
        <div className="w-full h-1.5 bg-slate-950/80 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-400 rounded-full transition-all duration-500 ease-out shadow-[0_0_8px_rgba(99,102,241,0.5)]"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-1.5 text-[10px] text-slate-500 font-mono leading-relaxed truncate">
          {progress?.note || '正在准备执行，产物将直接在右侧视窗实时就绪...'}
        </p>
      </div>
    );
  }

  /* 已结束：成功成果 + 产物链接 */
  if (task.status === 'succeeded') {
    const artifacts: TaskArtifact[] = task.artifacts || [];
    return (
      <div className="mt-2.5 pt-2.5 border-t border-slate-700/60 whitespace-normal">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="text-[11px] font-bold text-emerald-300 truncate">已完成：{task.title}</span>
          {elapsed > 0 && (
            <span className="ml-auto text-[10px] font-mono text-slate-500 shrink-0">{elapsed}s</span>
          )}
        </div>

        {task.resultSummary && (
          <p className="mt-1 text-[11px] text-slate-400 leading-relaxed line-clamp-3">{task.resultSummary}</p>
        )}

        {artifacts.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-slate-500 font-mono">产物</span>
            {artifacts.map((a) => (
              <button
                key={`${a.stage}-${a.createdAt || ''}`}
                type="button"
                onClick={() => onOpenArtifact?.(a.stage)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-slate-950/60 hover:bg-indigo-950/70 text-slate-300 hover:text-indigo-200 border border-slate-800 hover:border-indigo-700/60 transition-all cursor-pointer"
                title={a.summary || a.url || a.stage}
              >
                <FileText className="w-3 h-3" />
                <span>{stageLabel(a.stage)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* 失败：原因 + 重试 */
  if (task.status === 'failed') {
    return (
      <div className="mt-2.5 pt-2.5 border-t border-red-900/50 whitespace-normal">
        <div className="flex items-center gap-1.5 mb-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span className="text-[11px] font-bold text-red-300 truncate">执行失败：{task.title}</span>
          <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-mono bg-red-500/15 text-red-400 border border-red-500/30 shrink-0">
            FAILED
          </span>
        </div>
        <p className="text-[11px] text-red-300/80 leading-relaxed font-mono mb-2 line-clamp-2">
          {task.error || task.progress?.note || '任务未成功完成，建议重试或调整对话诉求'}
        </p>
        <button
          type="button"
          onClick={() => onRetry(task.taskId)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-red-600 hover:bg-red-500 text-white transition-all shadow-sm active:scale-95 cursor-pointer"
        >
          <RotateCw className="w-3.5 h-3.5" />
          <span>重新推演本任务</span>
        </button>
      </div>
    );
  }

  /* 已取消 */
  return (
    <div className="mt-2.5 pt-2.5 border-t border-slate-700/60 whitespace-normal">
      <div className="flex items-center gap-1.5">
        <XCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        <span className="text-[11px] text-slate-400 truncate">已取消：{task.title}</span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 4. 子组件：底部输入表单与人在回路待审开工按钮
 * ══════════════════════════════════════════════════════════════════════════════ */

/* ─── 待确认卡片：改动影响面 ───
 * 数据来自后端 Task.payload.impact（血缘图算出来的，不是模型猜的）。
 * 只做展示，不参与审批逻辑；缺字段时整块不渲染，老任务零影响。
 */

interface TaskImpactPreview {
  summary: string;
  targets: string[];
  granularity: 'shot' | 'node';
  incomplete: boolean;
  counts: { scenes: number; shots: number; keyframes: number; clips: number };
  samples: Array<{ id: string; chain: string[] }>;
  missing: string[];
}

function readTaskImpact(task?: TaskItem): TaskImpactPreview | null {
  const raw = task?.payload?.impact;
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.summary !== 'string' || !raw.counts) return null;
  return raw as TaskImpactPreview;
}

function ImpactNotice({ impact }: { impact: TaskImpactPreview }) {
  const [open, setOpen] = useState(false);
  const c = impact.counts || { scenes: 0, shots: 0, keyframes: 0, clips: 0 };
  const hasAssets = (c.shots || 0) + (c.keyframes || 0) + (c.clips || 0) > 0;
  const tone = hasAssets
    ? 'border-amber-500/25 bg-amber-500/5 text-amber-100/90'
    : 'border-slate-700/60 bg-slate-800/40 text-slate-300';

  return (
    <div className={`mb-2 rounded-lg border px-3 py-2 ${tone}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-left cursor-pointer"
      >
        {hasAssets ? (
          <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0" />
        ) : (
          <Brain className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        )}
        <span className="flex-1 text-[11px] leading-relaxed">{impact.summary}</span>
        {(impact.samples?.length || 0) > 0 && (
          <ChevronDown
            className={`w-3.5 h-3.5 shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {open && (
        <div className="mt-2 pt-2 border-t border-slate-700/50 space-y-2">
          {impact.targets?.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-slate-400">识别到改动对象</span>
              {impact.targets.map((t) => (
                <span key={t} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-500/15 text-indigo-200 border border-indigo-500/25">
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-4 gap-1.5">
            {([
              ['场次', c.scenes],
              ['镜头', c.shots],
              ['首帧图', c.keyframes],
              ['视频片段', c.clips],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded bg-slate-950/50 border border-slate-700/40 px-2 py-1.5 text-center">
                <div className="text-[13px] font-bold font-mono text-slate-100">{value || 0}</div>
                <div className="text-[9px] text-slate-500">{label}</div>
              </div>
            ))}
          </div>

          {impact.samples?.length > 0 && (
            <div className="space-y-0.5">
              {impact.samples.map((s, i) => (
                <div key={`${s.id}_${i}`} className="text-[10px] font-mono text-slate-400 truncate" title={s.chain?.join(' ← ')}>
                  <span className="text-slate-200">{s.id}</span>
                  <span className="opacity-60"> ← {s.chain?.slice(1).join(' ← ')}</span>
                </div>
              ))}
            </div>
          )}

          <p className="text-[10px] text-slate-500 leading-relaxed">
            依据产物血缘图推算，仅提示，不会自动重渲。
            {impact.granularity === 'node' && ' 当前按剧情节点粗算，可能多算几段。'}
            {impact.incomplete && impact.missing?.length > 0 && ` 部分产物尚未生成（${impact.missing.slice(0, 2).join('、')}），结果可能不完整。`}
          </p>
        </div>
      )}
    </div>
  );
}

interface ChatInputBarProps {
  inputText: string;
  setInputText: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isGenerating: boolean;
  pendingTask?: TaskItem;
  onApproveTask: (taskId: string) => void;
}

function ChatInputBar({
  inputText,
  setInputText,
  onSubmit,
  isGenerating,
  pendingTask,
  onApproveTask,
}: ChatInputBarProps) {
  const impact = readTaskImpact(pendingTask);
  return (
    <div className="p-4 border-t border-slate-800 bg-slate-900 shrink-0">
      {impact && <ImpactNotice impact={impact} />}
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={
            isGenerating ? 'AI 导演正在制作推演中，请稍候...' : '输入对话指令、靶向改写要求或新的影视创意...'
          }
          disabled={isGenerating}
          className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors shadow-inner disabled:opacity-50 disabled:cursor-not-allowed"
        />

        {/* 未开始任务（待确认）：一键批准启动 */}
        {pendingTask && (
          <button
            type="button"
            onClick={() => onApproveTask(pendingTask.taskId)}
            disabled={isGenerating}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-1.5 cursor-pointer shrink-0 animate-pulse active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span className="max-w-[220px] truncate">{pendingTask.title || '批准并启动'}</span>
          </button>
        )}

        <button
          type="submit"
          disabled={!inputText.trim() || isGenerating}
          className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-all shadow-md shadow-indigo-600/30 cursor-pointer flex items-center justify-center shrink-0"
        >
          {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </form>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 5. 主座舱容器：ChatPanel（纯投影视图，自身不维护任何任务状态）
 * ══════════════════════════════════════════════════════════════════════════════ */

interface ChatPanelProps {
  messages: ChatMessageItem[];
  /** 任务仓库快照：唯一状态来源，气泡按 message.taskId 从这里取 */
  tasks: Record<string, TaskItem>;
  artifacts: Record<string, any>;
  onSendMessage: (text: string) => void;
  onApproveTask: (taskId: string, overrides?: Record<string, any>) => void;
  onRetryTask: (taskId: string) => void;
  onOpenArtifact?: (stage: string) => void;
  onTriggerCriticReview?: () => void;
  onCriticDialog?: (message: string) => Promise<any>;
  isRunning: boolean;
  /** SSE 流式打字中：只驱动末尾光标；任务执行中（isRunning）不算，否则正文输出完后光标常驻 */
  isStreaming?: boolean;
  projectStatus?: string;
  currentStage?: string;
  cinematicOverrides: Record<string, CinematicParams>;
  onChangeCinematicOverride: (taskId: string, params: CinematicParams) => void;
}

export default function ChatPanel({
  messages,
  tasks,
  artifacts,
  onSendMessage,
  onApproveTask,
  onRetryTask,
  onOpenArtifact,
  onTriggerCriticReview,
  onCriticDialog,
  isRunning,
  isStreaming = false,
  projectStatus = 'idle',
  cinematicOverrides,
}: ChatPanelProps) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef<boolean>(true);

  // 1. 全局工程生命周期（任务仓库里的 running 也计入，避免刷新后按钮可点）
  const taskList = Object.values(tasks);
  const runningTask = taskList.find((t) => t.status === 'running');
  const pendingTask = taskList
    .filter((t) => t.status === 'proposed')
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .pop();
  const isGenerating = projectStatus === 'running' || isRunning || Boolean(runningTask);

  // 2. 同一任务可能被多条气泡引用（意图轮 + 审批轮），任务面板只挂在最后一条上
  const lastRefIdx = new Map<string, number>();
  messages.forEach((m, i) => {
    if (m.taskId) lastRefIdx.set(m.taskId, i);
  });

  // 3. 智能吸底滚动控制
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceToBottom < 80;
  };

  const scrollToBottom = (force = false) => {
    if (force || isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (isAtBottomRef.current) scrollToBottom();
  }, [messages, tasks]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isGenerating) return;
    onSendMessage(inputText.trim());
    setInputText('');
    isAtBottomRef.current = true;
    setTimeout(() => scrollToBottom(true), 50);
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200 overflow-hidden relative">
      {/* 消息滚动流 */}
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.map((m, idx) => {
          const isUser = m.sender === 'user';
          const task = m.taskId ? tasks[m.taskId] : undefined;
          const isTaskOwner = Boolean(m.taskId) && lastRefIdx.get(m.taskId!) === idx;
          const isLastMessage = idx === messages.length - 1;

          // 气泡正文：有正文用正文；仅挂任务而正文缺省时补一句承接文案
          const bubbleText = isUser
            ? m.content
            : m.content?.trim()
              ? m.content.trimStart()
              : task
                ? `已为您生成任务【${task.title}】。${task.status === 'proposed' ? '请在下方确认后授权执行。' : ''}`
                : '';

          const showBubble = Boolean(bubbleText) || (!isUser && isTaskOwner && Boolean(task));
          const isThinking = !isUser && isLastMessage && !m.content && !task && isGenerating;

          return (
            <div key={m.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-full`}>
              {/* 用户 / 智能体 角色小标 */}
              <div className="flex items-center gap-2 mb-1 text-[11px] text-slate-400 font-medium">
                {isUser ? (
                  <>
                    <span>创作者</span>
                    <div className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300">
                      <User className="w-3 h-3" />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-white">
                      <Bot className="w-3 h-3" />
                    </div>
                    <span>{m.senderName || 'AI 导演总制片'}</span>
                  </>
                )}
              </div>

              {/* 思考中态（尚未吐出正文且无任务时） */}
              {isThinking && (
                <div className="w-full max-w-2xl mb-2">
                  {m.thought ? (
                    <DirectorThoughtBlock thought={m.thought} isLive={isRunning} />
                  ) : (
                    <div className="inline-flex items-center gap-2 py-1 text-xs text-slate-400 select-none">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                      <span className="font-medium text-slate-400">thinking...</span>
                    </div>
                  )}
                </div>
              )}

              {/* 单气泡：导演回复 + 任务面板（未开始 / 进度 / 成果 / 失败同处一泡） */}
              {showBubble && (
                <div
                  className={`p-3.5 rounded-2xl text-xs leading-relaxed max-w-2xl whitespace-pre-wrap shadow-md ${
                    isUser ? 'bg-indigo-600 text-white' : 'bg-slate-900 border border-slate-800 text-slate-200'
                  }`}
                >
                  {bubbleText}
                  {!isUser && isLastMessage && isStreaming && (
                    <span className="inline-block w-1.5 h-3.5 ml-1 bg-indigo-400 animate-pulse align-middle" />
                  )}

                  {/* 待审（proposed）卡不进气泡：已常驻底部审批区；执行中/成果/失败仍同泡展示 */}
                  {!isUser && isTaskOwner && task && task.status !== 'proposed' && (
                    <InlineTaskPanel
                      task={task}
                      onApprove={(taskId) => onApproveTask(taskId, cinematicOverrides[taskId])}
                      onRetry={onRetryTask}
                      onOpenArtifact={onOpenArtifact}
                    />
                  )}
                </div>
              )}

              {/* 当已产生正文且有思考草稿时，放在正文后面 */}
              {!isUser && m.thought && m.content && (
                <div className="w-full max-w-2xl mt-1.5">
                  <DirectorThoughtBlock thought={m.thought} isLive={isRunning && isLastMessage} />
                </div>
              )}

              {/* 首页默认灵感提示 */}
              {idx === 0 && !isUser && messages.length === 1 && !isGenerating && (
                <div className="mt-3 flex flex-wrap gap-2 max-w-2xl">
                  <div className="w-full flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-0.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    <span>灵感推荐（点击快速开启创意思维）：</span>
                  </div>
                  {QUICK_INSPIRATIONS.map((insp, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onSendMessage(insp)}
                      className="text-[11px] px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-indigo-950/80 text-slate-300 hover:text-indigo-200 border border-slate-800 hover:border-indigo-700/60 transition-all cursor-pointer text-left shadow-sm flex items-center gap-1.5"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500/60" />
                      <span>{insp}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* 审查官质检报告卡片 */}
        {artifacts['critic_review'] && (
          <div className="w-full max-w-2xl">
            <CriticAuditCard
              criticReport={artifacts['critic_review']}
              onTriggerCriticReview={onTriggerCriticReview}
              onCriticDialog={onCriticDialog}
            />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 底部输入与操作栏 */}
      <ChatInputBar
        inputText={inputText}
        setInputText={setInputText}
        onSubmit={handleSubmit}
        isGenerating={isGenerating}
        pendingTask={pendingTask}
        onApproveTask={(taskId) => onApproveTask(taskId, cinematicOverrides[taskId])}
      />
    </div>
  );
}
