import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  isTruncationFailure,
  rescueCompletedPrefix,
  buildContinuationPrompt,
} from '../../src/utils/continuation-stitcher.js';

describe('ContinuationStitcher (接力缝合器)', () => {
  const BeatSchema = z.object({
    beatId: z.string(),
    beatTitle: z.string(),
    actionDescription: z.string(),
  });

  it('正确识别截断错误 (finishReason === length)', () => {
    expect(isTruncationFailure({ finishReason: 'length' })).toBe(true);
    expect(isTruncationFailure({ message: 'output truncated by maxTokens' })).toBe(true);
    expect(isTruncationFailure({ finishReason: 'stop' })).toBe(false);
  });

  it('从 err.cause.value 中救援提取前缀并剔除末尾残缺项', () => {
    const rawError = {
      finishReason: 'length',
      message: 'Type validation failed',
      cause: {
        value: {
          environmentLock: { timeOfDay: '黄昏', tone: '冷灰' },
          actionBeats: [
            {
              beatId: 'b1',
              beatTitle: '镜头 01',
              actionDescription: '泥泞土路入画',
              cinematicIntent: '远景固定',
            },
            {
              beatId: 'b2',
              beatTitle: '镜头 02',
              actionDescription: '停步喘气',
              cinematicIntent: '中景跟拍',
            },
            // 第 3 项被截断，缺少 actionDescription 与 cinematicIntent
            {
              beatId: 'b3',
              beatTitle: '镜头 03',
            },
          ],
        },
        issues: [
          {
            code: 'invalid_type',
            expected: 'string',
            received: 'undefined',
            path: ['actionBeats', 2, 'actionDescription'],
          },
        ],
      },
    };

    const rescue = rescueCompletedPrefix(rawError, 'actionBeats', BeatSchema);
    expect(rescue.success).toBe(true);
    expect(rescue.completedItems).toHaveLength(2);
    expect(rescue.completedItems[0].beatId).toBe('b1');
    expect(rescue.completedItems[1].beatId).toBe('b2');
    expect(rescue.headerFields).toEqual({
      environmentLock: { timeOfDay: '黄昏', tone: '冷灰' },
    });
    expect(rescue.lastItemAnchor?.id).toBe('b2');
  });

  it('从被腰斩的 rawText 字符串中容错恢复前缀数组', () => {
    const truncatedRawText = `
    {
      "environmentLock": { "weather": "浓雾" },
      "actionBeats": [
        { "beatId": "b1", "beatTitle": "镜01", "actionDescription": "走入", "cinematicIntent": "远景" },
        { "beatId": "b2", "beatTitle": "镜02", "actionDescription": "转头", "cinematicIntent": "近景" },
        { "beatId": "b3", "beatTitle": "镜03", "actionDesc
    `;

    const rawError = {
      finishReason: 'length',
      text: truncatedRawText,
    };

    const rescue = rescueCompletedPrefix(rawError, 'actionBeats', BeatSchema);
    expect(rescue.success).toBe(true);
    expect(rescue.completedItems).toHaveLength(2);
    expect(rescue.completedItems[0].beatId).toBe('b1');
    expect(rescue.completedItems[1].beatId).toBe('b2');
    expect(rescue.headerFields).toEqual({
      environmentLock: { weather: '浓雾' },
    });
  });

  it('生成纯通用接力提示词（零业务偏见）', () => {
    const prompt = buildContinuationPrompt({
      originalPrompt: '请生成资产列表',
      arrayKey: 'assets',
      completedCount: 30,
      lastAnchor: {
        id: 'asset_30',
        title: '老屋铜铃',
        summary: '青铜材质法器',
      },
    });

    expect(prompt).toContain('请生成资产列表');
    expect(prompt).toContain('已确认完成的最后一项标识: asset_30 - 老屋铜铃 - ("青铜材质法器")');
    expect(prompt).toContain('严格从第 31 项起直接输出后续接力项');
    expect(prompt).toContain('与已保存的前 30 项平滑衔接');
    expect(prompt).not.toContain('镜头'); // 纯通用，不包含任何分镜业务词
  });

  it('优先支持外部传值的自定义续写指令 (continuationDirective)', () => {
    const prompt = buildContinuationPrompt({
      originalPrompt: '请生成分镜台本',
      arrayKey: 'actionBeats',
      completedCount: 20,
      customDirective: '【业务专有】请紧跟第 20 镜的机位衔接，续写剩余镜头。',
    });

    expect(prompt).toContain('请生成分镜台本');
    expect(prompt).toContain('【业务专有】请紧跟第 20 镜的机位衔接，续写剩余镜头。');
  });

  it('优先支持外部传值的完整提示词构造器 (customPromptBuilder)', () => {
    const prompt = buildContinuationPrompt({
      originalPrompt: '原任务',
      arrayKey: 'items',
      completedCount: 10,
      customPromptBuilder: (ctx) => `[自定义模式] 已有 ${ctx.completedCount} 项，正在续写 ${ctx.arrayKey}`,
    });

    expect(prompt).toBe('[自定义模式] 已有 10 项，正在续写 items');
  });
});
