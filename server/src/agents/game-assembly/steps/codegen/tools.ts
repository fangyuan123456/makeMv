/**
 * agents/game-assembly/steps/codegen/tools.ts
 * 编码产物协议：模型用「带路径的代码块」提交文件，这里负责解析与校验。
 *
 * 为什么不用 JSON tool_call：把整份源码塞进 JSON 字符串要多转义一层，
 * 又费 token 又容易在输出截断时整条作废。裸代码块 + 路径头最省也最稳。
 */

import type { TechPlanOutput } from '../../artifact.js';
import { VirtualFS } from './vfs.js';

export interface FileDraft {
  fileName: string;
  content: string;
  /** 代码块是否正常闭合，未闭合说明输出被截断 */
  closed: boolean;
}

const FILE_FENCE = /`{3,4}file:\s*([^\s`\n]+)[ \t]*\r?\n([\s\S]*?)(`{3,4}|$)/g;
const MIN_FILE_CHARS = 80;

/** 从模型回复里抽出所有「file:路径」代码块 */
export function parseFileDrafts(rawOutput: string): FileDraft[] {
  const drafts: FileDraft[] = [];
  for (const match of rawOutput.matchAll(FILE_FENCE)) {
    const fileName = (match[1] || '').trim().replace(/^\.?\//, '');
    const body = match[2] || '';
    const closed = Boolean(match[3]);
    if (!fileName) continue;
    drafts.push({ fileName, content: body.replace(/\s+$/, ''), closed });
  }
  return drafts;
}

/** 兼容性兜底：少数模型会退回 JSON tool_call 形态 */
function parseJsonToolCalls(rawOutput: string): FileDraft[] {
  const blocks = Array.from(rawOutput.matchAll(/`{3,4}([a-zA-Z0-9_-]*)[ \t]*\r?\n?([\s\S]*?)`{3,4}/g));
  const drafts: FileDraft[] = [];
  for (const block of blocks) {
    const lang = (block[1] || '').toLowerCase();
    if (!lang.includes('tool') && !lang.includes('json')) continue;
    const body = block[2].trim();
    const start = body.search(/[[{]/);
    if (start < 0) continue;
    try {
      const parsed = JSON.parse(body.slice(start));
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        const path = item?.args?.path || item?.path;
        const content = item?.args?.content || item?.content;
        if (path && content) drafts.push({ fileName: String(path), content: String(content), closed: true });
      }
    } catch {
      // 解析不了的尝试直接跳过，交给下一轮重来
    }
  }
  return drafts;
}

export function parseDrafts(rawOutput: string): FileDraft[] {
  const drafts = parseFileDrafts(rawOutput);
  return drafts.length > 0 ? drafts : parseJsonToolCalls(rawOutput);
}

export interface WriteOutcome {
  written: string[];
  rejected: Array<{ fileName: string; reason: string }>;
}

/**
 * 把草稿写进内存文件系统。越界文件名、截断内容、空内容一律打回并说明原因。
 */
export function applyDrafts(
  drafts: FileDraft[],
  vfs: VirtualFS,
  allowedFiles: Set<string>,
  plan: TechPlanOutput
): WriteOutcome {
  const written: string[] = [];
  const rejected: WriteOutcome['rejected'] = [];

  for (const draft of drafts) {
    const fileName = draft.fileName.split('/').pop() || draft.fileName;

    if (!allowedFiles.has(fileName)) {
      rejected.push({ fileName, reason: '不在本次架构规划内，禁止创建' });
      continue;
    }
    if (!draft.closed) {
      rejected.push({ fileName, reason: '代码块没有闭合，输出被截断——请拆小或精简后重写' });
      continue;
    }
    if (draft.content.trim().length < MIN_FILE_CHARS) {
      rejected.push({ fileName, reason: '内容为空或过短，必须是完整实现' });
      continue;
    }

    vfs.write(fileName, draft.content);
    if (!written.includes(fileName)) written.push(fileName);
  }

  // 结构校验：import 的目标必须是本次规划里的文件
  const allowed = new Set(plan.files.map((f) => f.fileName));
  for (const fileName of written) {
    const source = vfs.read(fileName) || '';
    for (const m of source.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)) {
      const target = m[1];
      if (!allowed.has(target)) {
        rejected.push({ fileName, reason: `import 了不存在的模块 ./${target}` });
      }
    }
  }

  return { written, rejected };
}

/**
 * 从已就绪源码抽出对外符号，给下一轮模型一份「前序模块真实长什么样」的只读契约。
 */
export function buildSymbolSummary(vfs: VirtualFS): string {
  const lines: string[] = [];

  for (const [fileName, source] of vfs.entries()) {
    if (!fileName.endsWith('.js')) continue;
    const symbols: string[] = [];

    for (const m of source.matchAll(/^\s*export\s+class\s+(\w+)([^{]*)\{/gm)) {
      const className = m[1];
      const bodyStart = m.index ?? 0;
      const body = source.slice(bodyStart, bodyStart + 6000);
      const methods = Array.from(
        body.matchAll(/^\s{2,4}(?:static\s+)?(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*\{/gm)
      )
        .map((mm) => `${mm[1]}(${mm[2]})`)
        .filter((sig) => !['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(sig.split('(')[0]))
        .slice(0, 14);
      symbols.push(`class ${className} { ${methods.join('; ')} }`);
    }

    for (const m of source.matchAll(/^\s*export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/gm)) {
      symbols.push(`function ${m[1]}(${m[2]})`);
    }

    for (const m of source.matchAll(/^\s*export\s+(?:const|let)\s+(\w+)/gm)) {
      symbols.push(`const ${m[1]}`);
    }

    if (symbols.length > 0) lines.push(`- ${fileName}：${symbols.join(' ｜ ')}`);
  }

  return lines.join('\n');
}
