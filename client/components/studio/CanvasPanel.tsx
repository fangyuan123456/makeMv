'use client';

import React from 'react';
import { CheckCircle2, ArrowRight, Sparkles, Layers, ShieldCheck } from 'lucide-react';
import { MilestoneId, MilestoneInfo } from './studio.types';
import NarrativeViewer from './viewers/NarrativeViewer';
import AssetProductionViewer from './viewers/AssetProductionViewer';
import PrevisViewer from './viewers/PrevisViewer';
import VideoProductionViewer from './viewers/VideoProductionViewer';
import FMVPlaygroundViewer from './viewers/FMVPlaygroundViewer';
import WelcomeViewer from './viewers/WelcomeViewer';
import { HistoryItem } from './StudioHeader';

interface CanvasPanelProps {
  activeMilestone: MilestoneInfo;
  artifacts: Record<string, any>;
  sessionId: string | null;
  isWaitingForConfirmation: boolean;
  isRunning: boolean;
  onConfirmNext: () => void;
  onRefreshArtifacts: () => void;
  onTriggerCharacterGen: (characterIds: string[]) => void;
  onRegenerateShotImage?: (shotId: string) => void;
  onRegenerateClip?: (shotId: string) => void;
  onSelectInspiration: (idea: string) => void;
  onSelectProject: (id: string) => void;
  history?: HistoryItem[];
}

export default function CanvasPanel({
  activeMilestone,
  artifacts,
  sessionId,
  isWaitingForConfirmation,
  isRunning,
  onConfirmNext,
  onRefreshArtifacts,
  onTriggerCharacterGen,
  onRegenerateShotImage,
  onRegenerateClip,
  onSelectInspiration,
  onSelectProject,
  history = [],
}: CanvasPanelProps) {
  if (!sessionId) {
    return (
      <WelcomeViewer
        onSelectInspiration={onSelectInspiration}
        onSelectProject={onSelectProject}
        history={history}
      />
    );
  }

  const renderViewer = () => {
    switch (activeMilestone.id) {
      case 'milestone_1':
        return (
          <NarrativeViewer
            artifact={artifacts['narrative_design']}
            isRunning={isRunning}
          />
        );

      case 'milestone_2':
        return (
          <AssetProductionViewer
            characterArtifact={artifacts['character_design']}
            scriptArtifact={artifacts['scene_script'] || artifacts['narrative_design']}
            sessionId={sessionId}
            onRefreshArtifacts={onRefreshArtifacts}
            onTriggerCharacterGen={onTriggerCharacterGen}
          />
        );

      case 'milestone_3':
        return (
          <PrevisViewer
            storyboardArtifact={artifacts['storyboard']}
            referenceArtifact={artifacts['keyframe_reference']}
            onRegenerateShotImage={onRegenerateShotImage}
            isRunning={isRunning}
          />
        );

      case 'milestone_4':
        return (
          <VideoProductionViewer
            videoArtifact={artifacts['video_production']}
            onRegenerateClip={onRegenerateClip}
            isRunning={isRunning}
          />
        );

      case 'milestone_5':
        return (
          <FMVPlaygroundViewer
            packagerArtifact={artifacts['fmv_packaging']}
            sessionId={sessionId}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 relative overflow-hidden">
      {/* 画布顶部说明条与确认下一步按钮 */}
      <div className="bg-white border-b border-gray-200 px-6 py-3.5 flex items-center justify-between shrink-0 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-gray-900">{activeMilestone.name}</h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
              {activeMilestone.tagline}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">{activeMilestone.description}</p>
        </div>

        {/* 顶部主确认按钮 */}
        {isWaitingForConfirmation && (
          <button
            onClick={onConfirmNext}
            disabled={isRunning}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-all cursor-pointer disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>确认当前产物，进入下一步</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* 核心产物内容展示区 */}
      <div className="flex-1 overflow-hidden">{renderViewer()}</div>
    </div>
  );
}
