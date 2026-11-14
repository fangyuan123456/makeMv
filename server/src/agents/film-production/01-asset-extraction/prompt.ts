/**
 * agents/film-production/01-asset-extraction/prompt.ts
 * 视觉资产提取纯中文提示词体系 (纯大模型语义提取，零算力出图)
 */

import type { UniversalPrdSpec } from '../../../project-store/contracts/planner/index.js';

export function buildAssetExtractionSystemPrompt(): string {
  return `你是一名资深影视概念设计总监 (Concept Art Director)。
你的唯一使命是：根据创作者提供的【按幕剧本正文】与【互动短剧策划案 (PRD)】，提炼全剧统一美术画风（artStyle）、核心角色定妆（characters）、关键道具定妆（items）与场景空镜母本（locations），产出一份纯文本视听母本说明书。

【核心原则与铁律】
1. 【本步骤严格不生成图片】：纯大模型文本提取与结构化语义输出，严禁臆想虚假图片链接。
2. 【全剧统一美术画风 (artStyle)】：根据题材提炼 1 句高信噪比标准画风描述，杜绝画风割裂。
3. 【角色定妆提示词 (characters)】：
   - 提取全剧核心登场角色；
   - 包含外观要点 (appearanceSummary) 与纯中文定妆提示词 (promptZh)；
   - promptZh 规范：单人正面全身站姿定妆，纯中性浅灰无缝工作室背景，正面均匀柔光，无街景室内杂物，无文字水印。
4. 【道具定妆提示词 (items)】：
   - 必须涵盖剧本与互动点交互的所有关键信物；
   - 单个完整道具居中特写，纯中性浅灰背景，正面均匀柔光，无手部人物入镜。
5. 【场景空间母本 (locations)】：
   - 纯无人广角空镜，严禁出现任何人物、身体局部或剧情动作；
   - 明确标注该物理空间包含的剧幕 sceneIds。`;
}

export function buildAssetExtractionUserPrompt(input: {
  title: string;
  prd: UniversalPrdSpec;
  storyMarkdown: string;
}): string {
  const scriptSection = input.storyMarkdown.trim()
    ? `\n【按幕剧本正文】（人物与道具一律以剧本中实际出现的为准）：\n${input.storyMarkdown}\n`
    : '';

  const interactionHints =
    input.prd.interactions && input.prd.interactions.length > 0
      ? `\n【PRD 互动切口物件】：\n${JSON.stringify(
          input.prd.interactions.map((i) => ({
            id: i.id,
            kind: i.kind,
            prompt: i.prompt,
          })),
          null,
          2
        )}\n`
      : '';

  const clipIds = (input.prd.clips || []).map((c) => c.id);

  return `请为互动短剧《${input.title}》提取全剧视听资产说明书。

【作品题材】：${input.prd.genre || '互动电影'}
【玩家身份】：${input.prd.playerIdentity || '主角'}
【核心梗概】：${input.prd.premiseAndPerspective || ''}
${scriptSection}${interactionHints}
【全剧剧幕编号清单】：${clipIds.join('、')}

请严格按照 GlobalEntitiesSchema JSON 格式输出：
- artStyle: 全剧统一摄影与美术质感；
- characters: 核心登场角色列表；
- items: 关键实物与交互道具列表；
- locations: 物理场景空间列表 (空镜)。`;
}
