/**
 * 存量回填：为历史项目的角色补稳定身份 characterId。
 *
 * 背景：角色名此前同时充当显示名和跨产物外键，改名即断链、同名即串味。
 * 写入层现在会自动补 id（见 agents/director/character-identity.ts），但已经落盘的
 * 老项目不会自己长出 id——定妆条目在没有 id 时只能按名字关联，一旦改名就查不到事实。
 *
 * 用法：
 *   npx tsx scripts/backfill-character-ids.ts <projectId> [--dry]
 *   npx tsx scripts/backfill-character-ids.ts --all [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureBibleCharacterIds,
  syncPortraitCharacterIds,
} from '../src/agents/director/character-identity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(__dirname, '../data/projects');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const all = args.includes('--all');
const projectId = args.find((a) => !a.startsWith('--'));

if (!all && !projectId) {
  console.error('用法: npx tsx scripts/backfill-character-ids.ts <projectId|--all> [--dry]');
  process.exit(1);
}

interface Stat {
  projects: number;
  bibleIds: number;
  portraitIds: number;
}

const total: Stat = { projects: 0, bibleIds: 0, portraitIds: 0 };

function writeWithBackup(file: string, json: any): void {
  const backup = `${file}.bak_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(file, backup);
  fs.writeFileSync(file, JSON.stringify(json, null, 2), 'utf8');
}

function processProject(dir: string): void {
  const projectFile = path.join(dir, 'project.json');
  if (!fs.existsSync(projectFile)) return;

  let project: any;
  try {
    project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
  } catch {
    console.warn(`  ! 解析失败，跳过: ${projectFile}`);
    return;
  }

  const arts = project?.stageArtifacts || {};
  const bible = arts.narrative_design;
  const portrait = arts.character_design;

  const bibleAdded = bible ? ensureBibleCharacterIds(bible) : 0;
  const portraitTouched = portrait ? syncPortraitCharacterIds(bible, portrait) : 0;

  // narrative/story_bible.json 是故事圣经的导出副本，身份也要同步，否则两边漂移
  const bibleFile = path.join(dir, 'narrative', 'story_bible.json');
  let bibleFileChanged = false;
  let discBible: any;
  if (fs.existsSync(bibleFile)) {
    try {
      discBible = JSON.parse(fs.readFileSync(bibleFile, 'utf8'));
      const added = ensureBibleCharacterIds(discBible);
      if (added > 0) {
        bibleFileChanged = true;
        if (!bibleAdded) total.bibleIds += added;
      }
    } catch {
      console.warn(`  ! 解析失败，跳过: ${bibleFile}`);
    }
  }

  if (!bibleAdded && !portraitTouched && !bibleFileChanged) {
    console.log(`  - ${path.basename(dir)}: 已是完整身份，跳过`);
    return;
  }

  total.projects++;
  total.bibleIds += bibleAdded;
  total.portraitIds += portraitTouched;
  console.log(
    `  ✓ ${path.basename(dir)}: 故事圣经补 id ${bibleAdded}，定妆继承 ${portraitTouched}` +
      (bibleFileChanged ? '，导出副本已同步' : '')
  );
  if (dryRun) return;

  if (bibleAdded || portraitTouched) writeWithBackup(projectFile, project);
  if (bibleFileChanged) writeWithBackup(bibleFile, discBible);
}

console.log(`回填角色稳定身份${dryRun ? '（dry-run）' : ''}`);

if (all) {
  const dirs = fs
    .readdirSync(DATA_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(DATA_ROOT, d.name));
  for (const dir of dirs) processProject(dir);
} else {
  const dir = path.join(DATA_ROOT, projectId!);
  if (!fs.existsSync(dir)) {
    console.error(`项目目录不存在: ${dir}`);
    process.exit(1);
  }
  processProject(dir);
}

console.log(
  `完成：处理项目 ${total.projects} 个，补故事圣经 id ${total.bibleIds} 个，` +
    `定妆继承 ${total.portraitIds} 个` +
    (total.projects === 0 ? '（无需回填）' : '')
);
