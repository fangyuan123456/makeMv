/**
 * tools/film-production/asset-manifest-tool/steps/01-manifest/schema.ts
 * 全剧资产清单发现契约 (Asset Manifest Contract SSOT)
 */

import { z } from 'zod';

export const ManifestCharacterItemSchema = z.object({
  name: z.string().describe('角色姓名（有对白发言或独立能动主体性者，严禁提取无名背景路人）'),
  role: z.string().describe('身份/职业定位（如：纸扎匠人、知情者、灵体化身）'),
  importance: z.enum(['primary', 'supporting', 'minor']).default('supporting').describe('剧情戏份层级（primary: 核心主角，supporting: 重要配角，minor: 次要角色）'),
  brief: z.string().describe('一句话外貌与气质核心定位（不展开复杂服化道）'),
});

export const ManifestLocationItemSchema = z.object({
  name: z.string().describe('宏观母场景名称（Master Location，如：陈家古宅、古镇纸扎老街；必须是宏观三维建筑实体，严禁碎片化为桌角/偏房）'),
  type: z.string().describe('空间类型（如：南方夯土古民居、古镇街巷、地下密室）'),
  importance: z.enum(['primary', 'secondary']).default('secondary').describe('场景重要度（primary: 核心主场景，secondary: 次要/过渡场景）'),
  brief: z.string().describe('宏观空间核心建筑风格、物理格局与主采光基调简述'),
  subScenes: z.array(z.string()).default([]).describe('该母场景涵盖的剧本场次子机位/偏房角落列表（如：["灵堂主堂", "东偏房/侧间", "大门门槛"]）'),
});

export const ManifestItemItemSchema = z.object({
  name: z.string().describe('道具名称（严格遵循影视触碰原则：必须是演员在戏中用手握持、抓取、操作或推动关键因果的信物；生活泛用陈设与背景杂物严禁提取）'),
  category: z.string().describe('类别（如：关键信物、武器工具、解谜文书）'),
  brief: z.string().describe('道具几何形态与剧情线索功能速览'),
});

export const AssetManifestInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  storyMarkdown: z.string().optional().describe('剧本或故事正文 Markdown'),
  prd: z.any().optional().describe('策划案 PRD (UniversalPrdSpec)'),
});

export type AssetManifestInput = z.infer<typeof AssetManifestInputSchema>;

export const AssetManifestOutputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  artStyle: z.string().default('电影实拍质感与光影分级').describe('全剧视觉风格基调'),
  characters: z.array(ManifestCharacterItemSchema).default([]).describe('全剧出场角色轻量清单'),
  locations: z.array(ManifestLocationItemSchema).default([]).describe('全剧主场景轻量清单'),
  items: z.array(ManifestItemItemSchema).default([]).describe('全剧核心信物道具轻量清单'),
});

export type AssetManifestOutput = z.infer<typeof AssetManifestOutputSchema>;
