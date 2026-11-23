import { z } from 'zod';
import {
  assetManifestTool,
  entitySpecTool,
  imageUpscaleTool,
  lookdevTool,
} from '../../tools/film-production/index.js';
import type { SubmittableToolSpec } from '../runtime/types.js';

export function lookdevCapabilities(): SubmittableToolSpec[] {
  return [
    {
      toolName: assetManifestTool.toolName,
      title: '提取与维护全剧资产清单',
      stageName: '全剧核心资产清单提取',
      description: assetManifestTool.description,
      schema: assetManifestTool.inputSchema || z.any(),
      targetKind: 'global',
    },
    {
      toolName: entitySpecTool.toolName,
      title: '单实体视觉规格精细推演与修改',
      stageName: '单实体视觉规格推演',
      description: entitySpecTool.description,
      schema: entitySpecTool.inputSchema || z.any(),
      targetKind: 'character',
    },
    {
      toolName: lookdevTool.toolName,
      title: '角色、场景与道具定妆',
      stageName: '视觉资产定妆',
      description: lookdevTool.description,
      schema: lookdevTool.inputSchema || z.any(),
      targetKind: 'character',
    },
    {
      toolName: imageUpscaleTool.toolName,
      title: '高清超分定妆资产（SeedVR2）',
      stageName: 'SeedVR2 高清超分',
      description: imageUpscaleTool.description,
      schema: imageUpscaleTool.inputSchema || z.any(),
      targetKind: 'character',
    },
  ];
}
