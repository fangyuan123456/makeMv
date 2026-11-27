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
        { page: 'Loading 预加载页', features: '首幕视频与核心素材预热、标题与进度条展示' },
        { page: '游戏主页', features: '开始新游戏、继续上次进度、故事线与结局图鉴' },
        { page: '主播放与交互舞台', features: '全屏视频播放、中文状态 HUD 角标、幕末安全区互动浮层' },
        { page: '暂停与设置浮层', features: '冻结播放与倒计时、音量调节、重看当前幕、返回主页' },
        { page: '故事线选集与回溯', features: '展示已解锁节点与结局、支持状态快照回溯重玩' },
        { page: '结局结算页', features: '展示结局徽章、判词摘要、回溯重选与返回主页' },
      ];

  const uiLines = uiPages.map((u) => `- **${u.page}**：${u.features}`).join('\n');

  const clips = prd.clips || [];
  const endings = prd.endings || [];
  const interactions = prd.interactions || [];
  const wiring = prd.wiring || [];
  const stateSchema = prd.stateSchema || [];
  const startId = prd.startNodeId || clips[0]?.id || 'c1';

  const clipLines = clips.map((c) => `  - \`${c.id}\`：${c.title}（对应视频：${c.video || `${c.id}.mp4`}）`).join('\n');
  const endingLines = endings.map((e) => `  - \`${e.id}\`：[${e.endingType}] 《${e.title}》（${e.isVictory ? '🏆 胜利通关' : '💀 遗憾终局'}｜回溯起点：\`${e.rewindTargetClipId || startId}\`）— ${e.summary}`).join('\n');

  const branchingCount = interactions.filter((i) => i.isBranching !== false).length;
  const soloCount = interactions.length - branchingCount;

  const stateTable = stateSchema.length > 0
    ? `| 状态键 (\`key\`) | 中文展示名 | 初始值 | HUD 显示 | 用途说明 |\n| :--- | :--- | :---: | :---: | :--- |\n` +
      stateSchema.map((s) => `| \`${s.key}\` | ${s.label} | \`${JSON.stringify(s.initialValue)}\` | ${s.showInHud ? '是' : '否'} | ${s.description} |`).join('\n')
    : '（本作暂无全局数值/物品状态变量，专注纯剧情推进与抉择）';

  const interactionBlocks = interactions.length > 0
    ? interactions.map((inter, idx) => {
        const modeLabel = inter.isBranching === false ? '单线沉浸 · 无分支' : '命运分支';
        const timeoutLabel = inter.timeoutSec ? ` ｜ 限时 \`${inter.timeoutSec}s\`` : '';
        const lines: string[] = [
          `${idx + 1}. **\`${inter.id}\`（${modeLabel} ｜ 玩法：\`${inter.kind}\`${timeoutLabel}）**`,
          `   - **操作提示**：${inter.prompt}`,
        ];
        if (inter.config?.searchMode) {
          lines.push(`   - **呈现模式**：\`${inter.config.searchMode}\`（优先匹配关联道具定妆图）`);
        }
        if (inter.config?.targets?.length) {
          lines.push(
            `   - **目标物证**（需找齐）：` +
            inter.config.targets.map((t) => `\`${t.name}\`${t.stateTag ? `(${t.stateTag})` : ''}${t.feedback ? `[${t.feedback}]` : ''}`).join('、')
          );
        }
        if (inter.config?.decoys?.length) {
          lines.push(
            `   - **干扰线索**（点中只出轻气泡）：` +
            inter.config.decoys.map((d) => `\`${d.name}\`${d.feedback ? `[${d.feedback}]` : ''}`).join('、')
          );
        }
        if (inter.config?.holdDurationMs) {
          lines.push(`   - **长按蓄力时长**：\`${inter.config.holdDurationMs}ms\``);
        }
        if (inter.config?.targetTaps) {
          lines.push(`   - **连点目标次数**：\`${inter.config.targetTaps}\` 次`);
        }
        if (Array.isArray(inter.config?.sweetSpotPct)) {
          lines.push(`   - **时机靶区区间**：\`[${inter.config.sweetSpotPct[0]}%, ${inter.config.sweetSpotPct[1]}%]\``);
        }
        lines.push(`   - **结果枚举**：`);
        for (const o of inter.outcomes || []) {
          const addPairs = Object.entries(o.stateChange?.add || {}).map(([k, v]) => `${k} +${v}`).join(', ');
          const statePart = addPairs ? `（写入：\`${addPairs}\`）` : '';
          const fbPart = o.feedback ? `｜反馈：「${o.feedback}」` : '';
          lines.push(`     - \`[${o.key}]\` ${o.label}${statePart}${fbPart}`);
        }
        return lines.join('\n');
      }).join('\n')
    : '（本作无幕末互动节点）';

  const usedKinds = new Set(interactions.map((i) => String(i.kind || '').toUpperCase()));
  const behaviorRules: string[] = [];
  if (usedKinds.has('SEARCH')) {
    behaviorRules.push('- **`SEARCH`（场景搜证）**：安全区散落展示全部目标与干扰项（若为 `FLASHLIGHT` 模式则叠加鼠标/触屏跟随探照光圈）；点干扰物仅弹出气泡轻提示且不中断；全部目标找齐后触发完成反馈并切幕。');
  }
  if (usedKinds.has('TIMED_CHOICE')) {
    behaviorRules.push('- **`TIMED_CHOICE`（限时抉择）**：选项卡上方渲染紧迫倒计时条；归零未选时自动触发 `TIMEOUT` 对应结局或分支。');
  }
  if (usedKinds.has('HOLD')) {
    behaviorRules.push('- **`HOLD`（长按蓄力）**：长按进度环蓄满即成功；单线模式松手可重按，分支模式超时判 `FAIL`/`TIMEOUT`。');
  }
  if (usedKinds.has('QTE_TAP')) {
    behaviorRules.push('- **`QTE_TAP`（快速连点）**：限定时间内连点打满冲击条即成功；分支模式超时判 `FAIL`/`TIMEOUT`。');
  }
  if (usedKinds.has('TIMING')) {
    behaviorRules.push('- **`TIMING`（时机判定）**：光标在轨道往返移动，进入高亮靶区点击即命中并触发闪白冲击转场。');
  }
  if (usedKinds.has('ACTION_ZONE')) {
    behaviorRules.push('- **`ACTION_ZONE`（方位热区）**：左右/上下空间锚定动作热区按钮，支持倒计时超时路由。');
  }
  if (behaviorRules.length === 0) {
    behaviorRules.push('- **标准抉择/触发**：播完即弹出清晰选项或触发按钮，点击后写入状态并切入目标节点。');
  }

  const wiringTable = wiring.length > 0
    ? `| 起点 | 触发事件 / Outcome | 跳转目标 | 条件 |\n| :--- | :--- | :--- | :--- |\n` +
      wiring.map((w) => `| \`${w.from}\` | \`${w.onOutcome}\` | \`${w.to}\` | ${w.condition || '—'} |`).join('\n')
    : '（暂无连线）';

  const themeLine = prd.uiTheme
    ? `- **UI 主题视觉建议**：主色 \`${prd.uiTheme.primaryColor}\` ｜ 强调色 \`${prd.uiTheme.accentColor}\` ｜ 背景 \`${prd.uiTheme.bgColor}\` ｜ 质感：${prd.uiTheme.vibeKeywords}`
    : '- **UI 主题视觉建议**：深色沉浸舞台搭配高对比暖金高亮边框，贴合剧作氛围。';

  return `# 《${prd.gameTitle}》互动影游 PRD

## 1. 作品基调与视觉规范
- **真实题材**：${prd.genre}
- **主角身份与视角**：${prd.playerIdentity}（${prd.premiseAndPerspective || '第一人称视听浸入式互动电影'}）
${themeLine}
- **核心交互时机**：所有互动均在片段视频播放结束（\`onEnded\`）后于安全区叠加触发，不依赖视频内部硬编码打点。

## 2. 全局状态字典与流外规则
- **状态总览**：${prd.outOfFlowSummary}
- **HUD 显示铁律**：界面 HUD 仅展示下表中 \`HUD 显示 = 是\` 的**中文展示名**及数值，严禁直接渲染英文变量名。

${stateTable}

## 3. 分幕切片与结局清单
全剧共规划 ${clips.length} 个核心视频片段、${interactions.length} 个互动节点（其中命运分支 ${branchingCount} 个、单线沉浸 ${soloCount} 个）与 ${endings.length} 个分支结局。

- **起始片段**：\`${startId}\`
- **分幕视频清单**：
${clipLines || '  - 暂无分幕'}
- **分支终局清单**：
${endingLines || '  - 暂无结局'}

## 4. 互动节点详规与运行容错
### 4.1 互动节点清单
${interactionBlocks}

### 4.2 本作前端交互行为约定
${behaviorRules.join('\n')}
- **运行容错**：
  - 呼出暂停或切后台时立即冻结视频播放与交互倒计时；
  - 同一局内每个互动点已生效的 \`stateChange\` 不因重看片段或读档恢复重复累加（幂等去重）；
  - 退出重进支持从当前节点与交互状态恢复；回溯历史节点重玩时状态回滚至该节点进入前快照，并保留全局已解锁结局图鉴。

## 5. 全量流向接线表与游戏界面规划
### 5.1 全量流向接线表（\`wiring\`）
${wiringTable}

### 5.2 游戏 6 大界面规划
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
