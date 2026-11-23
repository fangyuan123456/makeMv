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
3. 空间必须维持宏观母场景（Master Set）层级（全剧2~3个），严禁将同一建筑的局部拆为独立场景，子机位记录在 subScenes 中；
4. 道具必须遵循影视触碰铁律（Actor touches it，仅限演员握持/推动因果的关键信物），生活陈设严禁列为道具；
5. 输出符合 AssetManifestOutputSchema 的完整更新后清单 JSON。`;
}
