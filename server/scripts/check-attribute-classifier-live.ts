/**
 * scripts/check-attribute-classifier-live.ts
 * 补判器的「活体」核对脚本 —— 需要真实模型，不进 npm test。
 *
 * 确定性回归在 tests/mastra/ModifyAttributeClassifier.test.ts（注入桩）；
 * 但桩只能验证采纳逻辑，验证不了模型在提示词下是否真的会弃权。
 * 每次改 attribute-classifier 的 SYSTEM_PROMPT 或类别定义后，跑这个脚本确认
 * 「该弃权的弃权、该判对的判对」，否则改动等于没验证。
 *
 * 用法：npx tsx scripts/check-attribute-classifier-live.ts
 * 退出码非 0 表示有样例不符预期。
 */

process.env.MODIFY_LLM_CLASSIFY = '1';

import { classifyModifyAttribute } from '../src/agents/director/modifier/attribute-classifier.js';

interface Case {
  content: string;
  history?: string[];
  expect: string[];
  why: string;
}

const CASES: Case[] = [
  { content: '这个不行，换一个', expect: ['unknown'], why: '纯否定，无属性信息' },
  { content: '把它改回来', expect: ['unknown'], why: '指代回退，无属性信息' },
  { content: '太吵了', expect: ['unknown'], why: '声音类，六类里没有对应项' },
  { content: '再短一点', expect: ['unknown'], why: '孤立省略句，无从知道短的是什么' },
  {
    content: '再短一点',
    history: ['第二场张明的台词太长了，收一收'],
    expect: ['dialogue'],
    why: '有历史时省略句可解析，必须给出类别而不是弃权',
  },
  { content: '把她弄得沧桑一点，别那么干净', expect: ['appearance', 'visual'], why: '词表漏收的真实诉求' },
  { content: '把她眼睛弄小一点', expect: ['appearance'], why: '五官属客观外观' },
  { content: '这段戏让人喘不过气，压一压', expect: ['dialogue', 'visual', 'shot'], why: '多解，但不能弃权' },
];

(async () => {
  let failed = 0;
  for (const c of CASES) {
    const t0 = Date.now();
    const r = await classifyModifyAttribute({ content: c.content, history: c.history });
    const ms = Date.now() - t0;
    const ok = Boolean(r) && c.expect.includes(r!.attribute);
    if (!ok) failed += 1;
    console.log(
      `${ok ? '✅' : '❌'} ${String(ms).padStart(5)}ms  ${String(r?.attribute ?? 'undefined').padEnd(11)} ` +
        `conf=${r?.confidence ?? '-'}  ←「${c.content}」${c.history ? '（带历史）' : ''}  ${c.why}`
    );
  }
  console.log(`\n${CASES.length - failed}/${CASES.length} 符合预期`);
  if (failed > 0) process.exitCode = 1;
})();
