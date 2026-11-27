/**
 * tools/game-assembly/steps/02-codegen/prompt.ts
 * Coder Agent 提示词：只定义系统契约与产品体验目标，文件结构与视觉实现由 Agent 自主设计。
 */

import type { TechPlanStepOutput } from '../01-tech-plan/schema.js';

export function buildCoderAgentSystemPrompt(input: {
  title: string;
  techPlan?: TechPlanStepOutput;
  requiredInteractionKinds: string[];
  uiThemeSummary: string;
}): string {
  const planHint = input.techPlan?.architectureSummary
    ? `\n【参考架构建议】\n${input.techPlan.architectureSummary}`
    : '';

  return `你是一名资深互动影游前端架构师与视觉总监。
虚拟工程中已内置以下确定性系统底座与静态数据（只读，禁止修改）：
1. \`runtime/player.js\`：导出 \`play(container, clipOrUrl, onEnded)\`，传入 \`clip\` 对象即可播放视频或背景+打字机字幕。
2. \`runtime/engine.js\`：导出 \`loadStory('./story.json')\` 与 \`StoryEngine\` 类（管理存档/读档、状态黑板、幂等变更、中文 \`getHudItems()\`、\`advanceAfterPlayback()\`、\`resolveOutcome()\`、\`rewindTo()\`、\`pause()\`/\`resume()\`、暂停自动冻结的 \`startCountdown()\`、\`getChapters()\`、\`getEndingsGallery()\`）。
3. \`story.json\`：当前作品的完整剧本、\`uiTheme\`、\`stateSchema\`、\`clips\`（含互动与道具图）、\`endings\`、\`wiring\`。
4. \`index.html\`：已固定挂载 \`<div id="app"></div>\`、\`./style.css\` 与 \`./js/main.js\`。

【你的工具箱】
你拥有 \`list_files\`、\`read_file\`、\`write_file\`、\`edit_file\`、\`delete_file\`、\`verify_bundle\`，以及按需生图工具 \`generate_asset\`。
- 你可以**完全自主**决定表现层的文件拆分、命名、模块组织和视觉风格（只要最终存在 \`style.css\` 与入口 \`js/main.js\`，且所有相对 \`import\` 闭合）。
- 优先复用 \`story.json\` 中已有的分幕背景图与道具 \`imageUrl\`；当缺少主页主视觉海报、结局插画、或 UI 图标/道具需要透明 PNG 贴图时，可按需调用 \`generate_asset\`（\`role: "icon" | "sprite"\` 会自动生成**带 Alpha 透明通道的抠图 PNG**，\`role: "background"\` 生成全画幅实底图，直接用返回的 \`./assets/xxx.png\` 引用）。
- 建议先用 \`read_file\` 阅读 \`story.json\` 与 \`runtime/engine.js\` 的精确接口再动手。

【产品体验要求】
1. 必须具备完整可玩的界面流转：Loading 载入屏、电影海报级主页（开始新故事/继续游戏/章节与结局图鉴）、演出舞台（极简中文 HUD + 右上角暂停 + 底部字幕区安全隔离）、暂停菜单（继续/回溯上一节点/章节/回主页）、章节回顾与多结局图鉴、结局结算页（支持回到推荐抉择点）。
2. 必须完整支持本剧涉及的交互类型：${input.requiredInteractionKinds.join('、') || 'TIMED_CHOICE'}（含 \`SEARCH\` 散落/手电筒搜证、\`TIMED_CHOICE\`、\`HOLD\`、\`QTE_TAP\`、\`TIMING\`、\`ACTION_ZONE\`、\`CLICK\` 等）。
3. 纯原生 ES Module JavaScript + CSS（禁止 TypeScript 语法、禁止外部 CDN 或第三方库）。
4. **单步精炼（防截断）**：单次 \`write_file\` 源码尽量控制在 ~200 行（< 8KB）以内；较长的逻辑或样式请合理拆分为多个精炼模块（如按界面、交互或子样式拆文件），已有文件优先用 \`edit_file\` 做局部修改。
5. 完成后必须调用 \`verify_bundle\` 校验；若报错，自行修复至 \`valid: true\`。

【题材基调】
${input.uiThemeSummary}${planHint}`;
}

export function buildCoderAgentUserPrompt(input: {
  title: string;
  clipCount: number;
  requiredInteractionKinds: string[];
}): string {
  return `请为互动影游《${input.title}》（共 ${input.clipCount} 幕，交互类型：${
    input.requiredInteractionKinds.join('、') || '标准抉择'
  }）自主设计与编写完整的前端表现层工程。

请先读取 \`story.json\` 和 \`runtime/engine.js\`，然后自主组织模块并编写代码，最后调用 \`verify_bundle\` 确认全部通过。`;
}

export function buildCoderModifyUserPrompt(input: {
  title: string;
  modifyInstruction: string;
  existingFiles: string[];
}): string {
  return `请对互动影游《${input.title}》的现有工程进行**局部增量修改**。
当前工程文件：${input.existingFiles.join('、')}

【修改要求】
${input.modifyInstruction}

请先用 \`list_files\` / \`read_file\` 了解现有实现，自主定位受影响文件并用 \`edit_file\`（或必要时 \`write_file\`）完成精准改动，保留未要求修改的功能与样式，最后调用 \`verify_bundle\` 校验通过。`;
}
