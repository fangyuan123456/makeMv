const cases = [
  { tag: 'siliconflow/DeepSeek-V4-Flash', url: 'https://api.siliconflow.cn/v1/chat/completions', key: process.env.SF_KEY, model: 'deepseek-ai/DeepSeek-V4-Flash' },
  { tag: 'n1n/gemini-2.5-flash', url: 'https://api.n1n.ai/v1/chat/completions', key: process.env.N1N_KEY, model: 'gemini-2.5-flash' },
];
const prompt = '用简体中文写一段约 600 字的悬疑场景描写：雨夜，老宅厨房，母亲背对女儿在洗一只搪瓷缸。不要解释，直接给正文。';
for (const c of cases) {
  const t0 = Date.now();
  const res = await fetch(c.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
    body: JSON.stringify({ model: c.model, messages: [{ role: 'user', content: prompt }], max_tokens: 1200, enable_thinking: false }),
  });
  const ms = Date.now() - t0;
  const j = await res.json().catch(() => ({}));
  const out = j?.choices?.[0]?.message?.content || '';
  const toks = j?.usage?.completion_tokens || 0;
  console.log(`${c.tag}: status=${res.status} ${ms}ms tokens=${toks} speed=${toks ? Math.round(toks / (ms / 1000)) : 0} tok/s len=${out.length}`);
  if (j.error) console.log('  err:', JSON.stringify(j.error).slice(0, 150));
}
