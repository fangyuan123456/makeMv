import path from 'path';
import fs from 'fs';
import { executeBundlerStep } from '../src/agents/text-game/steps/bundler/step.js';
import { getInteractiveShellCode } from '../src/agents/text-game/steps/codegen/index.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';

async function main() {
  const projectId = 'proj_mwc28koq_xddv';
  const title = '深渊号：最后的伦理官';

  console.log(`[sync-project-bundle] 正在为项目 ${projectId} 同步 1280x720 横屏影游运行包...`);

  // 1. 同步 InteractiveShell.ts 源码
  const store = ProjectStore.getInstance();
  const projectDir = store.getProjectDir(projectId);
  const srcPath = path.resolve(projectDir, 'text-game', 'src', 'InteractiveShell.ts');
  if (fs.existsSync(srcPath)) {
    fs.writeFileSync(srcPath, getInteractiveShellCode(), 'utf-8');
    console.log(`[sync-project-bundle] InteractiveShell.ts 已同步更新`);
  }

  // 2. 重新打包 bundle.js 与 index.html
  const res = await executeBundlerStep({
    projectId,
    title,
    startNodeId: 'S1',
    initialState: {},
  });

  console.log(`[sync-project-bundle] 打包完成:`, res);
}

main().catch((err) => {
  console.error('[sync-project-bundle] 异常:', err);
  process.exit(1);
});
