/**
 * media/providers/MockImageProvider.ts
 * 测试与离线轻量 Mock 图像生成器
 */

import type { IImageProvider, ImageGenerationOptions } from './ImageProvider.js';
import { config } from '../../utils/config.js';

export class MockImageProvider implements IImageProvider {
  public readonly name = 'mock';

  /** 画幅优先取调用方显式 size，否则跟随全局画幅配置 */
  private resolveSize(sizeStr?: string): [number, number] {
    const parts = (sizeStr || '').split(/[x*]/).map((s) => parseInt(s.trim(), 10));
    if (parts.length === 2 && parts.every((n) => Number.isFinite(n) && n > 0)) {
      return [parts[0], parts[1]];
    }
    return [config.frame.width, config.frame.height];
  }

  public async generateImage(prompt: string, options?: ImageGenerationOptions): Promise<string> {
    // 生成一个带有提示词摘要的标准 SVG Data URI，确保全流程测试真实闭环
    const [w, h] = this.resolveSize(options?.size);
    const safeText = (prompt || 'Mock Scene Image').slice(0, 40).replace(/[<>&"]/g, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0f172a" />
          <stop offset="100%" stop-color="#1e293b" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)" />
      <rect x="20" y="20" width="${w - 40}" height="${h - 40}" fill="none" stroke="#38bdf8" stroke-width="2" stroke-dasharray="6,6" opacity="0.6" />
      <text x="${w / 2}" y="${h * 0.47}" fill="#38bdf8" font-size="20" font-family="sans-serif" text-anchor="middle" font-weight="bold">MOCK KEYFRAME PREVIEW</text>
      <text x="${w / 2}" y="${h * 0.56}" fill="#94a3b8" font-size="14" font-family="sans-serif" text-anchor="middle">${safeText}</text>
    </svg>`;
    const base64 = Buffer.from(svg).toString('base64');
    return `data:image/svg+xml;base64,${base64}`;
  }
}
