const { buildDirectorPrompt } = await import('../src/agents/director/prompt.js');
const prompt = buildDirectorPrompt(process.argv[2], process.argv[3]);
// 只输出基础提示词之后的动态上下文部分
const marker = '【🚫 审查门禁 FAIL 阻断守则】';
const idx = prompt.indexOf(marker);
const dynamic = idx >= 0 ? prompt.slice(idx + marker.length) : prompt;
console.log('=== 动态上下文长度:', dynamic.length, '===');
console.log(dynamic.slice(0, 2500));
process.exit(0);
