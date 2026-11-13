/**
 * utils/run-failure-log.ts
 * 流水线整体失败证据落盘（Run Failure Log）
 *
 * 结构化生成失败已由 llm-diagnostics 单独落盘；这里兜住其它所有失败（图论门禁、素材缺失、
 * 代码生成越界、进程内异常……）：把完整错误栈 + 当时的任务进度写进
 * `.debug/_failures/<时间戳>/error.md`，并在任务面板的错误消息后面带上路径。
 *
 * 目的只有一个：失败之后不用重跑、不靠猜，打开目录就知道死在哪。
 */

import fs from 'node:fs';
import path from 'node:path';
import { getProjectDir, DEBUG_ROOT } from '../project-store/artifact-fs.js';

export interface RunFailureContext {
  projectId: string;
  runId?: string;
  workflowKey?: string;
  /** 失败瞬间的进度描述，用来判断死在第几道工序 */
  stageNote?: string;
}

/** 落盘一次运行失败，返回给人看的相对路径；任何异常都不往外抛 */
export function dumpRunFailure(ctx: RunFailureContext, err: unknown): string | undefined {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(getProjectDir(ctx.projectId), DEBUG_ROOT, '_failures', stamp);
    fs.mkdirSync(dir, { recursive: true });

    const e = err as { message?: string; stack?: string; name?: string };
    const message = String(e?.message || err);

    fs.writeFileSync(
      path.join(dir, 'error.md'),
      [
        '# 流水线执行失败',
        '',
        `- 项目: ${ctx.projectId}`,
        `- 任务: ${ctx.runId || '(未知)'}`,
        `- 工作流: ${ctx.workflowKey || '(未知)'}`,
        `- 时间: ${new Date().toISOString()}`,
        `- 当时的进度: ${ctx.stageNote || '(无)'}`,
        '',
        '## 错误消息',
        '',
        '```',
        message,
        '```',
        '',
        '## 调用栈',
        '',
        '```',
        String(e?.stack || '(无堆栈)'),
        '```',
        '',
      ].join('\n'),
      'utf-8'
    );

    const rel = path.relative(process.cwd(), dir).replace(/\\/g, '/');
    return rel;
  } catch (writeErr) {
    console.warn('[run-failure-log] 失败证据落盘异常:', writeErr);
    return undefined;
  }
}
