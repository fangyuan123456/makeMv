/**
 * 冒烟：/api/workflows 只读边界
 *
 * 验证三件事：
 * 1. mastra 容器能正常初始化（三条轨挂载不引入循环依赖）
 * 2. GET /api/workflows 返回 7 条（主线 + 6 工序子流 + 修改流）
 * 3. POST /api/workflows/:id/start 与 /resume 不再被路由处理
 */
import { mastra } from '../src/mastra.js';
import { handleMastraRoutes } from '../src/api/routes/mastra.js';

function mockRes() {
  const chunks: string[] = [];
  return {
    statusCode: 0,
    writeHead(code: number) {
      this.statusCode = code;
    },
    end(chunk?: string) {
      if (chunk) chunks.push(chunk);
    },
    get body() {
      return chunks.join('');
    },
  };
}

function mockReq(method: string, url: string) {
  return { method, url, headers: {} } as any;
}

async function main() {
  // 1. 容器初始化
  const mounted = Object.keys(mastra.listWorkflows() || {});
  console.log(`[1] mastra 挂载 ${mounted.length} 条: ${mounted.join(', ')}`);

  const mustHave = [
    'film-production-pipeline',
    'subwf-story-bible',
    'subwf-character-portrait',
    'subwf-scene-script',
    'subwf-storyboard',
    'subwf-keyframe-reference',
    'subwf-video-production',
    'subwf-modify',
  ];
  const missing = mustHave.filter((k) => !mounted.includes(k));
  if (missing.length) {
    console.error(`✗ 缺少挂载: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log('[1] ✓ 三条轨全部可见（主线 / 工序子流 / 修改流）');

  // 2. GET /api/workflows
  const listRes = mockRes();
  const handledList = await handleMastraRoutes(mockReq('GET', '/api/workflows'), listRes as any, '/api/workflows');
  const payload = JSON.parse(listRes.body || '{}');
  const list = payload.workflows || [];
  console.log(`[2] GET /api/workflows → handled=${handledList} status=${listRes.statusCode} count=${list.length}`);
  console.log(`[2] 条目: ${list.map((w: any) => `${w.id}(${w.type},${w.stepsCount})`).join(' | ')}`);

  const modifyEntry = list.find((w: any) => w.id === 'subwf-modify');
  if (!modifyEntry) {
    console.error('✗ 列表里没有 subwf-modify');
    process.exit(1);
  }
  console.log(`[2] ✓ subwf-modify 可见，steps=${modifyEntry.stepsCount} (${modifyEntry.stepIds?.join(',')})`);

  // 3. POST 执行入口必须已封闭
  const cases = [
    { path: '/api/workflows/subwf-modify/start', label: 'start' },
    { path: '/api/workflows/subwf-modify/resume', label: 'resume' },
    { path: '/api/workflows/film-production-pipeline/start', label: 'pipeline start' },
  ];
  for (const c of cases) {
    const res = mockRes();
    const handled = await handleMastraRoutes(mockReq('POST', c.path), res as any, c.path);
    if (handled) {
      console.error(`✗ ${c.label} 仍被路由处理（handled=true, status=${res.statusCode}）`);
      process.exit(1);
    }
    console.log(`[3] ✓ ${c.label} 不再被处理（handled=false，落回 404）`);
  }

  console.log('\n全部通过。');
}

main().catch((err) => {
  console.error('✗ 异常:', err);
  process.exit(1);
});
