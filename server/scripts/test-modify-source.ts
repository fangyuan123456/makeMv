/**
 * scripts/test-modify-source.ts
 * 修改源头裁决器回归测试（确定性沙盒，不依赖任何真实项目）
 *
 * 核心不变量（每一条都对应一次线上事故或一次可预见的误判）：
 * 1. 源头由「改哪一类属性」决定，不由「改谁」决定：
 *    同一个张明，年龄在故事圣经、台词在分场剧本、发型在定妆照。
 * 2. 「显得/看起来」这类观感副词是视觉诉求，不能被年龄词劫持；
 *    单独出现时也必须成立（旧实现里 look 只在 setting 同时命中时才被使用）。
 * 3. 「符合剧情氛围」这类修饰语不是设定事实，不能把画面诉求拽回文本轨。
 * 4. 媒体名词（定妆照/形象照/关键帧）要先遮蔽再判外观：
 *    「形象照有点糊」是画面瑕疵，不是角色形象设定。
 * 5. 目标工序未落盘时按显式上游链降级，绝不跳到角色定妆。
 * 6. 未落盘的媒体工序永不被选中；无任何文本产物时返回 no-source。
 * 7. 词表漏收（unknown）时补判一次类别，但补判失败/超时/低置信度必须回落原逻辑。
 */
// 脚本必须确定性：关闭默认模型补判，补判行为只在 [11] 里用注入桩验证
process.env.MODIFY_LLM_CLASSIFY = '0';

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
const FULLV = 'proj_scratch_full_video';

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
const video = { clips: [{ shotId: 'shot_1', videoPath: '/tmp/s1.mp4' }] };

// 全量工程：文本三件套 + 定妆 + 关键帧都已落盘（不含视频，用于验证「未落盘不得选中」）
seed(FULL, {
  [WorkflowStage.NARRATIVE_DESIGN]: bible,
  [WorkflowStage.SCENE_SCRIPT]: script,
  [WorkflowStage.STORYBOARD]: board,
  [WorkflowStage.CHARACTER_DESIGN]: portrait,
  [WorkflowStage.KEYFRAME_REFERENCE]: keyframe,
});

// 含视频的工程：只用于 8 场景命中率表（视频轨诉求要能真的落到视频轨）
seed(FULLV, {
  [WorkflowStage.NARRATIVE_DESIGN]: bible,
  [WorkflowStage.SCENE_SCRIPT]: script,
  [WorkflowStage.STORYBOARD]: board,
  [WorkflowStage.CHARACTER_DESIGN]: portrait,
  [WorkflowStage.KEYFRAME_REFERENCE]: keyframe,
  [WorkflowStage.VIDEO_PRODUCTION]: video,
});

async function main() {
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
      const p = await resolveModifySource(FULL, {
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
    const p = await resolveModifySource(FULL, {
      target: '张明',
      content: '这张定妆图让他显得年轻一点，光影柔和些',
      currentStage: WorkflowStage.CHARACTER_DESIGN,
      skillHint: 'character-portrait',
    });
    check('不被「年轻」劫持到故事圣经', p.sourceSkill === 'character-portrait', p.sourceSkill);
    check('依据 media-asset', p.basis === 'media-asset', p.basis);
  }

  /* ── 2.1 观感副词单独出现也必须成立（旧实现里 look 是死变量） ── */
  console.log('\n[2.1] 只有观感副词、没有画面词');
  {
    const p = await resolveModifySource(FULL, {
      target: '张明',
      content: '她看起来太老了',
      currentStage: WorkflowStage.CHARACTER_DESIGN,
    });
    check('判为画面呈现（visual）而不是 unknown', p.attribute === 'visual', p.attribute);
    check('走定妆媒体轨', p.sourceSkill === 'character-portrait', p.sourceSkill);
  }

  /* ── 3. 修饰语「符合剧情氛围」不是设定事实 ── */
  console.log('\n[3] 画面诉求里的「剧情」只是修饰语');
  {
    const p = await resolveModifySource(FULL, {
      target: '',
      content: '这张关键帧的光影调暗一点，符合剧情氛围',
      currentStage: WorkflowStage.KEYFRAME_REFERENCE,
    });
    check('走关键帧媒体轨', p.sourceSkill === 'keyframe-reference', p.sourceSkill);
  }

  /* ── 4. 场景锚点属于剧本，不是设定 ── */
  console.log('\n[4] 「第 3 场的背景改成雨夜」');
  {
    const p = await resolveModifySource(FULL, {
      target: '第3场',
      content: '把第3场的背景改成雨夜',
      currentStage: WorkflowStage.SCENE_SCRIPT,
    });
    check('场景描述 → 分场剧本', p.sourceSkill === 'scene-script', p.sourceSkill);
  }

  /* ── 5. 剧情走向仍是设定事实 ── */
  console.log('\n[5] 「把结局改成大团圆」');
  {
    const p = await resolveModifySource(FULL, {
      target: '',
      content: '把结局改成大团圆',
      currentStage: WorkflowStage.VIDEO_PRODUCTION,
    });
    check('结局 → 故事圣经', p.sourceSkill === 'story-bible', p.sourceSkill);
    check('cascade 含全部已落盘下游', p.cascadeStages.length === 4, p.cascadeStages);
    const seq = [
      'narrative_design',
      'character_design',
      'scene_script',
      'storyboard',
      'keyframe_reference',
      'video_production',
      'fmv_packaging',
    ];
    check(
      'cascade 按阶段位序升序',
      p.cascadeStages.every((s, i) => i === 0 || seq.indexOf(s) > seq.indexOf(p.cascadeStages[i - 1])),
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
    const p = await resolveModifySource(PID, {
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
    const p = await resolveModifySource(FULL, {
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
    const p = await resolveModifySource(PID, {
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

  /* ── 8.1 媒体名词遮蔽：形象照有瑕疵说的是这张图，不是角色形象设定 ── */
  console.log('\n[8.1] 「形象照有点糊」→ 媒体轨，不回故事圣经');
  {
    const p = await resolveModifySource(FULL, {
      target: '张明',
      content: '形象照有点糊，重出一张',
      currentStage: WorkflowStage.CHARACTER_DESIGN,
    });
    check('不判成 appearance', p.attribute !== 'appearance', p.attribute);
    check('落定妆媒体轨', p.sourceSkill === 'character-portrait', `${p.sourceSkill} / ${p.attribute}`);
  }

  /* ── 9. 无任何产物 → no-source ── */
  console.log('\n[9] 空项目');
  {
    const p = await resolveModifySource('proj_not_exists_for_test', {
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
    const p = await resolveModifySource(FULL, {
      target: 'scene_2',
      content: '第二段再改改',
      currentStage: WorkflowStage.SCENE_SCRIPT,
      classify: null,
    });
    check('定位到分场剧本', p.sourceSkill === 'scene-script', `${p.sourceSkill} / ${p.basis}`);
  }

  /* ── 11. unknown 补判：模型只能补类别，不能改判据 ── */
  console.log('\n[11] 词表漏收时的模型补判');
  {
    const unknownLine = '把他弄得沧桑一点'; // 词表全不命中：无设定/外观/台词/镜头/画面词
    const base = await resolveModifySource(FULL, {
      target: '',
      content: unknownLine,
      currentStage: WorkflowStage.KEYFRAME_REFERENCE,
      classify: null,
    });
    check('禁用补判 → 回落当前工作面', base.sourceSkill === 'keyframe-reference', base.sourceSkill);
    check('禁用补判 → 属性仍是 unknown', base.attribute === 'unknown', base.attribute);

    const guessed = await resolveModifySource(FULL, {
      target: '张明',
      content: unknownLine,
      currentStage: WorkflowStage.KEYFRAME_REFERENCE,
      classify: async () => ({ attribute: 'appearance', confidence: 0.86 }),
    });
    check('补判 appearance → 回故事圣经', guessed.sourceSkill === 'story-bible', guessed.sourceSkill);
    check('属性标记为 appearance', guessed.attribute === 'appearance', guessed.attribute);
    check('说明里标注了模型补判', guessed.reason.includes('模型补判'), guessed.reason);

    const lowConf = await resolveModifySource(FULL, {
      target: '',
      content: unknownLine,
      currentStage: WorkflowStage.KEYFRAME_REFERENCE,
      classify: async () => ({ attribute: 'appearance', confidence: 0.2 }),
    });
    check('低置信度不采信 → 回落当前工作面', lowConf.sourceSkill === 'keyframe-reference', lowConf.sourceSkill);

    const broken = await resolveModifySource(FULL, {
      target: '',
      content: unknownLine,
      currentStage: WorkflowStage.KEYFRAME_REFERENCE,
      classify: async () => {
        throw new Error('模型超时');
      },
    });
    check('补判抛错不影响裁决 → 回落当前工作面', broken.sourceSkill === 'keyframe-reference', broken.sourceSkill);

    const nulled = await resolveModifySource(FULL, {
      target: '',
      content: unknownLine,
      currentStage: WorkflowStage.KEYFRAME_REFERENCE,
      classify: async () => undefined as any,
    });
    check('补判无结果 → 回落当前工作面', nulled.sourceSkill === 'keyframe-reference', nulled.sourceSkill);
  }

  /* ── 12. 8 个真实场景命中率（规则 + 补判，补判用注入桩，不联网） ── */
  console.log('\n[12] 8 个历史场景命中率');
  {
    const scenarios: Array<{ line: string; target: string; stage: WorkflowStage; expect: string }> = [
      { line: '张明的年龄改成 45 岁', target: '张明', stage: WorkflowStage.CHARACTER_DESIGN, expect: 'story-bible' },
      { line: '张明的发型换成寸头', target: '张明', stage: WorkflowStage.CHARACTER_DESIGN, expect: 'story-bible' },
      { line: '第二场张明的台词再狠一点', target: '张明', stage: WorkflowStage.SCENE_SCRIPT, expect: 'scene-script' },
      { line: '这个镜头改成中景，运镜慢推', target: 'shot_1', stage: WorkflowStage.STORYBOARD, expect: 'storyboard' },
      { line: '这张定妆照的光影再柔一点', target: '张明', stage: WorkflowStage.CHARACTER_DESIGN, expect: 'character-portrait' },
      { line: '她看起来太老了，调年轻点', target: '张明', stage: WorkflowStage.CHARACTER_DESIGN, expect: 'character-portrait' },
      { line: '形象照有点糊，重出一张', target: '张明', stage: WorkflowStage.CHARACTER_DESIGN, expect: 'character-portrait' },
      { line: '剪辑节奏再快一点，紧凑些', target: '', stage: WorkflowStage.VIDEO_PRODUCTION, expect: 'video-production' },
    ];
    let hit = 0;
    const rows: string[] = [];
    for (const s of scenarios) {
      const p = await resolveModifySource(FULLV, {
        target: s.target,
        content: s.line,
        currentStage: s.stage,
        classify: null,
      });
      const ok = p.sourceSkill === s.expect;
      if (ok) hit++;
      rows.push(
        `  ${ok ? '✅' : '❌'} ${s.line.padEnd(24, ' ')} 期望 ${s.expect.padEnd(18, ' ')} 实际 ${p.sourceSkill}（${p.attribute}）`
      );
    }
    rows.forEach((r) => console.log(r));
    check(`规则档命中 ${hit}/8`, hit === 8, `${hit}/8`);
  }

  console.log(`\n总计 ${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
