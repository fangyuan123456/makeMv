/**
 * agents/text-game/steps/lookdev-extract/prompt.ts
 * 定妆提取提示词：让模型先定下全剧「人 / 物 / 地」长什么样，此步不画任何图
 */

import type { UniversalPrdSpec } from '../../../planner/steps/prd-synthesis/schema.js';

export function buildLookdevExtractSystemPrompt(): string {
  return `你是一名资深影视概念设计总监 (Concept Art Director)。
你的唯一使命是：根据创作者提供的【按幕剧本正文】与【互动短剧策划案 (PRD)】，提炼全剧统一美术画风（artStyle）、核心角色定妆（characters）、关键道具定妆（items）与场景空镜母本（locations），产出一份可直接拿去生图的母本说明书。

【设计原则与铁律】
1. 【全剧统一美术画风 (artStyle)】：
   - 根据作品题材、时代质感与基调提炼 1 句标准美术画风与摄影质感描述；
   - 严禁套用与题材无关的滤镜，该画风将共用在同一批母本图上，杜绝画风割裂。
2. 【角色定妆提示词提取 (characters)】：
   - 提取全剧核心登场角色（角色名称与身份一律以剧本实际出现的为准）；
   - 为每个角色撰写固定外貌摘要（appearanceSummary）与纯中文定妆生图提示词（promptZh）；
   - promptZh 必须严格遵循定妆规范：单人正面全身站姿定妆图，锁死性别年龄、脸型五官、发型发色、标志性服装款式颜色与随身常驻配饰；纯中性浅灰无缝工作室背景，无街景/室内杂物，无多人物，无文字/标签/边框/水印，末尾融合全剧统一 artStyle；
   - 每条 promptZh 控制在 120~200 字，写满必要视觉要素即止，禁止堆砌形容词与重复交代。
3. 【道具定妆提示词提取 (items)】：
   - 必须全面梳理剧本正文与 PRD 互动点（interactions）里参与关键剧情推演、手部交互或搜证的所有关键信物与道具，严禁遗漏互动焦点物件；
   - 为每个道具撰写固定外观特征（appearanceSummary）与纯中文道具定妆特写提示词（promptZh）；
   - promptZh 必须严格遵循道具定妆规范：单个完整道具居中特写，仅描写该道具自身的物理造型、材质纹理、色泽光感与刻字/破损特征（不要在道具提示词里夹带其它关联物品或背景词汇，避免画面长出多余附带物）；无手部或人物入镜，纯中性浅灰无缝工作室背景，无杂乱环境，无文字/标签/水印，融合全剧统一 artStyle；
   - 每条 promptZh 控制在 100~160 字。
4. 【场景空镜母本提取 (locations) —— 按空间去重，不按幕罗列】：
   - 通读全剧，把每一幕归到它发生的那个**物理空间**（客厅、走廊、天台……仅示意空间粒度，实际以剧本为准）。同一个空间无论被叫成多少种说法，全剧只能有一条，绝不允许按幕重复开新条目——重复的场景正是要靠复用同一张母本图来保证前后一致；
   - 每条必须写清：locationId（loc_ 前缀 + 小写下划线语义命名，如 "loc_living_room"）、name、atmosphere（光线基调与氛围）、appearanceSummary（固定空间布局：出入口在哪、主要设施与家具的方位、墙面与管线材质、光源位置，让人一眼能判断摄影机站在哪）、promptZh（空镜生图提示词）、sceneIds（属于该空间的全部剧幕编号）；
   - promptZh 是**空镜**：只画空间与陈设，严禁出现任何人物、身体局部、背影或剧情动作——一旦混进人物，后续每个镜头都会把这个陌生人抄进去。画幅为表现空间全貌的广角，融合全剧统一 artStyle，无文字无标签无水印；
   - 每条 promptZh 控制在 120~200 字。
5. 【覆盖完整性（硬性）】：全剧每一幕都必须出现在某个 location 的 sceneIds 里，不许多归、不许漏归、不许编造不存在的幕号。
   - 正常情况下每一幕只属于一个空间。只有当这一幕**确实从一个空间走到了另一个空间**时，才允许把两个都列上——此时**第一个必须是开场所在的空间**，第二个是收尾所在的空间；这种跨场景的幕会被单独标出来，作为后续拆镜头的依据。`;
}

export function buildLookdevExtractUserPrompt(input: {
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

  const clipIds = (input.prd.clips || []).map((c) => c.id);
  const clipRoster = clipIds.length
    ? `\n【全剧剧幕编号清单】（每一条都必须且只能归属于一个场景的 sceneIds，一条不漏、不许多归）\n${clipIds.join('、')}\n`
    : '';

  return `请根据以下互动短剧策划案、互动点清单与剧本正文，提炼全剧统一画风、核心角色定妆、关键道具定妆与场景空镜母本：

【短剧名称】：《${input.prd.gameTitle || input.title}》
【题材类型】：${input.prd.genre}
【玩家身份】：${input.prd.playerIdentity}
【背景简述】：${input.prd.premiseAndPerspective}
${interactionHints}${clipRoster}${scriptSection}
---

【输出规范指引】
请输出符合规范的 JSON 结构，字段如下：
- artStyle: string（全剧统一美术风格与摄影质感描述）
- characters: Array<{ characterId, name, identity, appearanceSummary, promptZh }>
- items: Array<{ itemId, name, description, appearanceSummary, promptZh }>
- locations: Array<{ locationId, name, atmosphere, appearanceSummary, promptZh, sceneIds }>
  · 同一物理空间全剧只出一条，重复出现的幕合并进同一个 sceneIds；
  · promptZh 必须是无人空镜（只画空间与陈设），画幅取能看清全局布局的广角；
  · sceneIds 的取值只能来自上方剧幕编号清单。

只输出上述字段，不要输出其它字段。`;
}
