/**
 * scripts/test-modify-source.ts
 * 修改源头裁决器回归测试。
 *
 * 核心不变量：
 * 1. 设定事实（年龄/身份/剧情）永远从文本源头改，即使模型把工序猜成图像轨；
 * 2. 未落盘的媒体工序绝不能被选为修改目标；
 * 3. 源头确定后，下游已落盘阶段必须被算进 cascade（改完源头 → 下游失效重推）；
 * 4. 没有任何文本产物时返回 no-source，由调用方降级为生成提案。
 */
import { resolveModifySource } from '../src/agents/director/modifier/source-resolver.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { WorkflowStage } from '../src/types/index.js';

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

const store = ProjectStore.getInstance();
const all = store.listProjects();
const project = all.find((p) => p.projectId === 'proj_1794101350967_b9al');
const arts = (project?.stageArtifacts || {}) as Record<string, any>;
const hasBible = Boolean(arts[WorkflowStage.NARRATIVE_DESIGN]);
const hasPortrait = Boolean(arts[WorkflowStage.CHARACTER_DESIGN]);

console.log(`样本项目: ${project?.projectId || '未找到'}`);
console.log(`已落盘: story-bible=${hasBible} character-portrait=${hasPortrait}`);
if (!project || !hasBible) {
  console.log('\n⚠️ 真实样本不可用，跳过依赖黑板的断言');
}

/* 1. 线上故障复现：「男一太老了吧」 */
if (project && hasBible) {
  console.log('\n[1] 线上案例「男一太老了吧」（模型把工序猜成 character-portrait）');
  const plan = resolveModifySource(project.projectId, {
    target: '张明',
    content: '将男主角张明的年龄改为更年轻',
    currentStage: WorkflowStage.CHARACTER_DESIGN,
    skillHint: 'character-portrait',
  });
  check('裁决到事实源头 story-bible', plan.sourceSkill === 'story-bible', plan.sourceSkill);
  check('依据是文本源', plan.basis === 'text-source', plan.basis);
  check('模型 hint 未劫持裁决', plan.sourceSkill !== 'character-portrait');

  /* 2. 泛称 target（黑板里没有「男主」这个实体，靠属性关键词兜底） */
  console.log('\n[2] 泛称「男主太老了」');
  const plan2 = resolveModifySource(project.projectId, {
    target: '男主',
    content: '男主太老了吧',
    currentStage: WorkflowStage.CHARACTER_DESIGN,
    skillHint: 'character-portrait',
  });
  check('仍归事实源头 story-bible', plan2.sourceSkill === 'story-bible', plan2.sourceSkill);
  check('依据 text-source', plan2.basis === 'text-source', plan2.basis);

  /* 3. cascade：源头之后已落盘的阶段 */
  console.log('\n[3] 下游失效范围');
  check(
    'cascade 包含已落盘的角色定妆',
    plan.cascadeStages.includes(WorkflowStage.CHARACTER_DESIGN) === hasPortrait,
    plan.cascadeStages
  );
  check(
    'cascade 按阶段位序排列',
    plan.cascadeStages.every(
      (s, i) =>
        i === 0 ||
        ['narrative_design', 'character_design', 'scene_script', 'storyboard', 'keyframe_reference', 'video_production', 'fmv_packaging'].indexOf(s) >
          ['narrative_design', 'character_design', 'scene_script', 'storyboard', 'keyframe_reference', 'video_production', 'fmv_packaging'].indexOf(plan.cascadeStages[i - 1])
    ),
    plan.cascadeStages
  );

  /* 4. 纯视觉样式 + 已落盘媒体 → 允许走媒体轨 */
  if (hasPortrait) {
    console.log('\n[4] 纯视觉样式（无实体名，明确指向定妆）');
    const plan3 = resolveModifySource(project.projectId, {
      target: '',
      content: '定妆照的配色换成冷蓝调，发型再利落一些',
      currentStage: WorkflowStage.CHARACTER_DESIGN,
      skillHint: 'character-portrait',
    });
    check('走媒体轨 character-portrait', plan3.sourceSkill === 'character-portrait', plan3.sourceSkill);
    check('依据 media-asset', plan3.basis === 'media-asset', plan3.basis);
  }

  /* 5. 未落盘媒体不得被选中 */
  console.log('\n[5] 未落盘的媒体工序不得被选中');
  const plan4 = resolveModifySource(project.projectId, {
    target: '',
    content: '这段视频节奏太慢了，重新剪一下',
    currentStage: WorkflowStage.CHARACTER_DESIGN,
    skillHint: 'video-production',
  });
  check('video-production 未落盘 → 不选它', plan4.sourceSkill !== 'video-production', plan4.sourceSkill);
}

/* 6. 无任何产物 → no-source */
console.log('\n[6] 空项目');
{
  const plan = resolveModifySource('proj_not_exists_for_test', {
    target: '张明',
    content: '把他改年轻一点',
    currentStage: WorkflowStage.NARRATIVE_DESIGN,
    skillHint: undefined,
  });
  check('返回 no-source', plan.basis === 'no-source', plan.basis);
  check('不产生 cascade', plan.cascadeStages.length === 0, plan.cascadeStages);
}

console.log(`\n总计 ${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
