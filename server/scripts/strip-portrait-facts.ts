/**
 * 存量数据清理：剔除定妆产物里重复的角色事实字段。
 *
 * 背景：character_design.characters[] 过去整份复制了故事圣经的角色属性
 * (role/gender/age/appearance/personality/motivation)，导致同一事实存两份，
 * 改源头（故事圣经）时下游那份不跟随，也无法分辨哪份是定义、哪份是派生。
 *
 * 现在定妆产物只保留视觉派生结果，事实改为读取期按 name 从故事圣经现查
 * (agents/director/character-facts.ts)。本脚本清理历史项目里已写入的重复字段，
 * 清理前后行为完全等价（API 展示层会自动合并事实）。
 *
 * 用法：
 *   npx tsx scripts/strip-portrait-facts.ts --all [--dry]
 *   npx tsx scripts/strip-portrait-facts.ts <projectId> [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(__dirname, '../data/projects');

/** 定妆条目里禁止再出现的重复事实字段 */
const DUPLICATED_FACT_KEYS = [
  'role',
  'gender',
  'age',
  'appearance',
  'appearancePrompt',
  'personality',
  'motivation',
  'arc',
];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const all = args.includes('--all');
const projectId = args.find((a) => !a.startsWith('--'));

if (!all && !projectId) {
  console.error('用法: npx tsx scripts/strip-portrait-facts.ts <projectId> | --all [--dry]');
  process.exit(1);
}

const targets = all
  ? fs
      .readdirSync(DATA_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  : [projectId!];

let totalRemoved = 0;
let touchedProjects = 0;

for (const pid of targets) {
  const file = path.join(DATA_ROOT, pid, 'project.json');
  if (!fs.existsSync(file)) continue;

  let json: any;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    console.warn(`  ! 解析失败，跳过 ${pid}`);
    continue;
  }

  const portrait = json?.stageArtifacts?.character_design;
  const characters = portrait?.characters;
  if (!Array.isArray(characters) || characters.length === 0) continue;

  let removed = 0;
  const kept: string[] = [];
  for (const c of characters) {
    if (!c || typeof c !== 'object') continue;
    for (const key of DUPLICATED_FACT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(c, key)) {
        delete c[key];
        removed++;
        if (!kept.includes(key)) kept.push(key);
      }
    }
  }

  if (removed === 0) continue;

  totalRemoved += removed;
  touchedProjects++;
  console.log(
    `${dryRun ? '~ [dry]' : '✓'} ${pid}: 移除 ${removed} 个重复字段 (${kept.join(', ')})，${characters.length} 个角色`
  );

  if (dryRun) continue;

  const backup = `${file}.bak_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(file, backup);
  fs.writeFileSync(file, JSON.stringify(json, null, 2), 'utf8');

  // 定妆产物另有独立物理落盘副本（characters/character_sheets.json），一并清理
  const sheetsFile = path.join(DATA_ROOT, pid, 'characters', 'character_sheets.json');
  if (fs.existsSync(sheetsFile)) {
    try {
      const sheets = JSON.parse(fs.readFileSync(sheetsFile, 'utf8'));
      if (Array.isArray(sheets?.characters)) {
        for (const c of sheets.characters) {
          for (const key of DUPLICATED_FACT_KEYS) delete c?.[key];
        }
        fs.copyFileSync(sheetsFile, `${sheetsFile}.bak_${new Date().toISOString().replace(/[:.]/g, '-')}`);
        fs.writeFileSync(sheetsFile, JSON.stringify(sheets, null, 2), 'utf8');
      }
    } catch {
      console.warn(`  ! character_sheets.json 处理失败（非致命）: ${pid}`);
    }
  }
}

console.log(
  `\n完成：${touchedProjects} 个项目、共移除 ${totalRemoved} 个重复字段` +
    (totalRemoved === 0 ? '（数据本就干净）' : dryRun ? '（dry-run，未写盘）' : '')
);
