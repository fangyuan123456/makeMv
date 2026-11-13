/**
 * agents/text-game/steps/codegen/prompt.ts
 * 编码工序提示词：系统提示词一次性交代底座事实、行为要求、数据字段与架构契约；
 * 每轮只追加「这一轮该写哪几个文件 / 上一轮写了什么」。
 */

import type { TechPlanOutput } from '../tech-plan/schema.js';
import {
  buildRuntimeBehaviorRules,
  buildRuntimeFactsSection,
} from '../tech-plan/runtime-contract.js';
import { RUNTIME_API_DOC } from './runtime-files.js';

export function buildCodegenSystemPrompt(input: {
  title: string;
  techPlan: TechPlanOutput;
  sceneCount: number;
  startSceneId: string;
  initialState: Record<string, unknown>;
  screening: string;
}): string {
  const planLines = input.techPlan.files
    .map((f, idx) => {
      const symbolLines = f.symbols.length
        ? f.symbols
            .map((s) => {
              const methods = s.methods
                .map((m) => `\n        · ${m.name}${m.signature} —— ${m.description}`)
                .join('');
              return `      - ${s.kind} ${s.name}：${s.purpose}${methods}`;
            })
            .join('\n')
        : '      - （纯样式文件，无对外符号）';
      return `${idx + 1}. ${f.fileName}（${f.kind}）｜职责：${f.responsibility}｜import：${
        f.dependencies.join('、') || '无'
      }\n${symbolLines}`;
    })
    .join('\n');

  return `你是一名资深互动影游前端工程师。你要按已经定稿的架构规划，用原生 JavaScript (ES Modules) + CSS 把这部互动影游写出来，做到打开 index.html 就能玩。

【工程事实】
${buildRuntimeFactsSection({
    sceneCount: input.sceneCount,
    startSceneId: input.startSceneId,
    initialState: input.initialState,
  })}

${buildRuntimeBehaviorRules()}

${RUNTIME_API_DOC}

【放映单】（全剧每一幕，按顺序；照它写成代码里的表，运行时不读任何播放表）
${input.screening}

【架构规划（唯一契约，逐字遵守）】
${input.techPlan.architectureSummary}

${planLines}

【编码纪律】
1. 每轮只写本轮指派的目标文件，不要抢跑，也不要重写已就绪的文件。
2. 每个文件用一个带路径的代码块提交，格式固定（三个反引号 + file:路径），代码块里直接放完整源码：
   \`\`\`file:StateBlackboard.js
   export class StateBlackboard { ... }
   \`\`\`
   代码块必须闭合；一个回复里可以并排提交多个文件块。
3. 文件必须是完整可运行的实现：禁止 TODO、占位、省略号、「其余同上」这类偷懒写法。
4. 模块之间用 import / export，import 路径写成 './Xxx.js' 且与规划文件名逐字一致；只能 import 规划里存在的文件，只能使用已就绪模块真实导出的名字。
5. 一律纯 JavaScript：不要写 TS 类型标注、interface、泛型、as 断言。
6. 禁止第三方库、CDN、外部图片与字体；除素材里的 background 外所有视觉（背景遮罩、装饰、按钮、进度、光效、过场、结局面板）都用 CSS 与内联 SVG 绘制。
7. 放映单照抄成代码里的一张表（幕号、介入、按钮文案、状态变化、去向都在里面），运行时不要再读任何 json；画面与台词由底座播。
8. 单文件保持精炼：js 控制在 120~300 行，css 控制在 120~260 行；宁可拆清职责，也不要写超长文件（写太长会被输出长度截断，整轮作废）。
9. 全部目标文件写完后，单独回复一行 DONE。`;
}

export function buildKickoffUserPrompt(input: {
  stageName: string;
  targetFiles: string[];
  symbolSummary: string;
}): string {
  return `🎯 第 1 阶段【${input.stageName}】：请写出 ${input.targetFiles.join('、')}。

要求：每个文件一个 \`\`\`file:路径 代码块，完整源码；只写这几个文件；写完不要解释。

当前已就绪模块（只读参考）：
${input.symbolSummary || '（暂无，本阶段是工程起点）'}`;
}

export function buildContinueUserPrompt(input: {
  toolResults: string;
  nextStageName: string | null;
  nextTargetFiles: string[];
  symbolSummary: string;
  missingNotes?: string[];
}): string {
  const targetSection = input.nextTargetFiles.length
    ? `🎯 下一阶段【${input.nextStageName}】：请写出 ${input.nextTargetFiles.join('、')}。
- 只写这几个文件；import 的接口必须对齐下方已就绪模块，缺什么就在本轮补上，不要假设别处已经实现。
- 每个文件一个 \`\`\`file:路径 代码块，不要任何开场白。`
    : `✅ 全部目标文件已就绪，请检查后单独回复 DONE。`;

  const missing = input.missingNotes?.length
    ? `\n\n⚠️ 上一轮被打回的原因：\n${input.missingNotes.map((n) => `- ${n}`).join('\n')}`
    : '';

  return `上一轮结果：
${input.toolResults}${missing}

${targetSection}

当前已就绪模块（只读参考）：
${input.symbolSummary || '（暂无）'}`;
}
