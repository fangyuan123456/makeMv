'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  Terminal,
  FileText,
  LogIn,
  LogOut,
  MessageSquare,
  Cpu,
} from 'lucide-react';
import { getStageAuditTrace } from '@/lib/workflowApi';

interface AuditModalProps {
  sessionId: string;
  stage: string;
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'trace' | 'input' | 'output' | 'prompts' | 'rawAi';

export default function AuditModal({ sessionId, stage, isOpen, onClose }: AuditModalProps) {
  const [loading, setLoading] = useState(false);
  const [markdown, setMarkdown] = useState('');
  const [inputData, setInputData] = useState<any>(null);
  const [outputData, setOutputData] = useState<any>(null);
  const [promptsData, setPromptsData] = useState<any>(null);
  const [rawAiData, setRawAiData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<TabType>('trace');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen || !sessionId || !stage) return;
    setLoading(true);
    getStageAuditTrace(sessionId, stage)
      .then((data) => {
        if (data && data.trace) {
          setMarkdown(data.trace.markdown || '');
          setInputData(data.trace.input || null);
          setOutputData(data.trace.output || null);
          setPromptsData(data.trace.prompts || null);
          setRawAiData(data.trace.rawAiResponse || null);
        } else {
          setMarkdown(`> ⚠️ 暂未查询到阶段 [${stage}] 的 .agent_debug 归档数据。可能该工序尚未执行完毕。`);
        }
      })
      .catch((err) => {
        setMarkdown(`> ❌ 获取归档记录失败: ${err.message}`);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, sessionId, stage]);

  if (!isOpen) return null;

  const getCurrentContent = () => {
    switch (activeTab) {
      case 'trace':
        return markdown;
      case 'input':
        return JSON.stringify(inputData, null, 2);
      case 'output':
        return JSON.stringify(outputData, null, 2);
      case 'prompts':
        return JSON.stringify(promptsData, null, 2);
      case 'rawAi':
        return JSON.stringify(rawAiData, null, 2);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getCurrentContent());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* 顶部标题栏 */}
        <div className="px-6 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-150 flex items-center justify-center text-indigo-600">
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  Agent 输入输出归档 (.agent_debug)
                </h3>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                  {stage}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                📁 归档路径: server/data/projects/{sessionId}/.agent_debug/{stage}/
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition-all cursor-pointer shadow-2xs flex items-center gap-1 text-xs px-2.5"
              title="复制当前 Tab 全部内容"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? '已复制' : '复制'}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab 切换栏 */}
        <div className="px-6 py-2 bg-slate-50 border-b border-slate-200/80 flex items-center gap-1.5 overflow-x-auto text-xs shrink-0">
          <button
            onClick={() => setActiveTab('trace')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
              activeTab === 'trace'
                ? 'bg-white text-indigo-600 shadow-2xs font-bold border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-indigo-500" />
            <span>综合追踪 (trace.md)</span>
          </button>

          <button
            onClick={() => setActiveTab('input')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
              activeTab === 'input'
                ? 'bg-white text-indigo-600 shadow-2xs font-bold border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <LogIn className="w-3.5 h-3.5 text-blue-500" />
            <span>输入内容 (input.json)</span>
          </button>

          <button
            onClick={() => setActiveTab('output')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
              activeTab === 'output'
                ? 'bg-white text-indigo-600 shadow-2xs font-bold border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <LogOut className="w-3.5 h-3.5 text-emerald-500" />
            <span>输出产物 (output.json)</span>
          </button>

          <button
            onClick={() => setActiveTab('prompts')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
              activeTab === 'prompts'
                ? 'bg-white text-indigo-600 shadow-2xs font-bold border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5 text-amber-500" />
            <span>AI 提示词 (prompts.json)</span>
          </button>

          <button
            onClick={() => setActiveTab('rawAi')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
              activeTab === 'rawAi'
                ? 'bg-white text-indigo-600 shadow-2xs font-bold border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Cpu className="w-3.5 h-3.5 text-violet-500" />
            <span>AI 原始回包 (raw_ai_response.json)</span>
          </button>
        </div>

        {/* 主体内容展示区 */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50 font-mono text-xs leading-relaxed">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-slate-400">
              <span>正在从项目 .agent_debug 目录读取归档...</span>
            </div>
          ) : activeTab === 'trace' ? (
            <div className="p-4 bg-white rounded-xl border border-slate-200 font-mono text-xs whitespace-pre-wrap leading-relaxed select-text shadow-2xs text-slate-800">
              {markdown}
            </div>
          ) : (
            <pre className="p-4 bg-white text-slate-800 border border-slate-200 rounded-xl overflow-x-auto text-xs leading-relaxed select-text shadow-2xs">
              {getCurrentContent() || '*(该项暂无归档内容)*'}
            </pre>
          )}
        </div>

        {/* 底部提示栏 */}
        <div className="px-6 py-2.5 bg-white border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
          <span>📁 本地路径：打开项目目录下的 `.agent_debug` 文件夹即可直接查看各 Agent 对应的独立 json 与 md 文件。</span>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium cursor-pointer shadow-2xs"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
