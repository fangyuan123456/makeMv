/**
 * agents/game-assembly/context.ts
 * 游戏总装状态评估器
 */

import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { resolveProjectStorySource } from '../../project-store/story-source.js';

export type GameAssemblyPhase =
  | 'READY_FOR_PRD'
  | 'READY_TO_BUILD'
  | 'ASSEMBLED_READY_TO_MODIFY'
  | 'WAITING_FOR_PRD';

export interface GameAssemblyEvaluation {
  phase: GameAssemblyPhase;
  hasStorySource: boolean;
  hasPrd: boolean;
  hasIndexHtml: boolean;
  hasStoryJson: boolean;
  existingFiles: string[];
  clipCount: number;
}

export function evaluateGameAssemblyPhase(projectId: string): GameAssemblyEvaluation {
  const store = ProjectStore.getInstance();
  const storySource = resolveProjectStorySource(projectId) as any;
  const hasStorySource = Boolean(storySource && Array.isArray(storySource.clips) && storySource.clips.length > 0);
  const prd = store.getArtifact(projectId, 'prd') as any;
  const hasPrd = Boolean(prd && Array.isArray(prd.clips) && prd.clips.length > 0);

  const projectDir = store.getProjectDir(projectId);
  const gameDir = path.resolve(projectDir, 'game-assembly');
  const hasIndexHtml = fs.existsSync(path.join(gameDir, 'index.html'));
  const hasStoryJson = fs.existsSync(path.join(gameDir, 'story.json'));

  const existingFiles: string[] = [];
  if (fs.existsSync(gameDir)) {
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          existingFiles.push(path.relative(gameDir, full).replace(/\\/g, '/'));
        }
      }
    };
    walk(gameDir);
  }

  let phase: GameAssemblyPhase = 'WAITING_FOR_PRD';
  if (hasIndexHtml && hasStoryJson) {
    phase = 'ASSEMBLED_READY_TO_MODIFY';
  } else if (hasPrd) {
    phase = 'READY_TO_BUILD';
  } else if (hasStorySource) {
    phase = 'READY_FOR_PRD';
  }

  return {
    phase,
    hasStorySource,
    hasPrd,
    hasIndexHtml,
    hasStoryJson,
    existingFiles,
    clipCount: Array.isArray(prd?.clips)
      ? prd.clips.length
      : Array.isArray(storySource?.clips)
        ? storySource.clips.length
        : 0,
  };
}
