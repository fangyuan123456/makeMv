/**
 * agents/planner/steps/interaction-slicing/schema.ts
 * 互动切口与剧幕拆分工序契约 (Interaction Slicing Schema SSOT)
 *
 * 核心哲学：
 * 1. 严格遵循「1 互动点 = 1 独立视频切片」：每个互动点（不论是单线体感操作 ACTION 还是分支抉择 CHOICE）
 *    都对应前序剧情片段播完(onEnded)后触发的唯一交互，杜绝同幕连挂双互动；
 * 2. 彻底源头结构化：平铺单字段 `interaction`（category: 'ACTION' | 'CHOICE'），零双字段冗余，兼容所有 LLM 结构化输出。
 */

import { z } from 'zod';

/**
 * 片段末尾唯一互动契约（ACTION 与 CHOICE 严格互斥）
 */
export const ClipInteractionSchema = z
  .object({
    category: z
      .enum(['ACTION', 'CHOICE'])
      .describe(
        '互动形态分类：ACTION=单线按钮交互（点击/长按/简单输入确认后直连下一片段）；CHOICE=命运分支抉择（二选一按钮分流主干或支线）'
      ),
    // category === 'ACTION' 时填写
    actionType: z
      .string()
      .optional()
      .describe('ACTION 时必填：按钮交互类型，优先 CLICK / HOLD，必要时可用 INPUT'),
    prompt: z
      .string()
      .optional()
      .describe('ACTION 时必填：6~18字按钮行动文案（承接尾帧往下推进，严禁重演刚做完的动作或虚构屏幕热区/擦拭动作）'),
    feedback: z
      .string()
      .optional()
      .describe('ACTION 时必填：点击按钮后的简短过场反应或心理提示（10~28字）'),
    // category === 'CHOICE' 时填写
    cutId: z
      .string()
      .optional()
      .describe('CHOICE 时必填：对应分支片段唯一编号，统一使用 "<clipId>.1"（如 S2.1）'),
    mainlineChoice: z
      .string()
      .optional()
      .describe('CHOICE 时必填：选项 A（沿主线继续推进的立场与动作）'),
    branchChoice: z
      .string()
      .optional()
      .describe('CHOICE 时必填：选项 B（进入支线或截然不同行动策略的抉择）'),
    conflictSummary: z
      .string()
      .optional()
      .describe('CHOICE 时必填：该抉择点面临的核心戏剧冲突提示'),
  })
  .superRefine((val, ctx) => {
    if (val.category === 'ACTION') {
      if (!val.actionType?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'category 为 ACTION 时必须填写 actionType',
          path: ['actionType'],
        });
      }
      if (!val.prompt?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'category 为 ACTION 时必须填写 prompt',
          path: ['prompt'],
        });
      }
    } else if (val.category === 'CHOICE') {
      if (!val.cutId?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'category 为 CHOICE 时必须填写 cutId',
          path: ['cutId'],
        });
      }
      if (!val.mainlineChoice?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'category 为 CHOICE 时必须填写 mainlineChoice',
          path: ['mainlineChoice'],
        });
      }
      if (!val.branchChoice?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'category 为 CHOICE 时必须填写 branchChoice',
          path: ['branchChoice'],
        });
      }
    }
  });

export type ClipInteraction = z.infer<typeof ClipInteractionSchema>;

/**
 * 单个视听片段节点模型 (1 片段 = 至多 1 互动)
 */
export const SlicedClipNodeSchema = z.object({
  clipId: z.string().describe('片段唯一标识，统一使用 S1, S2, S3...（1:1 对应 S1.mp4）'),
  level: z.number().describe('拓扑层级 n: 1, 2, 3... 从 1 递增'),
  title: z.string().describe('片段标题'),
  narrativeText: z.string().describe('由原主干剧本按互动标签物理切分出的完整分段正文'),
  isEnding: z.boolean().describe('是否为通关主线终局收口'),
  interaction: ClipInteractionSchema.optional().describe(
    '本片段播完(onEnded)触发的唯一互动点（非终局片段必填，终局片段可省略或挂收官动作互动）'
  ),
});

export type SlicedClipNode = z.infer<typeof SlicedClipNodeSchema>;

export const SliceInteractionsInputSchema = z.object({
  spineScript: z.string().describe('Step 1 产出的高纯度黄金主干剧本纯文本'),
});

/**
 * Step 2A · 原位 Patch 插入互动标签计划
 */
export const InteractionTagPatchSchema = z.object({
  tagId: z.string().min(1).describe('互动标签标识，如 I1, I2, I3'),
  clipTitle: z.string().min(1).describe('本段剧幕标题（4~12字）'),
  intentHint: z
    .string()
    .optional()
    .describe(
      '切口预设触发意图（8~25字，选锚点前必先明确）：玩家停在这里将要点击触发的下一个尚未发生的动作、情感回应或场景推进方向（如“拆看递来的信物”“推门步入下一场景”“稳住呼吸开口回应”）；切点 insertAfter 必须落在该动作执行之前，绝不可等动作和结果演完后再切'
    ),
  insertAfter: z
    .string()
    .min(2)
    .describe('从原剧本逐字截取的一小段独特锚点文本（约10~25字、含足够前文及句末标点，禁止只写三四个字），程序将在其后原位插入互动标签'),
  category: z
    .enum(['ACTION', 'CHOICE'])
    .describe('互动类型：ACTION=单线按钮推进节点；CHOICE=二选一分支抉择按钮'),
});

export type InteractionTagPatch = z.infer<typeof InteractionTagPatchSchema>;

export const InteractionTagPatchPlanSchema = z.object({
  title: z.string().describe('短剧中文标题'),
  endingTitle: z
    .string()
    .optional()
    .default('终局收束')
    .describe('最后一个标签之后、承载主线终局的片段标题'),
  patches: z
    .array(InteractionTagPatchSchema)
    .describe('按剧情先后顺序排列的互动标签插入点清单'),
});

export type InteractionTagPatchPlan = z.infer<typeof InteractionTagPatchPlanSchema>;

/**
 * Step 2C · 为物理切分后的单个标签实现具体玩法与内容
 */
export const ActionGameplayOutputSchema = z.object({
  actionType: z
    .enum(['CLICK', 'HOLD', 'INPUT'])
    .describe('按钮交互类型（仅允许这三选一）：CLICK（单次点击按钮）/ HOLD（长按按钮蓄力或稳住局势）/ INPUT（仅在确需输入口令密码时用）'),
  prompt: z
    .string()
    .min(1)
    .describe('6~18字按钮行动提示（紧承尾帧推进下一步，如“迈步探向暗梯”“细察铜钱划痕”；禁止重演刚演完的动作，禁止虚构热区点击/擦拭/连点）'),
  feedback: z
    .string()
    .min(1)
    .describe('10~28字，点击按钮后的简短过场反应或心情定调（承上启下，不重演上文、不剧透后文）'),
});

export type ActionGameplayOutput = z.infer<typeof ActionGameplayOutputSchema>;

export const ChoiceGameplayOutputSchema = z.object({
  conflictSummary: z
    .string()
    .min(1)
    .describe('12~32字，仅基于当前片段结尾已呈现局面的核心戏剧冲突提示（严禁剧透后段）'),
  mainlineChoice: z
    .string()
    .min(1)
    .describe('10~28字，选项 A（顺沿下一段主线继续推进的立场与动作）'),
  branchChoice: z
    .string()
    .min(1)
    .describe('10~28字，选项 B（进入支线或截然不同行动策略的抉择）'),
});

export type ChoiceGameplayOutput = z.infer<typeof ChoiceGameplayOutputSchema>;

export const SliceInteractionsOutputSchema = z.object({
  title: z.string().describe('短剧中文标题'),
  clips: z.array(SlicedClipNodeSchema).describe('按互动点切分出的有序视听演播片段清单'),
});

export type SliceInteractionsInput = z.infer<typeof SliceInteractionsInputSchema>;
export type SliceInteractionsOutput = z.infer<typeof SliceInteractionsOutputSchema>;

/**
 * 纯代码渲染器：0 token 开销、0 幻觉、100% 确定性拼装人类友好的 Markdown 分幕台本
 */
export function formatClipsToMarkdown(title: string, clips: SlicedClipNode[]): string {
  const choiceCount = clips.filter((c) => c.interaction?.category === 'CHOICE').length;
  const actionCount = clips.filter((c) => c.interaction?.category === 'ACTION').length;
  const lines: string[] = [
    `# 《${title}》互动分幕导演工作台本`,
    '',
    `> **总片段数**：共 ${clips.length} 个视听演播片段 ｜ **抉择分流**：${choiceCount} 处 ｜ **操作互动**：${actionCount} 处`,
    `> **映射原则**：严格 1 片段 ➔ 1 互动点，视听尾帧与交互体验 1:1 对齐`,
    '',
    '---',
    '',
  ];

  for (const clip of clips) {
    lines.push(`## 片段 ${String(clip.level).padStart(2, '0')}：${clip.title}`);
    lines.push('');
    lines.push('**【主干文学剧情】**');
    lines.push(clip.narrativeText);
    lines.push('');

    if (clip.interaction?.category === 'ACTION') {
      lines.push('---');
      lines.push(`### 🎬【互动点 ${String(clip.level).padStart(2, '0')} · 尾帧操作互动｜${clip.interaction.actionType || '交互'}】`);
      lines.push(`- **玩家操作**：${clip.interaction.prompt || ''}`);
      if (clip.interaction.feedback) {
        lines.push(`- **即时反馈**：${clip.interaction.feedback}`);
      }
      if (!clip.isEnding) {
        lines.push(`- 👉 **【顺延流向】**：[完成交互后进入片段 ${String(clip.level + 1).padStart(2, '0')}]`);
      }
      lines.push('');
    } else if (clip.interaction?.category === 'CHOICE') {
      lines.push('---');
      lines.push(`### 🎬【互动点 ${String(clip.level).padStart(2, '0')} · 命运分流抉择】`);
      lines.push(`- **核心戏剧冲突**：${clip.interaction.conflictSummary || '关键抉择'}`);
      lines.push(`- 👉 **【路径 A · 主线】**：${clip.interaction.mainlineChoice || '沿主线继续'} ➔ [直接顺延进入片段 ${String(clip.level + 1).padStart(2, '0')}]`);
      lines.push(`- 🔀 **【路径 B · 分支】**：${clip.interaction.branchChoice || '走向支线'} ➔ 📌 [保留切口 \`${clip.interaction.cutId || `${clip.clipId}.1`}\`，交由 Step 3 专项推演分支剧本]`);
      lines.push('');
    } else if (clip.isEnding) {
      lines.push('---');
      lines.push('### 🎬【终局收束 · 通关结局】');
      lines.push('👉 **达成黄金主线终局**，进入结局结算。');
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}
