import { z } from 'zod';
export const ClipAssemblyStepInputSchema = z.object({ projectId: z.string(), force: z.boolean().default(false) });
export const ClipAssemblyStepOutputSchema = z.object({ projectId: z.string(), force: z.boolean().default(false).optional(), assembled: z.number(), failed: z.number() });
export type ClipAssemblyStepInput = z.infer<typeof ClipAssemblyStepInputSchema>; export type ClipAssemblyStepOutput = z.infer<typeof ClipAssemblyStepOutputSchema>;
