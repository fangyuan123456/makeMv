'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Send,
  Sparkles,
  Bot,
  User,
  CheckCircle2,
  ArrowRight,
  Upload,
  Image as ImageIcon,
  Loader2,
  GitBranch,
  Film,
  Users,
  Gamepad2,
  ChevronDown,
  ChevronUp,
  Terminal,
  BookOpen,
  Zap,
  Maximize2,
  X,
  Copy,
  Check,
  Search,
  Briefcase,
  Flame,
  ShieldCheck,
  Swords,
  Heart,
  Clock,
  MessageSquare,
  Edit3,
  RotateCcw,
  Sliders,
} from 'lucide-react';
import { ChatMessageItem } from './studio.types';
import { assetUrl } from '../stages/utils';
import AuditModal from './AuditModal';
import InteractiveTopologyCanvas from '../stages/InteractiveTopologyCanvas';

interface ChatPanelProps {
  messages: ChatMessageItem[];
  sessionId: string | null;
  artifacts: Record<string, any>;
  onSendMessage: (text: string) => void;
  onConfirmNext: () => void;
  onTriggerCharacterGen: (characterIds: string[]) => void;
  onRegenerateSingleCharacter?: (
    charId: string,
    instruction?: string,
    baseVersion?: string,
    editedPrompt?: string
  ) => Promise<void>;
  onSelectCharacterVersion?: (charId: string, versionUrl: string) => Promise<void>;
  onUploadCharacterImage: (charId: string, type: 'final' | 'reference', file: File) => Promise<void>;
  isWaitingForConfirmation: boolean;
  isRunning: boolean;
  currentStage?: string;
}

const STAGE_RUNNING_CONFIG: Record<string, { role: string; steps: string[] }> = {
  narrative_design: {
    role: 'AI 叙事制作人',
    steps: [
      '💡 正在结合您的创意，提炼起承转合四幕黄金主干剧本原案...',
      '⚡ 正在设计沉浸式点触搜证、拟真通讯与三大戏剧分水岭...',
      '🕸️ 正在编译 10 节点双轨网状拓扑图并进行死锁安全拓扑质检...',
      '🎭 正在为 4 位核心角色生成详细小传与 8K 视觉定妆提示词...',
      '📦 正在聚合 5 套阶段规范交付物，即将呈现在右侧视窗...',
    ],
  },
  character_design: {
    role: 'AI 角色视觉总监',
    steps: [
      '🎨 正在解析角色外貌特征与性格弧光，规划定妆三视图...',
      '✨ 正在调用高质量图像生成管线渲染 8K 电影级定妆图...',
      '🔍 正在进行角色面部特征与风格一致性对比与质检...',
    ],
  },
  scene_script: {
    role: 'AI 剧本总监',
    steps: [
      '✍️ 正在精细化编写 10 个互动节点的逐场剧本与双轨对白...',
      '⚔️ 正在注入分支抉择关键台词与好感度升降判定逻辑...',
    ],
  },
  storyboard: {
    role: 'AI 视觉分镜师',
    steps: [
      '📐 正在切分镜头视听语言、机位运动与景别比例...',
      '🎬 正在生成电影级分镜关键帧画面与光影质感预演...',
    ],
  },
  video_production: {
    role: 'AI 视频渲染引擎',
    steps: [
      '🎥 正在分批渲染各节点的动态高清视频切片...',
      '🎙️ 正在对齐角色 TTS 语音对白并合成背景音效...',
    ],
  },
};

const QUICK_INSPIRATIONS = [
  '赛博朋克悬疑，记忆神偷潜入脑机财阀调查意识篡改案',
  '暴雨孤立客栈，十位旅人午夜遭遇连环命案找真凶',
  '硬科幻惊悚，废弃科考舰遭遇深空异变与失控AI',
  '都市奇幻，平民职员觉醒五分钟时空回溯逆袭商战',
];

export default function ChatPanel({
  messages,
  sessionId,
  artifacts,
  onSendMessage,
  onConfirmNext,
  onTriggerCharacterGen,
  onRegenerateSingleCharacter,
  onSelectCharacterVersion,
  onUploadCharacterImage,
  isWaitingForConfirmation,
  isRunning,
  currentStage,
}: ChatPanelProps) {
  const [inputText, setInputText] = useState('');
  const [expandedNodes, setExpandedNodes] = useState(false);
  const [uploadingCharId, setUploadingCharId] = useState<string | null>(null);
  const [generatingCharId, setGeneratingCharId] = useState<string | null>(null);
  const [refiningCharId, setRefiningCharId] = useState<string | null>(null);
  const [refinementTexts, setRefinementTexts] = useState<Record<string, string>>({});
  const [editingPrompts, setEditingPrompts] = useState<Record<string, string>>({});
  const [selectedVersionOverrides, setSelectedVersionOverrides] = useState<Record<string, string>>({});
  const [lightboxImage, setLightboxImage] = useState<{ url: string; title: string; subtitle?: string } | null>(null);
  const [auditModalStage, setAuditModalStage] = useState<string | null>(null);
  const [runningStepIndex, setRunningStepIndex] = useState(0);

  const stageConfig = STAGE_RUNNING_CONFIG[currentStage || 'narrative_design'] || {
    role: 'AI 影游总制作人',
    steps: [
      '💡 正在结合您的创意推演互动影游制作方案，请稍候...',
      '⚡ 正在梳理多分支网络与剧情张力，即将呈现阶段产物...',
    ],
  };

  useEffect(() => {
    if (!isRunning) {
      setRunningStepIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setRunningStepIndex((prev) => (prev + 1) % stageConfig.steps.length);
    }, 3200);
    return () => clearInterval(timer);
  }, [isRunning, stageConfig.steps.length]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isUserScrolledUpRef = useRef(false);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const [showTopologyModal, setShowTopologyModal] = useState(false);
  const prevMessagesLengthRef = useRef(messages.length);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const refFileInputRef = useRef<HTMLInputElement | null>(null);

  // Esc 键快速关闭弹窗 (拓扑大图或灯箱)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showTopologyModal) setShowTopologyModal(false);
        if (lightboxImage) setLightboxImage(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showTopologyModal, lightboxImage]);
  const [activeUploadTarget, setActiveUploadTarget] = useState<{ charId: string; type: 'final' | 'reference' } | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [nodeFilter, setNodeFilter] = useState<'all' | 'decision' | 'investigation' | 'ending'>('all');

  const handleCopyPrompt = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPromptId(id);
    setTimeout(() => setCopiedPromptId(null), 2000);
  };

  // 监听用户手动滚动行为：若用户往上查看历史，不要强制打断
  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isScrolledUp = scrollHeight - scrollTop - clientHeight > 100;
    isUserScrolledUpRef.current = isScrolledUp;
    setShowScrollBottomBtn(isScrolledUp);
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior,
      });
      isUserScrolledUpRef.current = false;
      setShowScrollBottomBtn(false);
    }
  };

  // 仅在真实新增消息且用户处于贴底状态时滚动，严禁随轮询与产物刷新强制暴力跳底
  useEffect(() => {
    const isNewMessage = messages.length > prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = messages.length;

    if (isNewMessage && !isUserScrolledUpRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim() || isRunning) return;
    onSendMessage(inputText.trim());
    setInputText('');
    isUserScrolledUpRef.current = false;
    setTimeout(() => scrollToBottom('smooth'), 50);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const triggerUpload = (charId: string, type: 'final' | 'reference') => {
    setActiveUploadTarget({ charId, type });
    if (type === 'reference') {
      refFileInputRef.current?.click();
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, type: 'final' | 'reference') => {
    const file = e.target.files?.[0];
    if (!file || !activeUploadTarget) return;

    try {
      setUploadingCharId(activeUploadTarget.charId);
      await onUploadCharacterImage(activeUploadTarget.charId, type, file);
    } catch (err: any) {
      alert(`上传失败: ${err.message || '网络异常'}`);
    } finally {
      setUploadingCharId(null);
      if (e.target) e.target.value = '';
    }
  };

  // Extract stage artifacts for rich in-chat display
  const narrative = artifacts['narrative_design'];
  const characterArtifact = artifacts['character_design'];
  const characters = characterArtifact?.characters || narrative?.characters || narrative?.bible?.characters || [];
  const keyframeArtifact = artifacts['keyframe_reference'];
  const keyframes = keyframeArtifact?.keyframes || [];
  const packagerArtifact = artifacts['fmv_packaging'];

  // Determine which agent message should house each artifact card
  const agentMessages = useMemo(() => messages.filter((m) => m.sender === 'agent'), [messages]);

  const narrativeMsgId = useMemo(() => {
    if (!narrative) return null;
    const match = [...agentMessages].reverse().find(
      (m) =>
        m.stage === 'narrative_design' ||
        m.stopPoint?.stage === 'narrative_design' ||
        m.content.includes('互动叙事大纲') ||
        m.content.includes('网状拓扑') ||
        m.content.includes('故事大纲')
    );
    return match ? match.id : (agentMessages[0]?.id || null);
  }, [agentMessages, narrative]);

  const characterMsgId = useMemo(() => {
    if (!characters || characters.length === 0) return null;
    if (!characterArtifact && !messages.some((m) => m.stage === 'character_design' || m.content.includes('角色形象') || m.content.includes('定妆'))) {
      return null;
    }
    const match = [...agentMessages].reverse().find(
      (m) =>
        m.stage === 'character_design' ||
        m.stopPoint?.stage === 'character_design' ||
        m.content.includes('角色形象') ||
        m.content.includes('定妆') ||
        m.content.includes('角色设计')
    );
    return match ? match.id : null;
  }, [agentMessages, characters, characterArtifact, messages]);

  const keyframesMsgId = useMemo(() => {
    if (!keyframes || keyframes.length === 0) return null;
    const match = [...agentMessages].reverse().find(
      (m) =>
        m.stage === 'keyframe_reference' ||
        m.stage === 'storyboard' ||
        m.stopPoint?.stage === 'keyframe_reference' ||
        m.content.includes('关键帧') ||
        m.content.includes('分镜')
    );
    return match ? match.id : null;
  }, [agentMessages, keyframes]);

  const packagerMsgId = useMemo(() => {
    if (!packagerArtifact) return null;
    const match = [...agentMessages].reverse().find(
      (m) =>
        m.stage === 'fmv_packaging' ||
        m.stopPoint?.stage === 'fmv_packaging' ||
        m.content.includes('打包完成') ||
        m.content.includes('影游')
    );
    return match ? match.id : (agentMessages[agentMessages.length - 1]?.id || null);
  }, [agentMessages, packagerArtifact]);

  // Renderers for deliverable cards
  const renderNarrativeCard = () => {
    if (!narrative) return null;
    const goldenSpine = narrative.goldenSpine || narrative.bible?.goldenSpine;
    const pivotPoints = narrative.pivotPoints || narrative.bible?.pivotPoints;
    const storyTitle = narrative.title || narrative.bible?.title || '未命名互动影游';
    const genreName = narrative.genreName || narrative.bible?.genreName || '互动影游';
    const visualStyle = narrative.style || narrative.bible?.style || '电影质感';
    const theme = narrative.theme || narrative.bible?.theme || '';
    const logline = narrative.logline || narrative.bible?.logline || narrative.synopsis;
    const sellingPoints = narrative.sellingPoints || narrative.bible?.sellingPoints || [];
    const storyGraph = narrative.storyGraph || narrative.bible?.storyGraph;
    const nodes = storyGraph?.nodes || [];
    const choices = storyGraph?.choices || [];
    const validation = storyGraph?.validation;

    // Filter nodes for the explorer list
    const filteredNodes = nodes.filter((node: any) => {
      if (nodeFilter === 'decision') return node.type === 'decision' || node.type === 'qte';
      if (nodeFilter === 'investigation') return node.type === 'investigation';
      if (nodeFilter === 'ending') return node.type === 'bad_end' || node.type === 'true_end';
      return true;
    });

    return (
      <div className="mt-3 rounded-2xl p-4 bg-gradient-to-b from-slate-50 to-indigo-50/20 border border-slate-200/90 shadow-sm space-y-4">
        {/* 顶部标题与世界观定位 (Hero Title & World Setting) */}
        <div className="bg-white rounded-xl p-4 border border-slate-200/80 shadow-2xs space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                {genreName}
              </span>
              {theme && (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                  {theme}
                </span>
              )}
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" />
                黄金主干已锁定
              </span>
            </div>
            <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
              4 幕 · {nodes.length || 10} 节点 · 约 120 秒
            </span>
          </div>

          <div>
            <h3 className="text-base font-black text-slate-900 tracking-tight flex items-center gap-2">
              <Film className="w-4 h-4 text-indigo-600" />
              <span>《{storyTitle}》</span>
            </h3>
            {visualStyle && (
              <p className="text-[11px] text-slate-500 mt-0.5">
                视觉风格调性：{visualStyle}
              </p>
            )}
          </div>

          {logline && (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/60 text-xs text-slate-800 leading-relaxed">
              <strong className="text-indigo-950 font-bold mr-1.5">📖 故事核心梗概:</strong>
              <span>{logline}</span>
            </div>
          )}

          {sellingPoints.length > 0 && (
            <div className="pt-1">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Flame className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                <span>4 大互动视听核心看点</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {sellingPoints.map((point: string, idx: number) => {
                  const parts = point.split('——');
                  const pTitle = parts[0] || point;
                  const pDesc = parts[1] || '';
                  return (
                    <div
                      key={idx}
                      className="p-2.5 rounded-lg bg-amber-50/40 border border-amber-200/60 text-[11px] space-y-0.5"
                    >
                      <div className="font-bold text-amber-950 flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-amber-600 shrink-0" />
                        <span>{pTitle}</span>
                      </div>
                      {pDesc && <p className="text-slate-600 text-[10px] pl-4 leading-normal">{pDesc}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 1. 黄金主干剧本原案 (4-Act Golden Spine Arc) */}
        {goldenSpine && goldenSpine.length > 0 ? (
          <div className="p-3.5 rounded-xl bg-white border border-slate-200/80 space-y-3 shadow-2xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
                <span>四幕起承转合电影弧线 (Golden Spine)</span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">严格遵循电影三幕结构</span>
            </div>

            {/* 视觉电影节奏进程轨 (Cinematic Progression Tracker) */}
            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-lg text-center text-[10px] font-bold text-slate-600">
              <div className="py-1 px-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                [起] 危机爆发
              </div>
              <div className="py-1 px-0.5 rounded bg-blue-100 text-blue-900 border border-blue-300">
                [承] 矛盾升级
              </div>
              <div className="py-1 px-0.5 rounded bg-purple-100 text-purple-900 border border-purple-300">
                [转] 惊天反转
              </div>
              <div className="py-1 px-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300">
                [合] 巅峰决胜
              </div>
            </div>

            <div className="space-y-2 pt-1">
              {goldenSpine.map((act: any, idx: number) => {
                const actBadgeLabels = ['起', '承', '转', '合'];
                const actBadgeColors = [
                  'bg-amber-100 text-amber-800 border-amber-300',
                  'bg-blue-100 text-blue-800 border-blue-300',
                  'bg-purple-100 text-purple-800 border-purple-300',
                  'bg-emerald-100 text-emerald-800 border-emerald-300',
                ];
                const badgeText = actBadgeLabels[idx] || `${idx + 1}`;
                const badgeColor = actBadgeColors[idx] || 'bg-slate-100 text-slate-700 border-slate-200';
                return (
                  <div key={idx} className="p-3 rounded-xl bg-slate-50/70 border border-slate-200/70 text-[11px] space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center font-black text-[10px] border shadow-2xs ${badgeColor}`}>
                          {badgeText}
                        </span>
                        <div>
                          <span className="font-bold text-slate-900 text-xs">{act.name}</span>
                          {act.dramaticFunction && (
                            <span className="text-[10px] text-slate-500 ml-1.5 font-normal">
                              ({act.dramaticFunction})
                            </span>
                          )}
                        </div>
                      </div>
                      {act.targetDurationSec && (
                        <span className="text-[10px] text-slate-500 font-mono bg-white px-2 py-0.5 rounded border border-slate-200/60">
                          ⏱️ {act.targetDurationSec}s
                        </span>
                      )}
                    </div>

                    <p className="text-slate-600 leading-relaxed pl-7 text-[11px]">
                      {act.summary}
                    </p>

                    {(act.coreConflict || act.cliffhanger) && (
                      <div className="pl-7 pt-1 space-y-1 text-[10px]">
                        {act.coreConflict && (
                          <div className="bg-white p-2 rounded-lg border border-slate-200/60 flex items-start gap-1.5 text-slate-600">
                            <Swords className="w-3 h-3 text-indigo-600 shrink-0 mt-0.5" />
                            <div>
                              <strong className="font-bold text-indigo-950 mr-1">核心冲突:</strong>
                              <span>{act.coreConflict}</span>
                            </div>
                          </div>
                        )}
                        {act.cliffhanger && (
                          <div className="bg-amber-50/70 p-2 rounded-lg border border-amber-200/60 flex items-start gap-1.5 text-amber-900">
                            <Zap className="w-3 h-3 text-amber-600 shrink-0 mt-0.5 fill-amber-500" />
                            <div>
                              <strong className="font-bold text-amber-950 mr-1">卡点悬念:</strong>
                              <span>{act.cliffhanger}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-700 leading-relaxed bg-white p-3 rounded-lg border border-slate-200/60 shadow-2xs">
            {narrative.synopsis || narrative.bible?.synopsis || narrative.logline || '故事圣经大纲已构筑完成。'}
          </p>
        )}

        {/* 2. 核心登场人物小传速览 (4 位角色 2x2 网格) */}
        {characters && characters.length > 0 && (
          <div className="p-3.5 rounded-xl bg-purple-50/30 border border-purple-200/70 space-y-3 shadow-2xs">
            <div className="flex items-center justify-between border-b border-purple-150 pb-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-purple-950">
                <Users className="w-4 h-4 text-purple-600" />
                <span>核心登场人物档案 ({characters.length} 位角色)</span>
              </div>
              <span className="text-[10px] text-purple-700 bg-white px-2 py-0.5 rounded-full border border-purple-200 font-medium">
                8K 视觉定妆已对齐
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {characters.map((c: any, idx: number) => {
                const roleBadge =
                  idx === 0
                    ? { label: '主角/玩家视角', color: 'bg-indigo-100 text-indigo-800 border-indigo-200' }
                    : idx === 1
                    ? { label: '核心同盟', color: 'bg-teal-100 text-teal-800 border-teal-200' }
                    : idx === 2
                    ? { label: '对立主谋', color: 'bg-rose-100 text-rose-800 border-rose-200' }
                    : { label: '残响引路人', color: 'bg-purple-100 text-purple-800 border-purple-200' };

                return (
                  <div
                    key={idx}
                    className="bg-white p-3 rounded-xl border border-purple-100 shadow-2xs text-[11px] space-y-2 flex flex-col justify-between"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-1.5 border-b border-slate-100 pb-1.5 flex-nowrap min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0 flex-nowrap">
                          <span className="font-bold text-slate-900 text-xs whitespace-nowrap truncate" title={c.name}>{c.name}</span>
                          {(c.gender || c.age) && (
                            <span className="text-[9px] text-slate-500 bg-slate-100 px-1 py-0.5 rounded border border-slate-200 font-mono whitespace-nowrap shrink-0">
                              {c.gender} {c.age ? `· ${c.age}岁` : ''}
                            </span>
                          )}
                        </div>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 whitespace-nowrap ${roleBadge.color}`}>
                          {roleBadge.label}
                        </span>
                      </div>

                      <p className="text-slate-600 leading-relaxed text-[11px]">
                        {c.role}
                      </p>

                      {c.motivation && (
                        <div className="text-[10px] leading-relaxed text-slate-700 bg-slate-50 p-2 rounded-lg border border-slate-200/60">
                          <span className="font-bold text-indigo-950 mr-1">🎯 核心动机:</span>
                          <span>{c.motivation}</span>
                        </div>
                      )}

                      {c.affinityTrigger && (
                        <div className="text-[10px] leading-relaxed text-rose-900 bg-rose-50/60 p-2 rounded-lg border border-rose-200/70">
                          <span className="font-bold text-rose-950 mr-1 flex-inline items-center gap-0.5">
                            <Heart className="w-2.5 h-2.5 inline text-rose-600 fill-rose-600" /> 好感增减规则:
                          </span>
                          <span>{c.affinityTrigger}</span>
                        </div>
                      )}
                    </div>

                    {c.visualPrompt && (
                      <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                        <span className="text-purple-700 font-medium">8K 定妆提示词</span>
                        <button
                          onClick={() => handleCopyPrompt(`char_${idx}`, c.visualPrompt)}
                          className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer font-bold text-[10px]"
                        >
                          {copiedPromptId === `char_${idx}` ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-600" />
                              <span className="text-emerald-600">已复制</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>复制</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 3. 核心戏剧分水岭 (Pivot Points) */}
        {pivotPoints && pivotPoints.length > 0 && (
          <div className="p-3.5 rounded-xl bg-indigo-50/40 border border-indigo-150/70 space-y-2.5 shadow-2xs">
            <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-950 border-b border-indigo-100 pb-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
              <span>核心戏剧分水岭 (自然裂变点)</span>
            </div>
            <div className="space-y-2 pt-0.5">
              {pivotPoints.map((pp: any, idx: number) => (
                <div key={idx} className="text-[11px] bg-white p-3 rounded-xl border border-indigo-100/80 shadow-2xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 text-xs">{pp.title}</span>
                    <span className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200/60 font-bold">
                      危机抉择
                    </span>
                  </div>
                  <div className="text-slate-600 text-[10px] leading-relaxed">
                    <span className="font-bold text-slate-700">临界困境：</span>
                    {pp.dilemma}
                  </div>
                  <div className="space-y-1 text-[10px] text-indigo-800 font-mono bg-slate-50 p-2 rounded-lg border border-slate-200/60">
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                      <span>{pp.branchA}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                      <span>{pp.branchB}</span>
                    </div>
                    {pp.branchC && (
                      <div className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                        <span>{pp.branchC}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4. 互动微机制矩阵 (Interactive Gameplay Systems) */}
        <div className="p-3.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs space-y-2.5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
              <Gamepad2 className="w-4 h-4 text-indigo-600" />
              <span>4 大交互玩法机制矩阵</span>
            </div>
            <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 font-bold">
              微交互全预置
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="p-2.5 rounded-lg bg-cyan-50/50 border border-cyan-200/60 space-y-1">
              <div className="font-bold text-cyan-950 flex items-center gap-1">
                <Search className="w-3 h-3 text-cyan-600" />
                <span>点触搜证 (Hotspots)</span>
              </div>
              <p className="text-[10px] text-slate-600 leading-tight">
                第一视角场景可交互高亮点，探查收集关键物证道具
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-indigo-50/50 border border-indigo-200/60 space-y-1">
              <div className="font-bold text-indigo-950 flex items-center gap-1">
                <MessageSquare className="w-3 h-3 text-indigo-600" />
                <span>即时通讯 (Comm Wheel)</span>
              </div>
              <p className="text-[10px] text-slate-600 leading-tight">
                关键节点拟真通讯通话，即时选择对话并影响角色好感度
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-rose-50/50 border border-rose-200/60 space-y-1">
              <div className="font-bold text-rose-950 flex items-center gap-1">
                <Briefcase className="w-3 h-3 text-rose-600" />
                <span>物证对质 (Evidence)</span>
              </div>
              <p className="text-[10px] text-slate-600 leading-tight">
                核心审讯对质场景，出示正确证物以拆穿谎言突破僵局
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-amber-50/50 border border-amber-200/60 space-y-1">
              <div className="font-bold text-amber-950 flex items-center gap-1">
                <Zap className="w-3 h-3 text-amber-600" />
                <span>限时心跳抉择 (Timed QTE)</span>
              </div>
              <p className="text-[10px] text-slate-600 leading-tight">
                心跳倒计时抉择，玩家超时未按键将触发惊险默认分支
              </p>
            </div>
          </div>
        </div>

        {/* 5. 网状故事拓扑图 (左侧直观预览 + 点击全屏放大查看) */}
        {storyGraph?.nodes && storyGraph.nodes.length > 0 && (
          <div className="rounded-xl overflow-hidden border border-slate-300 shadow-sm bg-slate-950 space-y-0">
            {/* 顶部标题栏与放大按钮 */}
            <div className="px-3.5 py-2.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-300">
                <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
                <span>网状故事拓扑图 ({storyGraph.nodes.length} 节点 · {choices.length} 分支 · 4 终局)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-500/40">
                  质检通过 (收束率 100%)
                </span>
                <button
                  onClick={() => setShowTopologyModal(true)}
                  className="px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 shadow-xs hover:scale-105 active:scale-95"
                >
                  <Maximize2 className="w-3 h-3" />
                  <span>点击全屏放大</span>
                </button>
              </div>
            </div>

            {/* 拓扑图画板预览 (可点击放大) */}
            <div
              onClick={() => setShowTopologyModal(true)}
              className="relative h-64 sm:h-72 w-full overflow-hidden cursor-pointer group"
              title="点击全屏放大查看详细拓扑大图"
            >
              <InteractiveTopologyCanvas
                graph={storyGraph}
                className="w-full h-full pointer-events-none"
              />
              {/* 悬浮遮罩提示 */}
              <div className="absolute inset-0 bg-slate-950/20 group-hover:bg-slate-950/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 backdrop-blur-2xs">
                <div className="px-4 py-2 rounded-xl bg-slate-900/95 text-white text-xs font-bold shadow-xl border border-white/20 flex items-center gap-2 transform translate-y-1 group-hover:translate-y-0 transition-all">
                  <Maximize2 className="w-4 h-4 text-indigo-400" />
                  <span>点击全屏放大查看详细拓扑大图 (支持漫游与缩放)</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 6. 剧情分支节点文字列表与分类筛选 */}
        {storyGraph?.nodes && storyGraph.nodes.length > 0 && (
          <div className="pt-2 border-t border-slate-200/60 space-y-2">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setExpandedNodes(!expandedNodes)}
                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>{expandedNodes ? '收起剧情节点详细列表' : '展开查看 10 个节点剧本文案'}</span>
                {expandedNodes ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={() => setAuditModalStage('narrative_design')}
                className="text-[10px] text-slate-400 hover:text-indigo-600 flex items-center gap-1 cursor-pointer transition-colors font-mono"
                title="查看叙事阶段发送给 AI 的提示词与产物档案"
              >
                <Terminal className="w-3 h-3 text-slate-400" />
                <span>.agent_debug</span>
              </button>
            </div>

            {expandedNodes && (
              <div className="space-y-2 pt-1">
                {/* 节点分类过滤小标签 */}
                <div className="flex items-center gap-1.5 text-[10px] font-medium">
                  <button
                    onClick={() => setNodeFilter('all')}
                    className={`px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                      nodeFilter === 'all'
                        ? 'bg-indigo-600 text-white border-indigo-600 font-bold'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    全部 ({nodes.length})
                  </button>
                  <button
                    onClick={() => setNodeFilter('decision')}
                    className={`px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                      nodeFilter === 'decision'
                        ? 'bg-indigo-600 text-white border-indigo-600 font-bold'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    ⚡ 抉择点
                  </button>
                  <button
                    onClick={() => setNodeFilter('investigation')}
                    className={`px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                      nodeFilter === 'investigation'
                        ? 'bg-indigo-600 text-white border-indigo-600 font-bold'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    🔍 搜证点
                  </button>
                  <button
                    onClick={() => setNodeFilter('ending')}
                    className={`px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                      nodeFilter === 'ending'
                        ? 'bg-indigo-600 text-white border-indigo-600 font-bold'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    🏆 结局走向
                  </button>
                </div>

                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                  {filteredNodes.map((node: any, idx: number) => {
                    const isBad = node.type === 'bad_end';
                    const isTrue = node.type === 'true_end';
                    const isDecision = node.type === 'decision' || node.type === 'qte';
                    const isInvestigation = node.type === 'investigation';

                    return (
                      <div
                        key={idx}
                        className={`p-3 rounded-xl border text-[11px] shadow-2xs space-y-1.5 ${
                          isBad
                            ? 'bg-rose-50/70 border-rose-200'
                            : isTrue
                            ? 'bg-emerald-50/70 border-emerald-200'
                            : isDecision
                            ? 'bg-indigo-50/70 border-indigo-200'
                            : isInvestigation
                            ? 'bg-cyan-50/70 border-cyan-200'
                            : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 font-bold text-slate-900">
                            <span className="font-mono text-indigo-700">[{node.id}]</span>
                            <span>{node.title}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {node.estimatedDurationSec && (
                              <span className="text-[10px] font-mono text-slate-400 mr-1">
                                ⏱️ {node.estimatedDurationSec}s
                              </span>
                            )}
                            <span
                              className={`text-[9px] px-2 py-0.5 rounded-full font-bold border ${
                                isBad
                                  ? 'bg-rose-100 text-rose-700 border-rose-300'
                                  : isTrue
                                  ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                                  : isDecision
                                  ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
                                  : isInvestigation
                                  ? 'bg-cyan-100 text-cyan-700 border-cyan-300'
                                  : 'bg-slate-100 text-slate-600 border-slate-300'
                              }`}
                            >
                              {node.type}
                            </span>
                          </div>
                        </div>
                        <p className="text-slate-600 text-[10px] leading-relaxed">{node.summary}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderCharacterCard = () => {
    if (!characters || characters.length === 0) return null;

    const readyCount = characters.filter((c: any) => Boolean(c.selected || c.imageUrl)).length;

    return (
      <div className="mt-3 rounded-2xl p-4 bg-gradient-to-b from-slate-50 to-purple-50/20 border border-slate-200/90 shadow-sm space-y-4">
        {/* 顶部标题与控制栏 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 pb-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-purple-600" />
            <h3 className="text-xs font-bold text-slate-900">
              角色视觉规格与定妆演进 ({characters.length}位)
            </h3>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-white text-slate-600 border-slate-200">
              {readyCount === characters.length ? '全部角色定妆已就绪' : `已定妆 ${readyCount} / ${characters.length}`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setAuditModalStage('character_design')}
              className="text-[10px] text-slate-400 hover:text-indigo-600 flex items-center gap-1 cursor-pointer transition-colors font-mono mr-1"
              title="查看角色设计阶段提示词档案"
            >
              <Terminal className="w-3 h-3 text-slate-400" />
              <span>.agent_debug</span>
            </button>
            <button
              onClick={() => onTriggerCharacterGen(characters.map((c: any) => c.id))}
              disabled={isRunning}
              className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
              title="一键为全部未生成的角色批量调用 AI 渲染"
            >
              <Sparkles className="w-3 h-3 text-indigo-500" />
              <span>一键批量生成全部角色</span>
            </button>
          </div>
        </div>

        {/* 角色卡片网格 (2x2) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {characters.map((char: any, idx: number) => {
            const charKey = char.id || char.name || `char_${idx + 1}`;
            const versions: string[] = Array.isArray(char.versions) ? char.versions : (char.imageUrl ? [char.imageUrl] : []);
            const activeImage =
              selectedVersionOverrides[charKey] ||
              selectedVersionOverrides[char.id] ||
              selectedVersionOverrides[char.name] ||
              char.selected ||
              versions[versions.length - 1] ||
              versions[0] ||
              char.imageUrl ||
              '';
            const hasImage = Boolean(activeImage);
            const isUploadingThis = uploadingCharId === char.id;
            const isGeneratingThis = generatingCharId === char.id;
            const isRefiningThis = refiningCharId === char.id;

            const roleBadge =
              idx === 0
                ? { label: '主角/玩家视角', color: 'bg-indigo-100 text-indigo-800 border-indigo-200' }
                : idx === 1
                ? { label: '核心同盟', color: 'bg-teal-100 text-teal-800 border-teal-200' }
                : idx === 2
                ? { label: '对立主谋', color: 'bg-rose-100 text-rose-800 border-rose-200' }
                : { label: '残响引路人', color: 'bg-purple-100 text-purple-800 border-purple-200' };

            const curVersionIndex = versions.indexOf(activeImage);
            const versionLabel = curVersionIndex >= 0 ? `v${curVersionIndex + 1}` : 'v1';

            return (
              <div
                key={char.id || idx}
                className="bg-white p-3.5 rounded-xl border border-slate-200/90 hover:border-slate-300 transition-all shadow-2xs space-y-3 flex flex-col justify-between"
              >
                <div className="space-y-2.5">
                  {/* 角色名与定位标签 */}
                  <div className="flex items-center justify-between gap-1.5 border-b border-slate-100 pb-2 flex-nowrap min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0 flex-nowrap">
                      <h4 className="font-bold text-slate-900 text-xs whitespace-nowrap truncate" title={char.name}>
                        {char.name}
                      </h4>
                      {(char.gender || char.age) && (
                        <span className="text-[9px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 font-mono whitespace-nowrap shrink-0">
                          {char.gender} {char.age ? `· ${char.age}岁` : ''}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0 flex-nowrap whitespace-nowrap">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 whitespace-nowrap ${roleBadge.color}`}>
                        {roleBadge.label}
                      </span>
                      {hasImage ? (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-0.5 shrink-0 whitespace-nowrap">
                          ✓ 已定妆 ({versionLabel})
                        </span>
                      ) : (
                        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 shrink-0 whitespace-nowrap">
                          待生成/上传
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 角色定妆图大框预览 (支持点击全屏放大) */}
                  <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-900 border border-slate-200/80 flex items-center justify-center group">
                    {hasImage ? (
                      <div
                        onClick={() =>
                          setLightboxImage({
                            url: activeImage,
                            title: `《${char.name}》· 定妆大照 (${versionLabel})`,
                            subtitle: `${char.role || ''} · ${char.personality || ''}`,
                          })
                        }
                        className="w-full h-full cursor-zoom-in relative"
                        title="点击全屏放大查看高清定妆细节"
                      >
                        <img
                          src={assetUrl(activeImage)}
                          alt={char.name}
                          className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300"
                        />
                        {/* 悬浮全屏放大提示 */}
                        <div className="absolute inset-0 bg-slate-950/20 group-hover:bg-slate-950/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 backdrop-blur-2xs">
                          <div className="px-3 py-1.5 rounded-lg bg-slate-900/90 text-white text-[11px] font-bold flex items-center gap-1.5 shadow-lg border border-white/20">
                            <Maximize2 className="w-3.5 h-3.5 text-indigo-400" />
                            <span>点击全屏放大查看</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* 无图占位态 */
                      <div className="p-4 text-center text-slate-400 space-y-1.5 flex flex-col items-center justify-center">
                        <ImageIcon className="w-7 h-7 text-slate-300" />
                        <span className="text-[10px] text-slate-400">
                          暂无定妆照 · 可点击下方【AI 生成】或【上传图片】
                        </span>
                      </div>
                    )}

                    {/* 加载中浮层 */}
                    {(isUploadingThis || isGeneratingThis) && (
                      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs flex flex-col items-center justify-center text-white text-xs gap-2">
                        <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                        <span className="text-[11px] font-medium">
                          {isUploadingThis ? '正在上传并更新版本...' : 'AI 正在极速渲染定妆照...'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 丰富视觉细节参数展示 */}
                  <div className="space-y-1.5 text-[10px] text-slate-600 bg-slate-50/70 p-2.5 rounded-lg border border-slate-200/60 leading-relaxed">
                    <div>
                      <strong className="text-slate-900 font-bold mr-1">🎭 五官骨相:</strong>
                      <span>{char.appearancePrompt || char.appearance || '面部骨骼冷峻分明'}</span>
                    </div>
                    {char.clothingPrompt && (
                      <div>
                        <strong className="text-slate-900 font-bold mr-1">👔 服饰材质:</strong>
                        <span>{char.clothingPrompt}</span>
                      </div>
                    )}
                    {char.imagePrompt && (
                      <div className="pt-1 border-t border-slate-200/60 flex items-center justify-between text-[10px] text-slate-500 flex-nowrap min-w-0">
                        <span className="text-indigo-900 font-medium whitespace-nowrap shrink-0">8K 生图 Prompt</span>
                        <div className="flex items-center gap-2 flex-nowrap shrink-0 whitespace-nowrap">
                          <button
                            onClick={() => {
                              const nextOpen = isRefiningThis ? null : char.id;
                              setRefiningCharId(nextOpen);
                              if (nextOpen && editingPrompts[char.id] === undefined) {
                                setEditingPrompts((prev) => ({ ...prev, [char.id]: char.imagePrompt || '' }));
                              }
                            }}
                            className="text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5 cursor-pointer font-bold"
                            title="展开直接编辑此角色的生图提示词"
                          >
                            <Edit3 className="w-3 h-3 text-indigo-500" />
                            <span>{isRefiningThis ? '收起编辑' : '编辑词'}</span>
                          </button>
                          <button
                            onClick={() => handleCopyPrompt(char.id, char.imagePrompt)}
                            className="text-slate-500 hover:text-indigo-800 flex items-center gap-1 cursor-pointer font-medium"
                          >
                            {copiedPromptId === char.id ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-600" />
                                <span className="text-emerald-600 font-bold">已复制</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>复制</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 底部历史版本缩略条 (有生成或上传记录时展开) */}
                  {versions.length > 0 && (
                    <div className="space-y-1 pt-1 border-t border-slate-100">
                      <div className="flex items-center justify-between text-[10px] flex-nowrap min-w-0">
                        <span className="font-bold text-slate-600 whitespace-nowrap shrink-0">
                          历史版本记录 ({versions.length}个版本 · 点击切换使用):
                        </span>
                        <span className="text-slate-400 font-mono text-[9px] whitespace-nowrap shrink-0">
                          当前: {versionLabel}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 overflow-x-auto py-1">
                        {versions.map((vUrl, vIdx) => {
                          const isCurSelected = activeImage === vUrl;
                          return (
                            <button
                              key={vUrl + vIdx}
                              onClick={() => {
                                const targetId = char.id || char.name || `char_${idx + 1}`;
                                setSelectedVersionOverrides((prev) => ({
                                  ...prev,
                                  [targetId]: vUrl,
                                  [char.id]: vUrl,
                                  [char.name]: vUrl,
                                }));
                                onSelectCharacterVersion?.(targetId, vUrl);
                              }}
                              className={`relative shrink-0 rounded-lg overflow-hidden border aspect-[16/10] w-14 transition-all cursor-pointer ${
                                isCurSelected
                                  ? 'ring-2 ring-indigo-500 border-indigo-500 shadow-xs scale-105'
                                  : 'border-slate-200 hover:border-slate-300 opacity-60 hover:opacity-100'
                              }`}
                              title={`点击切换使用版本 v${vIdx + 1}`}
                            >
                              <img src={assetUrl(vUrl)} alt={`v${vIdx + 1}`} className="w-full h-full object-cover" />
                              <span className="absolute top-0.5 left-0.5 px-1 py-0.2 bg-black/70 text-[8px] font-mono font-bold text-white rounded">
                                v{vIdx + 1}
                              </span>
                              {isCurSelected && (
                                <span className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[8px] font-black">
                                  ✓
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 折叠微调二次衍生与提示词自由编辑面板 */}
                  {isRefiningThis && (
                    <div className="p-3 rounded-xl bg-slate-50 border border-indigo-200 space-y-2.5 mt-1 animate-in fade-in duration-150 shadow-inner">
                      <div className="flex items-center justify-between text-[11px] pb-1.5 border-b border-indigo-100">
                        <div className="flex items-center gap-1.5 font-bold text-indigo-950">
                          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                          <span>
                            {hasImage
                              ? `基于当前定妆 (${versionLabel}) 二次微调衍生新版本`
                              : `编辑并定制 ${char.name} 的 8K 生图提示词`}
                          </span>
                        </div>
                        <button
                          onClick={() => setRefiningCharId(null)}
                          className="text-slate-400 hover:text-slate-600 cursor-pointer p-0.5 rounded"
                          title="关闭面板"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* 8K 提示词自由编辑区 */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <label className="font-bold text-slate-700 flex items-center gap-1">
                            <Edit3 className="w-3 h-3 text-indigo-600" />
                            <span>8K 生图提示词 (Prompt · 可自由编辑增删关键词):</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPrompts((prev) => ({
                                ...prev,
                                [char.id]: char.imagePrompt || '',
                              }));
                            }}
                            className="text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5 cursor-pointer font-medium text-[9px]"
                            title="重置回初始默认提示词"
                          >
                            <RotateCcw className="w-2.5 h-2.5" />
                            <span>恢复默认</span>
                          </button>
                        </div>
                        <textarea
                          value={editingPrompts[char.id] ?? (char.imagePrompt || '')}
                          onChange={(e) =>
                            setEditingPrompts((prev) => ({ ...prev, [char.id]: e.target.value }))
                          }
                          rows={3}
                          className="w-full p-2 text-[11px] font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 leading-relaxed text-slate-800 shadow-inner resize-y"
                          placeholder="可自由编辑 Prompt，修改服装、发型、打光、表情、环境细节..."
                        />
                      </div>

                      {/* 中文快捷微调输入框 */}
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-700">
                          补充微调指令 (中文快捷要求，可选):
                        </label>
                        <input
                          type="text"
                          value={refinementTexts[char.id] || ''}
                          onChange={(e) =>
                            setRefinementTexts((prev) => ({ ...prev, [char.id]: e.target.value }))
                          }
                          placeholder="例如：眼神更冷酷无情一点，衣服换成深灰风衣..."
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-800"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const instruction = refinementTexts[char.id];
                              const editedPrompt = editingPrompts[char.id] ?? char.imagePrompt;
                              setGeneratingCharId(char.id);
                              onRegenerateSingleCharacter?.(char.id, instruction, activeImage, editedPrompt).finally(() => {
                                setGeneratingCharId(null);
                                setRefiningCharId(null);
                              });
                            }
                          }}
                        />
                      </div>

                      {/* 底部操作与提交 */}
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[9px] text-slate-400 font-mono">
                          极速 Turbo 模式 · 2~3s · 保留历史版本
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setRefiningCharId(null)}
                            className="px-2.5 py-1 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 text-[10px] cursor-pointer"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const instruction = refinementTexts[char.id];
                              const editedPrompt = editingPrompts[char.id] ?? char.imagePrompt;
                              setGeneratingCharId(char.id);
                              try {
                                await onRegenerateSingleCharacter?.(char.id, instruction, activeImage, editedPrompt);
                                setRefiningCharId(null);
                              } finally {
                                setGeneratingCharId(null);
                              }
                            }}
                            disabled={isRunning || isGeneratingThis}
                            className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold flex items-center gap-1 shadow-2xs cursor-pointer disabled:opacity-50"
                          >
                            <Sparkles className="w-3 h-3" />
                            <span>
                              {hasImage ? `生成新版本 (v${versions.length + 1})` : '按此 Prompt 渲染定妆'}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 底部操作按钮栏 */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1.5 flex-nowrap min-w-0">
                  <div className="flex items-center gap-1 shrink-0 flex-nowrap whitespace-nowrap">
                    <button
                      onClick={() => triggerUpload(char.id, 'final')}
                      disabled={isRunning || isUploadingThis}
                      className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
                      title="从本地上传现成图片作为定妆照"
                    >
                      <Upload className="w-3 h-3 text-slate-500" />
                      <span>上传图片</span>
                    </button>

                    <button
                      onClick={() => {
                        const nextOpen = isRefiningThis ? null : char.id;
                        setRefiningCharId(nextOpen);
                        if (nextOpen && editingPrompts[char.id] === undefined) {
                          setEditingPrompts((prev) => ({ ...prev, [char.id]: char.imagePrompt || '' }));
                        }
                      }}
                      className={`px-2 py-1 rounded-lg border text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer shadow-2xs whitespace-nowrap shrink-0 ${
                        isRefiningThis
                          ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                          : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                      }`}
                      title="展开提示词编辑框，支持自由修改生图词并衍生新版本"
                    >
                      <Zap className="w-3 h-3 text-indigo-500" />
                      <span>{hasImage ? '微调衍生 / 编辑词' : '编辑提示词'}</span>
                    </button>
                  </div>

                  <button
                    onClick={async () => {
                      setGeneratingCharId(char.id);
                      try {
                        if (onRegenerateSingleCharacter) {
                          await onRegenerateSingleCharacter(char.id);
                        } else {
                          await onTriggerCharacterGen([char.id]);
                        }
                      } finally {
                        setGeneratingCharId(null);
                      }
                    }}
                    disabled={isRunning || isGeneratingThis}
                    className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold shadow-2xs transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>{hasImage ? '重绘此人' : 'AI 生成定妆'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderKeyframesCard = () => {
    if (!keyframes || keyframes.length === 0) return null;
    return (
      <div className="mt-3 rounded-xl p-3.5 bg-slate-50/80 border border-slate-200/90 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-xs">
            <Film className="w-4 h-4 text-indigo-600" />
            <span>分镜故事板高清关键帧 ({keyframes.length}幅)</span>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setAuditModalStage('keyframe_reference')}
              className="text-[10px] text-slate-400 hover:text-indigo-600 flex items-center gap-1 cursor-pointer transition-colors font-mono"
              title="查看关键帧阶段提示词档案"
            >
              <Terminal className="w-3 h-3 text-slate-400" />
              <span>.agent_debug</span>
            </button>
            <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> 连贯性质检通过
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {keyframes.slice(0, 6).map((kf: any, idx: number) => (
            <div key={idx} className="aspect-video rounded-xl overflow-hidden bg-slate-100 border border-slate-200 relative group shadow-2xs">
              <img
                src={assetUrl(kf.imageUrl || kf.image_url || kf.path)}
                alt={`Shot ${idx + 1}`}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
              <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/60 text-[9px] text-white font-mono">
                #{idx + 1}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderPackagerCard = () => {
    if (!packagerArtifact) return null;
    return (
      <div className="mt-3 rounded-xl p-3.5 bg-emerald-50/90 border border-emerald-200 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-emerald-950 font-bold text-xs">
            <Gamepad2 className="w-4 h-4 text-emerald-600" />
            <span>🎮 互动影游打包完成，已在右侧屏幕就绪！</span>
          </div>
          <button
            onClick={() => setAuditModalStage('fmv_packaging')}
            className="text-[10px] text-emerald-700 hover:text-emerald-900 flex items-center gap-1 cursor-pointer font-mono"
            title="查看影游装配档案"
          >
            <Terminal className="w-3 h-3" />
            <span>.agent_debug</span>
          </button>
        </div>
        <p className="text-[11px] text-emerald-800 leading-relaxed">
          决策呼吸微循环与状态机互动逻辑已装配完毕。请直接在右侧屏幕试玩您的作品！
        </p>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-50/70 border-r border-slate-200/90 text-slate-800">
      {/* 隐藏的文件上传 input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => handleFileChange(e, 'final')}
        accept="image/*"
        className="hidden"
      />
      <input
        type="file"
        ref={refFileInputRef}
        onChange={(e) => handleFileChange(e, 'reference')}
        accept="image/*"
        className="hidden"
      />

      {/* 顶部对话区标头 */}
      <div className="px-5 py-3 border-b border-slate-200/80 flex items-center justify-between bg-white/90 shrink-0 backdrop-blur-xs">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-xs shadow-emerald-500/40" />
          <span className="text-xs font-bold text-slate-800">AI 影游总制作人</span>
        </div>
        <span className="text-[11px] text-slate-400 font-medium">
          {sessionId ? '实时对话协同' : '立项灵感'}
        </span>
      </div>

      {/* 核心对话流 */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-5 space-y-5 relative"
      >
        {messages.map((msg) => {
          const isUser = msg.sender === 'user';
          const timeDisplay = msg.timestamp ? (msg.timestamp.includes('T') ? msg.timestamp.slice(11, 16) : msg.timestamp) : '';
          const isNarrativeAttached = !isUser && msg.id === narrativeMsgId;
          const isCharacterAttached = !isUser && msg.id === characterMsgId;
          const isKeyframesAttached = !isUser && msg.id === keyframesMsgId;
          const isPackagerAttached = !isUser && msg.id === packagerMsgId;

          return (
            <div
              key={msg.id}
              className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
            >
              {/* 头像 */}
              <div
                className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold shadow-2xs ${
                  isUser
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-indigo-600 border border-slate-200 shadow-2xs'
                }`}
              >
                {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
              </div>

              {/* 气泡内容 */}
              <div
                className={`max-w-[92%] rounded-2xl p-4 text-xs leading-relaxed shadow-xs ${
                  isUser
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-800 border border-slate-200/90'
                }`}
              >
                {/* 身份与时间标签 */}
                {isUser ? (
                  <div className="flex items-center justify-end gap-2 text-[10px] text-indigo-200 mb-1.5 font-bold">
                    <span>我 (创作者)</span>
                    {timeDisplay && <span className="font-normal opacity-80" suppressHydrationWarning>{timeDisplay}</span>}
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2 text-[10px] text-indigo-600 mb-1.5 font-bold">
                    <div className="flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-indigo-500" />
                      <span>{msg.senderName || 'AI 影游总制作人'}</span>
                    </div>
                    {timeDisplay && <span className="text-slate-400 font-normal" suppressHydrationWarning>{timeDisplay}</span>}
                  </div>
                )}

                <div className="whitespace-pre-wrap">{msg.content}</div>

                {/* 阶段产物卡片嵌入在对应 Agent 消息气泡内部 */}
                {isNarrativeAttached && renderNarrativeCard()}
                {isCharacterAttached && renderCharacterCard()}
                {isKeyframesAttached && renderKeyframesCard()}
                {isPackagerAttached && renderPackagerCard()}
              </div>
            </div>
          );
        })}

        {/* 兜底保底：若有产物但未命中任何气泡时渲染在底部 */}
        {!narrativeMsgId && renderNarrativeCard()}
        {!characterMsgId && characterArtifact && renderCharacterCard()}
        {!keyframesMsgId && keyframes.length > 0 && renderKeyframesCard()}
        {!packagerMsgId && packagerArtifact && renderPackagerCard()}

        {isRunning && (
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-xl bg-white text-indigo-600 border border-slate-200 shadow-2xs flex items-center justify-center shrink-0">
              <Bot className="w-3.5 h-3.5 animate-pulse text-indigo-600" />
            </div>
            <div className="rounded-2xl px-4 py-3 bg-white border border-indigo-150 shadow-xs text-xs text-slate-700 max-w-[85%] space-y-2">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-1.5">
                <span className="font-bold text-indigo-950 flex items-center gap-1.5 text-[11px]">
                  <Loader2 className="w-3.5 h-3.5 text-indigo-600 animate-spin shrink-0" />
                  {stageConfig.role} 正在推演
                </span>
                <div className="flex items-center gap-1">
                  {stageConfig.steps.map((_, idx) => (
                    <span
                      key={idx}
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        idx === runningStepIndex
                          ? 'w-4 bg-indigo-600'
                          : idx < runningStepIndex
                          ? 'w-1.5 bg-indigo-300'
                          : 'w-1.5 bg-slate-200'
                      }`}
                    />
                  ))}
                </div>
              </div>
              <p className="font-medium text-slate-800 leading-relaxed transition-all duration-300 text-xs">
                {stageConfig.steps[runningStepIndex]}
              </p>
            </div>
          </div>
        )}

        {/* 浮动回到最新消息按钮（仅当用户向上翻阅时出现） */}
        {showScrollBottomBtn && (
          <div className="sticky bottom-2 flex justify-center pointer-events-none z-30">
            <button
              onClick={() => scrollToBottom('smooth')}
              className="pointer-events-auto px-3.5 py-1.5 rounded-full bg-slate-900/90 hover:bg-slate-900 text-white text-[11px] font-bold shadow-lg backdrop-blur-xs flex items-center gap-1.5 cursor-pointer transition-all hover:scale-105 active:scale-95 border border-white/20"
            >
              <ChevronDown className="w-3.5 h-3.5 text-indigo-400" />
              <span>回到最新</span>
            </button>
          </div>
        )}
      </div>

      {/* 底部输入框与快速推进栏 */}
      <div className="p-4 border-t border-slate-200/90 bg-white space-y-3 shrink-0 shadow-xs">
        {/* 新创建时快捷灵感点选 */}
        {!sessionId && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              快速灵感（点击填入）：
            </span>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_INSPIRATIONS.map((insp, idx) => (
                <button
                  key={idx}
                  onClick={() => setInputText(insp)}
                  className="px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 text-slate-600 hover:text-indigo-700 text-[10px] font-medium transition-all text-left truncate max-w-[220px] cursor-pointer shadow-2xs"
                >
                  {insp}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 自然确认推进按钮 */}
        {isWaitingForConfirmation && (
          <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 shadow-2xs">
            <span className="font-bold flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              当前工序产物已就绪，等待您的指示
            </span>
            <button
              onClick={onConfirmNext}
              disabled={isRunning}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <span>确认满意，进入下一步</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* 聊天输入表单 */}
        <form onSubmit={handleSubmit} className="relative">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              !sessionId
                ? '描述你想创作的故事构想（例如：“赛博朋克记忆神偷，潜入脑机财阀调查意识篡改...”）...'
                : '像聊天一样给 AI 指示（例如：“把氛围改为阴郁悬疑”、“给女主加一个秘密身份”），或直接点上方按钮进入下一步...'
            }
            disabled={isRunning}
            rows={3}
            className="w-full text-xs text-slate-800 bg-slate-50/60 border border-slate-300 rounded-xl p-3 pb-9 outline-none focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-none transition-all placeholder:text-slate-400 shadow-2xs"
          />

          <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1.5">
            <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">Enter 发送</span>
            <button
              type="submit"
              disabled={!inputText.trim() || isRunning}
              className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-all disabled:opacity-30 cursor-pointer shadow-xs"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </div>

      {/* 提示词与产物档案抽屉/弹窗 */}
      {auditModalStage && sessionId && (
        <AuditModal
          sessionId={sessionId}
          stage={auditModalStage}
          isOpen={Boolean(auditModalStage)}
          onClose={() => setAuditModalStage(null)}
        />
      )}

      {/* 全屏放大拓扑大图弹窗 (Modal) */}
      {showTopologyModal && narrative?.storyGraph && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-7xl h-[92vh] bg-slate-950 border border-slate-700/80 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="h-14 bg-slate-900 border-b border-slate-800 px-6 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-sm font-bold text-white">
                    网状互动故事拓扑全景大图 (Interactive Story Graph)
                  </h3>
                </div>
                <span className="text-xs text-slate-400 font-mono hidden sm:inline">
                  · {narrative.storyGraph.nodes?.length || 10} 个场景节点 · 4 大终局走向
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-slate-400 hidden md:inline">
                  按住画布自由拖拽漫游 · 滚轮缩放 · 点击节点查看支线详情
                </span>
                <button
                  onClick={() => setShowTopologyModal(false)}
                  className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer border border-slate-700"
                  title="关闭 (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Canvas Body */}
            <div className="flex-1 w-full h-full relative overflow-hidden">
              <InteractiveTopologyCanvas
                graph={narrative.storyGraph}
                className="w-full h-full"
              />
            </div>
          </div>
        </div>
      )}

      {/* 角色定妆大图全屏检视灯箱 (Lightbox Modal) */}
      {lightboxImage && (
        <div
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-200 cursor-zoom-out"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-5xl max-h-[92vh] flex flex-col items-center cursor-default"
          >
            {/* Header / Info bar */}
            <div className="w-full flex items-center justify-between pb-3 px-1 text-white">
              <div>
                <h4 className="font-bold text-sm">{lightboxImage.title}</h4>
                {lightboxImage.subtitle && (
                  <p className="text-xs text-slate-400 mt-0.5">{lightboxImage.subtitle}</p>
                )}
              </div>
              <button
                onClick={() => setLightboxImage(null)}
                className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer border border-white/20"
                title="关闭 (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Large Image container */}
            <div className="relative rounded-2xl overflow-hidden border border-white/20 shadow-2xl bg-black max-h-[82vh] flex items-center justify-center">
              <img
                src={assetUrl(lightboxImage.url)}
                alt={lightboxImage.title}
                className="w-full h-full max-h-[82vh] object-contain"
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              按 Esc 或点击遮罩任意处关闭
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
