import { z } from 'zod';
import { assetExtractionTool, imageUpscaleTool, lookdevTool } from '../../tools/film-production/index.js';
import type { SubmittableToolSpec } from '../runtime/types.js';

export function lookdevCapabilities(): SubmittableToolSpec[] {
  return [
    { toolName: assetExtractionTool.toolName, title: '新增或删除角色/场景/道具资产', description: assetExtractionTool.description, schema: assetExtractionTool.inputSchema || z.any() },
    { toolName: lookdevTool.toolName, title: '角色、场景与道具定妆', description: lookdevTool.description, schema: lookdevTool.inputSchema || z.any() },
    { toolName: imageUpscaleTool.toolName, title: '高清超分定妆资产（SeedVR2）', description: imageUpscaleTool.description, schema: imageUpscaleTool.inputSchema || z.any() },
  ];
}
