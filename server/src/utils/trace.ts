/**
 * utils/trace.ts
 * 极简高内聚工程诊断追踪与错误归一化基础设施 (SSOT)
 * 
 * 核心设计原则：
 * 1. 零外部依赖，极简追加写入本地项目 trace/{day}.jsonl；
 * 2. 诊断旁路运行，绝对禁止阻断主业务流程；
 * 3. 错误归一化 (classify)：将各种底层报错归入 6 大标准错误码，提供机器可读与重试判定。
 */

import fs from 'fs';
import path from 'path';
import { config } from './config.js';

export interface ClassifiedError {
  code: 'AUTH' | 'RATE_LIMIT' | 'TIMEOUT' | 'CONTENT_FILTER' | 'PARSE' | 'UNKNOWN';
  retryable: boolean;
  detail: string;
}

/**
 * 核心错误归一化分析器 (Error Classifier SSOT)
 */
export function classify(err: any): ClassifiedError {
  const msg = String(err?.message || err || 'Unknown error');

  if (/401|403|invalid.*key|unauthorized|access.*denied|api.*key.*missing/i.test(msg)) {
    return { code: 'AUTH', retryable: false, detail: msg };
  }
  if (/429|rate.?limit|quota|concurrency/i.test(msg)) {
    return { code: 'RATE_LIMIT', retryable: true, detail: msg };
  }
  if (/timeout|ETIMEDOUT|aborted.*timeout|timed.*out|hangup/i.test(msg)) {
    return { code: 'TIMEOUT', retryable: true, detail: msg };
  }
  if (/审核|sensitive|content.?filter|violation|合规|违规|风控/i.test(msg)) {
    return { code: 'CONTENT_FILTER', retryable: false, detail: msg };
  }
  if (/JSON|parse|Unexpected token|SyntaxError/i.test(msg)) {
    return { code: 'PARSE', retryable: true, detail: msg };
  }

  return { code: 'UNKNOWN', retryable: true, detail: msg };
}

const PROJECT_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

/**
 * 追加写入项目 trace/{YYYY-MM-DD}.jsonl 日志
 */
export function trace(projectId: string, kind: string, payload: Record<string, any>): void {
  try {
    // 刚性白名单校验与空值防护：非合法字符直接安全放弃，严禁向外穿透
    if (!projectId || typeof projectId !== 'string' || !PROJECT_ID_REGEX.test(projectId)) {
      return;
    }

    const baseProjectsDir = path.resolve(config.paths.projects);
    const projectDir = path.resolve(baseProjectsDir, projectId);

    // 刚性沙箱边界检查：严禁越出 baseProjectsDir
    if (!projectDir.startsWith(baseProjectsDir + path.sep)) {
      return;
    }

    const traceDir = path.join(projectDir, 'trace');
    if (!fs.existsSync(traceDir)) {
      fs.mkdirSync(traceDir, { recursive: true });
    }

    const day = new Date().toISOString().slice(0, 10);
    const logFile = path.join(traceDir, `${day}.jsonl`);

    const entry = {
      ts: new Date().toISOString(),
      kind,
      ...payload,
    };

    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // 旁路诊断日志，永不阻断业务执行
  }
}
