/**
 * scripts/diag-text-game-codegen.ts
 * 阶段二后两段自检：技术规划（模型）→ 按依赖拓扑多轮编码（模型）→ 静态体检
 *
 * 用法：
 *   npx tsx scripts/diag-text-game-codegen.ts [projectId]
 *   npx tsx scripts/diag-text-game-codegen.ts [projectId] --plan-only   # 只跑规划，不写代码
 *
 * 复用已落盘的分幕产物（scenes/lookdev.json + 剧本），不重跑策划与生图。
 */

process.env.LLM_CALL_TIMEOUT_MS = process.env.DIAG_TIMEOUT_MS || '600000';

const projectId = process.argv[2] || 'proj_mwd8sl42_azk1';
const planOnly = process.argv.includes('--plan-only');

async function main() {
  const fs = await import('fs');
  const path = await import('path');
  const { config } = await import('../src/utils/config.js');
  const { loadPlannerDeliverables } = await import('../src/workflows/steps/build-text-game.step.js');
  const { ProjectStore } = await import('../src/project-store/ProjectStore.js');
  const { executeSceneAssemblyStep } = await import('../src/agents/text-game/steps/scene-assembly/index.js');
  const { executeTechPlanStep } = await import('../src/agents/text-game/steps/tech-plan/index.js');
  const { executeCodegenStep } = await import('../src/agents/text-game/steps/codegen/index.js');

  const { prd, storyMarkdown, title } = loadPlannerDeliverables(projectId);
  const projectDir = ProjectStore.getInstance().getProjectDir(projectId);
  const lookdevPath = path.resolve(projectDir, 'scenes/lookdev.json');
  const lookdev = JSON.parse(fs.readFileSync(lookdevPath, 'utf-8'));
  console.log(`[S2+] 项目=${projectId} 标题=《${title}》 model=${config.llm.model}`);

  const assembly = await executeSceneAssemblyStep({ projectId, title, prd, storyMarkdown, lookdev });
  console.log(`[S2+] 分幕 ${assembly.scenes.length} 幕：${assembly.scenes.map((s: any) => s.sceneId).join(',')}`);

  // ---------- 技术规划 ----------
  const t1 = Date.now();
  const plan = await executeTechPlanStep({
    title,
    prd,
    scenes: assembly.scenes,
    script: assembly.script,
    artStyle: lookdev.artStyle || '',
  });
  console.log(`[S2+] ✅ 规划 ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  console.log(`[S2+] 架构：${plan.architectureSummary}`);
  for (const f of plan.files) {
    console.log(`  · ${f.fileName}（${f.kind}）← ${f.dependencies.join(',') || '无'}｜${f.responsibility}`);
    for (const s of f.symbols) {
      console.log(`      ${s.kind} ${s.name}${s.methods.length ? `：${s.methods.map((m) => m.name).join('/')}` : ''}`);
    }
  }
  if (planOnly) process.exit(0);

  // ---------- 编码 ----------
  const t2 = Date.now();
  const code = await executeCodegenStep({
    projectId,
    title,
    prd,
    techPlan: plan,
    scenes: assembly.scenes,
    script: assembly.script,
  });
  console.log(`[S2+] ✅ 编码 ${((Date.now() - t2) / 1000).toFixed(1)}s / ${code.rounds} 轮`);
  for (const f of code.generatedFiles) {
    const full = path.resolve(projectDir, f);
    const lines = fs.existsSync(full) ? fs.readFileSync(full, 'utf-8').split('\n').length : -1;
    console.log(`  · ${f}（${lines} 行）`);
  }

  // ---------- 入口与静态体检 ----------
  const indexPath = path.resolve(projectDir, code.indexPath);
  if (!fs.existsSync(indexPath)) {
    throw new Error(`未生成可玩入口：${code.indexPath}`);
  }
  console.log(`[S2+] ✅ 可玩入口：${code.indexPath}`);

  const problems: string[] = [];
  const jsDir = path.resolve(projectDir, 'text-game/js');
  const jsFiles = fs.existsSync(jsDir) ? fs.readdirSync(jsDir).filter((f) => f.endsWith('.js')) : [];
  if (!jsFiles.includes('main.js')) problems.push('缺少 js/main.js');
  if (!fs.existsSync(path.resolve(projectDir, 'text-game/style.css'))) problems.push('缺少 style.css');

  for (const f of jsFiles) {
    const src = fs.readFileSync(path.resolve(jsDir, f), 'utf-8');
    if (/\bTODO\b|待补充|其余同上/.test(src)) problems.push(`${f} 含 TODO/占位`);
    if (/<img[^>]+src=["']\.\/?assets\//.test(src)) problems.push(`${f} 引用了未生成的图片资源`);
    if (/\binterface\s+\w+|:\s*(string|number|boolean)\b/.test(src)) problems.push(`${f} 残留 TypeScript 类型标注`);
    for (const m of src.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)) {
      if (!fs.existsSync(path.resolve(jsDir, m[1]))) problems.push(`${f} import 了不存在的 ./${m[1]}`);
    }
  }

  const mainSrc = fs.existsSync(path.resolve(jsDir, 'main.js'))
    ? fs.readFileSync(path.resolve(jsDir, 'main.js'), 'utf-8')
    : '';
  if (!/getElementById\(['"]app['"]\)|querySelector/.test(mainSrc)) {
    problems.push('main.js 没有挂载 #app');
  }
  const cssPath = path.resolve(projectDir, 'text-game/style.css');
  const cssSize = fs.existsSync(cssPath) ? fs.statSync(cssPath).size : 0;

  console.log(
    `[S2+] 产物：js ${jsFiles.length} 个 / style.css ${(cssSize / 1024).toFixed(1)}KB / ${
      jsFiles.join(',')
    }`
  );
  console.log(problems.length ? `[S2+] ⚠️ 体检问题：\n  - ${problems.join('\n  - ')}` : '[S2+] ✅ 静态体检通过');
  process.exit(0);
}

main().catch((err) => {
  console.error(`[S2+] ❌ 失败: ${err?.name || ''} ${err?.message || err}`);
  if (err?.cause) console.error(`[S2+] cause: ${String(err.cause?.message || err.cause)}`);
  process.exit(1);
});
