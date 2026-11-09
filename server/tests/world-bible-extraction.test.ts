/**
 * tests/world-bible-extraction.test.ts
 * PRD 资产与设定解构提取器 (World Bible Extractor) 单元与闭环测试
 */

process.env.NODE_ENV = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WorldBibleSchema,
  extractWorldBibleFromGDD,
  buildDeterministicWorldBible,
} from '../src/agents/planner/index.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';

const TEST_PROJ_ID = `test_bible_${Date.now()}`;

test.after(() => {
  ProjectStore.getInstance().deleteProject(TEST_PROJ_ID);
});

test('PRD 资产圣经提取器 (World Bible) 契约与全品类覆盖测试', async () => {
  const mockGdd = {
    schemaVersion: '2.0.0',
    title: '深海逆光：临界博弈',
    genre: '赛博悬疑 / 双面潜伏互动影游',
    markdown: '# 深海逆光\n\n审讯室中，维克托手按子弹，搜查猎犬在铁门外咆哮。',
  };

  const worldBible = await extractWorldBibleFromGDD(mockGdd as any);

  // 1. 契约严格校验
  const validated = WorldBibleSchema.parse(worldBible);
  assert.equal(validated.title, '深海逆光：临界博弈');

  // 2. 实体全品类覆盖验证 (包含人类角色、动物生物、关键道具)
  assert.ok(validated.entities.length >= 5, '至少提取 5 个核心实体');

  const charLin = validated.entities.find((e) => e.id === 'char_lin_xun');
  assert.ok(charLin, '必须包含主角林巡');
  assert.equal(charLin.category, 'character');
  assert.ok(charLin.visualDnaPromptEn.includes('1man'), '必须包含 ComfyUI 锁貌英文视觉 DNA');

  const charViktor = validated.entities.find((e) => e.id === 'char_viktor');
  assert.ok(charViktor, '必须包含对手维克托');
  assert.ok(charViktor.visualDescription.includes('测谎义眼'), '必须提取面部特征细节');

  const hound = validated.entities.find((e) => e.id === 'entity_hound_k9');
  assert.ok(hound, '必须成功提取机械犬/动物生物实体');
  assert.equal(hound.category, 'animal_creature');
  assert.ok(hound.visualDnaPromptEn.includes('cybernetic Doberman hound'), '动物实体必须有专属英文 Prompt 锚点');

  const bullet = validated.entities.find((e) => e.id === 'prop_brass_bullet');
  assert.ok(bullet, '必须提取关键道具：黄铜子弹');
  assert.equal(bullet.category, 'key_prop');

  const bloodList = validated.entities.find((e) => e.id === 'prop_blood_list');
  assert.ok(bloodList, '必须提取核心证据：带血名单');
  assert.equal(bloodList.category, 'key_prop');

  // 3. 场景空间与光影氛围验证
  assert.ok(validated.locations.length >= 2, '至少提取 2 个核心博弈场景');
  const room = validated.locations.find((l) => l.id === 'loc_interrogation_room');
  assert.ok(room, '必须包含雨夜安保审讯室');
  assert.ok(room.spatialLayout.length > 10, '必须刻画物理空间陈设');
  assert.ok(room.lightingAtmosphere.includes('冷') || room.lightingAtmosphere.includes('光'), '必须刻画光影氛围');
  assert.ok(room.audioAmbience.includes('雨') || room.audioAmbience.includes('声'), '必须刻画声音与听觉环境');
  assert.ok(room.visualPromptEn.includes('cinematic'), '必须包含标准英文场景生图 Prompt');

  // 4. 经典机锋对白与潜台词验证
  assert.ok(validated.dialogueModules.length >= 2, '至少包含 2 组核心机锋对白库');
  const clash = validated.dialogueModules[0];
  assert.ok(clash.lines.length >= 2, '对白模块必须包含多轮来回交锋');
  assert.ok(clash.lines.some((l) => l.subtext && l.subtext.length > 0), '台词必须包含心理动机与潜台词');
  assert.ok(clash.lines.some((l) => l.actionCue && l.actionCue.length > 0), '台词必须包含微动作或微表情指令');
});

test('ProjectStore 资产黑板存储持久化验证', async () => {
  const store = ProjectStore.getInstance();
  const proj = store.getProject(TEST_PROJ_ID);
  assert.ok(proj, '测试项目必须初始化');

  const worldBible = buildDeterministicWorldBible('测试项目');
  store.setArtifact(TEST_PROJ_ID, 'world_bible', worldBible);

  const reloaded = store.getArtifact<typeof worldBible>(TEST_PROJ_ID, 'world_bible');
  assert.ok(reloaded, '必须能够从磁盘重新读取世界圣经资产');
  assert.equal(reloaded.entities.length, worldBible.entities.length);
});
