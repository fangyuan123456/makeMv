'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  startProject,
  fetchProjects,
  deleteSession,
} from '@/lib/workflowApi';
import StudioWorkspace from './studio/StudioWorkspace';
import { HistoryItem } from './studio/StudioHeader';

export default function WorkflowPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isStarting, setIsStarting] = useState(false);

  // Sync session from URL params
  useEffect(() => {
    const sessionParam = searchParams.get('session');
    if (sessionParam) {
      setSessionId(sessionParam);
    } else {
      setSessionId(null);
    }
  }, [searchParams]);

  // Load project history (严格对齐后端 ProjectStore SSOT 契约)
  const loadHistory = useCallback(async () => {
    try {
      const sessions = await fetchProjects();
      setHistory(
        sessions.map((s: any) => {
          const pid = s.projectId || s.id;
          const idea = s.meta?.idea || s.title || s.idea || '未命名互动影游';
          const style = s.meta?.style || s.style || '';
          const dateStr = s.createdAt
            ? new Date(s.createdAt).toLocaleDateString('zh-CN')
            : (s.date ? new Date(s.date * 1000).toLocaleDateString('zh-CN') : '');
          return {
            id: pid,
            idea: idea.slice(0, 60),
            style,
            date: dateStr,
            status: typeof s.status === 'string' ? s.status : 'idle',
            stages: s.stageArtifacts || {},
          };
        })
      );
    } catch (err) {
      console.warn('[WorkflowPanel] Failed to fetch session history:', err);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Start new project
  const handleStartProject = async (idea: string) => {
    if (isStarting) return;
    setIsStarting(true);

    try {
      const result = await startProject({
        idea,
        style: 'realistic',
        video_ratio: '16:9',
        video_resolution: '720P',
        enable_concurrency: true,
      });

      const newId = result.projectId;
      setSessionId(newId);

      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', `/?session=${newId}`);
      }

      await loadHistory();
    } catch (err: any) {
      alert(`创建项目失败: ${err.message || '系统繁忙'}`);
    } finally {
      setIsStarting(false);
    }
  };

  // Select project from history
  const handleSelectSession = (id: string) => {
    setSessionId(id);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `/?session=${id}`);
    }
  };

  // Delete project
  const handleDeleteSession = async (id: string) => {
    try {
      await deleteSession(id);
      if (sessionId === id) {
        handleNewProject();
      }
      await loadHistory();
    } catch (err: any) {
      alert(`删除失败: ${err.message}`);
    }
  };

  // Reset to brand new creative project
  const handleNewProject = () => {
    setSessionId(null);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/');
    }
    loadHistory();
  };

  return (
    <StudioWorkspace
      sessionId={sessionId}
      onNewProject={handleNewProject}
      onSelectSession={handleSelectSession}
      onDeleteSession={handleDeleteSession}
      onStartProject={handleStartProject}
      history={history}
    />
  );
}
