/**
 * tools/film-production/asset-manifest-tool/steps/01-manifest/schema.ts
 * 全剧资产清单发现契约 (Asset Manifest Contract SSOT)
 */

import { z } from 'zod';

export const ManifestCharacterItemSchema = z.object({
  name: z.string().describe('角色姓名（有对白发言或独立能动主体性者，严禁提取无名背景路人）'),
  role: z.string().describe('身份/职业定位（如：手艺匠人、知情者、灵体化身）'),
  importance: z.enum(['primary', 'supporting', 'minor']).default('supporting').describe('剧情戏份层级（primary: 核心主角，supporting: 重要配角，minor: 次要角色）'),
  brief: z.string().describe('一句话外貌与气质核心定位（不展开复杂服化道）'),
});

export const ManifestLocationItemSchema = z.object({
  name: z.string().describe('独立可拍摄空间名称（具体到独立房间或室内/室外场地，如：老宅正厅灵堂、老宅院坝；严禁把整栋建筑笼统混成一个场景，也严禁碎片化为桌角/门槛）'),
  type: z.string().describe('空间类型（如：室内中式灵堂、室外山村院坝、地下密室）'),
  importance: z.enum(['primary', 'secondary']).default('secondary').describe('场景重要度（primary: 核心主场景，secondary: 次要/过渡场景）'),
  brief: z.string().describe('该独立空间的建筑结构、地面材质与主采光基调简述'),
  subScenes: z.array(z.string()).default([]).describe('同一物理空间内部的局部区域/机位点列表（如：["中央棺木", "香案前", "半掩侧门边"]）'),
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
