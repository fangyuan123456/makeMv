import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SkillRegistry } from '../../skills/SkillRegistry.js';
import { BaseSkill } from '../../skills/BaseSkill.js';
import { WorkflowStage } from '../../types/index.js';
import type { SkillManifest } from '../../skills/types.js';

describe('SkillRegistry 技能注册与发现中心', () => {
  const registry = SkillRegistry.getInstance();

  class TestScriptSkill extends BaseSkill {
    public readonly manifest: SkillManifest = {
      name: 'test-scene-script',
      displayName: '测试分场剧本',
      description: '扩写剧情节点剧本',
      category: 'script',
      targetStage: WorkflowStage.SCENE_SCRIPT,
    };
    protected async run() { return { data: {}, summary: 'ok' }; }
  }

  class TestCriticSkill extends BaseSkill {
    public readonly manifest: SkillManifest = {
      name: 'test-critic-review',
      displayName: '测试独立审查官',
      description: '挑刺质检',
      category: 'critic',
      targetStage: WorkflowStage.NARRATIVE_DESIGN,
    };
    protected async run() { return { data: {}, summary: 'ok' }; }
  }

  it('成功注册并查询技能插件', () => {
    registry.register(new TestScriptSkill());
    registry.register(new TestCriticSkill());

    const fetched = registry.get('test-scene-script');
    assert.ok(fetched);
    assert.equal(fetched.manifest.name, 'test-scene-script');
    assert.equal(fetched.manifest.displayName, '测试分场剧本');
  });

  it('查询未知技能返回 undefined', () => {
    assert.equal(registry.get('non-existent-skill-xyz'), undefined);
  });

  it('list 列出所有已注册技能的 manifest', () => {
    const list = registry.list();
    assert.ok(list.some((m) => m.name === 'test-scene-script'));
  });

  it('listForStage 包含当前工序技能与全局通用 critic 技能', () => {
    const scriptSkills = registry.listForStage(WorkflowStage.SCENE_SCRIPT);
    assert.ok(scriptSkills.some((m) => m.targetStage === WorkflowStage.SCENE_SCRIPT));
    // category === 'critic' 技能必须在所有阶段均可见
    assert.ok(scriptSkills.some((m) => m.category === 'critic' || m.name === 'critic-review'));
  });

  it('formatSkillsForPrompt 格式化当前工序聚焦的技能提示词段落', () => {
    const promptText = registry.formatSkillsForPrompt(WorkflowStage.SCENE_SCRIPT);
    assert.match(promptText, /AI 导演当前已挂载的外挂影视技能包清单/);
    assert.match(promptText, /test-scene-script/);
  });

  it('注册无效插件 (缺少 manifest.name) 时刚性抛错', () => {
    assert.throws(
      () => {
        registry.register({} as any);
      },
      /无法注册无效的技能插件/
    );
  });
});
