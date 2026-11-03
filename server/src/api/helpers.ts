/**
 * api/helpers.ts
 * 基础轻量 HTTP 工具库 (Zero External Dependency)
 */

import type { IncomingMessage, ServerResponse } from 'http';

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB 请求体上限 (防 DOS 攻击)

export function handleCors(req: IncomingMessage, res: ServerResponse): boolean {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

export function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    let receivedBytes = 0;

    req.on('data', (chunk) => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_BODY_SIZE) {
        req.destroy(new Error('Payload Too Large'));
        reject(new Error('请求体超出 10MB 上限'));
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve({});
      }
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

export function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function sendError(res: ServerResponse, statusCode: number, message: string): void {
  sendJson(res, statusCode, { success: false, error: message });
}
