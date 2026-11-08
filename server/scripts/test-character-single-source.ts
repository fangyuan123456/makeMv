/**
 * scripts/test-character-single-source.ts
 * 「角色事实唯一来源」契约回归测试（确定性沙盒 + Mock 渲染，不依赖真实项目/真实上游）
 *
 * 保护的不变量：
 * 1. 定妆条目只持有视觉派生结果，绝不持有 role/gender/age/appearance/personality/motivation；
 * 2. 角色事实只从故事圣经读取，改名/改年龄只需改一处，读取期自动生效；
 * 3. 展示层投影（hydrate）补齐事实，但存储层保持干净，杜绝「写回即复活冗余」；
 * 4. 质检裁剪后的定妆快照不再重复喂一遍角色事实（事实已在叙事条目不重）；
 * 5. 真实生成入口 renderFreshCharacter 落盘的对象不含任何事实字段。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { MemoryProjectStateStore } from '../src/project-store/MemoryProjectStateStore.js';
import { WorkflowStage } from '../src/types/index.js';
import {
  readCharacterFacts,
  findCharacterFacts,
  withCharacterFacts,
  hydrateCharacterArtifact,
  hydratePortraitArtifact,
  CHARACTER_FACTS_SOURCE,
} from '../src/agents/director/character-facts.js';
import { CharacterSheetItemSchema } from '../src/agents/director/generator/steps/character-portrait/schema.js';
import { renderFreshCharacter } from '../src/agents/director/generator/steps/character-portrait/generator.js';
import { pruneAssetForAudit } from '../src/agents/director/generator/steps/critic-review/prompt.js';

const FACT_KEYS = ['role', 'gender', 'age', 'appearance', 'personality', 'motivation'];

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: any) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}`, extra ?? '');
  }
}

const store = new MemoryProjectStateStore();
ProjectStore.setInstance(store);

const PID = 'proj_scratch_single_source';
const now = new Date().toISOString();

store.saveProject({
  projectId: PID,
  title: '深海回响',
  description: '角色事实唯一来源探针',
  status: 'idle',
  currentStage: WorkflowStage.CHARACTER_DESIGN,
  stageArtifacts: {
    narrative_design: {
      title: '深海回响',
      style: '冷调写实',
      characters: [
        {
          name: '张明',
          role: '男主角',
          gender: '男',
          age: 45,
          appearance: '短发，眼角有细纹',
          personality: '冷静克制',
          motivation: '找到失踪的搭档',
        },
        {
          name: '李娜',
          role: '女主角',
          gender: '女',
          age: 29,
          appearance: '齐肩黑发',
          personality: '锋利',
          motivation: '揭开真相',
        },
      ],
    } as any,
    character_design: {
      characters: [
        {
          name: '张明',
          visualPrompt: '45岁中年男子，短发，冷调侧光特写',
          imageUrl: '/media/proj_scratch_single_source/characters/zm.jpg',
          history: [],
          useReference: true,
        },
      ],
      totalCharacters: 2,
      completedCharacters: 1,
      style: '冷调写实',
      createdAt: now,
    } as any,
  },
  createdAt: now,
  updatedAt: now,
} as any);

const project = store.getProject(PID);

console.log('场景 1：定妆产物不再持有角色事实');
{
  const artifact: any = project!.stageArtifacts.character_design;
  const leaked = FACT_KEYS.filter((k) => k in artifact.characters[0]);
  check('存储层定妆条目无任何事实字段', leaked.length === 0, leaked);

  const schemaKeys = Object.keys((CharacterSheetItemSchema as any).shape);
  const schemaLeak = FACT_KEYS.filter((k) => schemaKeys.includes(k));
  check('Schema 契约层不再声明事实字段', schemaLeak.length === 0, schemaLeak);
  check(
    'Schema 仍保留视觉与版本字段',
    ['name', 'visualPrompt', 'imageUrl', 'history'].every((k) => schemaKeys.includes(k))
  );

  // 即使上游误传事实字段，也不允许被接受（zod 默认剥离未知键）
  const parsed: any = CharacterSheetItemSchema.parse({
    name: '张明',
    visualPrompt: 'p',
    role: '男主角',
    age: 45,
    appearance: '短发',
  });
  const parsedLeak = FACT_KEYS.filter((k) => k in parsed);
  check('误传的事实字段被契约剥离', parsedLeak.length === 0, parsedLeak);
}

console.log('场景 2：事实统一从故事圣经读取');
{
  const facts = readCharacterFacts(project);
  check('读取到 2 位角色事实', facts.length === 2, facts.length);
  const zhang = findCharacterFacts(project, '张明');
  check('按名精确命中', zhang?.age === 45 && zhang?.role === '男主角');
  const fuzzy = findCharacterFacts(project, ' 张 明 ');
  check('容忍空白差异', fuzzy?.name === '张明');
  check('未知角色返回 undefined', findCharacterFacts(project, '不存在的人') === undefined);
}

console.log('场景 3：读取期投影合并事实，视觉字段以条目为准');
{
  const sheet: any = project!.stageArtifacts.character_design.characters[0];
  const view: any = withCharacterFacts(project, sheet);
  check('投影补齐年龄/身份', view.age === 45 && view.role === '男主角');
  check('视觉字段未被事实覆盖', view.visualPrompt === sheet.visualPrompt);
  check('投影标注事实来源', view.factsFrom === CHARACTER_FACTS_SOURCE);

  const hydrated: any = hydratePortraitArtifact(project);
  check('产物级投影为每个角色补齐事实', hydrated.characters[0].personality === '冷静克制');
  check('存储层仍无事实字段（投影不回写）', !('age' in (project!.stageArtifacts.character_design as any).characters[0]));

  const single = hydrateCharacterArtifact(project, project!.stageArtifacts.character_design as any);
  check('单产物投影与产物级投影一致', single?.characters[0].role === '男主角');
}

console.log('场景 4：改设定只改一处，读取期自动跟随（消灭双份事实）');
{
  // 4.1 改年龄：只写故事圣经一处，定妆产物不动，读取期立即生效
  const bible: any = JSON.parse(JSON.stringify(project!.stageArtifacts.narrative_design));
  bible.characters[0].age = 28;
  store.setArtifact(PID, WorkflowStage.NARRATIVE_DESIGN, bible);

  const p2 = store.getProject(PID);
  const hydrated: any = hydratePortraitArtifact(p2);
  check('年龄改动立刻生效', hydrated.characters[0].age === 28);
  check(
    '定妆产物未因设定变更被改写',
    (p2!.stageArtifacts.character_design as any).characters[0].name === '张明'
  );

  // 4.2 改名：角色名是关联键，改名必须同步引用（只同步键，不复制事实）
  store.repairArtifact(PID, WorkflowStage.NARRATIVE_DESIGN, {
    type: 'RENAME_CHARACTER',
    payload: { oldName: '张明', newName: '张明远' },
  });
  const p3 = store.getProject(PID);
  const hydrated3: any = hydratePortraitArtifact(p3);
  check('改名后仍能合并到角色事实', hydrated3.characters[0].name === '张明远' && hydrated3.characters[0].role === '男主角', hydrated3.characters[0]);
  const portrait3: any = (p3!.stageArtifacts.character_design as any).characters[0];
  check('改名后定妆条目仍未复制事实字段', FACT_KEYS.every((k) => !(k in portrait3)), Object.keys(portrait3));

  // 复位，避免影响后续场景
  store.repairArtifact(PID, WorkflowStage.NARRATIVE_DESIGN, {
    type: 'RENAME_CHARACTER',
    payload: { oldName: '张明远', newName: '张明' },
  });
}

console.log('场景 5：质检快照不再重复喂角色事实');
{
  const pruned: any = pruneAssetForAudit('character_design', project!.stageArtifacts.character_design);
  const leak = FACT_KEYS.filter((k) => k in (pruned.characters?.[0] || {}));
  check('定妆快照不含事实字段', leak.length === 0, leak);
  check('定妆快照仍含视觉提示词与渲染状态', Boolean(pruned.characters[0].visualPrompt) && pruned.characters[0].isRendered === true);
}

console.log('场景 6：真实生成入口落盘对象不含事实字段');
{
  const rendered: any = await renderFreshCharacter(
    PID,
    { name: '王五', role: '反派', age: 52, appearance: '刀疤脸', personality: '阴狠', motivation: '复仇' },
    '52岁刀疤脸男子，冷调特写',
    { isMock: true }
  );
  const leak = FACT_KEYS.filter((k) => k in rendered);
  check('renderFreshCharacter 输出无事实字段', leak.length === 0, leak);
  check('渲染结果仍携带视觉提示词与图片 URL', Boolean(rendered.visualPrompt && rendered.imageUrl));
}

// 清理 Mock 渲染产生的物理文件
try {
  const dir = store.getProjectDir(PID);
  if (dir && fs.existsSync(path.join(dir, 'characters'))) {
    fs.rmSync(path.join(dir, 'characters'), { recursive: true, force: true });
  }
} catch {
  /* 清理失败不影响断言结论 */
}

console.log(`\n结果: ${pass} 过, ${fail} 挂`);
process.exit(fail > 0 ? 1 : 0);
