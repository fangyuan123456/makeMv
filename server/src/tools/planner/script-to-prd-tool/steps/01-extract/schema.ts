/**
 * tools/planner/script-to-prd-tool/steps/01-extract/schema.ts
 * 步骤一：剧本结构语义抽取专属契约 (Extract Step Contract SSOT)
 */

import { z } from 'zod';
import {
  InteractionConfigSchema,
  InteractionKindSchema,
  PrdStateFieldSchema,
  PrdUiThemeSchema,
} from '../../../../../project-store/contracts/planner/index.js';

export const ScriptToPrdInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识符 (SSOT 必填)'),
  scriptMarkdown: z.string().optional().describe('全景剧本 Markdown 文本 (可选，留空则自动从项目资产黑板读取)'),
  title: z.string().optional().describe('剧作标题 (可选，留空则自动从项目资产读取)'),
});

export type ScriptToPrdInput = z.infer<typeof ScriptToPrdInputSchema>;

export const ExtractedClipInteractionOutcomeSchema = z.object({
  key: z.string().describe('结果键名：如 A / B / FOUND / SUCCESS / FAIL / TIMEOUT'),
  label: z.string().describe('选项文案或结果描述'),
  targetNodeId: z.string().optional().describe('指向的下一个片段 ID（单线互动或推进主线时填写）'),
  targetEndingId: z.string().optional().describe('指向的结局 ID（走向专有终局时填写）'),
  stateTag: z.string().optional().describe('写入状态标签，如 +ledger'),
  feedback: z.string().optional().describe('完成后的轻反馈文案'),
});

export const ExtractedClipInteractionSchema = z.object({
  kind: InteractionKindSchema.describe('互动玩法类型：CHOICE / TIMED_CHOICE / SEARCH / HOLD / QTE_TAP / TIMING / CLICK / ACTION_ZONE'),
  isBranching: z.boolean().describe('true=命运分支；false=单线沉浸互动（完成后推进同一幕后续）'),
  prompt: z.string().describe('呈现给玩家的操作提示或抉择提示'),
  timeoutSec: z.number().nullable().optional().describe('限时秒数（无倒计时可为 null）'),
  config: InteractionConfigSchema.optional().describe('玩法专属参数（如 SEARCH 的 targets/decoys 等）'),
  outcomes: z.array(ExtractedClipInteractionOutcomeSchema).min(1).describe('所有结果与去向列表'),
});

export const ExtractedScriptStructureSchema = z.object({
  title: z.string().describe('提取出的剧作标题'),
  genre: z.string().optional().describe('真实题材类型（如 中式民俗微恐、赛博朋克潜入、动作悬疑）'),
  playerIdentity: z.string().optional().describe('玩家扮演的主角姓名与身份定位'),
  premiseAndPerspective: z.string().optional().describe('故事核心前提与第一人称临场视角描述'),
  uiTheme: PrdUiThemeSchema.optional().describe('契合剧作题材的 UI 主题配色与质感建议'),
  stateSchema: z.array(PrdStateFieldSchema).optional().describe('全局状态字典（含每个状态变量的中文名、初始值、HUD 显隐及用途）'),
  clips: z.array(
    z.object({
      id: z.string().describe('切片规范 ID，如 c1, c2, b1_a'),
      title: z.string().describe('切片标题'),
      narrativeText: z.string().describe('切片对应的剧情台词文本'),
      interaction: ExtractedClipInteractionSchema.nullable().optional().describe('本片段末尾触发的互动节点（含单线沉浸互动与命运分支）'),
    })
  ).describe('提取的剧情片段切片清单'),
  endings: z.array(
    z.object({
      id: z.string().describe('结局 ID，如 e_he_1, e_be_1'),
      title: z.string().describe('结局标题'),
      endingType: z.enum(['TE', 'HE', 'BE', 'NE', 'SE']).describe('结局类型 (TE=真结局/HE=好结局/BE=坏结局/NE=普通/SE=特殊)'),
      summary: z.string().describe('结局收敛剧情总结'),
    })
  ).describe('提取的所有结局清单'),
});

export type ExtractedScriptStructure = z.infer<typeof ExtractedScriptStructureSchema>;

export const ExtractStepInputSchema = ScriptToPrdInputSchema.extend({
  abortSignal: z.any().optional().describe('取消执行信号量'),
  _context: z.any().optional(),
});

export type ExtractStepInput = z.infer<typeof ExtractStepInputSchema>;
