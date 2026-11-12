/**
 * client/src/components/Header.tsx
 * 顶层导航与项目状态总览
 */

import React from 'react';
import type { ProjectMetadata, ProjectData } from '../types/index.js';

interface HeaderProps {
  projects: ProjectMetadata[];
  currentProjectId: string;
  projectData: ProjectData | null;
  onSelectProject: (id: string) => void;
  onRefresh: () => void;
  onCreateProject: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  projects,
  currentProjectId,
  projectData,
  onSelectProject,
  onRefresh,
  onCreateProject,
}) => {
  const hasGdd = Boolean(projectData?.artifacts?.gdd);
  const hasTextGame = Boolean(projectData?.artifacts?.text_game);
  const hasFilm = Boolean(projectData?.artifacts?.film_spec?.slices?.length);

  return (
    <header className="studio-header">
      <div className="brand-section">
        <div className="brand-logo">
          <span>🎬</span>
          <span>makeMv Studio</span>
        </div>
        <span className="brand-badge">Mastra Core v2.0</span>
      </div>

      <div className="project-controls">
        <select
          className="select-input"
          value={currentProjectId}
          onChange={(e) => onSelectProject(e.target.value)}
        >
          {projects.map((p) => (
            <option key={p.projectId} value={p.projectId}>
              {p.title || p.projectId} ({p.currentStage})
            </option>
          ))}
          {!projects.some((p) => p.projectId === currentProjectId) && (
            <option value={currentProjectId}>
              ✨ 新会话 ({currentProjectId})
            </option>
          )}
        </select>

        <button className="btn btn-secondary" onClick={onCreateProject} title="新建项目">
          + 新建
        </button>

        <button className="btn btn-secondary" onClick={onRefresh} title="刷新资产与状态">
          🔄 刷新
        </button>

        <div className="stage-indicators">
          <div className={`indicator-pill ${hasGdd ? 'ready' : ''}`} title="GDD 策划案">
            <span className="indicator-dot" />
            <span>策划案</span>
          </div>

          <div className={`indicator-pill ${hasTextGame ? 'ready' : ''}`} title="互动文游资产">
            <span className="indicator-dot" />
            <span>文游</span>
          </div>

          <div className={`indicator-pill ${hasFilm ? 'ready' : ''}`} title="影游视听分镜">
            <span className="indicator-dot" />
            <span>影游分镜</span>
          </div>
        </div>
      </div>
    </header>
  );
};
