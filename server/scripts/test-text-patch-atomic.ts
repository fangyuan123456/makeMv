// 文本轨多文件原子提交冒烟：验证「要么全写、要么全不写」
// 纯函数级验证，不触达大模型
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { applyJsonStringPatchesAtomic } = await import('../src/utils/universal-patch.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-atomic-'));

function seed(name: string, obj: any) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf-8');
  return p;
}
function read(p: string) {
  return fs.readFileSync(p, 'utf-8');
}

const A = seed('a.json', { title: '故事圣经', hero: { name: '李娜', age: 28 } });
const B = seed('b.json', { title: '分场剧本', line: '李娜今年 28 岁' });
const A0 = read(A);
const B0 = read(B);

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${extra ? ' → ' + extra : ''}`);
  }
}

console.log('\n[1] 双文件全命中：应两份都落盘');
{
  const res = applyJsonStringPatchesAtomic([
    { fileName: 'a.json', filePath: A, patches: [{ search: '"age": 28', replace: '"age": 45' }] },
    { fileName: 'b.json', filePath: B, patches: [{ search: '28 岁', replace: '45 岁' }] },
  ]);
  check('success=true', res.success, res.error);
  check('落盘文件数=2', res.files.length === 2, String(res.files.length));
  const a = JSON.parse(read(A));
  const b = JSON.parse(read(B));
  check('a.hero.age=45', a.hero.age === 45, String(a.hero.age));
  check('b.line 已同步', String(b.line).includes('45 岁'), b.line);
}

console.log('\n[2] 其中一份 search 不命中：整体失败，两份都不许变');
{
  const aBefore = read(A);
  const bBefore = read(B);
  const res = applyJsonStringPatchesAtomic([
    { fileName: 'a.json', filePath: A, patches: [{ search: '"age": 45', replace: '"age": 30' }] },
    { fileName: 'b.json', filePath: B, patches: [{ search: '不存在的句子', replace: 'x' }] },
  ]);
  check('success=false', res.success === false);
  check('错误里点名 b.json', String(res.error).includes('b.json'), res.error);
  check('a.json 字节未变（未半写）', read(A) === aBefore);
  check('b.json 字节未变', read(B) === bBefore);
}

console.log('\n[3] 补丁破坏 JSON 语法：整体拦截，两份都不许变');
{
  const aBefore = read(A);
  const bBefore = read(B);
  const res = applyJsonStringPatchesAtomic([
    { fileName: 'a.json', filePath: A, patches: [{ search: '"age": 45', replace: '"age": 45,,,' }] },
    { fileName: 'b.json', filePath: B, patches: [{ search: '45 岁', replace: '60 岁' }] },
  ]);
  check('success=false', res.success === false);
  check('错误里点名 a.json', String(res.error).includes('a.json'), res.error);
  check('a.json 字节未变', read(A) === aBefore);
  check('b.json 字节未变（合法补丁也不写）', read(B) === bBefore);
}

console.log('\n[4] 目标文件缺失：整体失败');
{
  const res = applyJsonStringPatchesAtomic([
    { fileName: 'missing.json', filePath: path.join(dir, 'missing.json'), patches: [{ search: 'x', replace: 'y' }] },
  ]);
  check('success=false', res.success === false);
  check('错误提示文件不存在', String(res.error).includes('不存在'), res.error);
}

console.log('\n[5] 空补丁组：不落盘且明确失败');
{
  const res = applyJsonStringPatchesAtomic([{ fileName: 'a.json', filePath: A, patches: [] }]);
  check('success=false', res.success === false);
}

// 还原「未涉及字段 100% 物理稳定」：a.json 除 age 外应逐字节保持
console.log('\n[6] 未涉及字段稳定性');
{
  const a = JSON.parse(read(A));
  check('title 未漂移', a.title === '故事圣经', a.title);
  check('hero.name 未漂移', a.hero.name === '李娜', a.hero.name);
  check('键顺序未变', Object.keys(a).join(',') === 'title,hero', Object.keys(a).join(','));
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
