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

### 【工程契约与互动钩子写作规范】
- 严格依据大纲既定的场景、人物设定与统一互动节点（\`interactions\`）推进，不擅自增删分支点、生造无关题材角色或篡改大纲设定的走向。
- **【剧作起幅铁律】**：无论单线互动还是命运分支，**每幕正文必须演到“互动触发前的悬念起幅瞬间”即止**（如贴墙屏息、扫视凌乱桌面准备翻找、对峙僵持），交由幕末 \`【互动钩子】\` 接管；**严禁在正文里提前演完该互动动作、点破目标物证的具体位置或替玩家找出目标物证**（例如 \`SEARCH\` 幕正文只描写案面杂陈与时间紧迫感，不剧透哪个物件是真目标），所有动作结果在下一幕开篇或专有终局中兑现。
- 幕末统一使用清晰的 \`### 【互动钩子：<单线|分支> <KIND> | ...】\` Markdown 区块表达：
  - 单线节点（\`isBranching: false\`）：注明操作提示、目标物证与干扰线索（\`SEARCH\`）、写入状态 \`+tag\`，以及统一推进下一幕；
  - 分支节点（\`isBranching: true\`）：注明各选项/成败结果、限时秒数与超时默认后果（\`TIMEOUT\`），各自指向对应下一幕或专有终局（可结合前序 \`+tag\` 状态解锁隐藏结局）。`;
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

现在，严格依据上述技能规范与大纲中的 ${interactions.length} 个互动节点（含 ${branchingCount} 个命运分支），撰写标准 **Markdown 格式互动影游剧本**：
- 全剧总计约 **${suggestedLength}** 汉字（硬上限不超过 2000 字），每幕严格聚焦 1 个核心主场景；
- 直接输出完整的剧本正文 Markdown，不要使用任何占位符。`;
}
