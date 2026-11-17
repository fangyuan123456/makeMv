import { JsonStreamStringExtractor } from '../src/utils/JsonStreamStringExtractor.js';

function runTests() {
  console.log('[Test] 开始测试 JsonStreamStringExtractor ...');

  // 测试 1: 一次性喂入完整 JSON
  {
    let extracted = '';
    const extractor = new JsonStreamStringExtractor({
      targetKeys: ['reasoning', 'summary'],
      onChunk: (chunk) => {
        extracted += chunk;
      },
    });

    extractor.feed('{"action":"propose","reasoning":"题材锁定为科幻生存","title":"推演剧本"}');
    if (extracted !== '题材锁定为科幻生存') {
      throw new Error(`测试 1 失败，期望 "题材锁定为科幻生存"，实际得到 "${extracted}"`);
    }
    console.log('✓ 测试 1 通过: 完整 JSON 提取');
  }

  // 测试 2: 极端单字符喂入（逐字符分片）与转义字符
  {
    let extracted = '';
    const extractor = new JsonStreamStringExtractor({
      targetKeys: ['reasoning'],
      onChunk: (chunk) => {
        extracted += chunk;
      },
    });

    const rawJson = '{"action":"propose","reasoning":"你好，\\n世界！\\"舰长\\"说：\\\\测试\\\\\\u4e2d\\u6587","title":"卡片"}';
    for (const ch of rawJson) {
      extractor.feed(ch);
    }

    const expected = '你好，\n世界！"舰长"说：\\测试\\中文';
    if (extracted !== expected) {
      throw new Error(`测试 2 失败，期望 "${expected}"，实际得到 "${extracted}"`);
    }
    console.log('✓ 测试 2 通过: 单字符极端分片与转义提取');
  }

  // 测试 3: 包含换行与格式化空格的 JSON
  {
    let extracted = '';
    const extractor = new JsonStreamStringExtractor({
      targetKeys: ['reasoning'],
      onChunk: (chunk) => {
        extracted += chunk;
      },
    });

    const jsonFormatted = `{\n  "action": "propose",\n  "reasoning" : "这是带缩进的描述内容",\n  "params": {}\n}`;
    extractor.feed(jsonFormatted);
    if (extracted !== '这是带缩进的描述内容') {
      throw new Error(`测试 3 失败，期望 "这是带缩进的描述内容"，实际得到 "${extracted}"`);
    }
    console.log('✓ 测试 3 通过: 格式化空格与换行 JSON 提取');
  }

  console.log('🎉 所有测试全部通过！');
}

runTests();
