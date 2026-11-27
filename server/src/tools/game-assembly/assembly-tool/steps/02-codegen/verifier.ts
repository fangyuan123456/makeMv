/**
 * tools/game-assembly/assembly-tool/steps/02-codegen/verifier.ts
 * 虚拟工程静态底线校验器（ES Module 语法 + 相对引用闭合 + 必需入口检查）
 */

import path from 'node:path';
import ts from 'typescript';
import type { VirtualFS } from './vfs.js';

export interface BundleVerificationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  files: string[];
}

const IMPORT_PATH_RE = /^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm;

export function normalizeVfsPath(rawPath: string): string {
  return rawPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').trim();
}

function checkJsSyntax(filePath: string, code: string): string[] {
  const errors: string[] = [];
  const res = ts.transpileModule(code, {
    fileName: filePath,
    reportDiagnostics: true,
    compilerOptions: {
      allowJs: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  });
  for (const diag of res.diagnostics || []) {
    if (diag.category !== ts.DiagnosticCategory.Error) continue;
    const msg = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
    if (diag.file && typeof diag.start === 'number') {
      const { line, character } = diag.file.getLineAndCharacterOfPosition(diag.start);
      errors.push(`${filePath}:${line + 1}:${character + 1} 语法错误: ${msg}`);
    } else {
      errors.push(`${filePath} 语法错误: ${msg}`);
    }
  }
  return errors;
}

export function verifyVirtualBundle(vfs: VirtualFS): BundleVerificationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const files = vfs.list();

  const requiredFiles = [
    'index.html',
    'story.json',
    'runtime/player.js',
    'runtime/player.css',
    'runtime/engine.js',
    'style.css',
    'js/main.js',
  ];

  for (const req of requiredFiles) {
    if (!vfs.hasFile(req)) {
      errors.push(`缺少必需入口或底座文件: ${req}`);
    }
  }

  for (const filePath of files) {
    if (!filePath.endsWith('.js')) continue;
    const code = vfs.read(filePath) || '';
    if (!code.trim()) {
      errors.push(`JS 文件为空: ${filePath}`);
      continue;
    }

    if (/^\s*(interface|type)\s+\w+/m.test(code)) {
      warnings.push(`${filePath} 可能包含 TypeScript 类型语法，请确保为纯 JavaScript`);
    }

    errors.push(...checkJsSyntax(filePath, code));

    let match: RegExpExecArray | null;
    IMPORT_PATH_RE.lastIndex = 0;
    while ((match = IMPORT_PATH_RE.exec(code)) !== null) {
      const spec = match[1];
      if (!spec.startsWith('./') && !spec.startsWith('../')) {
        errors.push(`${filePath} 禁止引入外部包或裸模块路径: ${spec}`);
        continue;
      }
      const dir = path.posix.dirname(filePath);
      const resolved = normalizeVfsPath(path.posix.normalize(path.posix.join(dir, spec)));
      if (!vfs.hasFile(resolved)) {
        errors.push(`${filePath} 引用的模块不存在: ${spec} (解析为 ${resolved})`);
      }
    }
  }

  const cssCode = vfs.read('style.css') || '';
  if (!cssCode.trim()) {
    errors.push('style.css 不能为空');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    files,
  };
}
