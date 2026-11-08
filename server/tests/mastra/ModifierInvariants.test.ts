/**
 * tests/mastra/ModifierInvariants.test.ts
 * 修改轨语义不变量校验的回归测试。
 *
 * 这里固化的是真实事故：
 * 「把主角性别改为女性」执行成功、JSON 合法、任务 succeeded，
 * 但六个角色全变女性、妻子角色仍悬空存在、儿子变成女儿。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blockingIssues,
  checkArtifactInvariants,
  summarizeIssues,
  type InvariantFile,
} from '../../src/agents/director/modifier/invariants.js';

function bible(overrides: Record<string, any> = {}) {
  return {
    title: '暗涌',
    characters: [
      { name: '李明', role: '男主角', gender: '男', age: 38 },
      { name: '李明的妻子', role: '女主角', gender: '女', age: 36 },
      { name: '李明的儿子', role: '关键角色', gender: '男', age: 10 },
    ],
    characterNames: ['李明', '李明的妻子', '李明的儿子'],
    storyGraph: {
      nodes: [
        { id: 'n1', title: '开场', characterNames: ['李明', '李明的妻子'], choices: [] },
        { id: 'n2', title: '抉择', characterNames: ['李明'], choices: [] },
      ],
    },
    ...overrides,
  };
}

function files(parts: { bible?: any; script?: any; board?: any }): InvariantFile[] {
  const list: InvariantFile[] = [];
  if (parts.bible) list.push({ key: 'story-bible', title: '故事圣经', artifact: parts.bible });
  if (parts.script) list.push({ key: 'scene-script', title: '分场剧本', artifact: parts.script });
  if (parts.board) list.push({ key: 'storyboard', title: '视听分镜', artifact: parts.board });
  return list;
}

test('干净数据：不产生任何问题', () => {
  const issues = checkArtifactInvariants(files({ bible: bible() }), {
    strictKeys: ['story-bible'],
  });
  assert.deepEqual(issues, []);
});

test('事故复现：性别改成女但 role 仍是男主角 → 阻断', () => {
  const broken = bible({
    characters: [
      { name: '李明', role: '男主角', gender: '女', age: 38 },
      { name: '李明的妻子', role: '女主角', gender: '女', age: 36 },
      { name: '李明的儿子', role: '关键角色', gender: '男', age: 10 },
    ],
  });
  const issues = checkArtifactInvariants(files({ bible: broken }), {
    strictKeys: ['story-bible'],
  });
  const blocker = blockingIssues(issues).find((i) => i.code === 'role-gender-conflict');
  assert.ok(blocker, '必须报出角色定位与性别矛盾');
  assert.match(blocker!.message, /男主角/);
  assert.match(summarizeIssues(issues), /自相矛盾/);
});

test('事故复现：儿子被改成女性 → 改动文件内升级为阻断', () => {
  const broken = bible({
    characters: [
      { name: '李明', role: '男主角', gender: '女', age: 38 },
      { name: '李明的妻子', role: '女主角', gender: '女', age: 36 },
      { name: '李明的儿子', role: '关键角色', gender: '女', age: 10 },
    ],
  });
  const issues = checkArtifactInvariants(files({ bible: broken }), {
    strictKeys: ['story-bible'],
  });
  assert.ok(
    issues.some((i) => i.code === 'title-gender-conflict' && i.level === 'error'),
    '儿子变女必须在改动文件内阻断'
  );
});

test('历史遗留：基线里同样存在的冲突只报警告', () => {
  const broken = bible({
    characters: [
      { name: '李明', role: '男主角', gender: '女', age: 38 },
      { name: '李明的妻子', role: '女主角', gender: '女', age: 36 },
      { name: '李明的儿子', role: '关键角色', gender: '女', age: 10 },
    ],
  });
  const issues = checkArtifactInvariants(files({ bible: broken }), {
    strictKeys: ['story-bible'],
    baselineFiles: files({ bible: broken }),
  });
  assert.equal(blockingIssues(issues).length, 0, '历史脏数据不得阻断本次修改');
  assert.ok(issues.length > 0 && issues.every((i) => i.level === 'warning'));
});

test('基线干净、改完变脏 → 阻断', () => {
  const clean = bible();
  const broken = bible({
    characters: [
      { name: '李明', role: '男主角', gender: '女', age: 38 },
      { name: '李明的妻子', role: '女主角', gender: '女', age: 36 },
      { name: '李明的儿子', role: '关键角色', gender: '男', age: 10 },
    ],
  });
  const issues = checkArtifactInvariants(files({ bible: broken }), {
    strictKeys: ['story-bible'],
    baselineFiles: files({ bible: clean }),
  });
  assert.equal(blockingIssues(issues).length, 1, '本次新引入的矛盾必须阻断');
  assert.equal(blockingIssues(issues)[0].code, 'role-gender-conflict');
});

test('删除角色但没清理引用 → 悬空引用阻断', () => {
  const pruned = bible({
    characters: [{ name: '李明', role: '男主角', gender: '男', age: 38 }],
  });
  const issues = checkArtifactInvariants(files({ bible: pruned }), {
    strictKeys: ['story-bible'],
  });
  const dangling = issues.filter((i) => i.code === 'dangling-character-ref');
  assert.ok(dangling.length >= 3, `索引与两个节点都应报悬空，实际 ${dangling.length} 条`);
  assert.ok(dangling.every((i) => i.level === 'error'));
});

test('剧本说话人不在角色表 → 阻断', () => {
  const script = {
    scenes: [
      {
        nodeId: 'n1',
        sceneTitle: '雨夜归家',
        dialogues: [
          { speaker: '李明', text: '我回来了。' },
          { speaker: '李明的妻子', text: '你身上有血。' },
          { speaker: '旁白', text: '雨声渐密。' },
        ],
      },
    ],
  };
  const ok = checkArtifactInvariants(files({ bible: bible(), script }), {
    strictKeys: ['scene-script'],
  });
  assert.equal(blockingIssues(ok).length, 0, '旁白必须被放行');

  const bad = checkArtifactInvariants(
    files({
      bible: bible(),
      script: {
        scenes: [
          {
            nodeId: 'n1',
            sceneTitle: '雨夜归家',
            dialogues: [{ speaker: '神秘人', text: '别回头。' }],
          },
        ],
      },
    }),
    { strictKeys: ['scene-script'] }
  );
  assert.ok(blockingIssues(bad).some((i) => i.code === 'dangling-speaker'));
});

test('分镜挂靠的剧情节点已不存在 → 阻断', () => {
  const board = {
    shots: [{ shotId: 's1', nodeId: 'n3', characterNames: ['李明'] }],
  };
  const issues = checkArtifactInvariants(files({ bible: bible(), board }), {
    strictKeys: ['storyboard'],
  });
  assert.ok(blockingIssues(issues).some((i) => i.code === 'dangling-node-ref'));
});

test('脏基线上做无关修改：不被自己的旧数据阻断', () => {
  // proj_1794129711028_9gjm 的真实状态：六个角色的 gender 全被刷成「女」
  const dirty = bible({
    characters: [
      { name: '李明', role: '男主角', gender: '女', age: 38, personality: '勇敢' },
      { name: '李明的妻子', role: '女主角', gender: '女', age: 36, personality: '坚韧' },
      { name: '李明的儿子', role: '关键角色', gender: '女', age: 10, personality: '敏感' },
      { name: '秘密组织成员', role: '反派', gender: '女', age: 30, personality: '冷酷' },
      { name: '警方特工', role: '支持角色', gender: '女', age: 35, personality: '干练' },
      { name: '秘密组织首领', role: '反派BOSS', gender: '女', age: 50, personality: '阴沉' },
    ],
    characterNames: [
      '李明',
      '李明的妻子',
      '李明的儿子',
      '秘密组织成员',
      '警方特工',
      '秘密组织首领',
    ],
  });
  const baselineFiles = files({ bible: dirty });

  // 本次只把「警方特工」的性格改了一处，没有触碰性别与定位
  const after = files({
    bible: {
      ...dirty,
      characters: dirty.characters.map((c: any, i: number) =>
        i === 4 ? { ...c, personality: '更为克制' } : c
      ),
    },
  });

  const issues = checkArtifactInvariants(after, {
    strictKeys: ['story-bible'],
    baselineFiles,
  });
  assert.equal(
    blockingIssues(issues).length,
    0,
    '历史脏数据不得阻断无关修改，否则这个项目再也改不动'
  );
  assert.ok(issues.length > 0, '旧冲突仍应作为提示存在');
});

test('没有故事圣经时直接放行，不误报', () => {
  const issues = checkArtifactInvariants(
    files({ board: { shots: [{ shotId: 's1', characterNames: ['李明'] }] } }),
    { strictKeys: ['storyboard'] }
  );
  assert.deepEqual(issues, []);
});
