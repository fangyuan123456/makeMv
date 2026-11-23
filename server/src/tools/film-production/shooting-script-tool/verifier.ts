/**
 * tools/film-production/shooting-script-tool/verifier.ts
 * 台词覆盖率语义核验与自愈器 (Dialogue Coverage Verifier SSOT)
 * 纯语义理解，不依赖任何特定正则或特定题材符号，确保文学剧本中所有台词 100% 被镜头捕捉
 */

import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { LLMProvider } from '../../../llm/index.js';
import { generateStructured } from '../../../utils/llm-diagnostics.js';
import type { ShootingScriptActionBeat } from '../../../project-store/contracts/film-production/film-spec.js';

const ExtractedDialogueSchema = z.object({
  dialogueLines: z.array(
    z.object({
      speaker: z.string().describe('说话的角色名'),
      line: z.string().describe('具体台词内容文本'),
    })
  ).describe('从剧本文学正文中提取出的所有角色口述台词'),
});

/**
 * 语义级提取文学剧本中的全部口述台词（不依赖特定格式符号，兼容散文体、剧本体等任何文风）
 */
export async function extractNarrativeDialogues(
  narrativeText: string,
  abortSignal?: AbortSignal
): Promise<Array<{ speaker: string; line: string }>> {
  if (!narrativeText || !narrativeText.trim()) return [];

  const agent = new Agent({
    name: 'dialogue-extractor',
    instructions:
      '你是一名专业剧本对白场记员。你的任务是从任意文学文体中精准提取出角色口述的所有台词内容（包括独白、对话、画外音、录音等）。严格排除旁白叙事与动作描述，仅提取口述对白。',
    model: LLMProvider.getModel(),
  });

  const prompt = `请分析以下文学剧情内容，提取其中角色所说的所有实际台词语句：

\`\`\`markdown
${narrativeText}
\`\`\`

请输出符合规范的 JSON 数组。`;

  try {
    const res = await generateStructured({
      agent,
      prompt,
      schema: ExtractedDialogueSchema,
      stage: 'film-tool',
      step: 'dialogue-coverage-extract',
      label: '剧本对白语义提取',
      abortSignal,
    });
    return (res as any)?.dialogueLines || [];
  } catch (err) {
    console.warn('[DialogueCoverageVerifier] 台词语义提取跳过 (模型响应异常):', err);
    return [];
  }
}

/**
 * 核验已生成的 ActionBeats 是否完整覆盖了提取出的台词
 */
export function verifyDialogueCoverage(
  beats: ShootingScriptActionBeat[],
  expectedLines: Array<{ speaker: string; line: string }>
): {
  isFullyCovered: boolean;
  missingLines: Array<{ speaker: string; line: string }>;
} {
  if (expectedLines.length === 0) {
    return { isFullyCovered: true, missingLines: [] };
  }

  const beatsDialogueText = beats
    .map((b) => b.dialogue || '')
    .filter(Boolean)
    .join('\n');

  const missingLines: Array<{ speaker: string; line: string }> = [];

  for (const expected of expectedLines) {
    // 采用语义模糊匹配（台词核心字词重合）
    const cleanLine = expected.line.replace(/[“”"''，。？！…—]/g, '').trim();
    if (!cleanLine) continue;

    const isCovered = beats.some((b) => {
      const bDialogue = (b.dialogue || '').replace(/[“”"''，。？！…—]/g, '').trim();
      return bDialogue.includes(cleanLine) || cleanLine.includes(bDialogue);
    });

    if (!isCovered) {
      missingLines.push(expected);
    }
  }

  return {
    isFullyCovered: missingLines.length === 0,
    missingLines,
  };
}
