import { z } from 'zod';
import { AssetExtractionInputSchema, AssetExtractionOutputSchema } from '../steps/01-extract/schema.js';

export const AssetExtractionModifierInputSchema = AssetExtractionInputSchema.extend({
  mode: z.literal('modify'),
  modifications: z.array(AssetExtractionInputSchema.shape.modifications.unwrap().element).optional(),
}).superRefine((input, ctx) => {
  (input.modifications || []).forEach((change, index) => {
    if (!change.operation && !change.action) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['modifications', index], message: '需要 operation 或 action' });
    }
    const operation = change.operation || change.action;
    if (operation === 'add' && !change.name?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['modifications', index, 'name'], message: '新增资产必须提供 name' });
    }
    if (operation === 'delete' && !change.entityId?.trim() && !change.name?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['modifications', index], message: '删除资产必须提供 entityId 或 name' });
    }
  });
  if ((!input.modifications || input.modifications.length === 0) && !input.instruction?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['instruction'], message: '需要 instruction 或 modifications' });
  }
});

export type AssetExtractionModifierInput = z.infer<typeof AssetExtractionModifierInputSchema>;
export const AssetExtractionModifierOutputSchema = AssetExtractionOutputSchema;
export type AssetExtractionModifierOutput = z.infer<typeof AssetExtractionModifierOutputSchema>;
