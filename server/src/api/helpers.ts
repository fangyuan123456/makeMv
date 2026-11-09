/**
 * api/helpers.ts
 * 统一 HTTP 响应工具与错误格式化 (API Helpers SSOT)
 */

import type { Response } from 'express';

export function sendSuccess<T = any>(res: Response, data: T, message?: string): void {
  res.json({
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
  });
}

export function sendError(res: Response, status: number, error: string): void {
  res.status(status).json({
    success: false,
    error,
    timestamp: new Date().toISOString(),
  });
}
