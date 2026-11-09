/**
 * agents/text-game/tools/test-play.tool.ts
 * 互动文游 Pi Agent 纯代码级确定性模拟试玩工具
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { TextGameDraftRegistry } from '../draft-store.js';

export const TEST_PLAY_TOOL_ID = 'simulate_test_play';

export const TestPlayInputSchema = z.object({
  sessionId: z.string().describe('当前构建会话 ID'),
  choicePath: z
    .array(z.string())
    .min(1)
    .describe('连续选取的选项 ID 序列，例如 ["opt_silent", "opt_swap_list"]'),
});

export const simulateTestPlayTool = createTool({
  id: TEST_PLAY_TOOL_ID,
  description:
    '使用纯代码确定性运行引擎模拟试玩一条路线。验证门禁是否满足、数值转移是否正常、是否能正常到达结局。',
  inputSchema: TestPlayInputSchema,
  execute: async ({ context }) => {
    const { sessionId, choicePath } = context;
    const session = TextGameDraftRegistry.getOrCreate(sessionId);

    return session.simulatePlay(choicePath);
  },
});
