/**
 * tools/game-assembly/assembly-tool/steps/02-codegen/tools.ts
 * Coder Agent 虚拟文件系统与生图工具集
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { VirtualFS } from './vfs.js';
import { generateGameUiAsset } from './asset-gen.js';
import { normalizeVfsPath, verifyVirtualBundle } from './verifier.js';

export { normalizeVfsPath, verifyVirtualBundle, type BundleVerificationResult } from './verifier.js';

export interface ParsedFileDraft {
  fileName: string;
  content: string;
}

const FILE_BLOCK_RE = /```(?:file:)?([^\s`]+)\n([\s\S]*?)```/g;

export function parseFileDrafts(raw: string): ParsedFileDraft[] {
  const drafts: ParsedFileDraft[] = [];
  let match: RegExpExecArray | null;
  while ((match = FILE_BLOCK_RE.exec(raw)) !== null) {
    const fileName = match[1].trim();
    const content = match[2];
    if (fileName && content.trim()) {
      drafts.push({ fileName, content });
    }
  }
  return drafts;
}

export const parseDrafts = parseFileDrafts;

const PROTECTED_FILES = new Set([
  'runtime/player.js',
  'runtime/player.css',
  'runtime/engine.js',
  'story.json',
  'index.html',
]);

function isProtectedPath(filePath: string): boolean {
  return PROTECTED_FILES.has(filePath) || filePath.startsWith('runtime/');
}

export function createCoderVfsTools(vfs: VirtualFS, gameAssemblyDir?: string) {
  const list_files = createTool({
    id: 'list_files',
    description: '列出当前虚拟工程中的所有文件路径与字节大小。',
    inputSchema: z.object({}),
    execute: async () => ({
      files: vfs.entries().map(([p, c]) => ({ path: p, bytes: c.length })),
    }),
  });

  const read_file = createTool({
    id: 'read_file',
    description: '读取虚拟工程中的文件内容（如 story.json、runtime/engine.js、js/main.js 等）。',
    inputSchema: z.object({
      path: z.string().describe('文件相对路径'),
    }),
    execute: async ({ context }) => {
      const target = normalizeVfsPath(context.path);
      if (!target || target === '.') {
        return { files: vfs.list() };
      }
      if (!vfs.hasFile(target)) {
        return { error: `文件不存在: ${target}`, availableFiles: vfs.list() };
      }
      const content = vfs.read(target) || '';
      const truncated = content.length > 16000;
      return {
        path: target,
        content: truncated
          ? `${content.slice(0, 16000)}\n/* ...已截断，共 ${content.length} 字符... */`
          : content,
        truncated,
      };
    },
  });

  const write_file = createTool({
    id: 'write_file',
    description:
      '创建或覆盖表现层文件（可自由组织 js/*.js、style.css 等；禁止修改 runtime/*、story.json、index.html）。',
    inputSchema: z.object({
      path: z.string().describe('目标相对路径，如 style.css、js/main.js 或自定义模块 js/hud.js'),
      content: z.string().describe('完整纯 JS/CSS 源码'),
    }),
    execute: async ({ context }) => {
      const target = normalizeVfsPath(context.path);
      if (isProtectedPath(target)) {
        return { ok: false, error: `禁止修改系统底座或数据契约: ${target}` };
      }
      vfs.write(target, context.content);
      return { ok: true, path: target, bytes: context.content.length };
    },
  });

  const edit_file = createTool({
    id: 'edit_file',
    description: '对已有表现层文件进行精确局部替换（推荐用于对话增量修改或修复报错）。',
    inputSchema: z.object({
      path: z.string().describe('目标文件路径'),
      target: z.string().describe('需要替换的精确原始文本片段'),
      replacement: z.string().describe('替换后的新文本'),
    }),
    execute: async ({ context }) => {
      const filePath = normalizeVfsPath(context.path);
      if (isProtectedPath(filePath)) {
        return { ok: false, error: `禁止修改系统文件: ${filePath}` };
      }
      const current = vfs.read(filePath);
      if (current === undefined) {
        return { ok: false, error: `文件不存在: ${filePath}` };
      }
      if (!current.includes(context.target)) {
        return { ok: false, error: `未在 ${filePath} 中找到匹配的 target 文本` };
      }
      vfs.write(filePath, current.replace(context.target, context.replacement));
      return { ok: true, path: filePath };
    },
  });

  const delete_file = createTool({
    id: 'delete_file',
    description: '删除不再需要的自定义表现层文件（不能删除系统文件或 js/main.js、style.css）。',
    inputSchema: z.object({
      path: z.string().describe('要删除的文件相对路径'),
    }),
    execute: async ({ context }) => {
      const filePath = normalizeVfsPath(context.path);
      if (isProtectedPath(filePath) || filePath === 'js/main.js' || filePath === 'style.css') {
        return { ok: false, error: `禁止删除核心文件: ${filePath}` };
      }
      if (!vfs.hasFile(filePath)) {
        return { ok: false, error: `文件不存在: ${filePath}` };
      }
      vfs.remove(filePath);
      return { ok: true, path: filePath };
    },
  });

  const verify_bundle = createTool({
    id: 'verify_bundle',
    description: '校验工程底线：必需文件存在、JS 语法无错、ES Module 相对路径全部闭合。',
    inputSchema: z.object({}),
    execute: async () => verifyVirtualBundle(vfs),
  });

  const generate_asset = createTool({
    id: 'generate_asset',
    description:
      '按需生成游戏 UI 图像或透明 PNG 素材（如主页海报、结局插画、搜证道具贴图、游戏图标）并直接落盘到 game-assembly/assets/ 下，代码里直接用 ./assets/xxx.png 引用。role=icon/sprite 会自动去背输出带 Alpha 透明通道的 PNG；role=background 输出完整实底背景图。',
    inputSchema: z.object({
      prompt: z.string().describe('画面描述（纯英文或中文视觉描述，勿带文字/水印要求）'),
      targetPath: z.string().describe('相对路径，如 assets/home_poster.png 或 assets/icon_watch.png'),
      role: z.enum(['icon', 'sprite', 'background']).default('icon').describe('素材角色：icon/sprite 自动抠图透明 PNG；background 实底海报'),
      aspect: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).optional().describe('宽高比，默认 icon=1:1，background=16:9'),
      style: z.string().optional().describe('可选画风修饰词'),
    }),
    execute: async ({ context }) => {
      if (!gameAssemblyDir) {
        return { ok: false, error: '未配置物理输出目录，无法生成图像资产' };
      }
      const res = await generateGameUiAsset({
        gameAssemblyDir,
        targetPath: context.targetPath,
        prompt: context.prompt,
        role: context.role,
        aspect: context.aspect,
        style: context.style,
      });
      return {
        ...res,
        importUrl: `./${res.path}`,
      };
    },
  });

  return {
    list_files,
    read_file,
    write_file,
    edit_file,
    delete_file,
    verify_bundle,
    ...(gameAssemblyDir ? { generate_asset } : {}),
  };
}
