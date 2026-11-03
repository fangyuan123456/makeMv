import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JsonSanitizer } from '../../utils/JsonSanitizer.js';

describe('JsonSanitizer 大模型文本清洗与非标自愈', () => {
  it('cleanInvisibleChars 剥离零宽字符与 BOM', () => {
    const raw = '\uFEFF{"name":\u200B"测试\u200C人物"}\u2028';
    const cleaned = JsonSanitizer.cleanInvisibleChars(raw);
    assert.ok(!cleaned.includes('\uFEFF'));
    assert.ok(!cleaned.includes('\u200B'));
    assert.ok(!cleaned.includes('\u200C'));
  });

  it('sanitizeControlCharsInStrings 自动转义字符串字面量裸控制字符', () => {
    const raw = '{"text": "第一行\n第二行\t制表"}';
    const sanitized = JsonSanitizer.sanitizeControlCharsInStrings(raw);
    const parsed = JSON.parse(sanitized);
    assert.equal(parsed.text, '第一行\n第二行\t制表');
  });

  it('extractJsonFromText 提取 Markdown json 代码块', () => {
    const text = '好的，这是生成的角色设定：\n```json\n{"name": "林克", "role": "主角"}\n```\n请确认。';
    const result = JsonSanitizer.extractJsonFromText<{ name: string; role: string }>(text);
    assert.equal(result.name, '林克');
    assert.equal(result.role, '主角');
  });

  it('autoCloseJson 自动平衡被截断的括号栈', () => {
    const truncated = '{"title": "未完剧本", "acts": [{"name": "序幕", "shots": [1, 2';
    const autoClosed = JsonSanitizer.autoCloseJson(truncated);
    const parsed = JSON.parse(autoClosed);
    assert.equal(parsed.title, '未完剧本');
    assert.equal(parsed.acts[0].name, '序幕');
    assert.deepEqual(parsed.acts[0].shots, [1, 2]);
  });
});
