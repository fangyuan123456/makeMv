/**
 * tools/film-production/asset-manifest-tool/modifier/prompt.ts
 * 资产骨架清单微调提示词 (Asset Manifest Modifier Prompt SSOT)
 */

export function buildAssetManifestModifyPrompt(params: {
  existingCharacters: Array<{ name: string; role?: string; brief?: string }>;
  existingLocations: Array<{ name: string; type?: string; brief?: string }>;
  existingItems: Array<{ name: string; category?: string; brief?: string }>;
  instruction: string;
}): string {
  const { existingCharacters, existingLocations, existingItems, instruction } = params;

  return `你是一名资深电影制片统筹（Film Production Coordinator）。
创作者对当前的资产清单提出了调整指令，请基于当前清单输出调整后的完整清单：

【当前已有角色】：${existingCharacters.map((c) => c.name).join('、') || '暂无'}
【当前已有场景】：${existingLocations.map((l) => l.name).join('、') || '暂无'}
【当前已有道具】：${existingItems.map((i) => i.name).join('、') || '暂无'}

【创作者修改指令】：
${instruction}

【调整规范与影视工业公理】：
1. 严格落实创作者指令（如新增角色/母场景/核心道具，或移除废弃实体）；
2. 保持未受影响实体的稳定性，未要求改动的内容必须原样完整保留；
3. 空间以视觉独立的物理空间/房间（如正厅、院落、书房）为最小定妆单元：室内外切换或墙体隔断导致背景与光影完全不同的独立空间必须拆分为独立场景；同一物理空间内部的局部位置/角落统一收拢在 subScenes 中，严禁碎片化为桌角或门槛；
4. 道具必须遵循信物准入铁律（剧本显式标注的获得物、角色核心职业装置、承载因果解谜的 Hero Props），生活陈设严禁列为道具；
5. 输出符合 AssetManifestOutputSchema 的完整更新后清单 JSON。`;
}
