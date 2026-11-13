/**
 * 一次性诊断：复现 router 两步流式对话，逐 chunk 打印，定位「正文只剩两个字」。
 * 只读 ProjectStore，不写任何产物、不启动流水线。
 */
// 不强制开启 LLM_DEBUG_HTTP：该开关会 clone 并 await 完整响应体，导致假性"非流式"缓冲。
// 需要看 HTTP 明细时由外部传入 LLM_DEBUG_HTTP=1。

const projectId = 'proj_mwd6hwti_cy5j';
const message = '构思一个废土赛博朋克深海潜艇的封闭悬疑博弈互动文游';

const { streamRouterDialogue } = await import('../src/agents/router/router.agent.js');
const { buildWorkingDialogueTurns } = await import('../src/mastra-compat/index.js');

const messages = buildWorkingDialogueTurns([], message);
console.log('【输入】', JSON.stringify(messages));

const t0 = Date.now();
const result = streamRouterDialogue({ projectId, messages });

let n = 0;
let acc = '';
for await (const chunk of result.textStream) {
  n += 1;
  acc += chunk;
  console.log(`chunk#${n} len=${chunk.length} +${Date.now() - t0}ms ${JSON.stringify(chunk)}`);
}

const steps = (await result.steps) as any[];
console.log('【汇总】耗时=', Date.now() - t0, 'ms chunk数=', n, '累积文本=', JSON.stringify(acc));
for (const [i, s] of steps.entries()) {
  console.log(
    `step${i}: finish=${s.finishReason} textLen=${(s.text || '').length} text=${JSON.stringify(
      (s.text || '').slice(0, 300)
    )} toolCalls=${(s.toolCalls || []).map((t: any) => t.toolName).join(',')}`
  );
}
