/**
 * project-store/artifact-fs.ts
 * 产物落盘统一门面 (Artifact Filesystem SSOT)
 *
 * 规则：
 * 1. 每个项目根目录 = data/projects/<projectId>；
 * 2. .debug/<阶段>/<工序>/ 存放全量产物的 md 展示镜像（方便人看 / 排查 / 给下游 LLM 读）；
 * 3. <阶段>/<工序>/ 只放最终交付物，且保持真实形态（md / 图片 / html / ts ...）；
 * 4. 阶段与工序目录一律带两位编号，编号即执行顺序。
 *
 * 运行时资源目录（scenes/、game-assembly/、assets/）不在此收编：它们被生成的 SceneLoader、
 * 前端 iframe 的 /media/:projectId/... URL 与媒体沙箱按原路径硬引用，改动会直接弄坏可玩产物。
 */

import fs from 'fs';
import path from 'path';
import { config } from '../utils/config.js';

export const STAGE = {
  planner: '01-planner',
  /** 第二阶段负责视觉资产与视频分镜生产 */
  filmAdapter: '02-film-production',
  /** 第三阶段只负责把成品视频组装成可玩的互动播放器 */
  textGame: '03-game-assembly',
} as const;

export const PLANNER_STEP = {
  outline: '00-interactive-outline',
  spine: '01-write-spine-script',
  slices: '02-slice-interactions',
  branches: '03-derive-branches',
  prd: '04-prd-synthesis',
  validation: '05-validate-topology',
} as const;

export const TEXT_GAME_STEP = {
  // 定妆拆两步：先定「长什么样」（纯文本），再把它画出来
  lookdevExtract: '01-lookdev-extract',
  lookdevRender: '02-lookdev-render',
  scenes: '03-scene-assembly',
  techPlan: '04-tech-plan',
  codegen: '05-codegen',
} as const;

export const FILM_STEP = {
  compile: '01-compile-film',
} as const;

export const DEBUG_ROOT = '.debug';

export type ArtifactScope = 'debug' | 'delivery';

/** 项目物理根目录 */
export function getProjectDir(projectId: string): string {
  const dir = path.join(config.paths.projects, projectId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 定位某个阶段/工序的落盘目录（自动创建） */
export function getArtifactDir(
  projectId: string,
  scope: ArtifactScope,
  stage: string,
  step: string
): string {
  const root = scope === 'debug' ? path.join(getProjectDir(projectId), DEBUG_ROOT) : getProjectDir(projectId);
  const dir = path.join(root, stage, step);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 只拼路径、不建目录，用于读取判断 */
export function getArtifactFilePath(
  projectId: string,
  scope: ArtifactScope,
  stage: string,
  step: string,
  filename: string
): string {
  const root = scope === 'debug' ? path.join(getProjectDir(projectId), DEBUG_ROOT) : getProjectDir(projectId);
  return path.join(root, stage, step, filename);
}

/** 写一个产物文件，返回绝对路径 */
export function writeArtifactFile(
  projectId: string,
  scope: ArtifactScope,
  stage: string,
  step: string,
  filename: string,
  content: string | Buffer
): string {
  const dir = getArtifactDir(projectId, scope, stage, step);
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, content as any);
  return fullPath;
}

/** 读一个产物文件，不存在返回 null */
export function readArtifactFile(
  projectId: string,
  scope: ArtifactScope,
  stage: string,
  step: string,
  filename: string
): string | null {
  const fullPath = getArtifactFilePath(projectId, scope, stage, step, filename);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf-8');
}

/**
 * 固定 key → 产物文件路径。ProjectStore 在进程内黑板缺失时用它兜底读盘，
 * 保持 getArtifact(key) 的调用接口不变。
 */
export const ARTIFACT_PATHS: Record<
  string,
  { scope: ArtifactScope; stage: string; step: string; file: string }
> = {
  planner_outline: { scope: 'debug', stage: STAGE.planner, step: PLANNER_STEP.outline, file: 'interactive_outline.md' },
  planner_spine: { scope: 'debug', stage: STAGE.planner, step: PLANNER_STEP.spine, file: 'planner_spine.md' },
  planner_clips: { scope: 'debug', stage: STAGE.planner, step: PLANNER_STEP.slices, file: 'planner_clips.md' },
  planner_branches: { scope: 'debug', stage: STAGE.planner, step: PLANNER_STEP.branches, file: 'planner_branches.md' },
  planner_prd: { scope: 'delivery', stage: STAGE.planner, step: PLANNER_STEP.prd, file: 'prd.md' },
  planner_validation: { scope: 'debug', stage: STAGE.planner, step: PLANNER_STEP.validation, file: 'topology_validation.md' },
  gdd: { scope: 'delivery', stage: STAGE.planner, step: PLANNER_STEP.prd, file: 'prd.md' },
  text_game: { scope: 'debug', stage: STAGE.textGame, step: TEXT_GAME_STEP.codegen, file: 'text_game_manifest.md' },
  text_game_manifest: { scope: 'debug', stage: STAGE.textGame, step: TEXT_GAME_STEP.codegen, file: 'text_game_manifest.md' },
  film_spec: { scope: 'delivery', stage: STAGE.filmAdapter, step: FILM_STEP.compile, file: 'film_spec.md' },
};

/**
 * 把任意结构化数据渲染成便于阅读的 Markdown。
 * 纯文本原样输出；对象按字段展开；数组按条目分节；长文本独立成段。
 */
export function renderArtifactMarkdown(title: string, value: unknown): string {
  return `# ${title}\n\n${renderValue(value, 0)}\n`;
}

function renderValue(value: unknown, depth: number): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '（无）';
    return value
      .map((item, index) => {
        if (typeof item === 'string') return `${index + 1}. ${item}`;
        if (item && typeof item === 'object') {
          const label =
            (item as any).title ||
            (item as any).name ||
            (item as any).clipId ||
            (item as any).sceneId ||
            (item as any).cutId ||
            (item as any).characterId ||
            `第 ${index + 1} 项`;
          const heading = '#'.repeat(Math.min(depth + 3, 6));
          return `${heading} ${index + 1}. ${label}\n\n${renderFields(item as Record<string, unknown>, depth + 1)}`;
        }
        return `${index + 1}. ${String(item)}`;
      })
      .join('\n\n');
  }
  if (typeof value === 'object') return renderFields(value as Record<string, unknown>, depth);
  return String(value);
}

function renderFields(obj: Record<string, unknown>, depth: number): string {
  return Object.entries(obj)
    .map(([key, val]) => {
      if (val === null || val === undefined || val === '') return '';
      if (typeof val === 'string') {
        return val.length > 120 ? `**${key}**\n\n${val}` : `- **${key}**: ${val}`;
      }
      if (typeof val === 'object') {
        const heading = '#'.repeat(Math.min(depth + 3, 6));
        return `${heading} ${key}\n\n${renderValue(val, depth + 1)}`;
      }
      return `- **${key}**: ${String(val)}`;
    })
    .filter(Boolean)
    .join('\n\n');
}
