'use client';

import React, { useState, useRef } from 'react';
import {
  Users,
  FileText,
  Sparkles,
  Upload,
  Image as ImageIcon,
  CheckCircle2,
  RefreshCw,
  Eye,
  MessageSquare,
  Shield,
  Layers,
  ArrowRight,
  GitBranch,
} from 'lucide-react';
import { uploadArtifactImage } from '@/lib/workflowApi';
import { assetUrl } from '../../stages/utils';

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
  const [uploadingCharId, setUploadingCharId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const refFileInputRef = useRef<HTMLInputElement | null>(null);
  const [currentUploadTarget, setCurrentUploadTarget] = useState<{ charId: string; type: 'final' | 'reference' } | null>(null);

  const characters = characterArtifact?.characters || scriptArtifact?.characters || scriptArtifact?.bible?.characters || [];
  const episodes = scriptArtifact?.episodes || [];

  // Handle image upload (Target vs Reference)
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, type: 'final' | 'reference') => {
    const file = e.target.files?.[0];
    if (!file || !currentUploadTarget) return;

    try {
      setUploadingCharId(currentUploadTarget.charId);
      const itemType = type === 'reference' ? 'reference' : 'characters';
      await uploadArtifactImage(sessionId, 'character_design', itemType, currentUploadTarget.charId, file);
      onRefreshArtifacts?.();
    } catch (err: any) {
      alert(`上传失败: ${err.message || '网络异常'}`);
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
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      {/* Hidden file inputs for uploads */}
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
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 p-1 bg-gray-100 rounded-xl">
          <button
            onClick={() => setActiveTab('characters')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'characters'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>角色视觉设定库 ({characters.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('script')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'script'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>节点互动剧本正文</span>
          </button>
        </div>

        {activeTab === 'characters' && characters.length > 0 && (
          <button
            onClick={() => onTriggerCharacterGen?.(characters.map((c: any) => c.id || c.name))}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition-all cursor-pointer"
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
            <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200/60 text-xs text-blue-900 flex items-center justify-between">
              <div>
                <strong>💡 角色设定已就绪</strong>：系统已完成角色性格、动机与外貌设定。您可以点击「AI生成定妆图」，也可以手动上传您心仪的目标图或参考图进行锚定。
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {characters.map((char: any, idx: number) => {
                const charId = char.id || char.name;
                const hasImage = Boolean(char.selected || char.imageUrl);
                const hasRefImage = Boolean(char.referenceImageUrl);
                const isUploading = uploadingCharId === charId;

                return (
                  <div
                    key={charId || idx}
                    className="bg-white rounded-2xl border border-gray-200/90 p-5 shadow-xs flex flex-col justify-between space-y-4 hover:border-indigo-300 transition-all"
                  >
                    <div>
                      {/* 角色头部 */}
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-base font-bold text-gray-900">{char.name}</h4>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              {char.role || '核心人物'}
                            </span>
                          </div>
                          {char.personality && (
                            <p className="text-xs text-purple-700 mt-1 font-medium">
                              性格：{char.personality}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* 外貌描述 */}
                      {char.appearancePrompt && (
                        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/60 text-xs text-gray-600 leading-relaxed mb-4">
                          <span className="font-bold text-gray-800">外貌体征：</span>
                          {char.appearancePrompt}
                        </div>
                      )}

                      {/* 图像展示 / 上传区域 */}
                      <div className="grid grid-cols-2 gap-3">
                        {/* 定妆成品图 */}
                        <div className="flex flex-col">
                          <span className="text-[11px] font-bold text-gray-700 mb-1.5 flex items-center gap-1">
                            <ImageIcon className="w-3 h-3 text-indigo-600" />
                            目标定妆图
                          </span>
                          <div className="aspect-[3/4] w-full rounded-xl border-2 border-dashed border-gray-200 bg-slate-50 relative flex items-center justify-center overflow-hidden group">
                            {hasImage ? (
                              <>
                                <img
                                  src={assetUrl(char.selected || char.imageUrl)}
                                  alt={char.name}
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-all flex flex-col items-center justify-center gap-2 p-2">
                                  <button
                                    onClick={() => triggerUpload(charId, 'final')}
                                    className="px-2.5 py-1 rounded-lg bg-white/90 hover:bg-white text-gray-900 text-[10px] font-bold cursor-pointer"
                                  >
                                    替换目标图
                                  </button>
                                  <button
                                    onClick={() => onTriggerCharacterGen?.([charId])}
                                    className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold cursor-pointer flex items-center gap-1"
                                  >
                                    <RefreshCw className="w-2.5 h-2.5" /> AI 重新生成
                                  </button>
                                </div>
                              </>
                            ) : (
                              <div className="text-center p-3 flex flex-col items-center">
                                <Users className="w-8 h-8 text-gray-300 mb-2" />
                                <span className="text-[11px] text-gray-500 font-medium mb-3">暂无定妆图</span>
                                <div className="flex flex-col gap-1.5 w-full">
                                  <button
                                    onClick={() => onTriggerCharacterGen?.([charId])}
                                    className="w-full py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold shadow-xs cursor-pointer flex items-center justify-center gap-1"
                                  >
                                    <Sparkles className="w-3 h-3" /> AI 生成定妆
                                  </button>
                                  <button
                                    onClick={() => triggerUpload(charId, 'final')}
                                    className="w-full py-1.5 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-[11px] font-medium cursor-pointer flex items-center justify-center gap-1"
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
                          <span className="text-[11px] font-bold text-gray-700 mb-1.5 flex items-center gap-1">
                            <Layers className="w-3 h-3 text-violet-600" />
                            面部/服装参考图 (可选)
                          </span>
                          <div className="aspect-[3/4] w-full rounded-xl border-2 border-dashed border-gray-200 bg-slate-50 relative flex items-center justify-center overflow-hidden group">
                            {hasRefImage ? (
                              <>
                                <img
                                  src={assetUrl(char.referenceImageUrl)}
                                  alt={`${char.name} 参考`}
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                                  <button
                                    onClick={() => triggerUpload(charId, 'reference')}
                                    className="px-2.5 py-1 rounded-lg bg-white/90 hover:bg-white text-gray-900 text-[10px] font-bold cursor-pointer"
                                  >
                                    更换参考图
                                  </button>
                                </div>
                              </>
                            ) : (
                              <div className="text-center p-3 flex flex-col items-center">
                                <Upload className="w-6 h-6 text-gray-300 mb-2" />
                                <span className="text-[11px] text-gray-400 font-medium mb-2">提供真人/造型参考</span>
                                <button
                                  onClick={() => triggerUpload(charId, 'reference')}
                                  className="py-1 px-3 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-[10px] font-medium cursor-pointer"
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
            {episodes.map((ep: any, eIdx: number) => (
              <div key={eIdx} className="bg-white rounded-2xl border border-gray-200/90 p-6 shadow-xs space-y-6">
                <div className="border-b border-gray-100 pb-4">
                  <span className="text-xs font-bold text-indigo-600">第 {ep.episodeNumber || eIdx + 1} 集</span>
                  <h3 className="text-lg font-bold text-gray-900 mt-0.5">{ep.title || '长文本场次详写'}</h3>
                  {ep.logline && <p className="text-xs text-gray-500 mt-1">{ep.logline}</p>}
                </div>

                {/* 场次列表 */}
                <div className="space-y-5">
                  {(ep.scenes || []).map((sc: any, sIdx: number) => (
                    <div key={sIdx} className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-gray-800 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-indigo-500" />
                          {sc.sceneId}: {sc.title}
                        </span>
                        <span className="text-gray-500">{sc.space}景 · {sc.time} · {sc.location}</span>
                      </div>

                      {/* 对白与动作条目 */}
                      <div className="space-y-2 pt-2 border-t border-slate-200/50">
                        {(sc.items || []).map((it: any, iIdx: number) => (
                          <div key={iIdx} className="text-xs leading-relaxed">
                            {it.type === 'action' ? (
                              <p className="text-gray-600 italic pl-3 border-l-2 border-gray-300">
                                🎬 {it.action?.description}
                              </p>
                            ) : (
                              <div className="flex items-start gap-2 bg-white p-2.5 rounded-lg border border-gray-200/60 shadow-2xs">
                                <span className="font-bold text-indigo-900 shrink-0">
                                  {it.dialogue?.character}:
                                </span>
                                <span className="text-gray-800">
                                  {it.dialogue?.text}
                                </span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* 分支抉择 */}
                      {sc.choices && sc.choices.length > 0 && (
                        <div className="pt-2 border-t border-slate-200/60 space-y-1.5">
                          <span className="text-[11px] font-bold text-amber-700 flex items-center gap-1">
                            <GitBranch className="w-3 h-3" /> 互动分支抉择：
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {sc.choices.map((ch: any, cIdx: number) => (
                              <div
                                key={cIdx}
                                className="px-3 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium"
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
