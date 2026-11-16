/**
 * tools/planner/script-to-prd-tool/steps/02-synthesize/markdown-renderer.ts
 * 纯 TypeScript 确定性 PRD 策划案 Markdown 渲染器 (SSOT)
 *
 * 核心规范：
 * 1. 100% 通用 PRD 5 章节模板（介绍 ➔ 状态 ➔ 接线JSON ➔ 胜负容错 ➔ 游戏界面与功能）；
 * 2. 第 3 章严格内嵌合法 JSON 结构（`clips + interactions + endings + wiring`）；
 * 3. 第 5 章严格包含 5 大核心界面规划（主页、播放页、暂停设置、故事线选集、结局结算）。
 */

import type { UniversalPrdSpec, PrdClipNode } from '../../../../../project-store/contracts/planner/index.js';

export function formatGddPrdToMarkdown(prd: UniversalPrdSpec): string {
  const uiPages = prd.uiPagesSummary && prd.uiPagesSummary.length > 0
    ? prd.uiPagesSummary
    : [
        { page: '主页', features: '开始新游戏、继续上次进度、查看已解锁结局图鉴' },
        { page: '播放页', features: '全屏视频播放、点击/选择交互浮层、数值状态角标实时显示、暂停与回溯' },
        { page: '暂停设置', features: '继续播放、音量与亮度调节、返回主页、重看当前片段' },
        { page: '故事线选集', features: '按主干与分支展示已解锁剧情节点、一键跳转重玩' },
        { page: '结局结算', features: '展示结局类型与标题、剧情摘要、回溯至关键抉择点重玩' },
      ];

  const uiLines = uiPages
    .map((u) => `- **${u.page}**：${u.features}`)
    .join('\n');

  const clips = prd.clips || [];
  const endings = prd.endings || [];
  const interactions = prd.interactions || [];
  const startId = prd.startNodeId || clips[0]?.id || 'c1';

  const clipLines = clips.map((c) => `  - \`${c.id}\`：《${c.title}》（对应视频：${c.video || `${c.id}.mp4`}）`).join('\n');
  const endingLines = endings.map((e) => `  - \`${e.id}\`：[${e.endingType}] 《${e.title}》（${e.isVictory ? '🏆 胜利通关' : '💀 遗憾终局'} - ${e.summary}）`).join('\n');

  return `# 《${prd.gameTitle}》互动影游 PRD

## 1. 游戏介绍
全剧视频片段与故事切片严格 1:1 对齐（题材：${prd.genre}）。
- **背景与视角**：${prd.premiseAndPerspective || '第一人称视听浸入式互动电影'}
- **交互时机**：所有交互均在每段视频播放完成（\`onEnded\`）后触发，无需依赖视频内部时间轴打点。

## 2. 流外状态与互动说明
- **流外状态**：${prd.outOfFlowSummary || '无复杂外围养成，专注纯剧情分支与生死抉择。'}
- **交互规则**：所有互动点的玩法类型（\`kind\`）、开放参数（\`config\`）、限时（\`timeoutSec\`）、结果枚举（\`outcomes\`）及状态变动（\`stateChange: { add, set }\`）统一定义于数据底座；互动本身不关心流程走向，流向与条件判断完全由接线有向图统一处理。

## 3. 节点接线与流向概览
全剧共规划 ${clips.length} 个核心视频片段、${interactions.length} 个分支互动抉择点与 ${endings.length} 个分支结局。
精确的节点接线网络、状态变更字典与跳转条件已收敛于同级规范数据底座 \`prd.json\`（Universal PRD Spec），与本文档双轨一并交付给下游游戏代码生成引擎。

- **起始片段**：\`${startId}\`
- **分幕镜头清单**：
${clipLines || '  - 暂无分幕'}
- **分支终局清单**：
${endingLines || '  - 暂无结局'}

## 4. 玩法、胜负与容错原则
- **怎么玩与胜负条件**：${prd.gameplayAndVictorySummary || '在剧情关键时刻做出决策，达成胜利通关或发掘不同隐藏终局。'}（精确条件以 \`prd.json\` 中的 \`wiring\` 与 \`endings\` 为准）
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
 * 分幕切片剧本 Markdown 渲染器 (供下游工序 2 视觉资产/分镜与故事切片查看 SSOT)
 *
 * 格式规范：顶部极简分幕目录清单 + 按 `## <clipId>｜<title>` 分节切分正文，
 * 与 `prd.md` 第 3 章 `clips[].id` 严格 1:1 对齐。
 */
export function formatStoryScenesToMarkdown(
  clips: PrdClipNode[],
  storySections: Record<string, { title: string; narrativeText: string }> = {}
): string {
  const indexRows: string[] = [];
  const sections: string[] = [];

  for (let idx = 0; idx < clips.length; idx++) {
    const clip = clips[idx];
    const section = storySections[clip.id] || { title: clip.title, narrativeText: '' };
    const title = section.title || clip.title || `第 ${idx + 1} 幕`;
    const roleLabel = idx === clips.length - 1 ? '主线终局' : '主干片段';

    indexRows.push(`- \`${clip.id}\`（${roleLabel}）：${title}`);
    sections.push(`## ${clip.id}｜${title}\n\n${section.narrativeText || '（无剧本正文）'}`);
  }

  const header = `# 分幕剧本清单

> 每个 \`## <编号>｜<标题>\` 严格 1:1 对应 \`prd.md\` 第 3 章 \`clips[].id\` 与视频文件 \`<编号>.mp4\`。

${indexRows.join('\n')}

---

`;

  return header + sections.join('\n\n') + '\n';
}
