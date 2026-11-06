import { useState } from 'react';
import {
  Film,
  RefreshCw,
  Clock,
  ChevronDown,
  ChevronUp,
  Activity,
  User,
  Sparkles,
  Layers,
} from 'lucide-react';
import { assetUrl } from '../../stages/utils';

export interface KeyPoseItem {
  poseIndex: number;
  timestampSec: number;
  poseName: string;
  poseDescription: string;
  poseImageUrl?: string;
}

export interface VideoClipItem {
  clipId: string;
  shotId: string;
  videoUrl?: string;
  durationSec?: number;
  duration?: number;
  resolution?: string;
  ratio?: string;
  status: string;
  prompt?: string;
  keyPoses?: KeyPoseItem[];
  renderMode?: 'direct_i2v' | 'pose_breakdown';
  characterPrompt?: string;
}

interface VideoProductionViewerProps {
  videoArtifact?: any;
  onRegenerateClip?: (shotId: string) => void;
  onReviseAction?: (shotId: string) => void;
  isRunning?: boolean;
}

export default function VideoProductionViewer({
  videoArtifact,
  onRegenerateClip,
  onReviseAction,
}: VideoProductionViewerProps) {
  const clips: VideoClipItem[] = videoArtifact?.renderedClips || videoArtifact?.clips || [];
  const [expandedPoses, setExpandedPoses] = useState<Record<string, boolean>>({});

  const togglePoses = (shotId: string) => {
    setExpandedPoses((prev) => ({
      ...prev,
      [shotId]: !prev[shotId],
    }));
  };

  if (clips.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 text-slate-500">
        <Film className="w-12 h-12 mb-3 text-slate-600 animate-pulse" />
        <p className="text-sm font-medium">正在由【视频导演】逐镜头调用动态大模型渲染视频切片与配音...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-y-auto p-6 space-y-6 text-slate-200">
      {/* 头部统计 */}
      <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800 shadow-xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-950 border border-indigo-800 flex items-center justify-center text-indigo-400">
            <Film className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100">节点动态视频切片库 (分级自适应架构)</h3>
            <p className="text-xs text-slate-400">
              支持常规 I2V 平滑渲染、角色换新微调与动作姿态时序分解预演 (Key-Pose Animatic)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full text-xs font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">
            已完成切片：{clips.length} 个
          </span>
        </div>
      </div>

      {/* 视频卡片流 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {clips.map((clip: any, idx: number) => {
          const videoUrl = clip.selected || clip.videoUrl || clip.video_path;
          const shotId = clip.shotId || `shot_${idx + 1}`;
          const isPoseExpanded = !!expandedPoses[shotId];
          const hasPoses = Array.isArray(clip.keyPoses) && clip.keyPoses.length > 0;
          const isPoseMode = clip.renderMode === 'pose_breakdown' || hasPoses;

          return (
            <div
              key={shotId}
              className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-xl flex flex-col justify-between hover:border-indigo-500/60 transition-all"
            >
              {/* 视频播放器 */}
              <div className="aspect-video w-full bg-black relative flex items-center justify-center">
                {videoUrl ? (
                  <video
                    src={assetUrl(videoUrl)}
                    controls
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-center p-4">
                    <Clock className="w-8 h-8 text-slate-600 mx-auto mb-2 animate-spin" />
                    <span className="text-xs text-slate-500">正在渲染动态视频...</span>
                  </div>
                )}
              </div>

              {/* 卡片详情区 */}
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-100">{shotId} 视频切片</span>
                    {isPoseMode ? (
                      <span className="px-2 py-0.5 rounded-md bg-purple-950/80 border border-purple-800/80 text-purple-300 text-[10px] font-semibold flex items-center gap-1">
                        <Activity className="w-2.5 h-2.5" /> 动作分解模式
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-slate-300 text-[10px] font-semibold flex items-center gap-1">
                        <Sparkles className="w-2.5 h-2.5 text-indigo-400" /> 标准 I2V
                      </span>
                    )}
                  </div>
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px] font-bold">
                    {Math.round(clip.durationSec || clip.duration || 3)} 秒
                  </span>
                </div>

                {/* 角色外貌特征锁定标签 */}
                {clip.characterPrompt && (
                  <div className="text-[11px] bg-slate-950/70 border border-slate-800/80 rounded-lg p-2 text-indigo-300 flex items-start gap-1.5">
                    <User className="w-3.5 h-3.5 mt-0.5 shrink-0 text-indigo-400" />
                    <span>角色锁定：{clip.characterPrompt}</span>
                  </div>
                )}

                {/* 动态提示词说明 */}
                {clip.prompt && (
                  <p className="text-[11px] text-slate-400 line-clamp-2">
                    动态提示词: {clip.prompt}
                  </p>
                )}

                {/* 动作姿态时序分解折叠区 */}
                {hasPoses && (
                  <div className="bg-slate-950/60 rounded-xl border border-slate-800/80 p-2.5 space-y-2">
                    <button
                      onClick={() => togglePoses(shotId)}
                      className="w-full flex items-center justify-between text-left text-[11px] font-semibold text-purple-300 hover:text-purple-200 transition-colors"
                    >
                      <span className="flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-purple-400" />
                        动作姿态序列 ({clip.keyPoses.length} 个时序卡点)
                      </span>
                      {isPoseExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {isPoseExpanded && (
                      <div className="space-y-1.5 pt-1 border-t border-slate-800/60">
                        {clip.keyPoses.map((pose: KeyPoseItem, pIdx: number) => (
                          <div
                            key={pIdx}
                            className="bg-slate-900/90 rounded-lg p-2 border border-slate-800/50 flex flex-col space-y-1 text-[11px]"
                          >
                            <div className="flex items-center justify-between font-bold text-slate-200">
                              <span className="text-purple-300">
                                #{pose.poseIndex + 1} [{pose.timestampSec.toFixed(1)}s] {pose.poseName}
                              </span>
                            </div>
                            <p className="text-slate-400 text-[10px] leading-relaxed">
                              {pose.poseDescription}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 底部操作工具栏 */}
                <div className="pt-2 border-t border-slate-800 flex items-center justify-end gap-2">
                  {onReviseAction && (
                    <button
                      onClick={() => onReviseAction(shotId)}
                      className="px-2.5 py-1 rounded-lg border border-purple-800/80 hover:bg-purple-950/40 text-purple-300 text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors"
                      title="呼起动作分解引擎，重新规划动作姿态卡点"
                    >
                      <Activity className="w-3 h-3 text-purple-400" /> 动作姿态精修
                    </button>
                  )}
                  {onRegenerateClip && (
                    <button
                      onClick={() => onRegenerateClip(shotId)}
                      className="px-2.5 py-1 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" /> 重染此镜头
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
