import React, { useState, useEffect } from 'react';
import { MASTRA_SERVER_URL } from './lib/mastra';
import { CinematicControls, type CinematicParams } from './components';

interface ActionProposal {
  actionId: string;
  skill?: string;
  label: string;
  description?: string;
  status: 'pending' | 'executed' | 'dismissed' | 'failed';
  payload?: Record<string, any>;
  resultSummary?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thought?: string;
  proposal?: ActionProposal;
}

interface GraphNode {
  id: string;
  label: string;
  description: string;
  isCompleted: boolean;
  artifactSummary: string;
}

export function App() {
  const [projectId, setProjectId] = useState<string>('');
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [criticGate, setCriticGate] = useState<string>('NONE');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: '🎬 你好，我是你的 AI 互动影游总导演 (基于 Mastra 动态状态图驱动)。\n流程完全自由非线性，您可以随时提出剧情构想、要求局部靶向重绘、跳步设计分镜或发起审查质检。',
      thought: '已激活类 LangGraph 状态图微内核，等待创作者输入创意构想。',
    },
  ]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [cinematicOverrides, setCinematicOverrides] = useState<Record<string, CinematicParams>>({});

  // 刷新状态图拓扑
  async function fetchGraph(pId: string) {
    if (!pId) return;
    try {
      const res = await fetch(`${MASTRA_SERVER_URL}/api/projects/${pId}/graph`);
      if (res.ok) {
        const data = await res.json();
        if (data.nodes) setGraphNodes(data.nodes);
        if (data.criticGate) setCriticGate(data.criticGate);
      }
    } catch {}
  }

  // 初始化加载项目
  useEffect(() => {
    async function init() {
      try {
        const res = await fetch(`${MASTRA_SERVER_URL}/api/projects`);
        if (res.ok) {
          const data = await res.json();
          if (data.projects && data.projects.length > 0) {
            const latest = data.projects[data.projects.length - 1];
            setProjectId(latest.projectId);
            fetchGraph(latest.projectId);
          }
        }
      } catch {}
    }
    init();
  }, []);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isSending) return;

    const userText = input.trim();
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: userText };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsSending(true);

    const assistantMsgId = (Date.now() + 1).toString();
    // 预置占位消息用于打字机动态追加
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      thought: '',
    };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const res = await fetch(`${MASTRA_SERVER_URL}/api/chat?stream=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          message: userText,
          projectId: projectId || undefined,
        }),
      });

      if (!res.ok) {
        throw new Error(`服务器响应异常: ${res.status}`);
      }

      if (res.headers.get('content-type')?.includes('text/event-stream') && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.replace(/^data:\s*/, '');
            if (dataStr === '[DONE]') break;

            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.type === 'reply') {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: m.content + parsed.text }
                      : m
                  )
                );
              } else if (parsed.type === 'thought') {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, thought: (m.thought || '') + parsed.text }
                      : m
                  )
                );
              } else if (parsed.type === 'proposal') {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, proposal: parsed.proposal }
                      : m
                  )
                );
              }
            } catch {}
          }
        }
      } else {
        const data = await res.json();
        if (data.projectId && data.projectId !== projectId) {
          setProjectId(data.projectId);
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: data.reply || '导演副手已完成推演。',
                  thought: data.thought,
                  proposal: data.proposal,
                }
              : m
          )
        );
      }

      if (projectId) {
        fetchGraph(projectId);
      }
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: `⚠️ 通信提示: 后端响应失败 (${err.message})。请检查 4111 端口服务是否正常运行。`,
              }
            : m
        )
      );
    } finally {
      setIsSending(false);
    }
  }

  // 人在回路批准执行提案 (支持携带运镜动量微调参数)
  async function handleApprove(proposal: ActionProposal) {
    if (!projectId || approvingId) return;
    setApprovingId(proposal.actionId);

    const customParams = cinematicOverrides[proposal.actionId];
    const overrideParameters = customParams
      ? {
          ...proposal.payload,
          userFeedback: customParams.userFeedback || proposal.payload?.userFeedback,
          cameraTrajectory: customParams.cameraTrajectory,
          motionIntensity: customParams.motionIntensity,
        }
      : proposal.payload;

    try {
      const res = await fetch(`${MASTRA_SERVER_URL}/api/proposals/${proposal.actionId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, overrideParameters }),
      });

      const data = await res.json();
      if (data.success) {
        // 更新本地消息中的提案状态
        setMessages((prev) =>
          prev.map((m) => {
            if (m.proposal?.actionId === proposal.actionId) {
              return {
                ...m,
                proposal: {
                  ...m.proposal,
                  status: 'executed',
                  resultSummary: data.result?.summary || '工序已成功执行落盘',
                },
              };
            }
            return m;
          })
        );
        fetchGraph(projectId);
      } else {
        alert(`执行失败: ${data.error || '未知异常'}`);
      }
    } catch (err: any) {
      alert(`请求异常: ${err.message}`);
    } finally {
      setApprovingId(null);
    }
  }

  // 驳回提案
  async function handleReject(proposal: ActionProposal) {
    if (!projectId) return;
    try {
      const res = await fetch(`${MASTRA_SERVER_URL}/api/proposals/${proposal.actionId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, reason: '创作者暂缓执行' }),
      });
      const data = await res.json();
      if (data.success) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.proposal?.actionId === proposal.actionId) {
              return {
                ...m,
                proposal: { ...m.proposal, status: 'dismissed' },
              };
            }
            return m;
          })
        );
      }
    } catch {}
  }

  return (
    <div style={{ maxWidth: 1000, margin: '30px auto', padding: '0 20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <header style={{ borderBottom: '1px solid #1f2937', paddingBottom: 16, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#38bdf8' }}>
            🎬 makeMv Studio (类 LangGraph 动态状态图 + 自由对话干预)
          </h1>
          <p style={{ margin: '4px 0 0', color: '#9ca3af', fontSize: 13 }}>
            当前工程 ID: <span style={{ color: '#f3f4f6', fontFamily: 'monospace' }}>{projectId || '未初始化'}</span>
            {criticGate !== 'NONE' && (
              <span style={{ marginLeft: 16, color: criticGate === 'PASS' ? '#4ade80' : criticGate === 'WARN' ? '#facc15' : '#f87171' }}>
                ● 审查门禁: {criticGate}
              </span>
            )}
          </p>
        </div>
        <div style={{ padding: '6px 14px', background: '#0f172a', border: '1px solid #0284c7', borderRadius: 20, color: '#38bdf8', fontSize: 12, fontWeight: 600 }}>
          ⚡ 状态图微内核已就绪
        </div>
      </header>

      {/* 类 LangGraph 状态图全景拓扑看板 */}
      {graphNodes.length > 0 && (
        <section style={{ marginBottom: 20, padding: 14, background: '#0b0f19', borderRadius: 10, border: '1px solid #1e293b' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 10 }}>
            🌐 状态图拓扑节点全景 (非线性自由跳转)：
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {graphNodes.map((n) => (
              <div
                key={n.id}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  background: n.isCompleted ? '#064e3b' : '#1e293b',
                  border: n.isCompleted ? '1px solid #059669' : '1px solid #334155',
                  color: n.isCompleted ? '#a7f3d0' : '#94a3b8',
                  fontSize: 12,
                }}
              >
                <span style={{ marginRight: 6 }}>{n.isCompleted ? '✓' : '○'}</span>
                <strong>{n.label}</strong>: {n.artifactSummary}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 对话流与人在回路交互区 */}
      <main style={{ minHeight: 460, background: '#111827', borderRadius: 12, padding: 20, marginBottom: 20, border: '1px solid #1f2937' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {messages.map((m) => (
            <div
              key={m.id}
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {/* 思考流展示 */}
              {m.thought && (
                <div style={{ padding: '6px 12px', background: '#1e293b', borderRadius: 6, fontSize: 12, color: '#cbd5e1', borderLeft: '3px solid #38bdf8' }}>
                  💭 <em>导演思维推演:</em> {m.thought}
                </div>
              )}

              {/* 消息正文 */}
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: 10,
                  background: m.role === 'user' ? '#0284c7' : '#1f2937',
                  color: '#f9fafb',
                  fontSize: 14,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {m.content}
              </div>

              {/* 人在回路行动提案卡片 (HITL Action Proposal) */}
              {m.proposal && (
                <div
                  style={{
                    marginTop: 6,
                    padding: 14,
                    borderRadius: 8,
                    background: '#0f172a',
                    border: '1px solid #38bdf8',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8' }}>
                      📋 人在回路待审提案: {m.proposal.label}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 12,
                        background:
                          m.proposal.status === 'executed'
                            ? '#059669'
                            : m.proposal.status === 'dismissed'
                            ? '#64748b'
                            : '#d97706',
                        color: '#fff',
                      }}
                    >
                      {m.proposal.status === 'executed' ? '已执行' : m.proposal.status === 'dismissed' ? '已驳回' : '等待批准'}
                    </span>
                  </div>

                  <p style={{ margin: '0 0 10px', fontSize: 13, color: '#cbd5e1' }}>
                    {m.proposal.description}
                  </p>

                  {m.proposal.status === 'executed' && m.proposal.resultSummary && (
                    <div style={{ padding: '8px 12px', background: '#064e3b', borderRadius: 6, fontSize: 12, color: '#a7f3d0' }}>
                      ✨ <strong>执行成果:</strong> {m.proposal.resultSummary}
                    </div>
                  )}

                  {m.proposal.status === 'pending' && (
                    <>
                      {/* 针对分镜与视频工序，展示 OpenMontage 影视级运镜与动量微调控制台 */}
                      {(m.proposal.skill === 'videoProductionTool' ||
                        m.proposal.skill === 'storyboardTool' ||
                        m.proposal.label?.includes('视频') ||
                        m.proposal.label?.includes('分镜')) && (
                        <CinematicControls
                          onChange={(params) =>
                            setCinematicOverrides((prev) => ({
                              ...prev,
                              [m.proposal!.actionId]: params,
                            }))
                          }
                        />
                      )}

                      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                        <button
                          onClick={() => handleApprove(m.proposal!)}
                          disabled={Boolean(approvingId)}
                          style={{
                            padding: '6px 14px',
                            borderRadius: 6,
                            border: 'none',
                            background: '#0284c7',
                            color: '#fff',
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {approvingId === m.proposal.actionId ? '执行中...' : '✅ 批准执行 (Resume)'}
                        </button>
                        <button
                          onClick={() => handleReject(m.proposal!)}
                          disabled={Boolean(approvingId)}
                          style={{
                            padding: '6px 14px',
                            borderRadius: 6,
                            border: '1px solid #475569',
                            background: 'transparent',
                            color: '#94a3b8',
                            fontSize: 13,
                            cursor: 'pointer',
                          }}
                        >
                          ❌ 暂缓 / 驳回
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </main>

      {/* 底部自然语言输入控制台 */}
      <form onSubmit={handleSend} style={{ display: 'flex', gap: 12 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="对导演输入任何创作意图（例如：“把李默发型换短发”、“直接跳到分镜”、“审查剧情漏洞”）..."
          disabled={isSending}
          style={{
            flex: 1,
            padding: '12px 16px',
            borderRadius: 8,
            border: '1px solid #374151',
            background: '#1f2937',
            color: '#f9fafb',
            fontSize: 14,
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={isSending || !input.trim()}
          style={{
            padding: '12px 24px',
            borderRadius: 8,
            border: 'none',
            background: isSending ? '#4b5563' : '#0284c7',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: isSending ? 'not-allowed' : 'pointer',
          }}
        >
          {isSending ? '分析中...' : '发送'}
        </button>
      </form>
    </div>
  );
}

export default App;
