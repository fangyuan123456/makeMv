import { useState, useRef, useEffect } from 'react';
import {
  Send,
  Sparkles,
  Bot,
  User,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronUp,
  Brain,
  Play,
  XCircle,
} from 'lucide-react';
import { ChatMessageItem, ActionProposal } from './studio.types';
import CriticAuditCard from './CriticAuditCard';
import { CinematicControls, type CinematicParams } from '../CinematicControls';

const SKILL_DISPLAY_MAP: Record<string, string> = {
  'story-bible': '故事世界观圣经 (StoryBible)',
  'character-portrait': '核心角色定妆照 (CharacterPortrait)',
  'scene-script': '分场多分支剧本 (SceneScript)',
  'storyboard': '导演视听分镜头 (Storyboard)',
  'keyframe-reference': '分镜基准参考图 (KeyframeReference)',
  'video-production': '动态视频切片 (VideoProduction)',
  'fmv-packaging': '影游母带封包 (FMVPackaging)',
  'critic-review': '独立审查官质检 (CriticReview)',
};

const QUICK_INSPIRATIONS = [
  '赛博朋克悬疑，记忆神偷潜入脑机财阀调查意识篡改案',
  '暴雨孤立客栈，十位旅人午夜遭遇连环命案找真凶',
  '硬科幻惊悚，废弃科考舰遭遇深空异变与失控AI',
  '都市奇幻，平民职员觉醒五分钟时空回溯逆袭商战',
];

function DirectorThoughtBlock({ thought, isLive }: { thought: string; isLive?: boolean }) {
  const [isOpen, setIsOpen] = useState(isLive ?? false);

  useEffect(() => {
    if (isLive) setIsOpen(true);
  }, [isLive]);

  return (
    <div className="mb-3 rounded-xl bg-slate-900 border border-slate-800 overflow-hidden text-slate-200 shadow-md">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-1.5 flex items-center justify-between text-[11px] font-bold text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-1.5">
          <Brain className={`w-3.5 h-3.5 text-indigo-400 ${isLive ? 'animate-pulse' : ''}`} />
          <span>导演构思推演 {isLive ? '(推演中...)' : ''}</span>
        </span>
        <span className="flex items-center gap-1 text-[10px] text-slate-500 font-normal">
          <span>{isOpen ? '收起' : '展开'}</span>
          {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </span>
      </button>
      {isOpen && (
        <div className="px-3 pb-2.5 pt-1 border-t border-slate-800 bg-black/40">
          <div className="text-[11px] leading-relaxed text-slate-300 pl-2.5 border-l-2 border-indigo-500 font-mono whitespace-pre-wrap max-h-56 overflow-y-auto">
            {thought}
          </div>
        </div>
      )}
    </div>
  );
}

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
  currentStage?: string;
  cinematicOverrides: Record<string, CinematicParams>;
  onChangeCinematicOverride: (actionId: string, params: CinematicParams) => void;
}

export default function ChatPanel({
  messages,
  artifacts,
  onSendMessage,
  onExecuteProposal,
  onDismissProposal,
  onTriggerCriticReview,
  onCriticDialog,
  isRunning,
  cinematicOverrides,
  onChangeCinematicOverride,
}: ChatPanelProps) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isRunning) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200 overflow-hidden relative">
      {/* 消息滚动流 */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.map((m) => {
          const isUser = m.sender === 'user';
          const proposal = m.actionProposal;
          // D2: 纯粹基于 kebab 命名的 skill 判定，消灭脆弱的 label 模糊匹配
          const isCinematicProposal = proposal?.skill === 'video-production' || proposal?.skill === 'storyboard';
          const isCriticFail =
            proposal?.status === 'executed' &&
            (proposal?.skill === 'critic-review' || proposal?.isGateIntercept) &&
            (proposal?.resultSummary?.includes('FAIL') || proposal?.lastMessage?.includes('FAIL'));

          return (
            <div
              key={m.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-full`}
            >
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

              {/* 思考流展示 */}
              {!isUser && m.thought && (
                <div className="w-full max-w-2xl">
                  <DirectorThoughtBlock thought={m.thought} />
                </div>
              )}

              {/* 正文气泡 */}
              {m.content && (
                <div
                  className={`p-3.5 rounded-2xl text-xs leading-relaxed max-w-2xl whitespace-pre-wrap shadow-md ${
                    isUser
                      ? 'bg-indigo-600 text-white rounded-tr-xs'
                      : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-xs'
                  }`}
                >
                  {m.content}
                </div>
              )}

              {/* 待确认行动提案卡片 */}
              {proposal && (
                <div
                  className={`w-full max-w-2xl mt-3 p-4 rounded-2xl bg-slate-900 border shadow-xl space-y-3 ${
                    isCriticFail ? 'border-rose-800/90 shadow-rose-950/20' : 'border-indigo-900/60'
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-2.5 h-2.5 rounded-full ${
                          isCriticFail ? 'bg-rose-500' : 'bg-indigo-500 animate-pulse'
                        }`}
                      />
                      <span className="text-xs font-bold text-slate-100">{proposal.label}</span>
                      {proposal.skill && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">
                          {SKILL_DISPLAY_MAP[proposal.skill] || proposal.skill}
                        </span>
                      )}
                    </div>

                    <div>
                      {proposal.status === 'pending' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                          待确认
                        </span>
                      )}
                      {proposal.status === 'running' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>执行中</span>
                        </span>
                      )}
                      {proposal.status === 'executed' && (
                        isCriticFail ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-800 flex items-center gap-1">
                            <XCircle className="w-3 h-3 text-rose-400" />
                            <span>执行完成 · 门禁 FAIL</span>
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            <span>已执行</span>
                          </span>
                        )
                      )}
                      {proposal.status === 'failed' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-800 flex items-center gap-1">
                          <XCircle className="w-3 h-3" />
                          <span>执行异常</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {proposal.description && (
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {proposal.description}
                    </p>
                  )}

                  {/* 细粒度执行进度反馈 */}
                  {proposal.status === 'running' && proposal.lastMessage && (
                    <div className="p-2.5 rounded-xl bg-indigo-950/40 border border-indigo-800/80 text-[11px] font-mono text-indigo-200 flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400 shrink-0" />
                      <span>{proposal.lastMessage}</span>
                    </div>
                  )}

                  {/* 运镜轨迹与动量控制台 (仅在分镜与视频工序卡片展示) */}
                  {isCinematicProposal && proposal.status === 'pending' && (
                    <div className="pt-2">
                      <CinematicControls
                        value={cinematicOverrides[proposal.actionId]}
                        onChange={(params) => onChangeCinematicOverride(proposal.actionId, params)}
                        disabled={isRunning}
                      />
                    </div>
                  )}

                  {/* 结果摘要 */}
                  {proposal.resultSummary && (
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300">
                      <strong>执行结论：</strong> {proposal.resultSummary}
                    </div>
                  )}

                  {/* 操作按钮组 */}
                  {proposal.status === 'pending' && (
                    <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
                      <button
                        onClick={() => onDismissProposal(proposal.actionId)}
                        disabled={isRunning}
                        className="px-3 py-1.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs font-medium transition-colors cursor-pointer"
                      >
                        暂不推进
                      </button>
                      <button
                        onClick={() => onExecuteProposal(proposal, cinematicOverrides[proposal.actionId])}
                        disabled={isRunning}
                        className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>批准并启动</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* 审查官质检卡片 (若当前有审查报告) */}
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

      {/* 快捷灵感推荐 (在对话初期展示) */}
      {messages.length <= 2 && (
        <div className="px-5 py-2 flex items-center gap-2 overflow-x-auto border-t border-slate-800/80 bg-slate-900/60 shrink-0">
          <span className="text-[11px] text-slate-500 shrink-0 flex items-center gap-1 font-bold">
            <Sparkles className="w-3 h-3 text-indigo-400" />
            灵感提示:
          </span>
          {QUICK_INSPIRATIONS.map((insp, idx) => (
            <button
              key={idx}
              onClick={() => onSendMessage(insp)}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 whitespace-nowrap cursor-pointer transition-colors"
            >
              {insp}
            </button>
          ))}
        </div>
      )}

      {/* 底部输入框 */}
      <div className="p-4 border-t border-slate-800 bg-slate-900 shrink-0">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="输入对话指令、靶向改写要求或新的影视创意..."
            disabled={isRunning}
            className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 outline-none focus:border-indigo-500 transition-colors shadow-inner"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isRunning}
            className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white transition-all shadow-md shadow-indigo-600/30 cursor-pointer flex items-center justify-center shrink-0"
          >
            {isRunning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
