/**
 * scripts/test-modify-source.ts
 * 修改源头裁决器回归测试（确定性沙盒，不依赖任何真实项目）
 *
 * 核心不变量（每一条都对应一次线上事故或一次可预见的误判）：
 * 1. 源头由「改哪一类属性」决定，不由「改谁」决定：
 *    同一个张明，年龄在故事圣经、台词在分场剧本、发型在定妆照。
 * 2. 「显得/看起来」这类观感副词是视觉诉求，不能被年龄词劫持。
 * 3. 「符合剧情氛围」这类修饰语不是设定事实，不能把画面诉求拽回文本轨。
 * 4. 目标工序未落盘时按显式上游链降级，绝不跳到角色定妆。
 * 5. 未落盘的媒体工序永不被选中；无任何文本产物时返回 no-source。
 */
import { resolveModifySource } from '../src/agents/director/modifier/source-resolver.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { MemoryProjectStateStore } from '../src/project-store/MemoryProjectStateStore.js';
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

const store = new MemoryProjectStateStore();
ProjectStore.setInstance(store);

const PID = 'proj_scratch_modify_source';
const FULL = 'proj_scratch_full';

function seed(projectId: string, artifacts: Record<string, any>) {
  const now = new Date().toISOString();
  store.saveProject({
    projectId,
    title: '深海回响',
    description: '探针工程',
    status: 'idle',
    currentStage: WorkflowStage.KEYFRAME_REFERENCE,
    stageArtifacts: artifacts,
    createdAt: now,
    updatedAt: now,
  } as any);
}

const bible = {
  title: '深海回响',
  style: '冷调悬疑',
  characters: [
    { name: '张明', role: '男主角' },
    { name: '李娜', role: '女主角' },
  ],
  goldenSpine: [{ name: '起因' }, { name: '对抗' }],
  storyGraph: { rootNodeId: 'node_1', nodes: [{ id: 'node_1', title: '失踪' }] },
};
const script = {
  totalScenes: 2,
  scenes: [
    { sceneId: 'scene_1', sceneTitle: '码头', dialogues: [{ speaker: '张明', text: '你好' }] },
    { sceneId: 'scene_2', sceneTitle: '船舱', dialogues: [{ speaker: '张明', text: '走' }] },
  ],
};
const board = { shots: [{ shotId: 'shot_1', shotScale: '特写', durationSec: 3 }] };
const portrait = { portraits: [{ characterName: '张明', imagePath: '/tmp/zm.png' }] };
const keyframe = { frames: [{ shotId: 'shot_1', imagePath: '/tmp/s1.png' }] };

// 全量工程：文本三件套 + 定妆 + 关键帧都已落盘
seed(FULL, {
  [WorkflowStage.NARRATIVE_DESIGN]: bible,
  [WorkflowStage.SCENE_SCRIPT]: script,
  [WorkflowStage.STORYBOARD]: board,
  [WorkflowStage.CHARACTER_DESIGN]: portrait,
  [WorkflowStage.KEYFRAME_REFERENCE]: keyframe,
});

/* ── 1. 属性定位：同一个实体，属性不同，源头不同 ── */
console.log('\n[1] 同一实体「张明」，四类属性四种源头');
{
  const cases: Array<[string, string, string, string]> = [
    ['张明的年龄改成 25 岁', 'story-bible', 'setting', '设定事实 → 故事圣经'],
    ['把张明在第二场的台词改得凶狠一点', 'scene-script', 'dialogue', '台词 → 分场剧本'],
    ['这个镜头构图再紧一点', 'storyboard', 'shot', '镜头语言 → 视听分镜'],
    ['这张定妆照的发型换成银色寸头', 'character-portrait', 'media', '带指示词「这张」→ 只改这一版画面'],
    ['定妆照的发型换成银色寸头', 'story-bible', 'appearance', '外观属角色事实 → 故事圣经（不带指示词）'],
    ['男一的形象换一下，换成短发', 'story-bible', 'appearance', '形象/发型是 appearance，不是画面呈现'],
    ['这张定妆照的光影调暗一点，别改设定', 'character-portrait', 'visual', '光影是这一张的呈现 → 媒体轨'],
  ];
  for (const [content, expect, attr, label] of cases) {
    const p = resolveModifySource(FULL, {
      target: content.includes('镜头') ? 'shot_1' : '张明',
      content,
      currentStage: WorkflowStage.KEYFRAME_REFERENCE,
    });
    check(`${label}（${expect}）`, p.sourceSkill === expect, `${p.sourceSkill} / ${p.attribute}`);
    check(`  属性标记正确`, p.attribute === attr, p.attribute);
  }
}

/* ── 2. 观感副词不得被年龄词劫持 ── */
console.log('\n[2] 「显得年轻」是视觉诉求');
{
  const p = resolveModifySource(FULL, {
    target: '张明',
    content: '这张定妆图让他显得年轻一点，光影柔和些',
    currentStage: WorkflowStage.CHARACTER_DESIGN,
    skillHint: 'character-portrait',
  });
  check('不被「年轻」劫持到故事圣经', p.sourceSkill === 'character-portrait', p.sourceSkill);
  check('依据 media-asset', p.basis === 'media-asset', p.basis);
}

/* ── 3. 修饰语「符合剧情氛围」不是设定事实 ── */
console.log('\n[3] 画面诉求里的「剧情」只是修饰语');
{
  const p = resolveModifySource(FULL, {
    target: '',
    content: '这张关键帧的光影调暗一点，符合剧情氛围',
    currentStage: WorkflowStage.KEYFRAME_REFERENCE,
  });
  check('走关键帧媒体轨', p.sourceSkill === 'keyframe-reference', p.sourceSkill);
}

/* ── 4. 场景锚点属于剧本，不是设定 ── */
console.log('\n[4] 「第 3 场的背景改成雨夜」');
{
  const p = resolveModifySource(FULL, {
    target: '第3场',
    content: '把第3场的背景改成雨夜',
    currentStage: WorkflowStage.SCENE_SCRIPT,
  });
  check('场景描述 → 分场剧本', p.sourceSkill === 'scene-script', p.sourceSkill);
}

/* ── 5. 剧情走向仍是设定事实 ── */
console.log('\n[5] 「把结局改成大团圆」');
{
  const p = resolveModifySource(FULL, {
    target: '',
    content: '把结局改成大团圆',
    currentStage: WorkflowStage.VIDEO_PRODUCTION,
  });
  check('结局 → 故事圣经', p.sourceSkill === 'story-bible', p.sourceSkill);
  check('cascade 含全部已落盘下游', p.cascadeStages.length === 4, p.cascadeStages);
  check(
    'cascade 按阶段位序升序',
    p.cascadeStages.every((s, i) => i === 0 || ['narrative_design', 'character_design', 'scene_script', 'storyboard', 'keyframe_reference', 'video_production', 'fmv_packaging'].indexOf(s) > ['narrative_design', 'character_design', 'scene_script', 'storyboard', 'keyframe_reference', 'video_production', 'fmv_packaging'].indexOf(p.cascadeStages[i - 1])),
    p.cascadeStages
  );
}

/* ── 6. 降级链：目标未落盘时只能改上游文本 ── */
console.log('\n[6] 剧本未落盘时改台词 → 降级到故事圣经，不得跳去定妆');
{
  seed(PID, {
    [WorkflowStage.NARRATIVE_DESIGN]: bible,
    [WorkflowStage.CHARACTER_DESIGN]: portrait,
  });
  const p = resolveModifySource(PID, {
    target: '张明',
    content: '把张明在第二场的台词改得凶狠一点',
    currentStage: WorkflowStage.CHARACTER_DESIGN,
  });
  check('降级到 story-bible', p.sourceSkill === 'story-bible', p.sourceSkill);
  check('不降级到 character-portrait', p.sourceSkill !== 'character-portrait', p.sourceSkill);
  check('原因里说明了降级', p.reason.includes('上游'), p.reason);
}

/* ── 7. 未落盘的媒体工序永不被选中 ── */
console.log('\n[7] 视频未落盘时不得选中 video-production');
{
  const p = resolveModifySource(FULL, {
    target: '',
    content: '这段视频节奏太慢了，重新剪一下',
    currentStage: WorkflowStage.KEYFRAME_REFERENCE,
    skillHint: 'video-production',
  });
  check('不选 video-production', p.sourceSkill !== 'video-production', p.sourceSkill);
}

/* ── 8. 外观属于事实：即使定妆已落盘，也必须回源头改（只改画面下次会被打回） ── */
console.log('\n[8] 定妆已落盘时改外观 → 仍回故事圣经 appearance');
{
  seed(PID, {
    [WorkflowStage.NARRATIVE_DESIGN]: bible,
    [WorkflowStage.STORYBOARD]: board,
    [WorkflowStage.CHARACTER_DESIGN]: portrait,
  });
  const p = resolveModifySource(PID, {
    target: '张明',
    content: '男一的形象换一下，换成短发',
    currentStage: WorkflowStage.STORYBOARD,
  });
  check('回 story-bible 改角色外观描述', p.sourceSkill === 'story-bible', p.sourceSkill);
  check('属性标记为 appearance', p.attribute === 'appearance', p.attribute);
  check(
    '定妆被列为待失效下游',
    p.cascadeStages.includes(WorkflowStage.CHARACTER_DESIGN),
    p.cascadeStages.join(',')
  );
}

/* ── 9. 无任何产物 → no-source ── */
console.log('\n[9] 空项目');
{
  const p = resolveModifySource('proj_not_exists_for_test', {
    target: '张明',
    content: '把他改年轻一点',
    currentStage: WorkflowStage.NARRATIVE_DESIGN,
  });
  check('返回 no-source', p.basis === 'no-source', p.basis);
  check('不产生 cascade', p.cascadeStages.length === 0, p.cascadeStages);
}

/* ── 10. WHO 兜底：属性说不清时按实体所在产物定位 ── */
console.log('\n[10] 属性不明时的实体定位');
{
  const p = resolveModifySource(FULL, {
    target: 'scene_2',
    content: '第二段再改改',
    currentStage: WorkflowStage.SCENE_SCRIPT,
  });
  check('定位到分场剧本', p.sourceSkill === 'scene-script', `${p.sourceSkill} / ${p.basis}`);
}

console.log(`\n总计 ${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
