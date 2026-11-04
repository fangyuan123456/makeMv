import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface State {
  hasError: boolean;
  errorMsg: string;
}

export default class StoryGraphErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMsg: error?.message || '未知渲染异常' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[StoryGraphErrorBoundary] 拓扑图渲染崩溃：', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 text-center bg-rose-950/40 border border-rose-800/60 rounded-2xl">
          <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto mb-2" />
          <h4 className="text-xs font-bold text-rose-300 mb-1">拓扑图渲染异常</h4>
          <p className="text-[11px] text-rose-400 font-mono break-all">{this.state.errorMsg}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
