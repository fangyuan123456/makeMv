/**
 * scripts/diag-text-game-stage2.ts
 * 阶段二端到端自检：母本段（角色 / 道具 / 场景出图）→ 分幕装配（纯代码）
 *
 * 用法：
 *   npx tsx scripts/diag-text-game-stage2.ts [projectId]
 *   npx tsx scripts/diag-text-game-stage2.ts [projectId] --skip-lookdev   # 复用已落盘母本，只验装配
 *   npx tsx scripts/diag-text-game-stage2.ts [projectId] --extract-only   # 只跑提取（不调生图）
 *
 * 复用项目已落盘的 planner 交付物（prd.md + story.md），不重跑策划案。
 */

process.env.LLM_CALL_TIMEOUT_MS = process.env.DIAG_TIMEOUT_MS || '600000';

const projectId = process.argv[2] || 'proj_mwd8sl42_azk1';
const skipLookdev = process.argv.includes('--skip-lookdev');
const extractOnly = process.argv.includes('--extract-only');

async function main() {
  const fs = await import('fs');
  const path = await import('path');
  const { config } = await import('../src/utils/config.js');
  const { loadPlannerDeliverables } = await import('../src/workflows/steps/build-text-game.step.js');
  const { runLookdevWorkflow } = await import('../src/agents/text-game/text-game.workflow.js');
  const { executeSceneAssemblyStep } = await import(
    '../src/agents/text-game/steps/scene-assembly/index.js'
  );
  const { ProjectStore } = await import('../src/project-store/ProjectStore.js');

  const { prd, storyMarkdown, title } = loadPlannerDeliverables(projectId);
  const projectDir = ProjectStore.getInstance().getProjectDir(projectId);
  console.log(`[S2] 项目=${projectId} 标题=《${title}》 story=${storyMarkdown.length}字`);

  // ---------- 母本段 ----------
  let entities: any;
  if (extractOnly) {
    // 只验提取（零生图成本）：换题材跑一遍，看它会不会被提示词里的例子带偏
    const { executeLookdevExtractStep } = await import(
      '../src/agents/text-game/steps/lookdev-extract/index.js'
    );
    const t = Date.now();
    const out = await executeLookdevExtractStep({ projectId, title, prd, storyMarkdown });
    entities = out.entities;
    console.log(`[S2] ✅ 仅提取 ${((Date.now() - t) / 1000).toFixed(1)}s（未生图）`);
    console.log(`[S2] artStyle: ${entities.artStyle}`);
    for (const c of entities.characters || []) {
      console.log(`  · 角色 ${c.characterId}｜${c.name}｜${c.identity}`);
    }
    for (const it of entities.items || []) {
      console.log(`  · 道具 ${it.itemId}｜${it.name}`);
    }
    for (const loc of entities.locations || []) {
      console.log(`  · 场景 ${loc.locationId}｜${loc.name}｜覆盖 ${(loc.sceneIds || []).join(',') || '（空）'}`);
    }
    const covered = new Set<string>();
    for (const loc of entities.locations || []) for (const id of loc.sceneIds || []) covered.add(id);
    const uncovered = prd.clips.map((c: any) => c.id).filter((id: string) => !covered.has(id));
    console.log(`[S2] 未归属任何场景的剧幕：${uncovered.length ? uncovered.join('、') : '无'}`);
    process.exit(0);
  }

  if (skipLookdev) {
    const p = path.resolve(projectDir, 'scenes/lookdev.json');
    entities = JSON.parse(fs.readFileSync(p, 'utf-8'));
    console.log(`[S2] 复用已落盘母本：${p}`);
  } else {
    console.log(`[S2] model=${config.llm.model} frame=${config.frame.imageSize}`);
    const t = Date.now();
    const out = await runLookdevWorkflow({
      projectId,
      title,
      prd,
      storyMarkdown,
      concurrency: 4,
      force: false,
    });
    entities = out.entities;
    console.log(
      `[S2] ✅ 母本段 ${((Date.now() - t) / 1000).toFixed(1)}s：` +
        `${entities.characters.length} 角色 / ${entities.items.length} 道具 / ${entities.locations?.length || 0} 场景，` +
        `图 新绘 ${out.renderedCount} / 复用 ${out.reusedCount} / 失败 ${out.failedCount}`
    );
  }

  console.log(`[S2] artStyle: ${entities.artStyle}`);
  for (const loc of entities.locations || []) {
    console.log(
      `  · 场景 ${loc.locationId}｜${loc.name}｜覆盖 ${(loc.sceneIds || []).join(',') || '（空）'}`
    );
    console.log(`      图：${loc.referenceImageUrl || '（未生成）'}`);
    console.log(`      ${(loc.promptZh || '').slice(0, 80)}...`);
  }

  // 覆盖检查：PRD 每一条 clip 都必须归属某个场景
  const covered = new Set<string>();
  for (const loc of entities.locations || []) for (const id of loc.sceneIds || []) covered.add(id);
  const uncovered = prd.clips.map((c: any) => c.id).filter((id: string) => !covered.has(id));
  console.log(`[S2] 未归属任何场景的剧幕：${uncovered.length ? uncovered.join('、') : '无'}`);

  // ---------- 装配段（纯代码，零模型） ----------
  const t2 = Date.now();
  const assembly = await executeSceneAssemblyStep({
    projectId,
    title,
    prd,
    storyMarkdown,
    lookdev: entities,
  });
  console.log(`[S2] ✅ 装配段 ${((Date.now() - t2) / 1000).toFixed(1)}s：${assembly.summary}`);

  const logicMap = new Map(assembly.script.scenes.map((x) => [x.sceneId, x]));
  for (const s of assembly.scenes) {
    const l = logicMap.get(s.sceneId);
    const flow = (l?.choices || []).length
      ? `岔口 ${l!.choices.map((c) => `${c.text}→${c.to}`).join(' / ')}`
      : l?.ending
        ? `终局 ${l.ending.type || '-'}`
        : `→ ${l?.next || '?'}`;
    console.log(
      `  · ${s.sceneId.padEnd(6)} ${(s.title || '').padEnd(14)} ${String(s.text.length).padStart(4)}字 ` +
        `背景${s.background ? '有' : '缺'} 介入${l?.interaction?.kind || '-'} ${flow}`
    );
  }

  const emptyBody = assembly.scenes.filter((s) => !s.text.trim());
  console.log(
    `[S2] 空正文：${emptyBody.length ? emptyBody.map((s) => s.sceneId).join('、') : '无'}`
  );

  process.exit(0);
}

main().catch((err) => {
  console.error(`[S2] ❌ 失败: ${err?.name || ''} ${err?.message || err}`);
  if (err?.cause) console.error(`[S2] cause: ${String(err.cause?.message || err.cause)}`);
  process.exit(1);
});
