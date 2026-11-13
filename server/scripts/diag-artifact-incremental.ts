/**
 * scripts/diag-artifact-incremental.ts
 * 验证阶段二 debug 镜像的增量落盘语义：
 * - 只跑完 lookdev-extract 时，只应出现 01-lookdev-extract/lookdev.md；
 * - 补上 lookdev-render 后追加 02-lookdev-render/lookdev.md；
 * - 不应产出 scenes.md / tech_plan.md 等空壳文件；
 * - 后续补上 scene-assembly 后，能继续追加 03-scene-assembly 的镜像。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const sandbox = path.join(os.tmpdir(), `diag-artifacts-${Date.now()}`);
process.env.PROJECTS_DIR = sandbox;

function listDebug(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, prefix = '') => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), rel);
      else out.push(rel);
    }
  };
  walk(dir);
  return out.sort();
}

const entities = {
  artStyle: '测试画风',
  characters: [{ characterId: 'char_a', name: '甲', identity: '主角', appearanceSummary: '短描述', promptZh: '提示词' }],
  items: [],
  locations: [{ locationId: 'loc_test', name: '测试场景', atmosphere: '冷光', appearanceSummary: '布局', promptZh: '空镜', sceneIds: ['S1'] }],
};

const extractOutput = { entities };
const renderOutput = {
  entities: {
    ...entities,
    characters: entities.characters.map((c) => ({ ...c, referenceImageUrl: '/media/p/assets/entities/char_a.png' })),
    locations: entities.locations.map((l) => ({ ...l, referenceImageUrl: '/media/p/assets/locations/loc_test.png' })),
  },
  renderedCount: 2,
  reusedCount: 0,
  failedCount: 0,
};

const assemblyOutput = {
  summary: '测试分幕',
  scenes: [
    {
      sceneId: 'S1',
      level: 1,
      title: '第一幕',
      location: { locationId: 'loc_test', name: '测试场景' },
      text: { body: '剧情' },
      interaction: { choices: [] },
    },
  ],
};

async function main() {
  const { persistTextGameArtifacts } = await import(
    '../src/agents/text-game/text-game.workflow.js'
  );

  const projectId = 'diag_incremental';
  const projectDir = path.join(sandbox, projectId);
  fs.mkdirSync(projectDir, { recursive: true });
  const debugDir = path.join(projectDir, '.debug', '02-text-game');

  // 第一轮：只有提取成功
  persistTextGameArtifacts(projectId, '增量测试剧', {
    'lookdev-extract-step': { status: 'success', output: extractOutput },
    'lookdev-render-step': { status: 'running' },
    'scene-assembly-step': { status: 'running' },
  } as any);
  const after1 = listDebug(debugDir);
  console.log('[Diag] 第一轮（仅 lookdev-extract 完成）:', JSON.stringify(after1));
  const pass1 = JSON.stringify(after1) === JSON.stringify(['01-lookdev-extract/lookdev.md']);

  // 第二轮：出图也完成
  persistTextGameArtifacts(projectId, '增量测试剧', {
    'lookdev-extract-step': { status: 'success', output: extractOutput },
    'lookdev-render-step': { status: 'success', output: renderOutput },
    'scene-assembly-step': { status: 'running' },
  } as any);
  const after2 = listDebug(debugDir);
  console.log('[Diag] 第二轮（追加 lookdev-render）:', JSON.stringify(after2));
  const pass2 =
    after2.includes('01-lookdev-extract/lookdev.md') && after2.includes('02-lookdev-render/lookdev.md');

  // 第三轮：scene-assembly 也完成
  persistTextGameArtifacts(projectId, '增量测试剧', {
    'lookdev-extract-step': { status: 'success', output: extractOutput },
    'lookdev-render-step': { status: 'success', output: renderOutput },
    'scene-assembly-step': { status: 'success', output: assemblyOutput },
  } as any);
  const after3 = listDebug(debugDir);
  console.log('[Diag] 第三轮（追加 scene-assembly）:', JSON.stringify(after3));
  const pass3 =
    after3.includes('03-scene-assembly/scenes.md') && after3.includes('03-scene-assembly/S1.md');

  console.log(
    pass1 && pass2 && pass3
      ? '[Diag] ✅ 通过：按工序增量落盘，且未完成工序不产生空壳文件'
      : `[Diag] ❌ 失败：pass1=${pass1} pass2=${pass2} pass3=${pass3}`
  );
  fs.rmSync(sandbox, { recursive: true, force: true });
  process.exit(pass1 && pass2 && pass3 ? 0 : 1);
}

void main().catch((err) => {
  console.error('[Diag] 异常:', err);
  fs.rmSync(sandbox, { recursive: true, force: true });
  process.exit(1);
});
