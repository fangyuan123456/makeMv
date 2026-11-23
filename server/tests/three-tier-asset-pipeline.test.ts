import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AssetManifestTool,
  buildAssetManifestPrompt,
  buildAssetManifestModifyPrompt,
  assetManifestModifierStep,
} from '../src/tools/film-production/asset-manifest-tool/index.js';
import {
  EntitySpecTool,
  buildEntitySpecPrompt,
  buildEntitySpecModifyPrompt,
} from '../src/tools/film-production/entity-spec-tool/index.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';

describe('Three-Tier Visual Asset Pipeline SSOT', () => {
  it('AssetManifestTool 具有正确的工具元数据与结构化契约', () => {
    const tool = new AssetManifestTool();
    assert.equal(tool.toolName, 'film.asset_manifest');
    assert.ok(tool.description.includes('清单'));
  });

  it('EntitySpecTool 具有正确的单实体隔离并发键与元数据', () => {
    const tool = new EntitySpecTool();
    assert.equal(tool.toolName, 'film.entity_spec');
    const concurrencyKey = tool.resolveConcurrencyKey('proj_123', {
      targetKind: 'character',
      targetId: 'char_chen_shouye',
    });
    assert.equal(concurrencyKey, 'proj_123:character:char_chen_shouye');
  });

  it('buildAssetManifestPrompt 聚焦出场名单与极简定位', () => {
    const prompt = buildAssetManifestPrompt({
      title: '守夜禁规',
      storyMarkdown: '陈守夜推开老宅大门...',
    });
    assert.ok(prompt.includes('守夜禁规'));
    assert.ok(prompt.includes('核心资产清单'));
  });

  it('buildEntitySpecPrompt 仅针对单个指定实体且为纯正向语言', () => {
    const prompt = buildEntitySpecPrompt({
      targetKind: 'character',
      name: '陈守夜',
      roleOrBrief: '男主角·守夜人',
      instruction: '更加冷峻有书生气',
      storyMarkdown: '陈守夜推开老宅大门...',
    });
    assert.ok(prompt.includes('目标角色：陈守夜'));
    assert.ok(prompt.includes('更加冷峻有书生气'));
    assert.ok(prompt.includes('面部骨相五官'));
    // 确保没有教条动作词
    assert.ok(!prompt.includes('严禁慢放'));
  });

  it('AssetManifestTool 支持 mode: modify 结构化增删清单项', async () => {
    const { assetManifestModifierStep } = await import('../src/tools/film-production/asset-manifest-tool/index.js');
    const { ProjectStore } = await import('../src/project-store/ProjectStore.js');
    const projectId = `test_manifest_mod_${Date.now()}`;
    const store = ProjectStore.getInstance();
    store.setArtifact(projectId, 'lookdev_entities', {
      artStyle: '民国悬疑实拍',
      characters: [{ characterId: 'char_old_1', name: '旧角色' }],
      locations: [{ locationId: 'loc_old_1', name: '旧场景' }],
      items: [{ itemId: 'item_old_1', name: '旧道具' }],
    });

    // 增删测试 (执行 modifier step)
    const result = await assetManifestModifierStep.execute({
      context: {
        projectId,
        modifications: [
          { action: 'delete', entityKind: 'character', targetId: 'char_old_1' },
          { action: 'add', entityKind: 'character', name: '新角色', entity: { role: '配角', brief: '新登场人物' } },
        ],
      },
    } as any);

    assert.equal(result.projectId, projectId);
    assert.equal(result.characters.some((c: any) => c.name === '旧角色'), false);
    assert.equal(result.characters.some((c: any) => c.name === '新角色'), true);

    // 验证 Modifier Prompt 生成
    const manifestModPrompt = buildAssetManifestModifyPrompt({
      existingCharacters: [{ name: '陈守夜' }],
      existingLocations: [{ name: '老宅' }],
      existingItems: [{ name: '古镜' }],
      instruction: '新增角色李副官',
    });
    assert.ok(manifestModPrompt.includes('陈守夜'));
    assert.ok(manifestModPrompt.includes('新增角色李副官'));

    const entityModPrompt = buildEntitySpecModifyPrompt({
      targetKind: 'character',
      name: '陈守夜',
      existingSpec: { appearanceSummary: '冷峻守夜人' },
      instruction: '服装改为深黑色长衫',
    });
    assert.ok(entityModPrompt.includes('基准底稿'));
    assert.ok(entityModPrompt.includes('冷峻守夜人'));
    assert.ok(entityModPrompt.includes('深黑色长衫'));
  });
});
