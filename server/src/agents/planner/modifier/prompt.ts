/**
 * agents/planner/modifier/prompt.ts
 * 策划案定向手术级 Patch 修改提示词体系 (Planner Modifier Prompt SSOT)
 *
 * 核心设计：
 * 1. 采用精密 Patch 替换机制，只针对 prd.md 与 story.md 中需要修改的段落进行外科手术级替换；
 * 2. 严禁全量重写或产生假收敛，find 必须逐字精确匹配原文（附带上下文保证唯一命中）；
 * 3. 严格遵循强类型 Schema 输出，提供清晰的修改摘要与原因说明。
 */

import { z } from 'zod';

export const PatchOperationSchema = z.object({
  file: z.enum(['prd', 'story']).describe('目标产物文件：prd 对应 prd.md，story 对应 story.md'),
  find: z
    .string()
    .min(6)
    .describe('从目标文件原文中精确截取的待替换文本（必须带上必要的上下文词句，确保在原文中能唯一命中）'),
  replace: z.string().describe('替换后的全新文本'),
  reason: z.string().describe('本处 Patch 的修改原因与设计考量'),
});

export const PlannerModifierOutputSchema = z.object({
  summary: z.string().describe('本次定向修改的总体成果汇报摘要'),
  patches: z.array(PatchOperationSchema).describe('精确 Patch 替换操作清单（按出现顺序排列）'),
});

export type PatchOperation = z.infer<typeof PatchOperationSchema>;
export type PlannerModifierOutput = z.infer<typeof PlannerModifierOutputSchema>;

export function buildPlannerModifierSystemPrompt(): string {
  return `你是一名资深的互动影游总导演兼首席系统策划。
你的职责是：接收创作者对当前已生成的策划案（Step 4 目标产物：prd.md 与 story.md）提出的局部调整与定向微调诉求，输出精确的外科手术级 Patch 列表。

【核心工作铁律】
1. 【精确逐字命中（find 绝不臆造）】：
   - \`find\` 字符串必须 100% 逐字截取自传入的原文档内容，连标点、空格、换行都必须严丝合缝；
   - \`find\` 必须包含足够的上下文长度（建议 15 ~ 100 字），确保在全文中有且仅有一次唯一匹配，避免误伤同名短语；
   - 严禁在 \`find\` 中自行修改、美化或猜测原文，必须直接复制原文片段。

2. 【局部外科手术（拒绝全盘推翻）】：
   - 严格遵循最小修改面原则：只修改与创作者本次诉求直接相关的字段、段落、人设属性、情节细节或分支走向；
   - 原文中未受影响的镜头拓扑、片段编号、其他角色设定与核心结构必须原样保留；
   - 若创作者诉求涉及专有名词、核心道具名称或角色名字/性别的变更，必须在 prd.md 与 story.md 中所有受影响的关键段落分别提供 Patch。

3. 【音画视听与剧情自洽】：
   - 修改后的 \`replace\` 内容必须符合原剧的题材基调，保持工业级互动影游的文笔与格式；
   - 修改角色或剧情时，需兼顾上下文因果逻辑，避免修改后产生自相矛盾的情节漏洞。

4. 【按文档顺序排列】：
   - 针对同一文件的 patches，必须按照其在原文档中从上到下出现的顺序依次列出。`;
}

export function buildPlannerModifierUserPrompt(params: {
  target: string;
  detail: string;
  prdContent: string;
  storyContent: string;
}): string {
  const { target, detail, prdContent, storyContent } = params;
  return `【创作者修改目标】：${target}
【创作者修改具体诉求】：${detail}

====================【当前 prd.md 目标产物原文】====================
${prdContent || '（当前 prd.md 暂无内容）'}

====================【当前 story.md 目标产物原文】====================
${storyContent || '（当前 story.md 暂无内容）'}

请仔细阅读上述两份已生成的策划案产物，结合创作者的修改诉求，规划最稳健的外科手术 Patch 替换方案，输出符合 PlannerModifierOutput 规格的结构化数据。`;
}
