/**
 * tools/film-production/01-asset-extraction-tool/steps/01-extract/prompt.ts
 * 视觉资产提炼工序专属提示词体系 (Asset Extraction Prompt SSOT)
 */

import type { AssetExtractionInput } from './schema.js';

export function buildAssetExtractionSystemPrompt(): string {
  return `你是一名电影级美术总监与概念视觉设计师。
你的职责是：从输入的互动影游策划案与剧本文本中，**全面提炼所有登场角色、核心实物道具与关键场景空间的纯文本外观特征与中文生图提示词**。

【提炼规则】：
1. 提炼全剧登场角色（characters）：姓名、身份定位、核心外观提炼、以及专业的中文全身立绘生图提示词 promptZh（注意：角色立绘提示词必须聚焦单人正面全身定妆设定，使用纯浅灰无缝工作室背景，严禁写入具体复杂的场景与背景元素，环境背景在场景空间中专门描述）。
2. 提炼关键实物道具（items）：名称、剧情作用、外观特征、以及专业的道具特写生图提示词 promptZh。
3. 提炼核心场景空间（locations）：locationId、名称、环境氛围、空间视觉特征、sceneIds（关联的场景ID列表，如 ["loc_bridge"] 或 []）、以及专业的场景空镜生图提示词 promptZh。
4. 提炼全剧视觉美学基调（artStyle）：如电影级写实摄影、赛博朋克霓虹光影、复古胶片质感等。
5. 纯文本提炼，不需要生成图片。`;
}

export function buildAssetExtractionUserPrompt(input: AssetExtractionInput): string {
  return `请根据以下互动影游项目策划案与故事剧本，提取全剧视觉资产（角色、道具、场景外观及提示词）：

【项目标题】：${input.title || '互动影游项目'}
【策划案 PRD】：
\`\`\`json
${input.prd ? JSON.stringify(input.prd, null, 2) : '暂无 PRD'}
\`\`\`

【故事剧本】：
\`\`\`markdown
${input.storyMarkdown || '暂无故事正文'}
\`\`\`

请输出严格符合 GlobalEntitiesSchema 契约的结构化 JSON。`;
}
