/**
 * tools/film-production/asset-manifest-tool/index.ts
 * 全剧资产清单发现与调整工具 (Asset Manifest Tool SSOT)
 */

import { z } from 'zod';
import { BaseTaskTool } from '../../base/task-tool.js';
import { createAssetManifestWorkflow, createAssetManifestModifierWorkflow } from './workflow.js';
import {
  AssetManifestInputSchema,
  AssetManifestOutputSchema,
  type AssetManifestInput,
  type AssetManifestOutput,
} from './steps/01-manifest/index.js';
import {
  AssetManifestModifierInputSchema,
  type AssetManifestModifierInput,
} from './modifier/index.js';

export * from './steps/01-manifest/index.js';
export * from './modifier/index.js';
export * from './workflow.js';

export const CombinedAssetManifestInputSchema = z.union([
  AssetManifestModifierInputSchema.extend({ mode: z.literal('modify') }),
  AssetManifestInputSchema.strict(),
  AssetManifestModifierInputSchema,
]);

export class AssetManifestTool extends BaseTaskTool<
  AssetManifestInput | AssetManifestModifierInput,
  AssetManifestOutput
> {
  public readonly toolName = 'film.asset_manifest';
  public readonly description = '全剧核心资产清单发现与维护工具。无状态提取出场角色、场景与信物清单，或执行结构化与自然语言增删改。';
  public readonly inputSchema = CombinedAssetManifestInputSchema as any;
  public readonly outputSchema = AssetManifestOutputSchema;

  /**
   * 双轨正交解耦路由分发：
   * 1. 当入参包含 mode === 'modify'、修改指令 instruction 或 modifications 数组时，派发至微调手术轨；
   * 2. 否则默认执行从 0 到 1 的批量清单发现流水线。
   */
  protected buildWorkflow(input?: any) {
    if (
      input?.mode === 'modify' ||
      (input?.instruction && input.instruction.trim()) ||
      (Array.isArray(input?.modifications) && input.modifications.length > 0)
    ) {
      return createAssetManifestModifierWorkflow();
    }
    return createAssetManifestWorkflow();
  }
}

/** 单例导出 */
export const assetManifestTool = new AssetManifestTool();
