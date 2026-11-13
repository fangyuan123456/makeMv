import { z } from 'zod';
export const KeyframeStepInputSchema = z.object({ projectId: z.string(), force: z.boolean().default(false) });
export const KeyframeStepOutputSchema = z.object({ projectId: z.string(), force: z.boolean().default(false).optional(), generated: z.number(), reused: z.number(), failed: z.number() });
export type KeyframeStepInput = z.infer<typeof KeyframeStepInputSchema>; export type KeyframeStepOutput = z.infer<typeof KeyframeStepOutputSchema>;
