'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Gamepad2,
  Clock,
  Heart,
  Briefcase,
  AlertTriangle,
  Trophy,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { assetUrl } from './utils';

export interface FMVChoice {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  choiceText: string;
  timeoutSeconds?: number;
  isTimeoutDefault?: boolean;
  conditions?: {
    requiredClues?: string[];
    minAffinity?: Record<string, number>;
    flagsRequired?: Record<string, boolean>;
  };
  effects?: {
    affinityDelta?: Record<string, number>;
    gainItems?: string[];
    setFlags?: Record<string, boolean>;
  };
}

export interface FMVNodeAsset {
  nodeId: string;
  title: string;
  videoUrl: string;
  localPath?: string;
  durationSec: number;
  decisionTimeSec?: number;
  holdImageUrl?: string;
  loopVideoUrl?: string;
  isDecisionPoint: boolean;
  choices?: FMVChoice[];
}

export interface FMVManifest {
  gameTitle: string;
  startNodeId: string;
  totalDurationSec: number;
  nodes: Record<string, FMVNodeAsset>;
}

interface FMVInteractivePlayerProps {
  manifest?: FMVManifest;
  sessionId?: string;
  onRestart?: () => void;
}

export default function FMVInteractivePlayer({
  manifest,
  sessionId,
  onRestart,
}: FMVInteractivePlayerProps) {
  const [currentNodeId, setCurrentNodeId] = useState<string>(manifest?.startNodeId || '');
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isLooping, setIsLooping] = useState<boolean>(false);
  const [showChoices, setShowChoices] = useState<boolean>(false);
  const [qteRemaining, setQteRemaining] = useState<number | null>(null);

  // Global Game State (Affinity, Inventory, Flags)
  const [gameState, setGameState] = useState<{
    affinity: Record<string, number>;
    inventory: string[];
    flags: Record<string, boolean>;
  }>({
    affinity: {},
    inventory: [],
    flags: {},
  });

  const [history, setHistory] = useState<string[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const qteTimerRef = useRef<NodeJS.Timeout | null>(null);

  const currentNode: FMVNodeAsset | undefined = manifest?.nodes?.[currentNodeId];

  // Initialize or reset game
  useEffect(() => {
    if (manifest?.startNodeId) {
      setCurrentNodeId(manifest.startNodeId);
      setHistory([manifest.startNodeId]);
      setShowChoices(false);
      setIsLooping(false);
      setIsPlaying(true);
    }
  }, [manifest]);

  // Handle video timeupdate to trigger choices before video ends
  const handleTimeUpdate = () => {
    if (!videoRef.current || !currentNode) return;
    const current = videoRef.current.currentTime;
    const duration = videoRef.current.duration || currentNode.durationSec || 5;

    // Trigger choices at decisionTimeSec, or in last 3 seconds
    const decisionThreshold = currentNode.decisionTimeSec ?? Math.max(0, duration - 3.5);

    if (currentNode.isDecisionPoint && current >= decisionThreshold && !showChoices) {
      triggerDecisionPoint();
    }
  };

  // Video ended handler: transition to hold loop if choices still unselected
  const handleVideoEnded = () => {
    if (!currentNode) return;

    if (currentNode.isDecisionPoint) {
      setShowChoices(true);
      // If loop video exists, play loop video smoothly
      if (currentNode.loopVideoUrl && videoRef.current) {
        setIsLooping(true);
        videoRef.current.src = assetUrl(currentNode.loopVideoUrl);
        videoRef.current.loop = true;
        videoRef.current.play().catch(() => {});
      }
    } else if (currentNode.choices && currentNode.choices.length === 1) {
      // Auto-advance for single linear branch
      makeChoice(currentNode.choices[0]);
    }
  };

  const triggerDecisionPoint = () => {
    setShowChoices(true);

    // Check for QTE timeout
    const defaultChoice = currentNode?.choices?.find((c) => c.isTimeoutDefault);
    const qteChoiceWithTimeout = currentNode?.choices?.find((c) => c.timeoutSeconds && c.timeoutSeconds > 0);
    const timeoutSec = qteChoiceWithTimeout?.timeoutSeconds || (defaultChoice ? 5 : null);

    if (timeoutSec) {
      setQteRemaining(timeoutSec);
      if (qteTimerRef.current) clearInterval(qteTimerRef.current);

      let timeLeft = timeoutSec;
      qteTimerRef.current = setInterval(() => {
        timeLeft -= 0.1;
        if (timeLeft <= 0) {
          if (qteTimerRef.current) clearInterval(qteTimerRef.current);
          setQteRemaining(null);
          // Timeout occurred: follow default fallback choice
          if (defaultChoice) {
            makeChoice(defaultChoice);
          } else if (currentNode?.choices?.[0]) {
            makeChoice(currentNode.choices[0]);
          }
        } else {
          setQteRemaining(Math.max(0, timeLeft));
        }
      }, 100);
    }
  };

  // Execute a choice
  const makeChoice = (choice: FMVChoice) => {
    if (qteTimerRef.current) {
      clearInterval(qteTimerRef.current);
      qteTimerRef.current = null;
    }
    setQteRemaining(null);
    setShowChoices(false);
    setIsLooping(false);

    // Apply effects (Affinity, inventory, flags)
    const newAffinity = { ...gameState.affinity };
    if (choice.effects?.affinityDelta) {
      for (const [char, delta] of Object.entries(choice.effects.affinityDelta)) {
        newAffinity[char] = (newAffinity[char] || 50) + delta;
      }
    }

    const newInventory = [...gameState.inventory];
    if (choice.effects?.gainItems) {
      newInventory.push(...choice.effects.gainItems);
    }

    const newFlags = { ...gameState.flags, ...(choice.effects?.setFlags || {}) };

    setGameState({
      affinity: newAffinity,
      inventory: Array.from(new Set(newInventory)),
      flags: newFlags,
    });

    // Advance to target node
    if (choice.toNodeId && manifest?.nodes?.[choice.toNodeId]) {
      setHistory((prev) => [...prev, choice.toNodeId]);
      setCurrentNodeId(choice.toNodeId);
      setIsPlaying(true);
    }
  };

  // Restart / Rewind to previous checkpoint
  const rewindToCheckpoint = () => {
    if (history.length > 1) {
      const prevNodeId = history[history.length - 2];
      setHistory((prev) => prev.slice(0, -1));
      setCurrentNodeId(prevNodeId);
      setShowChoices(false);
      setIsLooping(false);
      setIsPlaying(true);
    } else if (manifest?.startNodeId) {
      setCurrentNodeId(manifest.startNodeId);
      setHistory([manifest.startNodeId]);
      setShowChoices(false);
      setIsLooping(false);
      setIsPlaying(true);
    }
  };

  if (!manifest || !Object.keys(manifest.nodes || {}).length) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center bg-white rounded-2xl border border-dashed border-gray-300">
        <Gamepad2 className="w-12 h-12 text-gray-300 mb-3" />
        <h4 className="text-sm font-bold text-gray-700">暂无互动影游清单</h4>
        <p className="text-xs text-gray-400 mt-1 max-w-sm">
          请在生成分镜视频后，点击「影游装配与合成」生成包含决策图谱的 game_manifest.json。
        </p>
      </div>
    );
  }

  const isEnding = !currentNode?.isDecisionPoint && (!currentNode?.choices || currentNode.choices.length === 0);
  const isBadEnd = currentNode?.title?.includes('坏结局') || currentNode?.title?.includes('败') || currentNode?.title?.includes('当场');

  return (
    <div className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl border border-slate-800 select-none group">
      {/* 视频渲染层 */}
      {currentNode?.videoUrl && (
        <video
          ref={videoRef}
          key={`${currentNodeId}_${isLooping}`}
          src={assetUrl(isLooping && currentNode.loopVideoUrl ? currentNode.loopVideoUrl : currentNode.videoUrl)}
          className="w-full h-full object-cover"
          autoPlay
          playsInline
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleVideoEnded}
        />
      )}

      {/* 顶部 HUD：游戏标题、好感度与背包 */}
      <div className="absolute top-0 inset-x-0 p-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between pointer-events-none z-20">
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-md bg-indigo-600/80 backdrop-blur-md text-[11px] font-bold text-white tracking-wider flex items-center gap-1.5 shadow-sm">
            <Gamepad2 className="w-3.5 h-3.5" />
            {manifest.gameTitle}
          </span>
          <span className="text-xs text-white/70 font-medium drop-shadow-sm">
            {currentNode?.title}
          </span>
        </div>

        {/* 状态徽章：好感度与道具 */}
        <div className="flex items-center gap-3">
          {Object.entries(gameState.affinity).map(([char, val]) => (
            <div
              key={char}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-xs text-rose-300 font-semibold"
            >
              <Heart className="w-3 h-3 text-rose-500 fill-rose-500" />
              <span>{char}</span>
              <span className="text-white font-mono">{val}</span>
            </div>
          ))}

          {gameState.inventory.length > 0 && (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-xs text-amber-300 font-semibold">
              <Briefcase className="w-3 h-3 text-amber-400" />
              <span>道具: {gameState.inventory.join(', ')}</span>
            </div>
          )}
        </div>
      </div>

      {/* QTE 限时倒计时条 */}
      {qteRemaining !== null && (
        <div className="absolute top-14 inset-x-8 z-30 flex flex-col items-center">
          <div className="w-full max-w-md h-2 bg-black/60 rounded-full overflow-hidden border border-rose-500/40 p-0.5">
            <div
              className="h-full bg-gradient-to-r from-amber-400 to-rose-500 rounded-full transition-all duration-100 ease-linear shadow-lg"
              style={{ width: `${Math.min(100, (qteRemaining / 5) * 100)}%` }}
            />
          </div>
          <span className="text-[11px] font-bold text-rose-400 mt-1 flex items-center gap-1 animate-pulse">
            <Clock className="w-3 h-3" />
            决策倒计时: {qteRemaining.toFixed(1)}s
          </span>
        </div>
      )}

      {/* 交互分支选项层 (弹层浮于视频上方) */}
      {showChoices && currentNode?.choices && currentNode.choices.length > 0 && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-xs flex flex-col items-center justify-end p-8 pb-12 z-30 animate-in fade-in duration-300">
          <p className="text-xs uppercase tracking-widest text-indigo-300 font-bold mb-4 drop-shadow-md flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            请做出你的抉择
          </p>

          <div className="w-full max-w-xl flex flex-col gap-2.5">
            {currentNode.choices.map((choice, idx) => {
              // Condition check (e.g. requiredClues)
              const hasRequiredClues = choice.conditions?.requiredClues
                ? choice.conditions.requiredClues.every((c) => gameState.inventory.includes(c))
                : true;

              return (
                <button
                  key={choice.id || idx}
                  disabled={!hasRequiredClues}
                  onClick={() => makeChoice(choice)}
                  className={`group/btn relative w-full px-5 py-3.5 rounded-xl border text-left transition-all duration-200 cursor-pointer flex items-center justify-between ${
                    hasRequiredClues
                      ? 'bg-slate-900/90 hover:bg-indigo-600/90 border-white/20 hover:border-indigo-400 text-white shadow-lg hover:shadow-indigo-500/30 hover:scale-[1.01]'
                      : 'bg-black/60 border-white/5 text-gray-500 cursor-not-allowed opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-indigo-300 group-hover/btn:bg-white group-hover/btn:text-indigo-700 transition-colors">
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <span className="text-sm font-semibold tracking-wide">
                      {choice.choiceText}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {choice.timeoutSeconds && (
                      <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-mono border border-rose-500/30">
                        限时 {choice.timeoutSeconds}s
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 text-white/40 group-hover/btn:text-white transition-transform group-hover/btn:translate-x-0.5" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 终局结算界面 (Bad End / True End) */}
      {isEnding && (
        <div className="absolute inset-0 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-8 z-30 animate-in zoom-in-95 duration-500">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 shadow-xl border border-white/10">
            {isBadEnd ? (
              <ShieldAlert className="w-8 h-8 text-rose-500" />
            ) : (
              <Trophy className="w-8 h-8 text-amber-400" />
            )}
          </div>

          <h3 className="text-xl font-bold text-white tracking-wider mb-2">
            {currentNode?.title}
          </h3>
          <p className="text-xs text-white/60 max-w-md text-center mb-6">
            {isBadEnd ? '命运在此处折戟，你的选择决定了故事的结局。' : '恭喜你成功破局，达成终局胜利！'}
          </p>

          <div className="flex items-center gap-3">
            <button
              onClick={rewindToCheckpoint}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all cursor-pointer border border-white/20"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              回到上一抉择点
            </button>

            <button
              onClick={onRestart || rewindToCheckpoint}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all cursor-pointer shadow-lg shadow-indigo-600/30"
            >
              <Play className="w-3.5 h-3.5" />
              从头再玩一次
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
