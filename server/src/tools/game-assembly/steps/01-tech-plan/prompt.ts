/**
 * tools/game-assembly/steps/01-tech-plan/prompt.ts
 * 技术架构规划提示词体系
 */

import type { UniversalPrdSpec } from '../../../../project-store/contracts/planner/index.js';
import type { SingleSceneJson, StoryScript } from '../../../../project-store/contracts/game-assembly/index.js';
import {
  buildRuntimeBehaviorRules,
  buildRuntimeFactsSection,
  buildScreeningList,
} from './runtime-contract.js';

export const RUNTIME_API_DOC = `【播放视频（已提供底座，禁止另写一套播放器）】
import { play } from '../runtime/player.js';

play(container, url, onEnded)
  container  父容器节点，视频在里面播
  url        这一幕的视频地址
  onEnded    播完回调

URL 指向的是现在这种图文一幕（假视频）还是真视频，由底座分辨；你的代码只当它在播视频。`;

export function buildTechPlanSystemPrompt(): string {
  return `你是一名互动影游前端架构师。你的任务是读完策划案与分幕数据后，规划这个浏览器端互动影游工程的**文件划分与依赖拓扑**。

你现在不写实现代码，只交结构方案。方案会原样交给编码工序逐文件落地，所以每个文件的职责、对外符号与方法签名都必须写实、可执行。

【工程硬约束】
1. 产物是零构建的浏览器静态站点：game-assembly/js/*.js 用标准 ES module 互相 import，game-assembly/style.css 提供样式，index.html 由系统生成（只引入 ./js/main.js 与 ./style.css）。没有打包、没有转译。
2. 所有文件都是纯 JavaScript（.js），不写 TypeScript 类型标注，也不要规划任何类型文件。
3. 禁止引入任何第三方库、CDN、构建工具、图片或字体资源。
4. 视觉全部由 CSS 与内联 SVG 绘制，因此必须规划一个 kind = "css" 的样式文件。
5. 播放底座（播放器 + 数据加载 + 舞台样式）已经由系统写好放在 game-assembly/runtime/，**不要规划、不要重新实现**，只要在方案里按接口调用。

【数据与结构】
- 每一幕是一集视频，地址固定 ../scenes/<幕号>.json，交给播放底座即可，你不要读它。
- 全剧有几幕、每幕的介入点与去向，都在下方放映单里——这是既成事实，编码时直接写成代码里的表。

【规划要求】
1. 文件数量控制在 4~6 个之间（含 1 个 css），不要为了「看起来分层」而切碎；一个文件一件事。
2. 必须覆盖这些职责，允许合并但不能缺失：按放映单调度的路由（介入点 / 岔口 / 终局 / 下一幕）、玩家状态、HUD、介入与选项界面、启动装配入口。
3. 入口文件固定叫 main.js，kind 为 js，必须 import 其它全部 js 文件，并排在清单最后。
4. style.css 必须存在，kind 为 css，dependencies 恒为空。
5. dependencies 只能填本次规划中真实存在的 .js 文件名，形成有向无环图，禁止自依赖与环形依赖。
6. 每个文件的 symbols 必须写清导出的类名 / 函数名，class 还要写方法与参数——编码工序只会照着这份签名写，不会自行脑补。
7. 幕号一律照用放映单里的写法（S1 / S6.1），不要另造 id / label / clip_01 这类假编号，也不要编造放映单里没有的幕或互动。
8. 设计要贴合这部作品的实际玩法：它有几幕、有没有介入点、有没有岔口与终局，方案里要体现这些差异，而不是套一个通用模板。`;
}

export function buildTechPlanUserPrompt(input: {
  title: string;
  prd: UniversalPrdSpec;
  scenes: SingleSceneJson[];
  script: StoryScript;
  artStyle: string;
}): string {
  const { prd, scenes, script } = input;
  const startSceneId = script?.startSceneId || scenes?.[0]?.sceneId || 'S1';
  const startScene = scenes?.find((s) => s.sceneId === startSceneId) || scenes?.[0];

  const textLengths = new Map((scenes || []).map((s) => [s.sceneId, (s.text || '').length]));
  const screening = buildScreeningList(script || { startSceneId, initialState: {}, scenes: [] }, { textLengths });

  const interactionKinds = Array.from(
    new Set((script?.scenes || []).map((s) => s.interaction?.kind).filter(Boolean) as string[])
  );

  const endingLines =
    (script?.scenes || [])
      .filter((s) => s.ending)
      .map(
        (s) =>
          `- ${s.sceneId}｜${s.ending?.type || '-'}《${s.ending?.title || '-'}》${
            s.ending?.rewindTo ? `｜可回溯到 ${s.ending.rewindTo}` : ''
          }`
      )
      .join('\n') || '- （本作没有终局幕）';

  return `请为下面这部互动影游规划工程结构：

【作品】《${prd?.gameTitle || input.title}》
【题材】${prd?.genre || '未标注'}
【玩家身份】${prd?.playerIdentity || '未标注'}
【美术基调】${input.artStyle || '未标注'}

【放映单】（共 ${scenes?.length || 0} 幕）
${screening}

【介入类型】${interactionKinds.length ? interactionKinds.join(' / ') : '无'}
【终局】
${endingLines}

${buildRuntimeFactsSection({
    sceneCount: scenes?.length || 0,
    startSceneId: startScene?.sceneId || startSceneId,
    initialState: script?.initialState || {},
  })}

${buildRuntimeBehaviorRules()}

${RUNTIME_API_DOC}

【输出】按给定 schema 输出 architectureSummary 与 files（已按依赖拓扑排序，main.js 在最后）。`;
}
