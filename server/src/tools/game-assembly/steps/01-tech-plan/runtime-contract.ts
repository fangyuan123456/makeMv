/**
 * tools/game-assembly/steps/01-tech-plan/runtime-contract.ts
 * 互动影游运行时契约 (Runtime Contract SSOT)
 */

import type { StoryScript } from '../../../../project-store/contracts/game-assembly/index.js';

export function buildRuntimeFactsSection(facts: {
  sceneCount: number;
  startSceneId: string;
  initialState: Record<string, unknown>;
}): string {
  return `【运行时给定事实（不可更改）】
1. 产物是一份零构建的静态站点，放在 game-assembly/ 下：index.html（入口，系统生成，只含 #app 容器与 <script type="module" src="./js/main.js">）、js/*.js（你写的 ES module）、style.css（你写的样式）。浏览器直接跑，没有打包、没有转译、没有构建步骤。
2. 模块之间用标准 import / export，import 路径必须与规划的文件名逐字一致（如 import { StateMachine } from './StateMachine.js'）。入口固定是 js/main.js。
3. 全剧共 ${facts.sceneCount} 幕，起始幕 ${facts.startSceneId}。幕号、顺序、互动点、去向都是既成事实（放映单里全有）：直接写成代码里的表，不要运行时再去读什么播放表。
4. initialState = ${JSON.stringify(facts.initialState)}，以 script.json 为准。
5. 页面在 iframe 中打开，视口尺寸不固定，布局必须自适应（宽高 100%，不要写死像素宽度）。`;
}

export function buildRuntimeBehaviorRules(): string {
  return `【运行时行为要求】
1. 界面完整度（6 大界面缺一不可）：
   - Loading 预加载页（预加载首幕资源并显示进度）；
   - 游戏主页（首幕海报底图、标题、开始新游戏、继续存档、故事线与结局图鉴）；
   - 主播放舞台（全屏播放 + 顶部中文状态 HUD + 暂停/选集/静音按钮 + 幕末安全区互动层）；
   - 暂停浮层（呼出即冻结视频与倒计时，支持继续、重看当前幕、返回主页）；
   - 故事线选集与回溯（展示已解锁节点与结局，支持按状态快照回溯重玩）；
   - 结局结算页（展示结局徽章、判词、回溯重选、返回主页）。
2. 一幕交互按放映单与 \`interaction.kind\` 分发：
   - \`SEARCH\`：安全区散落展示全部目标与干扰项（若 \`searchMode === 'FLASHLIGHT'\` 则叠加探照光圈）；点干扰物仅弹轻提示；全部目标集齐后套用 \`stateChange\` 并切幕；
   - \`TIMED_CHOICE\` / \`CHOICE\` / \`ACTION_ZONE\`：渲染选项或空间热区；有 \`timeoutSec\` 时顶部显示倒计时条，归零自动触发 \`TIMEOUT\` 分支；
   - \`HOLD\` / \`QTE_TAP\` / \`TIMING\` / \`CLICK\`：按对应蓄力环/连点条/靶区或触发按钮渲染真实交互；
   - 有 \`ending\`：展示终局覆盖层；只有 \`next\`：直接切 \`next\`。
3. 状态：initialState 起步，{ add } 累加、{ set } 赋值。HUD 仅显示中文状态名（由 \`stateSchema\` 映射），严禁印出英文变量名。
4. 视觉：遮罩、装饰、按钮、进度、过场由 CSS 与内联 SVG 绘制，主色/强调色/背景色直接复用 PRD 的 \`uiTheme\`；页面在 iframe 中自适应宽高 100%。
5. 切幕只走一条通道 goToScene(sceneId)：清理计时器与浮层 → play，不留残留。`;
}

export function buildScreeningList(
  script: StoryScript,
  opts: { textLengths?: Map<string, number>; verbatim?: boolean } = {}
): string {
  return script.scenes
    .map((s) => {
      const parts: string[] = [];

      const len = opts.textLengths?.get(s.sceneId);
      if (typeof len === 'number') parts.push(`正文 ${len} 字`);

      if (s.interaction) {
        const cd = s.interaction.timeoutSec ? `(${s.interaction.timeoutSec}s)` : '';
        const targets = s.interaction.config?.targets?.map((t) => t.name).join('、');
        const cfgNote = targets ? `[目标:${targets}]` : '';
        parts.push(`介入 ${s.interaction.kind}${cd}「${s.interaction.prompt}」${cfgNote}${describeChange(s.interaction.stateChange)}`);
        if (opts.verbatim && s.interaction.feedback) parts.push(`操作后提示「${s.interaction.feedback}」`);
      }

      if (s.choices?.length) {
        const items = s.choices.map(
          (c) => `「${c.text}」→${c.to}${describeChange(c.stateChange)}`
        );
        parts.push(`岔口 ${items.join(' / ')}`);
      }

      if (s.next) parts.push(`播完去 ${s.next}`);

      if (s.ending) {
        const rw = s.ending.rewindTo ? `，可回溯到 ${s.ending.rewindTo}` : '';
        const verdict = opts.verbatim && s.ending.verdict ? `，判词「${s.ending.verdict}」` : '';
        parts.push(`终局 ${s.ending.type || '-'}《${s.ending.title}》${verdict}${rw}`);
      }

      return `- ${s.sceneId}《${s.title}》｜${parts.join('｜') || '无玩法'}`;
    })
    .join('\n');
}

function describeChange(change?: {
  add?: Record<string, number>;
  set?: Record<string, unknown>;
}): string {
  if (!change) return '';
  const parts: string[] = [];
  if (change.add) {
    for (const [k, v] of Object.entries(change.add)) parts.push(`${k}${v >= 0 ? '+' : ''}${v}`);
  }
  if (change.set) {
    for (const [k, v] of Object.entries(change.set)) parts.push(`${k}=${JSON.stringify(v)}`);
  }
  return parts.length ? `（${parts.join('，')}）` : '';
}
