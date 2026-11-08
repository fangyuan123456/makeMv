/**
 * tests/mastra/CharacterIdentity.test.ts
 * 角色稳定身份回归套件
 *
 * 背景：角色名一直同时是显示名和跨产物外键。两个职责压在一个字符串上，
 * 于是「改名 = 断链」「同名 = 串味」两件事都只能靠人肉补救：
 * 前者靠 RENAME_CHARACTER 做文本替换，后者根本没有解——按名字查事实只能取第一个。
 *
 * 本套件锁住四条不变量：
 *   1. 写入产物即自动补 characterId，且重复写入不换身份（id 必须稳定）；
 *   2. 定妆条目继承故事圣经的身份，微调一次也不会退化；
 *   3. 两个同名角色各自取到自己的事实，不串；
 *   4. 改名只动 name，id 不动，事实照样查得到；老数据无 id 仍按名字回落。
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';
import { withCharacterFacts, findCharacterFacts } from '../../src/agents/director/character-facts.js';
import { ensureBibleCharacterIds, syncShotCharacterIds } from '../../src/agents/director/lineage/character-identity.js';

describe('CharacterIdentity - 角色稳定身份', () => {
  const store = ProjectStore.getInstance();
  const makeProjectId = (suffix: string) => `test_proj_char_identity_${suffix}`;

  function seed(projectId: string): void {
    try {
      store.deleteProject(projectId);
    } catch {}
    store.saveProject({
      projectId,
      title: '角色身份测试工程',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
    } as any);
  }

  function writeBible(projectId: string, characters: any[]): any {
    store.setArtifact(projectId, WorkflowStage.NARRATIVE_DESIGN, {
      title: '末日回响',
      logline: '特工追查记忆黑市',
      style: '暗冷影调',
      goldenSpine: [],
      characters,
      characterNames: characters.map((c) => c.name),
    });
    return store.getArtifact(projectId, WorkflowStage.NARRATIVE_DESIGN);
  }

  before(() => {
    for (const id of ['idempotent', 'duplicate', 'rename', 'legacy']) seed(makeProjectId(id));
  });

  it('1. 写故事圣经自动补 id，重复写入不换身份', () => {
    const pid = makeProjectId('idempotent');
    const bible = writeBible(pid, [{ name: '阿诺', appearance: '刀疤脸', gender: '男', age: 35 }]);
    const firstId = bible.characters[0].characterId;
    assert.match(String(firstId), /^char_/, '写入层必须自动补上稳定身份');

    // 再写一次（模拟微调后回写）：id 必须原样保留，否则每次改设定都换一次身份
    store.setArtifact(pid, WorkflowStage.NARRATIVE_DESIGN, {
      ...bible,
      characters: [{ ...bible.characters[0], personality: '沉默' }],
    });
    const again = store.getArtifact(pid, WorkflowStage.NARRATIVE_DESIGN);
    assert.equal(again.characters[0].characterId, firstId, '重复写入不得更换已有身份');
  });

  it('2. 定妆条目继承故事圣经身份，且只补不改', () => {
    const pid = makeProjectId('idempotent');
    const bible = store.getArtifact(pid, WorkflowStage.NARRATIVE_DESIGN);
    const bibleId = bible.characters[0].characterId;

    store.setArtifact(pid, WorkflowStage.CHARACTER_DESIGN, {
      characters: [{ name: '阿诺', visualPrompt: '刀疤脸，黑色风衣' }],
      totalCharacters: 1,
      completedCharacters: 1,
      style: '暗冷影调',
    });
    const portrait = store.getArtifact(pid, WorkflowStage.CHARACTER_DESIGN);
    assert.equal(portrait.characters[0].characterId, bibleId, '定妆必须继承故事圣经的身份');

    // 再做一次微调回写：身份不得被重算
    store.setArtifact(pid, WorkflowStage.CHARACTER_DESIGN, {
      ...portrait,
      characters: [{ ...portrait.characters[0], visualPrompt: '刀疤脸，湿发贴额' }],
    });
    const refined = store.getArtifact(pid, WorkflowStage.CHARACTER_DESIGN);
    assert.equal(refined.characters[0].characterId, bibleId, '微调一次就退化成按名字关联是不允许的');
  });

  it('3. 两个同名角色各自取到自己的事实，不串', () => {
    const pid = makeProjectId('duplicate');
    const bible = writeBible(pid, [
      { name: '影子', appearance: '黑衣', gender: '男', age: 40 },
      { name: '影子', appearance: '白衣', gender: '女', age: 22 },
    ]);
    const [idA, idB] = bible.characters.map((c: any) => c.characterId);
    assert.notEqual(idA, idB, '同名角色必须拿到不同身份');

    const project = store.getProject(pid)!;
    const factsA = withCharacterFacts(project, { characterId: idA, name: '影子' } as any);
    const factsB = withCharacterFacts(project, { characterId: idB, name: '影子' } as any);
    assert.equal(factsA.gender, '男');
    assert.equal(factsA.age, 40);
    assert.equal(factsB.gender, '女');
    assert.equal(factsB.age, 22);

    // 没有 id 时（老数据）：同名本身就无解，宁可不给也不能给错的
    const noId = findCharacterFacts(project, '影子');
    assert.equal(
      noId,
      undefined,
      '同名且无身份时不能猜，猜错会把错的年龄性别写进下游'
    );
  });

  it('4. 改名只动 name，id 不动，事实照样查得到', () => {
    const pid = makeProjectId('rename');
    const bible = writeBible(pid, [{ name: '阿诺', appearance: '刀疤脸', gender: '男', age: 35 }]);
    const id = bible.characters[0].characterId;

    store.setArtifact(pid, WorkflowStage.CHARACTER_DESIGN, {
      characters: [{ name: '阿诺', visualPrompt: '刀疤脸，黑色风衣', imageUrl: 'http://mock/a.png' }],
      totalCharacters: 1,
      completedCharacters: 1,
      style: '暗冷影调',
    });

    // 改名（故事圣经）——定妆条目的名字此时还是旧的
    store.setArtifact(pid, WorkflowStage.NARRATIVE_DESIGN, {
      ...bible,
      characters: [{ ...bible.characters[0], name: '阿澈' }],
      characterNames: ['阿澈'],
    });
    const renamed = store.getArtifact(pid, WorkflowStage.NARRATIVE_DESIGN);
    assert.equal(renamed.characters[0].characterId, id, '改名不得更换身份');

    const project = store.getProject(pid)!;
    const portrait: any = store.getArtifact(pid, WorkflowStage.CHARACTER_DESIGN);
    const view = withCharacterFacts(project, portrait.characters[0]);
    assert.equal(view.name, '阿诺', '条目名以自身为准');
    assert.equal(view.gender, '男', '名字已不一致，但按身份仍能查到事实');
    assert.equal(view.age, 35);
    assert.equal(view.factsFrom, 'narrative_design.characters');
  });

  it('5. 老数据无 id 仍按名字回落；名字有歧义时不瞎猜', () => {
    const pid = makeProjectId('legacy');
    // 直接写 project 绕过 setArtifact，模拟历史数据（没有任何 characterId）
    const project = store.getProject(pid)!;
    project.stageArtifacts = {
      narrative_design: {
        characters: [
          { name: '特工阿诺', appearance: '刀疤脸', gender: '男', age: 35 },
          { name: '阿诺尔德', appearance: '金发', gender: '男', age: 50 },
        ],
        characterNames: ['特工阿诺', '阿诺尔德'],
      },
    } as any;
    store.saveProject(project);

    const legacy = store.getProject(pid)!;
    assert.equal(findCharacterFacts(legacy, '特工阿诺')?.age, 35, '精确同名必须能查到');
    assert.equal(
      findCharacterFacts(legacy, '阿诺'),
      undefined,
      '「阿诺」同时被两个角色包含，猜一个等于埋雷'
    );

    // 唯一包含匹配仍然可用：角色名常带前缀（特工X / X先生）
    assert.equal(findCharacterFacts(legacy, '诺尔')?.age, 50, '只有一个候选时按包含匹配回落');

    // 补身份后，同名歧义也能消除
    const bible = legacy.stageArtifacts!.narrative_design;
    ensureBibleCharacterIds(bible);
    assert.ok(bible.characters.every((c: any) => c.characterId));
  });

  it('分镜镜头登记出镜角色：姓名解析成稳定 id，改名不断链', () => {
    const bible = {
      characters: [
        { name: '李明', characterId: 'char_liming' },
        { name: '李明的妻子', characterId: 'char_wife' },
      ],
    };
    const storyboard = {
      shots: [
        { shotId: 'shot_1', nodeId: 'node_1', characterNames: ['李明'] },
        { shotId: 'shot_2', nodeId: 'node_1', characterNames: [] }, // 纯环境空镜
        { shotId: 'shot_3', nodeId: 'node_2', characterNames: ['李明', '李明的妻子', '李明'] },
      ],
    };

    assert.equal(syncShotCharacterIds(bible, storyboard), 3);
    assert.deepEqual(storyboard.shots[0].characterIds, ['char_liming']);
    assert.deepEqual(storyboard.shots[1].characterIds, [], '空镜必须保持空数组，不能填成节点角色');
    assert.deepEqual(storyboard.shots[2].characterIds, ['char_liming', 'char_wife'], '重复姓名去重');

    // 幂等：再次同步不重写
    assert.equal(syncShotCharacterIds(bible, storyboard), 0);
  });

  it('分镜未登记 characterNames 时不臆造 id（宁可降级到节点级）', () => {
    const bible = { characters: [{ name: '李明', characterId: 'char_liming' }] };
    const storyboard = { shots: [{ shotId: 'shot_1', nodeId: 'node_1' }] };
    assert.equal(syncShotCharacterIds(bible, storyboard), 0);
    assert.equal(storyboard.shots[0].characterIds, undefined, '缺字段不能拿节点角色兜底，否则影响面会漏算');
  });

  it('解析不到 id 的姓名保留原名，断链比丢失更糟', () => {
    const bible = { characters: [{ name: '李明', characterId: 'char_liming' }] };
    const storyboard = { shots: [{ shotId: 'shot_1', nodeId: 'node_1', characterNames: ['李明', '路人甲'] }] };
    syncShotCharacterIds(bible, storyboard);
    assert.deepEqual(storyboard.shots[0].characterIds, ['char_liming', '路人甲']);
  });
});
