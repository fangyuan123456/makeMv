/**
 * agents/game-assembly/steps/tech-plan/runtime-contract.ts
 * 互动影游运行时契约 (Runtime Contract SSOT)
 *
 * 这里写清「系统已经给定、模型不需要重新设计」的事实：
 * 1. 放映单：全剧有哪几幕、每幕的介入点与去向（编译期就已知，直接写成代码里的表）；
 * 2. 产物位置与加载路径（index.html / js 模块 / style.css / ../scenes/*.json）；
 * 3. 播放器跑起来必须做到的行为（介入点、岔口、终局、状态写入）。
 *
 * tech-plan 拿它规划文件职责，codegen 拿它写代码——共用一份，避免两边说两套话。
 */

import type { StoryScript } from '../../../../project-store/contracts/game-assembly/index.js';

/**
 * 数据与路径事实：产物怎么放、运行时从哪读。
 */
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

/**
 * 行为要求：跑起来必须做到的事（codegen 系统提示词主体之一）。
 */
export function buildRuntimeBehaviorRules(): string {
  return `【运行时行为要求】
1. 一幕只有四种情况，按放映单判断：
   - 有 interaction：自动弹介入点，按 kind 渲染真实交互（CLICK 给可点区域与点击反馈、HOLD 显示长按进度、其它未知 kind 降级为「点击确认」按钮），做完套用 stateChange、把 feedback 当轻提示展示，然后按 next 切幕；
   - 有 choices 且有内容：自动弹选项按钮，点击先套用 stateChange 再跳到 to；
   - 有 ending：自动展示终局覆盖层（title、verdict），有 rewindTo 就给「回到该幕重选」；
   - 只有 next（或什么都没有）：直接切 next，中间不要插任何点击。
2. 状态：initialState 起步，{ add } 累加、{ set } 赋值。HUD 常驻显示当前幕标题（放映单里的 title）与关键状态数值。
3. 视觉：遮罩、装饰、按钮、进度、过场都由 CSS 与内联 SVG 绘制；不引用任何图片、字体、CDN 或第三方库；图标用 SVG path，不要堆 emoji。
4. 关卡结构（幕号、走向、按钮文案）按放映单写进代码；台词与画面由底座播。不要按幕写 if / switch，用一张表驱动，所有幕走同一条调度路径。
5. 切幕只走一条通道 goToScene(sceneId)：清理浮层 → play，不要在三处各写一份加载逻辑。
6. 渲染新一幕前必须清掉上一幕的介入层、选项层、提示层（清 innerHTML 并隐藏），不许浮层残留；浮层显示状态统一使用同一个类名（推荐 is-visible），不得在 JS 使用 is-visible、CSS 却只定义 active。
7. 介入层与选项层只放在画面下部安全区，不遮挡 HUD 与幕标题；同一时刻只能有一个可交互浮层。
8. HUD 不要出现 "TRUST 2 / HASCHIP NO" 这种机器味标签，按业务写中文（如 信任 2 / 证据 3）。
9. 放映单里没有这一幕、或去向指向不存在的幕时，给一句明确提示并停在当前画面，不要白屏、不要死循环。`;
}

/**
 * 放映单：全剧每一幕的「播什么、玩家干什么、往哪走」。
 *
 * 这是编译期已知的事实——codegen 据此把它写成代码里的一张表，运行时不读任何播放表。
 * verbatim=true 时连按钮文案、反馈文案、结局判词一起给（写代码用）；否则只给结构（规划用）。
 */
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
        parts.push(`介入 ${s.interaction.kind}「${s.interaction.prompt}」${describeChange(s.interaction.stateChange)}`);
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

/** { add: { trust: 1 } } → （trust+1） */
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
