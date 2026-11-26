import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEntityBindingsFromText } from '../../src/tools/film-production/shared/semantic-asset-compiler.js';

test('Server Semantic Asset Compiler: 纯自然语言实体绑定、长名优先对齐与参考图片提取', () => {
  const mockEntities = {
    characters: [
      { characterId: 'char_1', name: '李秀兰', imageUrl: 'https://example.com/lixiulan.png' },
      { characterId: 'char_2', name: '陈小满', imageUrl: 'https://example.com/xiaoman.png' },
      { characterId: 'char_3', name: '陈小满爷爷', referenceImageUrl: 'https://example.com/grandpa.png' }, // 长名优先
    ],
    locations: [
      { locationId: 'loc_1', name: '老宅', imageUrl: 'https://example.com/old_house.png' },
    ],
    items: [
      { itemId: 'item_1', name: '布老虎', imageUrl: 'https://example.com/tiger.png' },
      { itemId: 'item_2', name: '三炷细香', imageUrl: 'https://example.com/incense.png' },
    ],
  };

  const text = '在老宅的正厅灵堂中，供桌案台前，李秀兰手持三炷细香，陈小满爷爷紧抱布老虎。';
  const resolved = resolveEntityBindingsFromText(text, mockEntities);

  assert.equal(resolved.locationId, 'loc_1');
  assert.equal(resolved.locationName, '老宅');
  assert.equal(resolved.locationImage, 'https://example.com/old_house.png');

  assert.ok(resolved.characterIds.includes('char_1'));
  assert.ok(resolved.characterIds.includes('char_3')); // 匹配长名陈小满爷爷，不截断为陈小满
  assert.deepEqual(resolved.characterImages, [
    'https://example.com/lixiulan.png',
    'https://example.com/grandpa.png',
  ]);

  assert.ok(resolved.itemIds.includes('item_1'));
  assert.ok(resolved.itemIds.includes('item_2'));
  assert.deepEqual(resolved.itemImages, [
    'https://example.com/incense.png',
    'https://example.com/tiger.png',
  ]);
});
