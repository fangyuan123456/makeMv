export interface SummaryStreamEvent {
  projectId: string;
  sessionId: string;
  messageId: string;
  type: 'start' | 'snapshot' | 'chunk' | 'done' | 'error';
  text?: string;
  offset?: number;
  error?: string;
}

interface ActiveSummary {
  projectId: string;
  sessionId: string;
  messageId: string;
  text: string;
  pending: string;
  timer?: ReturnType<typeof setTimeout>;
}

class SummaryEventHub {
  private readonly active = new Map<string, ActiveSummary>();
  private readonly listeners = new Set<(event: SummaryStreamEvent) => void>();

  private key(projectId: string, sessionId: string, messageId: string): string {
    return `${projectId}\0${sessionId}\0${messageId}`;
  }

  private emit(event: SummaryStreamEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn('[SummaryEventHub] 复盘事件订阅者写入失败:', err);
      }
    }
  }

  public subscribe(listener: (event: SummaryStreamEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public snapshots(projectId: string): SummaryStreamEvent[] {
    return [...this.active.values()]
      .filter((summary) => summary.projectId === projectId)
      .map(({ sessionId, messageId, text }) => ({
        projectId, sessionId, messageId, type: 'snapshot', text,
      }));
  }

  public begin(projectId: string, sessionId: string, messageId: string): void {
    const summary: ActiveSummary = { projectId, sessionId, messageId, text: '', pending: '' };
    this.active.set(this.key(projectId, sessionId, messageId), summary);
    this.emit({ projectId, sessionId, messageId, type: 'start' });
  }

  public append(projectId: string, sessionId: string, messageId: string, chunk: string): void {
    const summary = this.active.get(this.key(projectId, sessionId, messageId));
    if (!summary || !chunk) return;
    summary.text += chunk;
    summary.pending += chunk;
    if (!summary.timer) summary.timer = setTimeout(() => this.flush(summary), 50);
  }

  private flush(summary: ActiveSummary): void {
    if (summary.timer) clearTimeout(summary.timer);
    summary.timer = undefined;
    if (!summary.pending) return;
    const text = summary.pending;
    const offset = summary.text.length - text.length;
    summary.pending = '';
    this.emit({ projectId: summary.projectId, sessionId: summary.sessionId, messageId: summary.messageId, type: 'chunk', text, offset });
  }

  public finish(projectId: string, sessionId: string, messageId: string): void {
    const key = this.key(projectId, sessionId, messageId);
    const summary = this.active.get(key);
    if (!summary) return;
    this.flush(summary);
    this.active.delete(key);
    this.emit({ projectId, sessionId, messageId, type: 'done' });
  }

  public fail(projectId: string, sessionId: string, messageId: string, error: string): void {
    const key = this.key(projectId, sessionId, messageId);
    const summary = this.active.get(key);
    if (!summary) return;
    this.flush(summary);
    this.active.delete(key);
    this.emit({ projectId, sessionId, messageId, type: 'error', error });
  }
}

export const summaryEvents = new SummaryEventHub();
