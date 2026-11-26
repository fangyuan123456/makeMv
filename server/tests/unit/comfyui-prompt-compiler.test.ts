import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShotKeyframePrompt,
  type KeyframeReferenceEntry,
} from '../../src/tools/film-production/shot-keyframe-tool/steps/01-render/prompt.js';
import type { CinematicShotOrder } from '../../src/project-store/contracts/film-production/film-spec.js';

test('ComfyUI 提示词编译器: 纯自然语言格式自动编译为图文多模态 <imageN> 注意力映射与未定妆展开', () => {
  // 1. 模拟创作者/Agent 编写的纯自然语言分镜（0 处 @ 标点，纯正电影文学）
  const mockShot: CinematicShotOrder = {
    shotId: 'shot_001',
    shotNumber: 1,
    title: '镜头 01（全景定场 · 灵堂祭拜 · 5s）',
    shotType: '全景',
    cameraMovement: '慢推',
    sceneSubject: '老宅灵堂祭拜',
    firstFramePrompt:
      '在老宅的正厅灵堂中，供桌横陈。李秀兰双手执起三炷细香，神情凝重。陈小满爷爷紧抱布老虎立于画左。陈小满在门槛旁探头张望。王掌柜在门外驻足。',
  };

  // 2. 模拟系统已定妆资产的参考图列表（按影视优先级排序：场景母本、入画主角、长名配角、次要角色、道具）
  const mockReferences: KeyframeReferenceEntry[] = [
    { role: 'location', id: 'loc_1', name: '老宅', url: 'https://cdn.example.com/scenes/old_house.png' },
    { role: 'character', id: 'char_1', name: '李秀兰', identity: '守村遗孀', url: 'https://cdn.example.com/chars/lixiulan_threeview.png' },
    { role: 'character', id: 'char_3', name: '陈小满爷爷', identity: '盲眼老者', url: 'https://cdn.example.com/chars/grandpa.png' },
    { role: 'character', id: 'char_2', name: '陈小满', identity: '八岁幼童', url: 'https://cdn.example.com/chars/xiaoman.png' },
    { role: 'item', id: 'item_2', name: '三炷细香', url: 'https://cdn.example.com/items/incense.png' },
    { role: 'item', id: 'item_1', name: '布老虎', url: 'https://cdn.example.com/items/tiger.png' },
  ];

  // 3. 模拟资产全景清单（包含已定妆实体与未定妆配角）
  const mockEntities = {
    characters: [
      { characterId: 'char_1', name: '李秀兰' },
      { characterId: 'char_2', name: '陈小满' },
      { characterId: 'char_3', name: '陈小满爷爷' },
      // 王掌柜尚未定妆出图，仅有剧本外观设定
      { characterId: 'char_4', name: '王掌柜', promptZh: '五十岁上下，山羊胡，身材微胖，身着灰布长衫' },
    ],
    locations: [{ locationId: 'loc_1', name: '老宅' }],
    items: [
      { itemId: 'item_1', name: '布老虎' },
      { itemId: 'item_2', name: '三炷细香' },
    ],
  };

  // 4. 执行编译
  const compiledPrompt = buildShotKeyframePrompt(
    mockShot,
    mockReferences,
    undefined,
    undefined,
    mockEntities
  );

  console.log('\n========= 流入 ComfyUI 的最终编译提示词效果 =========\n');
  console.log(compiledPrompt);
  console.log('\n======================================================\n');

  // 5. 严格验证断言
  // 5.1 验证多图注意力对齐：已定妆实体名称自动升级为 <imageN>(实体名)
  assert.ok(compiledPrompt.includes('<image1>(老宅)'));
  assert.ok(compiledPrompt.includes('<image2>(李秀兰)'));
  assert.ok(compiledPrompt.includes('<image3>(陈小满爷爷)'));
  assert.ok(compiledPrompt.includes('<image4>(陈小满)'));
  assert.ok(compiledPrompt.includes('<image5>(三炷细香)'));
  assert.ok(compiledPrompt.includes('<image6>(布老虎)'));

  // 5.2 验证长名优先防护：绝对不能将“陈小满爷爷”错误切分为“<image4>(陈小满)爷爷”
  assert.ok(!compiledPrompt.includes('<image4>(陈小满)爷爷'));

  // 5.3 验证未定妆实体降级解包：未出图的“王掌柜”自动展开为外貌特征
  assert.ok(compiledPrompt.includes('王掌柜（五十岁上下，山羊胡，身材微胖，身着灰布长衫）'));

  // 5.4 验证参考资产映射块生成
  assert.ok(compiledPrompt.includes('【参考资产映射】'));
  assert.ok(compiledPrompt.includes('- <image1> 为「老宅」环境美术与材质母本'));
  assert.ok(compiledPrompt.includes('- <image2> 为「李秀兰」（守村遗孀）定妆基准'));
  assert.ok(compiledPrompt.includes('- <image3> 为「陈小满爷爷」（盲眼老者）定妆基准'));
  assert.ok(compiledPrompt.includes('- <image4> 为「陈小满」（八岁幼童）定妆基准'));
  assert.ok(compiledPrompt.includes('- <image5> 为「三炷细香」道具设定图'));
  assert.ok(compiledPrompt.includes('- <image6> 为「布老虎」道具设定图'));

  // 5.5 验证无任何 @ 残留
  assert.ok(!compiledPrompt.includes('@'));
});
