import { z } from 'zod';
export const VideoGenerationStepInputSchema = z.object({ projectId: z.string(), force: z.boolean().default(false) });
export const VideoGenerationStepOutputSchema = z.object({ projectId: z.string(), force: z.boolean().default(false).optional(), generated: z.number(), failed: z.number() });
export type VideoGenerationStepInput = z.infer<typeof VideoGenerationStepInputSchema>; export type VideoGenerationStepOutput = z.infer<typeof VideoGenerationStepOutputSchema>;
