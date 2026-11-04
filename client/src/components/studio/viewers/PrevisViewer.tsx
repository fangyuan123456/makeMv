import { Clapperboard, Image as ImageIcon, ShieldCheck, RefreshCw, Eye } from 'lucide-react';
import { assetUrl } from '../../stages/utils';

interface PrevisViewerProps {
  storyboardArtifact?: any;
  referenceArtifact?: any;
  onRegenerateShotImage?: (shotId: string) => void;
  isRunning?: boolean;
}

export default function PrevisViewer({
  storyboardArtifact,
  referenceArtifact,
  onRegenerateShotImage,
}: PrevisViewerProps) {
  const shots = storyboardArtifact?.shots || [];
  const refMap = new Map<string, any>();
  for (const ref of referenceArtifact?.shots || []) {
    refMap.set(ref.shotId || ref.id, ref);
  }

  if (shots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 text-slate-500">
        <Clapperboard className="w-12 h-12 mb-3 text-slate-600 animate-pulse" />
        <p className="text-sm font-medium">正在由【分镜师】与【画师】联合切分镜头与渲染关键帧...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-y-auto p-6 space-y-6 text-slate-200">
      {/* 顶部质检徽章 */}
      <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800 shadow-xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-950 border border-emerald-800 flex items-center justify-center text-emerald-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100">分镜视听语言与高清关键帧</h3>
            <p className="text-xs text-slate-400">已由 Doctor 合规官完成画风与人物一致性质检</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
            已就绪：{shots.length} 个分镜头
          </span>
        </div>
      </div>

      {/* 分镜卡片流 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {shots.map((shot: any, idx: number) => {
          const ref = refMap.get(shot.shotId);
          const imageUrl = ref?.imageUrl || shot.firstFrameImageUrl || shot.imageUrl;
          const shotName = shot.name || `镜头 #${shot.shotId || idx + 1}`;

          return (
            <div
              key={shot.shotId || idx}
              className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-xl flex flex-col justify-between hover:border-indigo-500 transition-all"
            >
              {/* 关键帧图像预览 */}
              <div className="aspect-video w-full bg-black relative group overflow-hidden flex items-center justify-center">
                {imageUrl ? (
                  <>
                    <img
                      src={assetUrl(imageUrl)}
                      alt={shotName}
                      className="w-full h-full object-cover transition-transform group-hover:scale-102"
                    />
                    <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-xs text-white text-[11px] font-mono font-bold">
                      {shot.shotId}
                    </div>
                    {shot.cameraMovement && (
                      <div className="absolute bottom-2.5 left-2.5 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-xs text-indigo-300 text-[10px] font-bold">
                        🎥 {shot.cameraMovement}
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center gap-2">
                      <a
                        href={assetUrl(imageUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 rounded-xl bg-slate-800/90 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1 shadow-sm border border-slate-700"
                      >
                        <Eye className="w-3.5 h-3.5" /> 查看大图
                      </a>
                      {onRegenerateShotImage && (
                        <button
                          onClick={() => onRegenerateShotImage(shot.shotId)}
                          className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1 shadow-sm cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" /> 重新生图
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-center p-4">
                    <ImageIcon className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                    <span className="text-xs text-slate-500">正在生成高清关键帧...</span>
                  </div>
                )}
              </div>

              {/* 镜头信息 */}
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-100">{shotName}</span>
                  <div className="flex items-center gap-1 text-[11px] text-slate-400">
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 font-bold">{shot.shotScale || '中景'}</span>
                    <span>·</span>
                    <span>{shot.duration || 5} 秒</span>
                  </div>
                </div>

                {shot.dialogueOrAction && (
                  <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 leading-relaxed">
                    <strong className="text-slate-100 mr-1">台词/动作:</strong>
                    {shot.dialogueOrAction}
                  </div>
                )}

                {shot.visualContent && (
                  <p className="text-[11px] text-slate-400 line-clamp-2">
                    画面说明: {shot.visualContent}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
