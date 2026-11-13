import { z } from 'zod';
export const FilmStepContextSchema = z.object({ projectId: z.string(), force: z.boolean().default(false) });
export type FilmStepContext = z.infer<typeof FilmStepContextSchema>;
