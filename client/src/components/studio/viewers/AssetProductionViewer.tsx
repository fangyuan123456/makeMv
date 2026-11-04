import { useState, useRef } from 'react';
import {
  Users,
  FileText,
  Sparkles,
  Upload,
  Image as ImageIcon,
  RefreshCw,
  Layers,
  MessageSquare,
  GitBranch,
} from 'lucide-react';
import { assetUrl } from '../../stages/utils';
import { MASTRA_SERVER_URL } from '../../../lib/mastra';

interface AssetProductionViewerProps {
  characterArtifact?: any;
  scriptArtifact?: any;
  sessionId: string;
  onRefreshArtifacts?: () => void;
  onTriggerCharacterGen?: (characterIds: string[]) => void;
}

export default function AssetProductionViewer({
  characterArtifact,
  scriptArtifact,
  sessionId,
  onRefreshArtifacts,
  onTriggerCharacterGen,
}: AssetProductionViewerProps) {
  const [activeTab, setActiveTab] = useState<'characters' | 'script'>('characters');
  const [_uploadingCharId, setUploadingCharId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const refFileInputRef = useRef<HTMLInputElement | null>(null);
  const [currentUploadTarget, setCurrentUploadTarget] = useState<{ charId: string; type: 'final' | 'reference' } | null>(null);

  const characters = characterArtifact?.characters || scriptArtifact?.characters || scriptArtifact?.bible?.characters || [];
  const scenes = scriptArtifact?.scenes || [];
  const episodes = scriptArtifact?.episodes || [];

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, type: 'final' | 'reference') => {
    const file = e.target.files?.[0];
    if (!file || !currentUploadTarget) return;

    try {
      setUploadingCharId(currentUploadTarget.charId);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', type);
      formData.append('characterId', currentUploadTarget.charId);

      const res = await fetch(`${MASTRA_SERVER_URL}/api/projects/${sessionId}/media/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onRefreshArtifacts?.();
    } catch (err: any) {
      alert(`上传图片提示: ${err.message || '网络异常'}`);
    } finally {
      setUploadingCharId(null);
      setCurrentUploadTarget(null);
      if (e.target) e.target.value = '';
    }
  };

  const triggerUpload = (charId: string, type: 'final' | 'reference') => {
    setCurrentUploadTarget({ charId, type });
    if (type === 'reference') {
      refFileInputRef.current?.click();
    } else {
      fileInputRef.current?.click();
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200 overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFileChange(e, 'final')}
      />
      <input
        ref={refFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFileChange(e, 'reference')}
      />

      {/* 顶部双轨资产切换栏 */}
      <div className="bg-slate-900 border-b border-slate-800 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 p-1 bg-slate-950 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('characters')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'characters'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>角色视觉设定库 ({characters.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('script')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'script'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>节点互动剧本正文</span>
          </button>
        </div>

        {activeTab === 'characters' && characters.length > 0 && (
          <button
            onClick={() => onTriggerCharacterGen?.(characters.map((c: any) => c.id || c.name))}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-xs transition-all cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>一键 AI 生成全部角色定妆图</span>
          </button>
        )}
      </div>

      {/* 主展示区 */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'characters' ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-blue-950/40 border border-blue-800/60 text-xs text-blue-200 flex items-center justify-between">
              <div>
                <strong>💡 角色设定已就绪</strong>：系统已完成角色性格、动机与外貌设定。您可以点击「AI生成定妆图」，也可以手动上传您心仪的目标图或参考图进行锚定。
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {characters.map((char: any, idx: number) => {
                const charId = char.id || char.name;
                const hasImage = Boolean(char.selected || char.imageUrl);
                const hasRefImage = Boolean(char.referenceImageUrl);

                return (
                  <div
                    key={charId || idx}
                    className="bg-slate-900 rounded-2xl border border-slate-800 p-5 shadow-xl flex flex-col justify-between space-y-4 hover:border-indigo-500 transition-all"
                  >
                    <div>
                      {/* 角色头部 */}
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-base font-bold text-slate-100">{char.name}</h4>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">
                              {char.role || '核心人物'}
                            </span>
                          </div>
                          {char.personality && (
                            <p className="text-xs text-purple-300 mt-1 font-medium">
                              性格：{char.personality}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* 外貌描述 */}
                      {(char.appearancePrompt || char.appearance) && (
                        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-400 leading-relaxed mb-4">
                          <span className="font-bold text-slate-200">外貌体征：</span>
                          {char.appearancePrompt || char.appearance}
                        </div>
                      )}

                      {/* 图像展示 / 上传区域 */}
                      <div className="grid grid-cols-2 gap-3">
                        {/* 定妆成品图 */}
                        <div className="flex flex-col">
                          <span className="text-[11px] font-bold text-slate-300 mb-1.5 flex items-center gap-1">
                            <ImageIcon className="w-3 h-3 text-indigo-400" />
                            目标定妆图
                          </span>
                          <div className="aspect-[3/4] w-full rounded-xl border-2 border-dashed border-slate-700 bg-black relative flex items-center justify-center overflow-hidden group">
                            {hasImage ? (
                              <>
                                <img
                                  src={assetUrl(char.selected || char.imageUrl)}
                                  alt={char.name}
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all flex flex-col items-center justify-center gap-2 p-2">
                                  <button
                                    onClick={() => triggerUpload(charId, 'final')}
                                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-bold cursor-pointer border border-slate-600"
                                  >
                                    替换目标图
                                  </button>
                                  <button
                                    onClick={() => onTriggerCharacterGen?.([charId])}
                                    className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold cursor-pointer flex items-center gap-1"
                                  >
                                    <RefreshCw className="w-2.5 h-2.5" /> AI 重新生成
                                  </button>
                                </div>
                              </>
                            ) : (
                              <div className="text-center p-3 flex flex-col items-center">
                                <Users className="w-8 h-8 text-slate-600 mb-2" />
                                <span className="text-[11px] text-slate-400 font-medium mb-3">暂无定妆图</span>
                                <div className="flex flex-col gap-1.5 w-full">
                                  <button
                                    onClick={() => onTriggerCharacterGen?.([charId])}
                                    className="w-full py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold shadow-xs cursor-pointer flex items-center justify-center gap-1"
                                  >
                                    <Sparkles className="w-3 h-3" /> AI 生成定妆
                                  </button>
                                  <button
                                    onClick={() => triggerUpload(charId, 'final')}
                                    className="w-full py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-200 text-[11px] font-medium cursor-pointer flex items-center justify-center gap-1"
                                  >
                                    <Upload className="w-3 h-3" /> 上传目标图
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* 参考图 (Reference) */}
                        <div className="flex flex-col">
                          <span className="text-[11px] font-bold text-slate-300 mb-1.5 flex items-center gap-1">
                            <Layers className="w-3 h-3 text-violet-400" />
                            面部/服装参考图 (可选)
                          </span>
                          <div className="aspect-[3/4] w-full rounded-xl border-2 border-dashed border-slate-700 bg-black relative flex items-center justify-center overflow-hidden group">
                            {hasRefImage ? (
                              <>
                                <img
                                  src={assetUrl(char.referenceImageUrl)}
                                  alt={`${char.name} 参考`}
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                                  <button
                                    onClick={() => triggerUpload(charId, 'reference')}
                                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-bold cursor-pointer border border-slate-600"
                                  >
                                    更换参考图
                                  </button>
                                </div>
                              </>
                            ) : (
                              <div className="text-center p-3 flex flex-col items-center">
                                <Upload className="w-6 h-6 text-slate-600 mb-2" />
                                <span className="text-[11px] text-slate-500 font-medium mb-2">提供真人/造型参考</span>
                                <button
                                  onClick={() => triggerUpload(charId, 'reference')}
                                  className="py-1 px-3 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 text-[10px] font-medium cursor-pointer"
                                >
                                  上传参考图
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* 节点互动剧本正文视图 */
          <div className="space-y-6 max-w-4xl mx-auto">
            {scenes.length > 0 ? (
              <div className="space-y-5">
                <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 shadow-xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-indigo-950 border border-indigo-800 flex items-center justify-center text-indigo-400">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-100">{scriptArtifact?.title || '分场多分支剧本文学稿'}</h3>
                      <p className="text-xs text-slate-400">共 {scenes.length} 个戏剧场次，已完成网状分支与对白对齐</p>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">
                    {scenes.length} 场戏
                  </span>
                </div>

                {scenes.map((sc: any, sIdx: number) => (
                  <div key={sc.nodeId || sIdx} className="bg-slate-900 rounded-2xl border border-slate-800 p-6 shadow-xl space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">
                          第 {sc.act || 1} 幕
                        </span>
                        <h4 className="text-sm font-bold text-slate-100">
                          {sc.sceneTitle || `场次 #${sIdx + 1}`}
                        </h4>
                        <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                          {sc.nodeId}
                        </span>
                      </div>
                      <span className="text-xs text-slate-400">
                        📍 {sc.location || '场景空间'} · ⏱️ {sc.timeOfDay || '日内'}
                      </span>
                    </div>

                    {sc.actionSummary && (
                      <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 leading-relaxed">
                        <strong className="text-indigo-400 font-bold mr-1.5">🎬 视听动作描写:</strong>
                        <span>{sc.actionSummary}</span>
                      </div>
                    )}

                    {sc.dialogues && sc.dialogues.length > 0 && (
                      <div className="space-y-2 pt-1">
                        <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
                          <MessageSquare className="w-3 h-3 text-indigo-400" /> 核心对白交锋:
                        </span>
                        <div className="space-y-1.5 pl-1">
                          {sc.dialogues.map((dlg: any, dIdx: number) => (
                            <div key={dIdx} className="flex items-start gap-2 bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 text-xs">
                              <span className="font-bold text-indigo-300 shrink-0 min-w-16">
                                {dlg.speaker}:
                              </span>
                              <div className="flex-1 space-x-1">
                                {dlg.parenthetical && (
                                  <span className="text-slate-500 italic">（{dlg.parenthetical}）</span>
                                )}
                                <span className="text-slate-200 font-medium">{dlg.line}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {sc.interactionMoment && (
                      <div className="pt-2 border-t border-slate-800 flex items-center gap-2 text-xs text-amber-300 bg-amber-950/40 p-2.5 rounded-xl border border-amber-800/60">
                        <GitBranch className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="font-bold shrink-0">互动时刻:</span>
                        <span>{sc.interactionMoment}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : episodes.length > 0 ? (
              episodes.map((ep: any, eIdx: number) => (
                <div key={eIdx} className="bg-slate-900 rounded-2xl border border-slate-800 p-6 shadow-xl space-y-6">
                  <div className="border-b border-slate-800 pb-4">
                    <span className="text-xs font-bold text-indigo-400">第 {ep.episodeNumber || eIdx + 1} 集</span>
                    <h3 className="text-lg font-bold text-slate-100 mt-0.5">{ep.title || '长文本场次详写'}</h3>
                    {ep.logline && <p className="text-xs text-slate-400 mt-1">{ep.logline}</p>}
                  </div>

                  <div className="space-y-5">
                    {(ep.scenes || []).map((sc: any, sIdx: number) => (
                      <div key={sIdx} className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-200 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-indigo-500" />
                            {sc.sceneId}: {sc.title}
                          </span>
                          <span className="text-slate-400">{sc.space}景 · {sc.time} · {sc.location}</span>
                        </div>

                        <div className="space-y-2 pt-2 border-t border-slate-800">
                          {(sc.items || []).map((it: any, iIdx: number) => (
                            <div key={iIdx} className="text-xs leading-relaxed">
                              {it.type === 'action' ? (
                                <p className="text-slate-400 italic pl-3 border-l-2 border-slate-700">
                                  🎬 {it.action?.description}
                                </p>
                              ) : (
                                <div className="flex items-start gap-2 bg-slate-900 p-2.5 rounded-lg border border-slate-800 shadow-2xs">
                                  <span className="font-bold text-indigo-300 shrink-0">
                                    {it.dialogue?.character}:
                                  </span>
                                  <span className="text-slate-200">
                                    {it.dialogue?.text}
                                  </span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>

                        {sc.choices && sc.choices.length > 0 && (
                          <div className="pt-2 border-t border-slate-800 space-y-1.5">
                            <span className="text-[11px] font-bold text-amber-400 flex items-center gap-1">
                              <GitBranch className="w-3 h-3" /> 互动分支抉择：
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {sc.choices.map((ch: any, cIdx: number) => (
                                <div
                                  key={cIdx}
                                  className="px-3 py-1 rounded-lg bg-amber-950/60 border border-amber-800 text-amber-200 text-xs font-medium"
                                >
                                  👉 {ch.choiceText}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center p-12 text-center bg-slate-900 rounded-2xl border border-slate-800 shadow-xl">
                <FileText className="w-12 h-12 text-slate-600 mb-3" />
                <h4 className="text-sm font-bold text-slate-200">暂无分场剧本文学稿</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  请先在对话区确认定妆照，并点击【推进分场剧本】提案，系统将为您拆解全节点对白与戏剧动作。
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
