/**
 * scripts/verify-llm.ts
 * LLM 配置冒烟测试：验证 server/.env 中的 key/baseUrl/model 真实可用。
 * 运行：cd server && npx tsx scripts/verify-llm.ts
 */
import { config } from '../src/utils/config.js';
import { LLMRegistry } from '../src/llm/LLMRegistry.js';

async function main() {
  const masked = config.llm.apiKey
    ? `${config.llm.apiKey.slice(0, 8)}****${config.llm.apiKey.slice(-4)}`
    : '(空)';
  console.log('== 当前 LLM 配置 ==');
  console.log(`  provider: ${config.llm.provider}`);
  console.log(`  baseUrl:  ${config.llm.baseUrl}`);
  console.log(`  model:    ${config.llm.model}`);
  console.log(`  apiKey:   ${masked}`);
  console.log(`  mockMode: ${config.mockMode}`);

  if (config.mockMode || process.env.USE_MOCK_LLM === 'true') {
    console.error('\n❌ 当前处于 MOCK 模式，请确认 .env 中 MOCK_MODE=false / USE_MOCK_LLM=false');
    process.exit(1);
  }

  const service = LLMRegistry.get();
  console.log(`\n[1/2] generateText 真实调用 (${service.modelName}) ...`);
  const text = await service.generateText('用中文回复一句话：确认你能正常工作。', '你是一个测试助手，回复尽量简短。');
  console.log('  ✅ 回复:', text.trim().slice(0, 120));

  console.log('\n[2/2] generateObject (JSON 结构化输出，Agent 决策的核心路径) ...');
  const obj = await service.generateObject<{ ok: boolean; reply: string }>(
    '请返回 JSON：{"ok": true, "reply": "你的确认语"}',
    { type: 'object', properties: { ok: { type: 'boolean' }, reply: { type: 'string' } }, required: ['ok', 'reply'] },
    '你是一个测试助手。'
  );
  console.log('  ✅ 结构化结果:', JSON.stringify(obj));

  console.log('\n🎉 LLM 配置验证全部通过！');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ LLM 调用失败:', err?.message || err);
  process.exit(1);
});
