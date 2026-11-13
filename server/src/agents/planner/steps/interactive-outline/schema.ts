import { z } from 'zod';

export const InteractiveOutlineNodeSchema = z.object({
  id: z.string(), role: z.enum(['MAINLINE', 'BRANCH', 'ENDING']), purpose: z.string(),
  interaction: z.enum(['ACTION', 'CHOICE', 'NONE']), choiceA: z.string().optional(), choiceB: z.string().optional(),
  next: z.array(z.string()).default([]), stateChange: z.string().optional(),
});
export const InteractiveOutlineSchema = z.object({
  title: z.string(), premise: z.string(), mainlineStart: z.string(),
  nodes: z.array(InteractiveOutlineNodeSchema).min(3), hardConstraints: z.array(z.string()).min(1),
}).superRefine((outline, ctx) => {
  const ids = new Set<string>();
  for (const [i, node] of outline.nodes.entries()) {
    if (ids.has(node.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', i, 'id'], message: `节点 ID 重复: ${node.id}` });
    ids.add(node.id);
    if (node.interaction === 'CHOICE' && (!node.choiceA || !node.choiceB || node.next.length < 2)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', i], message: 'CHOICE 必须有两个选项和两个去向' });
    for (const target of node.next) if (!outline.nodes.some((n) => n.id === target)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', i, 'next'], message: `去向不存在: ${target}` });
  }
  if (!ids.has(outline.mainlineStart)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['mainlineStart'], message: '主线起点不存在' });
  if (!outline.nodes.some((n) => n.role === 'MAINLINE')) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes'], message: '缺少主线节点' });
  if (!outline.nodes.some((n) => n.role === 'BRANCH')) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes'], message: '缺少支线节点' });
  if (!outline.nodes.some((n) => n.role === 'ENDING')) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes'], message: '缺少结局节点' });
});
export const InteractiveOutlineInputSchema = z.object({ userPrompt: z.string(), creativeBrief: z.string().optional(), userToneOrPreference: z.string().optional() });
export type InteractiveOutline = z.infer<typeof InteractiveOutlineSchema>;
export type InteractiveOutlineInput = z.infer<typeof InteractiveOutlineInputSchema>;
