/**
 * tools/planner/screenplay-tool/steps/02-screenplay/prompt.ts
 * 步骤二：全景剧本编写专属提示词体系 (Screenplay Step Prompt SSOT)
 */

import type { PremiseOutput } from '../01-premise/schema.js';
import { getSkillPrompt } from '../../../../../skills/index.js';

export function buildScreenplaySystemPrompt(): string {
  return `你是一名享誉国际的顶级互动影游总编剧与视听导演。

你的核心职责是：根据故事大纲与人设，编写一部**开局即高压现场、采用紧贴主角单视点的高压对峙视角（主角正常使用法定姓名出镜，聚焦近距离交锋与强临场代入感）、每幕仅 1~2 个核心物理动作配合锋利短促对白直奔互动钩子的高密度互动影游剧本（每幕控制在 250~450 字）**。

${getSkillPrompt('ai-interactive-screenplay')}

### 【结构化输出与工程契约】
- **分工铁律（代码自动拼装拓扑，模型专注戏剧表演）**：
  - 每一幕的标题（\`## 第 N 幕\`）、\`【互动抉择点】\` 选项清单、走向箭头与 \`### 【互动钩子：...】\` 将由系统根据大纲 \`interactions\` **100% 确定性自动拼装**；
  - 你**只需且必须**按 \`StructuredScreenplayContentSchema\` 输出两部分结构化内容：
    1. \`acts\`：按 \`actNumber\` 顺序填写每一幕的 \`sceneHeader\`（单母场景与光影环境）和 \`narrativeBody\`（纯戏剧正文，250~450 字）；**严禁在 \`narrativeBody\` 内自己手写 \`【互动抉择点】\`、\`### 【互动钩子】\` 或 \`【终局】\`**；
    2. \`endings\`：为全剧**每一个** \`targetType === "ENDING"\` 的选项（含中间幕支线/超时终局与最后一幕全部选项）填写一份 \`narrativeText\`（80~150 字电影定格结算，不重不漏）。
- **【防剧透剥离铁律】**：大纲的 \`plotSummary\` 与 \`turningPoint\` 往往包含整幕的收尾发现（例如“搜出了香灰/符纸”“吞下证据”）。编写 \`narrativeBody\` 时**必须自动剥离互动之后才发生的结果**：\`narrativeBody\` 只写到互动触发前的悬念起幅瞬间（如蹲在尸体旁看到衣襟露出纸角、手刚按上暗格、对手高举武器逼问）并自然悬停等待玩家动作；**严禁提前写出“已找到目标物证/已完成互动动作/互动后才进门的新角色”**——这些结果一律写入对应 \`endings\` 结算文案，或留待**下一幕 \`narrativeBody\` 开篇第 1 句**作为即时承接演出！
- **【跨幕母场景与物理接力一致】**：每幕 \`sceneHeader\` 严格锁定 1 个核心母场景；若上一幕 \`CONTINUE_MAINLINE\` 选项的动作是“从 A 地前往 B 地”，则上一幕只在 A 地收束，下一幕 \`sceneHeader\` 切至 B 地并在 \`narrativeBody\` 第 1 句写进入 B 地，严禁两幕写在同一地点却重复演出“搬运/前往该地点”。`;
}

export function buildFullScriptPrompt(params: {
  premise: PremiseOutput;
  userPrompt?: string;
}): string {
  const { premise, userPrompt } = params;
  const suggestedLength = `${premise.actOutlines.length * 250}-${premise.actOutlines.length * 450}`;
  const interactions = Array.isArray(premise.interactions) ? premise.interactions : [];
  const branchingCount = interactions.filter((i) => i.isBranching).length;

  let interactionsGuide = '';
  if (interactions.length > 0) {
    interactionsGuide = `\n【大纲规划的 ${interactions.length} 个幕末互动节点（其中命运分支 ${branchingCount} 个，单线沉浸 ${interactions.length - branchingCount} 个，严格实现，彻底取消合流）】：\n` +
      interactions.map((it) => {
        const modeTag = it.isBranching ? '命运分支' : '单线沉浸（无分支）';
        const outcomeLines = it.outcomes.map((o) => {
          const dest = o.targetType === 'ENDING'
            ? `走向专有终局【${o.endingTitle || '终局'}】(${o.endingType || 'BE'})`
            : '推进主线剧情进入下一幕';
          return `    * [${o.key}] ${o.label}（${dest}${o.stateTag ? `，写入状态: ${o.stateTag}` : ''}，手段与代价: ${o.approachAndCost}）`;
        }).join('\n');
        const configHint = it.config?.targets?.length
          ? `  - 搜证配置：目标=${it.config.targets.map((t) => `${t.name}${t.stateTag ? `(${t.stateTag})` : ''}`).join('、')}${it.config.decoys?.length ? ` | 干扰线索=${it.config.decoys.map((d) => d.name).join('、')}` : ''}\n`
          : '';
        return `* 【互动节点 ${it.pointIndex}】（第 ${it.actNumber} 幕 | ${modeTag} | 类型: ${it.kind}${it.timeoutSec ? ` | 限时 ${it.timeoutSec}s` : ''}）：\n` +
          `  - 触发起幅情境：${it.sceneContext}\n` +
          `  - 操作/抉择提示：${it.prompt}\n` +
          configHint +
          `  - 结果与去向：\n${outcomeLines}\n`;
      }).join('\n');
  } else {
    interactionsGuide = '\n【大纲未规划互动节点】：按大纲写作，不为凑数新增选择节点。\n';
  }

  return `【创作者核心诉求（全剧最高戏剧纲领）】：
${userPrompt ? `${userPrompt}\n` : '（按已确立大纲推演）'}
你已确立了以下故事设定与详实分幕大纲：
- 标题：《${premise.title}》
- 题材：${premise.genre}
- 故事梗概：${premise.logline}
${premise.worldSetting ? `- 世界观背景与既定真相：${premise.worldSetting}\n` : ''}- 核心角色：${premise.characters.map((c) => `${c.name}（身份: ${c.role}，外貌特征: ${c.appearance}，核心动机: ${c.motivation}）`).join('、')}
- 分幕故事大纲（正文紧凑推进，剧情饱满，拒绝无意义注水）：
${premise.actOutlines.map((a) => {
  let actText = `  * 第 ${a.actNumber} 幕《${a.title}》：\n` +
    `    - 核心冲突：${a.coreConflict}\n` +
    `    - 剧情展开脉络：${a.plotSummary || '（依据主线冲突推演）'}\n`;
  if (Array.isArray(a.scenes) && a.scenes.length > 0) {
    actText += `    - 场景流转：${a.scenes.join(' ➔ ')}\n`;
  }
  if (a.turningPoint) {
    actText += `    - 幕末转折：${a.turningPoint}\n`;
  }
  if (a.suspense) {
    actText += `    - 悬念核心：${a.suspense}\n`;
  }
  return actText;
}).join('\n')}
${interactionsGuide}

现在，严格依据上述技能规范与大纲中的 ${interactions.length} 个互动节点（含 ${branchingCount} 个命运分支），按 \`StructuredScreenplayContentSchema\` 输出结构化分幕正文（\`acts\`）与专有终局结算（\`endings\`）：
- 全剧正文总计约 **${suggestedLength}** 汉字（单幕 \`narrativeBody\` 控制在 250~450 字），每幕严格聚焦 1 个核心主场景；
- 系统会自动为你拼装 \`【互动抉择点】\`、\`【终局：...】\` 标题和 \`### 【互动钩子】\`，你只需输出纯净、连贯、充满视听张力的 \`acts\` 与 \`endings\` 内容，不重不漏。`;
}
