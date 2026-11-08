/**
 * scripts/test-patch-whitespace-flexible.ts
 * 复现线上案例：多行缩进 JSON + 模型输出单行拼接 search → 空白弹性匹配兜底。
 * 附带守卫验证：内容确实不同时仍必须失败（弹性匹配不放行内容差异）。
 */
import { applyStringPatches } from '../src/utils/universal-patch.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { applyJsonStringPatchesAtomic } from '../src/utils/universal-patch.js';

let pass = 0;
let fail = 0;
function assert(cond: boolean, name: string, extra?: string) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.error(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

const multiLineJson = `{
  "characters": [
    {
      "name": "杰克",
      "role": "男主角",
      "gender": "男",
      "age": 32
    }
  ]
}`;

console.log('场景 1：单行拼接 search 命中多行 JSON（本次线上失败案例）');
{
  const res = applyStringPatches(multiLineJson, [
    {
      search: `"name": "杰克", "role": "男主角", "gender": "男"`,
      replace: `"name": "杰姬", "role": "女主角", "gender": "女"`,
    },
  ]);
  assert(res.success, '补丁应用成功');
  assert(res.appliedCount === 1, 'appliedCount === 1', `实际 ${res.appliedCount}`);
  const obj = JSON.parse(res.resultText);
  assert(obj.characters[0].name === '杰姬', 'name 已更新');
  assert(obj.characters[0].gender === '女', 'gender 已更新');
  assert(obj.characters[0].age === 32, '未涉及字段 0 漂移');
}

console.log('场景 2：跨行 search（含换行）命中单行化原文');
{
  const oneLine = `{"name": "杰克", "role": "男主角"}`;
  const res = applyStringPatches(oneLine, [
    { search: `"name": "杰克",\n      "role": "男主角"`, replace: `"name": "杰克",\n      "role": "女主角"` },
  ]);
  assert(res.success, '补丁应用成功');
  assert(JSON.parse(res.resultText).role === '女主角', 'role 已更新');
}

console.log('场景 3：内容 token 不一致时，弹性匹配不得放行');
{
  const res = applyStringPatches(multiLineJson, [
    {
      search: `"name": "杰克逊", "role": "男主角"`,
      replace: `"name": "杰姬", "role": "女主角"`,
    },
  ]);
  assert(!res.success, '内容不同必须整体失败', '错误地被弹性匹配放行');
}

console.log('场景 4：端到端原子提交（磁盘读写 + JSON 语法守卫）');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-flex-'));
  const filePath = path.join(dir, 'story_bible.json');
  fs.writeFileSync(filePath, multiLineJson, 'utf-8');
  const res = applyJsonStringPatchesAtomic([
    {
      fileName: 'narrative/story_bible.json',
      filePath,
      patches: [
        {
          search: `"name": "杰克", "role": "男主角", "gender": "男"`,
          replace: `"name": "杰姬", "role": "女主角", "gender": "女"`,
        },
      ],
    },
  ]);
  assert(res.success, '原子提交成功', res.error);
  const after = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert(after.characters[0].role === '女主角', '落盘内容已更新');
  assert(after.characters[0].age === 32, '未涉及字段保持原样');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('场景 5：默认 unique 拒绝多处命中，显式 all 才允许全替换');
{
  const repeated = `第一行提到杰克，后面还有。
"name": "杰克", "role": "男主角"
再提一次杰克。`;

  // 5a 默认 unique：命中 3 次必须拒绝，且原文不得被改写
  const uniqueRes = applyStringPatches(repeated, [{ search: '杰克', replace: '杰姬' }]);
  assert(!uniqueRes.success, '默认 unique 下多处命中必须拒绝');
  assert(
    uniqueRes.errors.some((e) => e.includes('不唯一')),
    '错误信息须说明命中次数与补救方式'
  );
  assert(uniqueRes.resultText === repeated, '被拒绝时原文不得被改写');

  // 5b 显式 all：允许全替换（改名场景）
  const allRes = applyStringPatches(repeated, [
    { search: '杰克', replace: '杰姬', scope: 'all' },
  ]);
  assert(allRes.success && allRes.resultText.split('杰克').length === 1, '显式 all 可全局改名');

  // 5c 单字 all：永远拒绝
  const single = applyStringPatches('"gender": "男"\n"role": "男"', [
    { search: '男', replace: '女', scope: 'all' },
  ]);
  assert(!single.success, '单字全局替换必须拒绝');
}

console.log('场景 6：真实事故回归——「男→女」不得一次污染全部角色');
{
  const bible = `{
  "characters": [
    { "name": "李明", "gender": "男", "role": "男主角" },
    { "name": "李明的妻子", "gender": "男", "role": "女主角" },
    { "name": "李明的儿子", "gender": "男", "role": "关键角色" }
  ]
}`;
  const bad = applyStringPatches(bible, [{ search: '男', replace: '女', scope: 'all' }]);
  assert(!bad.success, '短补丁「男→女」必须被拦下');

  const good = applyStringPatches(bible, [
    { search: '"name": "李明", "gender": "男"', replace: '"name": "李明", "gender": "女"' },
  ]);
  assert(good.success, '带上下文的精确补丁可正常修改');
  const parsed = JSON.parse(good.resultText);
  assert(parsed.characters[0].gender === '女', '目标角色已改为女性');
  assert(parsed.characters[1].gender === '男', '配偶角色未被污染');
  assert(parsed.characters[2].gender === '男', '儿子未被污染');
}

console.log(`\n结果: ${pass} 过, ${fail} 挂`);
process.exit(fail > 0 ? 1 : 0);
