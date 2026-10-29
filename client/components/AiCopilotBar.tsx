'use client';

import React, { useState, useMemo } from 'react';
import { Sparkles, Send, ChevronDown, ChevronUp, Wand2, RefreshCw } from 'lucide-react';

interface AiCopilotBarProps {
  currentStage: string | null;
  sessionId: string | null;
  isRunning: boolean;
  onIntervene: (modifications: Record<string, any>) => void;
  onRegenerate?: () => void;
}

interface StageCopilotMeta {
  title: string;
  badge: string;
  description: string;
  placeholder: string;
  chips: string[];
  buildPayload: (text: string) => Record<string, any>;
}

const STAGE_COPILOT_CONFIG: Record<string, StageCopilotMeta> = {
  script_generation: {
    title: 'AI 剧本大纲对话助手',
    badge: '大纲微调',
    description: '输入自然语言指令微调故事梗概、戏剧冲突、主要角色定位或叙事节奏',
    placeholder: '输入大纲修改意图，例如：“第3集增加地心反重力战场，让金刚获得远古战斧”、“基调偏向赛博废土”...',
    chips: [
      '增加一段反转断章与悬念',
      '强化双王对抗的压迫感与力量感',
      '为主要角色增加更强烈的行动动机',
      '调快整体节奏，让危机提前在第1集爆发',
    ],
    buildPayload: (text) => ({
      action: 'revise_bible',
      instruction: text,
      feedback: text,
    }),
  },
  character_design: {
    title: 'AI 角色与场景视觉调整助手',
    badge: '视觉美术微调',
    description: '输入自然语言指令调整全剧角色的外观体表、神态材质、战损细节或场景光影色调',
    placeholder: '输入角色与场景调整指令，例如：“让哥斯拉背鳍发蓝光更强、带放射性晶簇”、“金刚身上增加远古战纹，手握石斧”...',
    chips: [
      '增强生物压迫感与体量规模',
      '增加重度战损与表皮龟裂细节',
      '切换为冷色调高对比电影光影',
      '强化暗黑异形与生物寄生感',
    ],
    buildPayload: (text) => ({
      instruction: text,
      feedback: text,
    }),
  },
  episode_script: {
    title: 'AI 分集剧本与单集钩子微调助手',
    badge: '单集剧本精修',
    description: '输入自然语言指令微调当前分集的开篇黄金3秒冲突、场次动作描写、对白情绪或结尾卡点断章',
    placeholder: '输入单集剧本调整指令，例如：“强化结尾掐脖子断章悬念，停在未知巨眼睁开的瞬间”、“让对白更短促犀利、火药味更浓”...',
    chips: [
      '强化结尾掐脖子断章悬念',
      '优化开篇黄金3秒危机切入',
      '增加紧迫的战损与伤情描写',
      '精简日常对白，提升情绪锋芒',
    ],
    buildPayload: (text) => ({
      action: 'revise_episode',
      instruction: text,
      feedback: text,
    }),
  },
  storyboard: {
    title: 'AI 分镜与镜头语言微调助手',
    badge: '分镜运镜微调',
    description: '输入自然语言指令调整镜头景别、运镜方式、机位高度与对峙构图',
    placeholder: '输入分镜调整指令，例如：“增加低角度广角大仰拍展现怪兽体量”、“加快镜头切换频率，强化贴身交锋”...',
    chips: [
      '增加低角度大仰拍全景',
      '增加近身搏击晃动跟随特写',
      '增加慢动作定格高潮聚集',
      '强化逆光冷暖对峙构图',
    ],
    buildPayload: (text) => ({
      instruction: text,
      feedback: text,
    }),
  },
  reference_generation: {
    title: 'AI 首尾帧画质与氛围精修助手',
    badge: '首尾帧精修',
    description: '输入自然语言指令微调首尾帧图像的空气介质、光源冷暖、体积光与角色站位神态',
    placeholder: '输入画面精修指令，例如：“提升电影级光影对比度，增加体积光神光”、“背景增加水汽与弥漫烟尘”...',
    chips: [
      '增强电影级体积光与丁达尔效应',
      '增加细密雨丝与烟雾粒子氛围',
      '强化主体特写微表情与眼神光',
      '加强环境冷暖交界对比光',
    ],
    buildPayload: (text) => ({
      instruction: text,
      feedback: text,
    }),
  },
  video_post: {
    title: 'AI 视频后期与视听剪辑助手',
    badge: '视频后期微调',
    description: '输入自然语言指令微调镜头动态、物理冲击感、视听剪辑节奏、配乐音效或胶片调色',
    placeholder: '输入视频后期调整指令，例如：“增强重低音轰鸣与次声波震颤”、“镜头推拉增加动态模糊与碎石飞溅”...',
    chips: [
      '增强重低音与危机背景音效',
      '强化地面震颤与碎石飞溅动态',
      '冷灰胶片电影质感调色',
      '增加慢动作定格冲击感',
    ],
    buildPayload: (text) => ({
      instruction: text,
      feedback: text,
    }),
  },
};

export default function AiCopilotBar({
  currentStage,
  sessionId,
  isRunning,
  onIntervene,
  onRegenerate,
}: AiCopilotBarProps) {
  const [prompt, setPrompt] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);

  const stageConfig = useMemo(() => {
    if (!currentStage) return STAGE_COPILOT_CONFIG.script_generation;
    return STAGE_COPILOT_CONFIG[currentStage] || STAGE_COPILOT_CONFIG.script_generation;
  }, [currentStage]);

  if (!sessionId) return null;

  const handleSubmit = () => {
    const trimmed = prompt.trim();
    if (!trimmed || isRunning) return;
    const payload = stageConfig.buildPayload(trimmed);
    onIntervene(payload);
    setPrompt('');
  };

  const handleRegenerateClick = () => {
    if (isRunning || !onRegenerate) return;
    const confirmed = window.confirm(
      '确定要重新生成本阶段吗？\n\n注意：重新生成将重置当前阶段以及后续所有阶段的内容。'
    );
    if (confirmed) {
      onRegenerate();
    }
  };

  return (
    <div className="w-full border-b border-purple-200/70 bg-gradient-to-r from-purple-50/90 via-indigo-50/90 to-blue-50/90 px-4 sm:px-6 py-2.5 transition-all shrink-0">
      <div className="max-w-7xl mx-auto space-y-2">
        {/* 顶部标题行与展开/收起按钮 */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-2xs">
              <Sparkles className="w-3 h-3" />
            </div>
            <span className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
              {stageConfig.title}
              <span className="text-[10px] text-purple-700 bg-purple-100/80 px-2 py-0.5 rounded-full font-medium">
                {stageConfig.badge}
              </span>
            </span>
            <span className="hidden md:inline text-[11px] text-gray-500">
              — {stageConfig.description}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-[11px] font-medium text-purple-700 hover:text-purple-900 bg-white/70 hover:bg-white px-2 py-0.5 rounded-md border border-purple-200/60 shadow-2xs transition-colors cursor-pointer"
          >
            {isExpanded ? (
              <>
                <span>收起</span>
                <ChevronUp className="w-3 h-3" />
              </>
            ) : (
              <>
                <span>展开指令框</span>
                <ChevronDown className="w-3 h-3" />
              </>
            )}
          </button>
        </div>

        {/* 输入框主栏 */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              disabled={isRunning}
              placeholder={stageConfig.placeholder}
              className="w-full text-xs text-gray-800 bg-white border border-purple-200 rounded-xl pl-3.5 pr-8 py-2 outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-300 disabled:bg-slate-100 shadow-2xs placeholder:text-gray-400"
            />
            <Wand2 className="w-3.5 h-3.5 text-purple-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isRunning || !prompt.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs transition-all shrink-0 cursor-pointer"
          >
            {isRunning ? (
              <Sparkles className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            <span>{isRunning ? '处理中...' : '发送修改'}</span>
          </button>

          {onRegenerate && (
            <button
              type="button"
              onClick={handleRegenerateClick}
              disabled={isRunning}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-orange-600 bg-white border border-orange-300 hover:bg-orange-50 active:bg-orange-100 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs transition-all shrink-0 cursor-pointer"
              title={isRunning ? '正在生成中...' : '重新生成本阶段'}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
              <span>重新生成</span>
            </button>
          )}
        </div>

        {/* 展开状态下的灵感示例标签 */}
        {isExpanded && stageConfig.chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[11px] text-gray-400">快速指令示例：</span>
            {stageConfig.chips.map((chip) => (
              <button
                key={chip}
                type="button"
                disabled={isRunning}
                onClick={() => setPrompt((prev) => (prev ? `${prev}，${chip}` : chip))}
                className="px-2 py-0.5 rounded-md bg-white/80 hover:bg-white border border-purple-100 hover:border-purple-200 text-purple-700 hover:text-purple-900 text-[11px] transition-colors cursor-pointer shadow-2xs"
              >
                + {chip}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
