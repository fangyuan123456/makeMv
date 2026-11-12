/**
 * agents/text-game/steps/entity-extract/prompt.ts
 * 全局角色与道具定妆提示词提取体系 (Global Entity Extract Prompt SSOT)
 */

import type { UniversalPrdSpec } from '../../../planner/steps/prd-synthesis/schema.js';

export function buildEntityExtractSystemPrompt(): string {
  return `你是一名资深影视概念设计总监 (Concept Art Director)。
你的唯一使命是：根据创作者提供的【按幕剧本正文】与【互动短剧策划案 (PRD)】，提炼全剧统一美术画风（artStyle）、核心角色定妆提示词（characters）与关键道具定妆提示词（items），用于先行生成全剧角色与道具定妆母本图。

【设计原则与铁律】
1. 【全剧统一美术画风 (artStyle)】：
   - 根据作品题材、时代质感与基调提炼 1 句标准美术画风与摄影质感描述；
   - 严禁套用与题材无关的滤镜，该画风将共用在人物定妆、道具定妆与每幕尾帧场景图中，杜绝画风割裂。
2. 【角色定妆提示词提取 (characters)】：
   - 提取全剧核心登场角色（角色名称与身份一律以剧本实际出现的为准）；
   - 为每个角色撰写固定外貌摘要（appearanceSummary）与纯中文定妆生图提示词（promptZh）及英文版（promptEn）；
   - promptZh 必须严格遵循定妆规范：单人正面全身站姿定妆图，锁死性别年龄、脸型五官、发型发色、标志性服装款式颜色与随身常驻配饰；纯中性浅灰无缝工作室背景，无街景/室内杂物，无多人物，无文字/标签/边框/水印，末尾融合全剧统一 artStyle。
3. 【道具定妆提示词提取 (items)】：
   - 必须全面梳理剧本正文与 PRD 互动点（interactions）里参与关键剧情推演、手部交互或尾帧搜证的所有关键信物与道具，严禁遗漏互动焦点物件；
   - 为每个道具撰写固定外观特征（appearanceSummary）与纯中文道具定妆特写提示词（promptZh）及英文版（promptEn）；
   - promptZh 必须严格遵循道具定妆规范：单个完整道具居中特写，仅描写该道具自身的物理造型、材质纹理、色泽光感与刻字/破损特征（不要在道具提示词里夹带其它关联物品或背景词汇，避免画面长出多余附带物）；无手部或人物入镜，纯中性浅灰无缝工作室背景，无杂乱环境，无文字/标签/水印，融合全剧统一 artStyle。`;
}

export function buildEntityExtractUserPrompt(input: {
  title: string;
  prd: UniversalPrdSpec;
  storyMarkdown: string;
}): string {
  const scriptSection = input.storyMarkdown.trim()
    ? `\n【按幕剧本正文】（人物与道具一律以剧本中实际出现的为准）\n${input.storyMarkdown}\n`
    : '';

  const interactionHints =
    input.prd.interactions && input.prd.interactions.length > 0
      ? `\n【PRD 幕尾互动点清单】（其中涉及的点触/擦拭/长按等交互目标物件，必须重点纳入 items 道具字典）：\n${JSON.stringify(
          input.prd.interactions.map((i) => ({
            id: i.id,
            kind: i.kind,
            prompt: i.prompt,
            config: i.config,
          })),
          null,
          2
        )}\n`
      : '';

  return `请根据以下互动短剧策划案、互动点清单与剧本正文，提炼全剧统一画风、核心角色定妆提示词与关键道具定妆提示词：

【短剧名称】：《${input.prd.gameTitle || input.title}》
【题材类型】：${input.prd.genre}
【玩家身份】：${input.prd.playerIdentity}
【背景简述】：${input.prd.premiseAndPerspective}
${interactionHints}${scriptSection}
---

【输出规范指引】
请输出符合规范的 JSON 结构，字段如下：
- artStyle: string（全剧统一美术风格与摄影质感描述）
- characters: Array<{ characterId, name, identity, appearanceSummary, promptZh, promptEn }>
- items: Array<{ itemId, name, description, appearanceSummary, promptZh, promptEn }>`;
}
