/**
 * scripts/run-stage2-real.ts
 * 对既有真实项目单跑阶段二（文游扩写 + Pi 直出 game.html）
 *
 * 用法：npx tsx scripts/run-stage2-real.ts <projectId>
 */

import fs from 'fs';
import path from 'path';
import { executeBuildTextGameStep } from '../src/workflows/steps/build-text-game.step.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { STAGE, PLANNER_STEP, getArtifactFilePath } from '../src/project-store/artifact-fs.js';

const projectId = process.argv[2];
if (!projectId) {
  console.error('用法: npx tsx scripts/run-stage2-real.ts <projectId>');
  process.exit(1);
}

async function main() {
  const store = ProjectStore.getInstance();
  const projectDir = store.getProjectDir(projectId);
  const prdPath = getArtifactFilePath(projectId, 'delivery', STAGE.planner, PLANNER_STEP.prd, 'prd.md');

  if (!fs.existsSync(prdPath) && !store.getArtifact(projectId, 'gdd')) {
    throw new Error(`项目 ${projectId} 缺少 PRD 交付文档`);
  }

  console.log(`[Stage2] 项目: ${projectId}`);
  console.log(`[Stage2] 模型: ${process.env.LLM_MODEL || '(未设置)'} @ ${process.env.LLM_BASE_URL || '(未设置)'}`);
  const t0 = Date.now();

  const out = await executeBuildTextGameStep({ projectId });
  const elapsed = Math.round((Date.now() - t0) / 1000);

  const htmlPath = path.join(projectDir, 'text-game', 'index.html');
  const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf-8') : '';

  console.log(`\n[Stage2] 完成，耗时 ${elapsed}s`);
  console.log(`  《${out.textGame.title}》 节点数: ${out.textGame.nodes.length}`);
  console.log(`  index.html: ${html.length} 字节`);
  console.log(`  节点覆盖: ${out.textGame.nodes.filter((n) => html.includes(n.id)).length}/${out.textGame.nodes.length}`);
  console.log(`  产物目录: ${projectDir}`);
  console.log(`  中间产物: ${path.join(projectDir, '.debug', STAGE.textGame)}`);
}

main().catch((err) => {
  console.error('[Stage2] 失败:', err);
  process.exit(1);
});
