'use client';

import React from 'react';
import {
  Sparkles,
  GitBranch,
  Users,
  Film,
  Video,
  Gamepad2,
  Clock,
  ArrowRight,
  PlusCircle,
  FolderOpen,
} from 'lucide-react';
import { MILESTONES } from '../studio.types';

interface HistoryItem {
  id: string;
  idea: string;
  style?: string;
  date: string;
  status: string;
  stages?: Record<string, string>;
}

interface WelcomeViewerProps {
  onSelectInspiration: (idea: string) => void;
  onSelectProject: (id: string) => void;
  history: HistoryItem[];
}

const INSPIRATIONS = [
  {
    title: '赛博记忆黑市',
    tag: '科幻悬疑',
    desc: '记忆神偷潜入跨国脑机巨头，追查被篡改的绝密意识数据。',
    prompt: '赛博朋克悬疑短剧，记忆神偷潜入跨国脑机巨头，追查被篡改的绝密意识数据，多方势力博弈与信任背叛。',
  },
  {
    title: '风雨客栈连环案',
    tag: '古风密室',
    desc: '暴雨夜十人困于孤立驿站，午夜离奇命案接连发生，凶手潜藏其中。',
    prompt: '古代悬疑武侠短剧，暴雨夜十人困于孤立驿站，午夜离奇命案接连发生，玩家需要通过线索与抉择找出真正的凶手。',
  },
  {
    title: '深空星舰信标',
    tag: '太空惊悚',
    desc: '搜救队登上一艘失联三十年的科考舰，遭遇不可名状的异变与AI异化。',
    prompt: '硬科幻悬疑影游，搜救队登上一艘失联三十年的科考舰，遭遇不可名状的深空异变与舰载AI的异常指令。',
  },
  {
    title: '时空回溯职场逆袭',
    tag: '都市奇幻',
    desc: '平民职员意外觉醒五分钟时空回溯能力，在商战迷局与家族恩怨中步步为营。',
    prompt: '现代都市奇幻短剧，平民职员意外觉醒五分钟时空回溯能力，在复杂商战迷局与家族恩怨中逆风翻盘。',
  },
];

export default function WelcomeViewer({
  onSelectInspiration,
  onSelectProject,
  history,
}: WelcomeViewerProps) {
  return (
    <div className="flex-1 overflow-y-auto p-8 bg-slate-50 space-y-8">
      {/* 头部横幅 */}
      <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 rounded-2xl p-8 text-white shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.25),transparent_70%)] pointer-events-none" />
        <div className="max-w-2xl relative z-10 space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-bold border border-indigo-400/30">
            <Sparkles className="w-3.5 h-3.5" />
            全新一代 AI 互动影游制作工坊
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            从一句话灵感，到工业级可玩互动影游
          </h1>
          <p className="text-xs text-indigo-200/80 leading-relaxed pt-1">
            在左侧对话区输入你的故事构思或直接点击下方灵感模板，AI 智能体编队将为您按工序自动推进网状剧本、角色锚点、分镜预演至独立视频切片与成片试玩。
          </p>
        </div>

        {/* 5大里程碑一览条 */}
        <div className="grid grid-cols-5 gap-3 mt-6 pt-6 border-t border-indigo-700/40">
          {MILESTONES.map((m) => (
            <div
              key={m.id}
              className="bg-white/5 backdrop-blur-xs rounded-xl p-3 border border-white/10 flex flex-col justify-between"
            >
              <div className="flex items-center gap-1.5 text-indigo-300 text-[11px] font-bold">
                <span>0{m.index}</span>
                <span className="text-white truncate">{m.name}</span>
              </div>
              <p className="text-[10px] text-indigo-200/60 mt-1 line-clamp-2">{m.tagline}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 创意灵感选择区 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-800 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            快速灵感启动（点击直接投入创作）
          </h2>
          <span className="text-xs text-gray-400">或者在左侧对话框中描述您自创的故事</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {INSPIRATIONS.map((item, idx) => (
            <div
              key={idx}
              onClick={() => onSelectInspiration(item.prompt)}
              className="p-5 rounded-2xl bg-white border border-gray-200/80 hover:border-indigo-400 hover:shadow-md transition-all cursor-pointer group flex flex-col justify-between space-y-3"
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-bold text-indigo-600 px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-100">
                    {item.tag}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all" />
                </div>
                <h3 className="text-sm font-bold text-gray-900 group-hover:text-indigo-600 transition-colors">
                  {item.title}
                </h3>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">{item.desc}</p>
              </div>

              <div className="pt-2 border-t border-gray-100 text-[11px] font-medium text-indigo-600 flex items-center gap-1">
                <span>以该创意开始</span>
                <ArrowRight className="w-3 h-3" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 最近项目快速恢复区 */}
      {history.length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-800 flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-gray-600" />
              继续最近的项目
            </h2>
            <span className="text-xs text-gray-400">共 {history.length} 个历史项目</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {history.slice(0, 6).map((item) => (
              <div
                key={item.id}
                onClick={() => onSelectProject(item.id)}
                className="p-4 rounded-xl bg-white border border-gray-200 hover:border-gray-400 hover:shadow-xs transition-all cursor-pointer group flex items-start justify-between"
              >
                <div className="min-w-0 pr-3">
                  <h4 className="text-xs font-bold text-gray-900 truncate group-hover:text-indigo-600">
                    {item.idea || '未命名短剧'}
                  </h4>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400">
                    <Clock className="w-3 h-3" />
                    <span>{item.date || '近期'}</span>
                    <span className="w-1 h-1 rounded-full bg-gray-300" />
                    <span className="text-indigo-600 font-medium">点击继续</span>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-gray-600 shrink-0 mt-0.5" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
