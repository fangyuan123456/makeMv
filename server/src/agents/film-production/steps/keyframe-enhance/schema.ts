import { z } from 'zod';
export const KeyframeEnhanceStepInputSchema = z.object({ projectId: z.string(), force: z.boolean().default(false) });
export const KeyframeEnhanceStepOutputSchema = z.object({ projectId: z.string(), force: z.boolean().default(false).optional(), enhanced: z.number(), failed: z.number() });
export type KeyframeEnhanceStepInput = z.infer<typeof KeyframeEnhanceStepInputSchema>; export type KeyframeEnhanceStepOutput = z.infer<typeof KeyframeEnhanceStepOutputSchema>;
