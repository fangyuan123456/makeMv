/**
 * agents/director/tools/emit-director-intent.tool.ts
 * AI 视听总导演专属结构化意图决策工具 (Director Intent Tool SSOT)
 * 
 * 核心机制（法典 2.2 结构化输出与人在回路）：
 * 1. 结构化 Schema 刚性约束：由 Zod Schema 强类型约束 action 枚举与工序参数，彻底消灭大模型手写 XML 标签的拼写与格式幻觉；
 * 2. 包装器自愈：基于重写后的 createTool，在模型通信时降维为字符串传输，并在运行时由 JsonSanitizer 100% 还原为强类型 Schema；
 * 3. 伴随流式直出：大模型在流式推演结束时，发起 Function Call，将行动决策由底座模型结构化输出。
 */

import { z } from 'zod';
import { createTool, resolveToolArgs } from '../../../mastra-compat/index.js';

export const EMIT_DIRECTOR_INTENT_TOOL_ID = 'emit_director_intent';

export interface AgentIntentSignal {
  action: 'next' | 'modify' | 'approve' | 'audit' | 'rollback';
  skill?: string;
  target?: string;
  content?: string;
}

export const DirectorIntentSchema = z.object({
  action: z
    .enum(['next', 'modify', 'approve', 'audit', 'rollback'])
    .describe(
      '意图决策枚举（必填，无默认值，必须显式选择）：next(推演达成共识，提议进入下一阶段工序) | modify(已有资产局部外科手术微调) | approve(纯粹开工授权，启动当前待审工序) | audit(独立审查官质检多维评估) | rollback(时空回退推翻重做)。任何消息（包括闲聊寒暄、咨询）都必须映射为工程决策动作——诉求模糊或难以判断时一律选 next，严禁省略本工具调用退化为纯聊天'
    ),
  skill: z
    .string()
    .optional()
    .describe('法定工序标识符（仅在 modify 或 rollback 时填写，例如 character-portrait, story-bible, video-production 等）'),
  target: z
    .string()
    .optional()
    .describe('微调目标实体名称或ID（仅在 modify 时填写，例如主角姓名、特定角色名、分镜编号 shot_1 等）'),
  content: z
    .string()
    .optional()
    .describe('微调具体诉求或回退理由（仅在 modify 或 rollback 时填写，例如“主角年龄改为18岁”、“换成赛博朋克霓虹光影”）'),
});

export type DirectorIntentInput = z.infer<typeof DirectorIntentSchema>;

export const emitDirectorIntentTool = createTool({
  id: EMIT_DIRECTOR_INTENT_TOOL_ID,
  description: `AI 视听总导演工序意图决策与开工发射工具（即插即用自内聚工具）。
【何时必须调用本工具（Trigger Conditions）】：
总导演向创作者给出视听推演方案、修改回应或推进建议后，必须同步调用本工具提交行动决策，严禁只输出文本而遗漏本工具调用。

严格遵循自顶向下优先级漏斗（高优先级短路，禁止降级）：
1. P0 (rollback): 创作者明确要求推翻重做、完全走偏、回退上游工序重新推演时调用；
2. P1 (modify): 创作者对已有资产或设定提出任何修改、调整、重设诉求（如主角改年龄、性格、换装、剧情微调），即使带有“同意”只要有修改要求必须选 modify，禁止选 next 或 approve；
   事实定位原则：按「被修改的事实落在哪个已落盘资产里」判断，而不是创作者字面提到的工序：
   - 故事设定事实（角色姓名/性别/年龄/身份/背景/人物关系、世界观、剧情走向、幕结构）→ story-bible；
   - 台词、场次内容、场面调度 → scene-script；镜头切分、运镜、构图 → storyboard；
   - 角色视觉形象（服装/发型/长相风格）→ character-portrait；画面参考 → keyframe-reference；成片动态 → video-production；
   即使诉求听起来在谈后续工序（如"主角改成女的"是在聊角色形象），只要改动的是已落盘的设定事实，也必须选 modify；
   skill 判断不准时，务必把 target 填成具体实体名（角色名/场次名/镜头号），系统会反查黑板真实产物自动定位工序；
   前提硬约束：modify 只能作用于已经生成落盘的资产。若所涉工序从未执行（例如项目刚创建、首条消息就在描述创作构想），禁止选 modify，必须选 next 推进生成；
3. P2 (approve): 创作者发出开启、推进、同意、开始制作、进入下一步等开工指令（无任何附加修改要求），确认启动当前工序时调用；
4. P3 (audit): 创作者要求独立审查官审计挑毛病或进行质检评估时调用；
5. P4 (next): 当你完成当前阶段的故事方案推演并提议推进工序时，必须伴随调用本工具提交 next 意图。注意区分：提议推进（等创作者拍板）时正文末尾应自然征求意见；但汇报已完成的工序成果时，下一工序衔接提醒由系统自动补充，正文严禁复述「已为你准备下一工序/请确认授权」类流程话术。`,
  inputSchema: DirectorIntentSchema,
  outputSchema: z.object({
    success: z.boolean(),
    intent: DirectorIntentSchema,
  }),
  execute: async (intent: DirectorIntentInput) => {
    return {
      success: true,
      intent,
    };
  },
});

/**
 * 从大模型运行结果中唯一提取总导演结构化意图（高内聚 SSOT）
 * 严格遵循 Mastra 官方微内核 ToolCallChunk.payload 契约，并通过 resolveToolArgs 稳健还原
 */
export async function extractDirectorIntent(
  modelResult: { toolCalls?: any[] | Promise<any[]> } | any
): Promise<AgentIntentSignal | undefined> {
  const toolCalls = await modelResult?.toolCalls;
  if (!Array.isArray(toolCalls)) return undefined;

  // 倒序优先匹配最新且具有有效载荷的工具调用 (过滤被切片废弃的无效调用)
  const targetCall = [...toolCalls].reverse().find((chunk) => {
    const name = chunk?.toolName || chunk?.payload?.toolName;
    const args = chunk?.args || chunk?.payload?.args;
    return name === EMIT_DIRECTOR_INTENT_TOOL_ID && args;
  });

  if (!targetCall) return undefined;
  const rawArgs = targetCall.args || targetCall.payload?.args;

  const parsed = resolveToolArgs<DirectorIntentInput>(rawArgs, DirectorIntentSchema);
  if (!parsed) return undefined;

  if (!parsed.action) {
    // 工程层兜底：schema 无默认值，模型漏填 action 时显式回退 next（全消息皆决策，防退化为闲聊）。
    // 与 zod default 的区别：这里有日志留痕、可观测，且 next 产物是 proposed 待审卡（人在回路，安全）。
    console.warn(`[DirectorIntent] 意图工具调用缺少 action，工程层兜底为 next`);
    return {
      action: 'next',
      skill: parsed.skill || undefined,
      target: parsed.target || undefined,
      content: parsed.content || undefined,
    };
  }

  return {
    action: parsed.action,
    skill: parsed.skill || undefined,
    target: parsed.target || undefined,
    content: parsed.content || undefined,
  };
}
