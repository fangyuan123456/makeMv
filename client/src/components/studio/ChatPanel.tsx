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
  XCircle,
  AlertTriangle,
  RotateCw,
} from 'lucide-react';
import { ChatMessageItem, ActionProposal } from './studio.types';
import CriticAuditCard from './CriticAuditCard';
import { type CinematicParams } from '../CinematicControls';

/* ─── 常量定义 ─── */

const QUICK_INSPIRATIONS = [
  '赛博朋克悬疑，记忆神偷潜入脑机财阀调查意识篡改案',
  '暴雨孤立客栈，十位旅人午夜遭遇连环命案找真凶',
  '硬科幻惊悚，废弃科考舰遭遇深空异变与失控AI',
  '都市奇幻，平民职员觉醒五分钟时空回溯逆袭商战',
];

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
 * 2. 子组件：影视工序推演进度看板 (加粗科技感进度条)
 * ══════════════════════════════════════════════════════════════════════════════ */

interface StageProgressCardProps {
  proposal?: ActionProposal;
}

function StageProgressCard({ proposal }: StageProgressCardProps) {
  const progress = proposal?.progress;
  const percent = Math.min(100, Math.max(5, progress?.percent ?? 10));
  const stepLabel =
    progress && progress.total > 1 && progress.total <= 20 && progress.current > 0
      ? `第 ${progress.current}/${progress.total} 步 · ${percent}%`
      : `${percent}%`;

  return (
    <div className="w-full max-w-xl my-1 p-4 rounded-2xl bg-gradient-to-br from-slate-900/90 via-indigo-950/40 to-slate-900/90 border border-indigo-900/60 shadow-xl shadow-indigo-950/20 backdrop-blur-sm relative overflow-hidden group">
      <div className="absolute -right-8 -top-8 w-28 h-28 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none group-hover:bg-indigo-500/20 transition-all duration-700" />
      <div className="flex items-start gap-3.5 relative z-10">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border bg-indigo-950/80 border-indigo-500/50 text-indigo-400 shadow-md shadow-indigo-500/20 animate-pulse">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-bold text-slate-100 tracking-wide truncate">
              {`【${proposal?.label || '核心影视工序'}】正在全自动推演中`}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 animate-pulse shrink-0">
              RUNNING
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 mb-1.5">
            <p className="text-[11px] text-slate-400 leading-relaxed font-mono truncate flex-1 min-w-0">
              {proposal?.lastMessage || '正在调度 Mastra 影视微内核流水线，资产将直接在右侧视窗实时就绪...'}
            </p>
            <span className="text-[11px] font-mono text-indigo-300 font-semibold shrink-0">
              {stepLabel}
            </span>
          </div>

          <div className="w-full h-2.5 bg-slate-950/80 rounded-full border border-slate-800/80 overflow-hidden p-0.5 shadow-inner">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-400 rounded-full transition-all duration-500 ease-out shadow-[0_0_8px_rgba(99,102,241,0.5)]"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 3. 子组件：工序推演失败警示看板 (错误原因显性化 + 一键重新推演)
 * ══════════════════════════════════════════════════════════════════════════════ */

interface StageFailureCardProps {
  proposal?: ActionProposal;
  onRetry: () => void;
}

function StageFailureCard({ proposal, onRetry }: StageFailureCardProps) {
  return (
    <div className="w-full max-w-xl my-1 p-4 rounded-2xl bg-gradient-to-br from-slate-900/90 via-red-950/30 to-slate-900/90 border border-red-500/40 shadow-xl shadow-red-950/20 backdrop-blur-sm relative overflow-hidden group">
      <div className="flex items-start gap-3.5 relative z-10">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border bg-red-950/80 border-red-500/50 text-red-400 shadow-md shadow-red-500/20">
          <AlertTriangle className="w-5 h-5 text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-xs font-bold text-slate-100 tracking-wide truncate">
              {`【${proposal?.label || '影视工序'}】推演遇到异常`}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-red-500/20 text-red-400 border border-red-500/30 shrink-0">
              FAILED
            </span>
          </div>
          <p className="text-[11px] text-red-300/80 leading-relaxed font-mono mb-3 line-clamp-2">
            {proposal?.error || proposal?.lastMessage || '工序推演未成功完成，建议点击重试或调整对话诉求'}
          </p>
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-500 text-white transition-all shadow-sm active:scale-95 cursor-pointer"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>重新推演本工序</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 4. 子组件：底部输入表单与人在回路待审开工按钮
 * ══════════════════════════════════════════════════════════════════════════════ */

interface ChatInputBarProps {
  inputText: string;
  setInputText: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isGenerating: boolean;
  pendingProposal?: ActionProposal;
  onExecuteProposal: (proposal: ActionProposal) => void;
}

function ChatInputBar({
  inputText,
  setInputText,
  onSubmit,
  isGenerating,
  pendingProposal,
  onExecuteProposal,
}: ChatInputBarProps) {
  return (
    <div className="p-4 border-t border-slate-800 bg-slate-900 shrink-0">
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={
            isGenerating
              ? 'AI 导演正在制作推演中，请稍候...'
              : '输入对话指令、靶向改写要求或新的影视创意...'
          }
          disabled={isGenerating}
          className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors shadow-inner disabled:opacity-50 disabled:cursor-not-allowed"
        />

        {/* 人在回路待审按钮 (仅在 pending 待确认时展示，一旦确认开工立即消失) */}
        {pendingProposal && (
          <button
            type="button"
            onClick={() => onExecuteProposal(pendingProposal)}
            disabled={isGenerating}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-1.5 cursor-pointer shrink-0 animate-pulse active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{pendingProposal.label || '批准并启动'}</span>
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
 * 5. 主座舱容器：ChatPanel (精简高内聚主界面)
 * ══════════════════════════════════════════════════════════════════════════════ */

interface ChatPanelProps {
  messages: ChatMessageItem[];
  sessionId: string | null;
  artifacts: Record<string, any>;
  onSendMessage: (text: string) => void;
  onExecuteProposal: (proposal: ActionProposal, overrides?: Record<string, any>) => void;
  onDismissProposal: (actionId: string) => void;
  onTriggerCriticReview?: () => void;
  onCriticDialog?: (message: string) => Promise<any>;
  isRunning: boolean;
  projectStatus?: string;
  currentStage?: string;
  cinematicOverrides: Record<string, CinematicParams>;
  onChangeCinematicOverride: (actionId: string, params: CinematicParams) => void;
}

export default function ChatPanel({
  messages,
  artifacts,
  onSendMessage,
  onExecuteProposal,
  onTriggerCriticReview,
  onCriticDialog,
  isRunning,
  projectStatus = 'idle',
  cinematicOverrides,
}: ChatPanelProps) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef<boolean>(true);

  // 1. 全局工程生命周期状态 (SSOT)
  const isGenerating = projectStatus === 'running' || isRunning;

  // 2. 找到最后一条由开工触发的消息索引
  let lastApproveIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.sender !== 'user' && msg.isExecutionTrigger) {
      lastApproveIdx = i;
      break;
    }
  }

  // 3. 提取最新活跃提案
  const activeProposal = [...messages]
    .reverse()
    .map((m) => m.actionProposal)
    .find((p) => p && (p.status === 'pending' || p.status === 'running'));

  const pendingProposal = activeProposal?.status === 'pending' ? activeProposal : undefined;

  // 4. 智能吸底滚动控制
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
  }, [messages]);

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
          const isApproveMessage = Boolean(!isUser && m.isExecutionTrigger);

          const proposal = m.actionProposal;
          const liveProposal =
            proposal && activeProposal && activeProposal.actionId === proposal.actionId
              ? activeProposal
              : proposal;

          const isFailedProposal = isApproveMessage && liveProposal?.status === 'failed';
          const isRunningProposal =
            isApproveMessage && (isGenerating || liveProposal?.status === 'running') && idx === lastApproveIdx;
          const isStageExecution = isRunningProposal;

          // 成功执行后的开工卡片退场，避免冗余占屏
          if (isApproveMessage && !isFailedProposal && !isRunningProposal) {
            return null;
          }

          const isCriticFail =
            liveProposal?.status === 'executed' &&
            (liveProposal?.skill === 'critic-review' || liveProposal?.isGateIntercept) &&
            (liveProposal?.resultSummary?.includes('FAIL') || liveProposal?.lastMessage?.includes('FAIL'));

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

              {/* 思考中态（尚未吐出正文且未执行时） */}
              {!isUser && !isStageExecution && idx === messages.length - 1 && !m.content && (!m.actionProposal || isRunning) && (
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

              {/* 核心卡片分支：失败看板 / 执行进度看板 / 正常气泡 */}
              {!isUser && isFailedProposal ? (
                <StageFailureCard
                  proposal={liveProposal}
                  onRetry={() => liveProposal && onExecuteProposal(liveProposal)}
                />
              ) : !isUser && isStageExecution ? (
                <StageProgressCard proposal={liveProposal || activeProposal} />
              ) : (
                (m.content || (m.actionProposal && !isRunning)) && (
                  <div
                    className={`p-3.5 rounded-2xl text-xs leading-relaxed max-w-2xl whitespace-pre-wrap shadow-md ${
                      isUser ? 'bg-indigo-600 text-white' : 'bg-slate-900 border border-slate-800 text-slate-200'
                    }`}
                  >
                    {m.content
                      ? m.content.trimStart()
                      : `收到微调指示！已为您生成工序调整方案：${m.actionProposal?.description || m.actionProposal?.label}。请点击下方按钮（或回复“同意”）授权执行。`}
                    {!isUser && isRunning && idx === messages.length - 1 && (
                      <span className="inline-block w-1.5 h-3.5 ml-1 bg-indigo-400 animate-pulse align-middle" />
                    )}
                  </div>
                )
              )}

              {/* 当已产生正文且有思考草稿时，放在正文后面 */}
              {!isUser && !isStageExecution && m.thought && m.content && (
                <div className="w-full max-w-2xl mt-1.5">
                  <DirectorThoughtBlock thought={m.thought} isLive={isRunning && idx === messages.length - 1} />
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

              {/* 已完成提案状态极简徽章 */}
              {!isStageExecution && proposal && proposal.status === 'executed' && (
                <div className="mt-1.5 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/60 border border-slate-800 text-[11px] text-slate-400">
                  {isCriticFail ? (
                    <>
                      <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      <span className="text-rose-300">已执行 (门禁 FAIL): {proposal.label}</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>已完成工序: {proposal.label}</span>
                    </>
                  )}
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
        pendingProposal={pendingProposal}
        onExecuteProposal={(p) => onExecuteProposal(p, cinematicOverrides[p.actionId])}
      />
    </div>
  );
}
