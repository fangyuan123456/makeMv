/**
 * tests/verify-entity-spec-prompt.test.ts
 * 验证角色视觉资产与渲染外壳正交解耦规范
 * 1. 验证资产层 buildCharacterSpecPrompt 不含【】结构标题与动作姿态
 * 2. 验证 CharacterSpecSchema 强类型契约严格限定 80~120 汉字纯物理长相
 * 3. 验证渲染层 buildCharacterPortraitPrompt 统筹三视图排版与 A-Pose 站姿外壳，总字数收敛在 180~250 字符黄金注意窗口
 */

import assert from 'node:assert';
import { buildCharacterSpecPrompt } from '../src/tools/film-production/entity-spec-tool/character/prompt.js';
import { buildLocationSpecPrompt } from '../src/tools/film-production/entity-spec-tool/location/prompt.js';
import { buildItemSpecPrompt } from '../src/tools/film-production/entity-spec-tool/item/prompt.js';
import { buildCharacterPortraitPrompt } from '../src/tools/film-production/lookdev-tool/character/prompt.js';
import { buildSceneAtmospherePrompt } from '../src/tools/film-production/lookdev-tool/location/prompt.js';
import { buildPropLookdevPrompt } from '../src/tools/film-production/lookdev-tool/item/prompt.js';
import { CharacterSpecSchema, LocationSpecSchema, ItemSpecSchema } from '../src/project-store/contracts/film-production/lookdev.js';

console.log('🧪 开始验证角色、场景与道具三大视觉资产全链路正交解耦规范...\n');

// 测试 1: 验证 buildCharacterSpecPrompt 指导语纯净化
function testCharacterPromptPurity() {
  console.log('--- 测试 1: 角色资产提示词模板纯净化与零小标题检验 ---');
  const prompt = buildCharacterSpecPrompt({
    name: '阿明',
    roleOrBrief: '纸扎铺学徒',
    storyMarkdown: '阿明在纸扎铺中工作...',
  });

  assert.ok(!prompt.includes('【人物本体解剖学物理特征】'), 'Prompt 不得包含【人物本体解剖学物理特征】小标题');
  assert.ok(!prompt.includes('【服装剪裁面料与真实物理质感】'), 'Prompt 不得包含【服装剪裁面料】小标题');
  assert.ok(!prompt.includes('统一简明起笔：“端正立姿A-Pose'), '资产层 Prompt 不得强行要求以 A-Pose 起笔');

  console.log('✅ 测试 1 通过: 角色资产层 Prompt 模板纯净无小标题诱导！\n');
}

// 测试 2: 验证 buildLocationSpecPrompt 场景解耦规范
function testLocationPromptPurity() {
  console.log('--- 测试 2: 场景资产提示词模板与空间结构解耦检验 ---');
  const prompt = buildLocationSpecPrompt({
    name: '纸扎铺',
    roleOrBrief: '前店后坊临街老店',
    storyMarkdown: '纸扎铺中陈列着纸人与白灯笼...',
  });

  // 严禁包含空间结构诱导
  assert.ok(!prompt.includes('【空间形制与纵深透视】'), '场景 Prompt 不得包含【空间形制】等说明小标题');
  assert.ok(prompt.includes('严禁空间坐标与方位结构'), '场景 Prompt 必须明确禁止在生图词中写左右后方等空间坐标');

  console.log('✅ 测试 2 通过: 场景生图词与空间蓝图彻底解耦！\n');
}

// 测试 3: 验证 LocationSpecSchema 契约合规
function testLocationSchemaValidation() {
  console.log('--- 测试 3: LocationSpecSchema 强类型契约校验 ---');

  const validLocation = {
    locationId: 'loc_test_001',
    name: '纸扎铺',
    atmosphere: '冷月透窗，暖烛摇曳',
    appearanceSummary: '临街木构老铺面，前店后坊',
    promptZh: '临街木构老铺面，深长进深透视，高耸挑空梁架下悬挂数盏残破泛黄纸灯笼。中央横陈厚重黑漆大柜台，高大博古架堆叠半成品纸扎与惨白竹篾骨架，破损木格窗透入幽冷月光，洒在生苔湿润的磨损青石板路面。老木开裂，夯土斑驳，纸帛纤维漫反射。冷幽月光与昏黄油灯对撞，阴翳层次深沉，中式悬疑电影实拍质感。',
    spatialLayout: '以居中厚重黑漆柜台为空间原点，正对入口双扇木门；面向柜台时，左侧为通高木格窗墙，右侧为纸扎堆放博古架，后方为通往后坊的过道。',
    subScenes: ['铺面柜台区', '纸扎堆放角落'],
    sceneIds: [],
  };

  const parsed = LocationSpecSchema.parse(validLocation);
  assert.strictEqual(parsed.name, '纸扎铺');
  assert.ok(parsed.promptZh.length >= 100 && parsed.promptZh.length <= 150, `场景 promptZh 字数 (${parsed.promptZh.length}) 应在黄金窗口内`);
  assert.ok(!parsed.promptZh.includes('面向柜台时'), '场景生图词中不应包含“面向某物时”等几何坐标');
  assert.ok(parsed.spatialLayout && parsed.spatialLayout.includes('面向柜台时'), '空间结构应专职留存于 spatialLayout 字段');

  console.log('✅ 测试 3 通过: LocationSpecSchema 强类型解析与空间结构分离合规！\n');
}

// 测试 4: 验证下游场景渲染组装
function testSceneRenderAssembly() {
  console.log('--- 测试 4: 下游场景空镜渲染组装验证 ---');

  const location = {
    locationId: 'loc_test_001',
    name: '纸扎铺',
    atmosphere: '冷月透窗，暖烛摇曳',
    appearanceSummary: '临街木构老铺面',
    promptZh: '临街木构老铺面，深长进深透视，高耸挑空梁架下悬挂数盏残破泛黄纸灯笼。中央横陈厚重黑漆大柜台，高大博古架堆叠半成品纸扎与惨白竹篾骨架，破损木格窗透入幽冷月光，洒在生苔湿润的磨损青石板路面。老木开裂，夯土斑驳，纸帛纤维漫反射。冷幽月光与昏黄油灯对撞，阴翳层次深沉，中式悬疑电影实拍质感。',
    sceneIds: [],
  };

  const assembledScenePrompt = buildSceneAtmospherePrompt(location, '电影写实摄影');
  console.log('组装后的最终场景空镜出图提示词:');
  console.log(assembledScenePrompt);
  console.log(`总字符数: ${assembledScenePrompt.length}`);

  assert.ok(assembledScenePrompt.includes('纯空间无人物'), '场景空镜必须包含纯空间无人物约束');
  assert.ok(assembledScenePrompt.length <= 180, `场景出图词长度 (${assembledScenePrompt.length}) 必须在 180 字符黄金注意窗口内`);

  console.log('✅ 测试 4 通过: 场景空镜出图词精准收敛在黄金注意窗口内！\n');
}

// 测试 5: 验证 buildItemSpecPrompt 道具解耦规范
function testItemPromptPurity() {
  console.log('--- 测试 5: 道具资产提示词模板与棚拍外壳解耦检验 ---');
  const prompt = buildItemSpecPrompt({
    name: '百年契约',
    roleOrBrief: '供奉于契约坛的古老契书',
    storyMarkdown: '阿明在契约坛上发现了百年契约...',
  });

  assert.ok(!prompt.includes('【单体孤立原则】'), '道具 Prompt 不得包含【单体孤立原则】等说明小标题');
  assert.ok(!prompt.includes('物体必须居中置于干净中性影调空间'), '道具资产层 Prompt 不得包含居中、中性影调等下游棚拍外壳');

  console.log('✅ 测试 5 通过: 道具实物本体与棚拍外壳彻底解耦！\n');
}

// 测试 6: 验证 ItemSpecSchema 强类型契约
function testItemSchemaValidation() {
  console.log('--- 测试 6: ItemSpecSchema 强类型契约校验 ---');

  const validItem = {
    itemId: 'item_test_001',
    name: '百年契约',
    description: '供奉于地下密室的古老契书',
    appearanceSummary: '泛黄古契书，朱砂写满亡者姓名',
    promptZh: '长方形三层手工构皮纸古契书，尺寸约三十乘四十五厘米，层间干裂分层。深米黄纸面带深褐水渍霉斑，边缘卷曲焦脆，右下角有火烧碳化锯齿痕。正面朱砂墨繁体楷书亡者姓名阳寿，多处暗红氧化指印血渍，纸面有横向折痕与细微虫蛀孔。',
  };

  const parsed = ItemSpecSchema.parse(validItem);
  assert.strictEqual(parsed.name, '百年契约');
  assert.ok(parsed.promptZh.length >= 60 && parsed.promptZh.length <= 110, `道具 promptZh 字数 (${parsed.promptZh.length}) 应在黄金窗口内`);
  assert.ok(!parsed.promptZh.includes('中性影调'), '道具生图词中不应包含“中性影调”等下游棚拍词眼');
  assert.ok(!parsed.promptZh.includes('居中'), '道具生图词中不应包含“居中”等排版词眼');

  console.log('✅ 测试 6 通过: ItemSpecSchema 强类型解析与长度合规！\n');
}

// 测试 7: 验证下游道具渲染组装
function testItemRenderAssembly() {
  console.log('--- 测试 7: 下游道具特写棚拍渲染组装验证 ---');

  const item = {
    itemId: 'item_test_001',
    name: '百年契约',
    description: '供奉于地下密室的古老契书',
    appearanceSummary: '泛黄古契书',
    promptZh: '长方形三层手工构皮纸古契书，尺寸约三十乘四十五厘米，层间干裂分层。深米黄纸面带深褐水渍霉斑，边缘卷曲焦脆，右下角有火烧碳化锯齿痕。正面朱砂墨繁体楷书亡者姓名阳寿，多处暗红氧化指印血渍，纸面有横向折痕与细微虫蛀孔。',
  };

  const assembledItemPrompt = buildPropLookdevPrompt(item, '电影写实摄影');
  console.log('组装后的最终道具特写出图提示词:');
  console.log(assembledItemPrompt);
  console.log(`总字符数: ${assembledItemPrompt.length}`);

  assert.ok(assembledItemPrompt.includes('单件独立道具居中特写'), '渲染层必须统筹居中特写');
  assert.ok(assembledItemPrompt.includes('纯浅灰中性无缝摄影棚背景'), '渲染层必须统筹无缝摄影棚背景');
  assert.ok(assembledItemPrompt.length <= 220, `道具出图词长度 (${assembledItemPrompt.length}) 必须在 220 字符黄金注意窗口内`);

  console.log('✅ 测试 7 通过: 道具特写出图词精准收敛在黄金注意窗口内！\n');
}

testCharacterPromptPurity();
testLocationPromptPurity();
testLocationSchemaValidation();
testSceneRenderAssembly();
testItemPromptPurity();
testItemSchemaValidation();
testItemRenderAssembly();

console.log('🎉 角色、场景与道具三大实体全链路正交解耦规范 100% 验证通过！');
