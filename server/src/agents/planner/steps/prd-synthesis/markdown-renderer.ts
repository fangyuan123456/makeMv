/**
 * agents/planner/steps/prd-synthesis/markdown-renderer.ts
 * 纯 TypeScript 确定性 PRD 策划案与分幕剧本 Markdown 渲染器
 *
 * 核心设计：
 * 1. 100% 通用 PRD 5 章节模板，零冗余重复表、零 Mermaid 噪音；
 * 2. 第 3 章内嵌唯一事实来源 JSON（`clips + interactions + endings + wiring`），保证 100% JSON.parse 合法；
 * 3. `story.md` 与 `prd.md` 中的 `clips[].id` 严格 1:1 对齐，供下游生视频/生图与游戏开发直接锚定。
 */

import type { SlicedClipNode } from '../interaction-slicing/schema.js';
import type { DerivedBranchNode } from '../branch-derivation/schema.js';
import type { UniversalPrdSpec, StoryGraph } from './schema.js';
import type { GDDArtifact } from '../../schema.js';

/**
 * 将 100% 通用 PRD 数据渲染为 AI 直读版 Markdown 文档
 */
export function formatGddPrdToMarkdown(
  prd: UniversalPrdSpec,
  _clips?: SlicedClipNode[],
  _branches?: DerivedBranchNode[],
  _graph?: StoryGraph
): string {
  const uniqueSourceJson: UniversalPrdSpec = {
    gameTitle: prd.gameTitle,
    genre: prd.genre,
    playerIdentity: prd.playerIdentity,
    premiseAndPerspective: prd.premiseAndPerspective,
    outOfFlowSummary: prd.outOfFlowSummary,
    gameplayAndVictorySummary: prd.gameplayAndVictorySummary,
    uiPagesSummary: prd.uiPagesSummary,
    startNodeId: prd.startNodeId,
    initialState: prd.initialState,
    clips: prd.clips,
    interactions: prd.interactions,
    endings: prd.endings,
    wiring: prd.wiring,
  };

  const uiLines = prd.uiPagesSummary
    .map((u) => `- **${u.page}**：${u.features}`)
    .join('\n');

  return `# 《${prd.gameTitle}》互动影游 PRD

## 1. 游戏介绍
全剧视频片段编号见第 3 章 \`clips\`（与 \`story.md\` 各节及视频文件 \`{id}.mp4\` 1:1 对齐，题材：${prd.genre}）。
- **背景与视角**：${prd.premiseAndPerspective}
- **交互时机**：所有交互均在每段视频播放完成（\`onEnded\`）后触发，无需依赖视频内部时间轴打点。

## 2. 流外状态与互动说明
- **流外状态**：${prd.outOfFlowSummary}
- **交互规则**：所有互动点的玩法类型（\`kind\`）、开放参数（\`config\`）、限时（\`timeoutSec\`）、结果枚举（\`outcomes\`）及状态变动（\`stateChange: { add, set }\`）统一在第 3 章 \`interactions\` 定义；互动本身不关心流程走向，流向与条件判断完全由 \`wiring\` 统一处理。

## 3. 节点接线图（\`clips\` + \`interactions\` + \`endings\` + \`wiring\`，AI 直读唯一事实来源）
> 说明：\`wiring\` 按数组从上到下顺序匹配第一条满足 \`condition\` 的边（\`condition: null\` 作兜底分支）；\`stateChange\` 显式区分 \`add\`（数值增量）与 \`set\`（直接赋值）。

\`\`\`json
${JSON.stringify(uniqueSourceJson, null, 2)}
\`\`\`

## 4. 玩法、胜负与容错原则
- **怎么玩与胜负条件**：${prd.gameplayAndVictorySummary}（精确条件以上方 \`wiring\` 与 \`endings\` 为准）
- **运行容错**：
  - 退出重进支持从当前进度节点及精确交互阶段恢复（保留并重置当前步超时计时）；
  - 同一局内每个互动点已生效的 \`stateChange\` 不因重看片段或读档恢复重复累加（幂等去重）；
  - 切后台或呼出暂停时立即冻结视频播放与交互倒计时；
  - 若支持从选集回溯历史节点重玩，单局状态回滚至该节点进入前快照，已解锁的结局与全局收集进度保留。

## 5. 游戏界面与功能
${uiLines}
`;
}

/**
 * 分幕剧本（供下游按片段生成视频/图片与对照核验）
 *
 * 格式规范：顶部极简目录清单 + 按 `## <clipId>｜<title>` 分节，
 * 与 `prd.md` 第 3 章 `clips[].id` 严格 1:1 对齐；正文中不夹杂玩法配置或冗余废话。
 */
export function formatStoryScenesToMarkdown(
  clips: SlicedClipNode[],
  branches: DerivedBranchNode[]
): string {
  const sections: string[] = [];
  const indexRows: string[] = [];
  const usedCutIds = new Set<string>();

  for (const clip of clips) {
    const roleLabel = clip.isEnding ? '主线终局' : '主干片段';
    indexRows.push(`- \`${clip.clipId}\`（${roleLabel}）：${clip.title}`);
    sections.push(`## ${clip.clipId}｜${clip.title}\n\n${clip.narrativeText || ''}`);

    for (const b of branches.filter((x) => x.sourceClipId === clip.clipId)) {
      usedCutIds.add(b.cutId);
      const branchRole =
        b.resolutionType === 'ENDING'
          ? `分支终局·${b.endingType || 'BE'}`
          : `分支过渡（➔ ${b.targetClipId || '主线'}）`;
      indexRows.push(`- \`${b.cutId}\`（${branchRole}｜源自 \`${b.sourceClipId}\`）：${b.branchTitle}`);
      sections.push(`## ${b.cutId}｜${b.branchTitle}\n\n${b.narrativeText || ''}`);
    }
  }

  for (const b of branches.filter((x) => !usedCutIds.has(x.cutId))) {
    const branchRole =
      b.resolutionType === 'ENDING' ? `分支终局·${b.endingType || 'BE'}` : '分支片段';
    indexRows.push(`- \`${b.cutId}\`（${branchRole}）：${b.branchTitle}`);
    sections.push(`## ${b.cutId}｜${b.branchTitle}\n\n${b.narrativeText || ''}`);
  }

  const header = `# 分幕剧本清单\n\n> 每个 \`## <编号>｜<标题>\` 严格 1:1 对应 \`prd.md\` 第 3 章 \`clips[].id\` 与视频文件 \`<编号>.mp4\`。\n\n${indexRows.join('\n')}\n\n---\n\n`;
  return header + sections.join('\n\n') + '\n';
}

/**
 * 渲染标准互动影游系统策划案 (GDD PRD - 供兼容旧单元测试及世界观展示)
 */
export function renderGddMarkdown(gdd: GDDArtifact): string {
  if (gdd.markdown && gdd.markdown.trim().length > 0) {
    return gdd.markdown;
  }

  const lines: string[] = [];
  lines.push(`# 《${gdd.title}》`);
  lines.push(`## 互动影游系统策划案 (Game Design Document PRD)\n`);
  lines.push(`* **题材类型**：${gdd.genre}`);
  lines.push(`* **核心高概念 (The Hook)**：${gdd.hook}`);
  lines.push(`* **玩家视角 (Player Role)**：${gdd.playerRole}`);
  lines.push(`* **核心玩法循环 (Core Loop)**：${gdd.coreLoop}\n`);

  if (gdd.globalStateMachine?.philosophy) {
    lines.push(`> **机制哲学**：${gdd.globalStateMachine.philosophy}\n`);
  }

  for (const beat of gdd.beatOutline || []) {
    lines.push(`### [${beat.act}] ${beat.title} (\`${beat.beatId}\`)`);
    lines.push(`* **玩法任务**：${beat.gameplayTask}`);
    for (const branch of beat.branchExpectations || []) {
      lines.push(`  * 👉 ${branch.intent} ➔ \`${branch.targetBeatId}\``);
    }
    if (beat.isEnding) {
      lines.push(`* 🏆 **终局**：${beat.endingTheme || ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * .debug 展示用：按幕列出 planner 某一步的原始结构化产出。
 */
export function formatPlannerTraceMarkdown(
  title: string,
  clips: SlicedClipNode[],
  branches: DerivedBranchNode[],
  phase: 'slices' | 'branches'
): string {
  const isBranchPhase = phase === 'branches';
  const statsParts = [
    `**幕数**：${clips.length}`,
    `**操作互动**：${clips.filter((c) => c.interaction?.category === 'ACTION').length}`,
    `**抉择切口**：${clips.filter((c) => c.interaction?.category === 'CHOICE').length}`,
  ];
  if (isBranchPhase) {
    statsParts.push(`**支线**：${branches.length}`);
  }
  const lines: string[] = [
    `# 《${title}》${isBranchPhase ? '分支扩写' : '互动切片'}`,
    '',
    `> ${statsParts.join(' ｜ ')}`,
    '',
    '---',
    '',
  ];

  const matchedBranchIds = new Set<string>();

  for (const clip of clips) {
    lines.push(`## 第 ${clip.level} 幕 · ${clip.title}`);
    lines.push('');
    lines.push(`- **clipId**：\`${clip.clipId}\` ｜ **level**：${clip.level}${clip.isEnding ? ' ｜ **终局幕**' : ''}`);
    lines.push('');
    lines.push('### 剧本正文');
    lines.push('');
    lines.push(clip.narrativeText || '（无正文）');
    lines.push('');

    if (clip.interaction?.category === 'ACTION') {
      const op = clip.interaction;
      lines.push(`### 尾帧互动｜${op.actionType || '交互'}`);
      lines.push('');
      lines.push(`${op.prompt || ''}${op.feedback ? ` ➔ ${op.feedback}` : ''}`);
      lines.push('');
    }

    if (clip.interaction?.category === 'CHOICE') {
      const cut = clip.interaction;
      lines.push(`### 抉择切口 \`${cut.cutId || `${clip.clipId}.1`}\``);
      lines.push('');
      lines.push(`- **核心戏剧冲突**：${cut.conflictSummary || ''}`);
      lines.push(`- **主线选项**：${cut.mainlineChoice || ''}`);
      lines.push(`- **分支选项**：${cut.branchChoice || ''}`);
      lines.push('');
    }

    if (isBranchPhase) {
      const cutId =
        clip.interaction?.category === 'CHOICE' ? clip.interaction.cutId : undefined;
      const matched = branches.filter((b) =>
        cutId ? b.cutId === cutId : b.sourceClipId === clip.clipId
      );
      for (const b of matched) {
        matchedBranchIds.add(b.cutId);
        lines.push(`### 支线 · ${b.branchTitle}（\`${b.cutId}\`）`);
        lines.push('');
        lines.push(`- **触发选项**：${b.choiceText}`);
        lines.push(
          `- **归宿**：${b.resolutionType === 'REJOIN'
            ? `合流至 \`${b.targetClipId || '主线'}\``
            : `独立终局【${b.endingType || 'ENDING'}：${b.endingTitle || '未命名'}】`}`
        );
        lines.push('');
        lines.push(b.narrativeText || '（无支线正文）');
        lines.push('');
        if (b.rejoinConsequence) {
          lines.push('**合流承接**');
          lines.push('');
          lines.push(b.rejoinConsequence);
          lines.push('');
        }
      }
    }

    lines.push('---');
    lines.push('');
  }

  if (isBranchPhase) {
    const orphans = branches.filter((b) => !matchedBranchIds.has(b.cutId));
    if (orphans.length > 0) {
      lines.push('## 未归属到幕的支线');
      lines.push('');
      for (const b of orphans) {
        lines.push(`### ${b.branchTitle}（\`${b.cutId}\` ｜ 源 \`${b.sourceClipId}\`）`);
        lines.push('');
        lines.push(b.narrativeText || '（无支线正文）');
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}
