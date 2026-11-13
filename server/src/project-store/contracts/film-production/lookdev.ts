import { z } from 'zod';
export const GlobalEntitiesSchema = z.object({
  artStyle: z.string(),
  characters: z.array(z.object({ characterId: z.string(), name: z.string(), identity: z.string(), appearanceSummary: z.string(), promptZh: z.string(), referenceImageUrl: z.string().optional() })),
  items: z.array(z.object({ itemId: z.string(), name: z.string(), description: z.string(), appearanceSummary: z.string(), promptZh: z.string(), referenceImageUrl: z.string().optional() })),
  locations: z.array(z.object({ locationId: z.string(), name: z.string(), atmosphere: z.string(), appearanceSummary: z.string(), promptZh: z.string(), sceneIds: z.array(z.string()), referenceImageUrl: z.string().optional() })).default([]),
});
export type GlobalEntities = z.infer<typeof GlobalEntitiesSchema>;
