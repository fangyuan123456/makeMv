/**
 * tools/film-production/entity-spec-tool/location/schema.ts
 * 场景视觉规格契约 (Location Spec Contract SSOT)
 */

import { z } from 'zod';
import { LocationSpecSchema } from '../../../../project-store/contracts/film-production/lookdev.js';

export { LocationSpecSchema };
export type LocationSpec = z.infer<typeof LocationSpecSchema>;

export const LocationSpecInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  locationId: z.string().optional().describe('场景唯一标识'),
  name: z.string().describe('场景名称'),
  roleOrBrief: z.string().optional().describe('空间定位或一句话概述'),
  instruction: z.string().optional().describe('创作者个性化修改要求'),
  storyMarkdown: z.string().optional().describe('剧本正文'),
  prd: z.any().optional().describe('策划案 PRD'),
});

export type LocationSpecInput = z.infer<typeof LocationSpecInputSchema>;
