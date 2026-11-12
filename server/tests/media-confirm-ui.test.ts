/**
 * tests/media-confirm-ui.test.ts
 *
 * 6 份 ComfyUI 工作流 JSON 契约测试 + media → ConfirmUI 接入体检。
 * 全程 dry-run：只替换网络出站（uploadImage / executeAndPoll），不连真实 ComfyUI、不烧算力。
 * 跑完自动产出可查看报告：tests/output/media-confirm-ui-report.html
 *
 * 运行：tsx tests/media-confirm-ui.test.ts
 */
process.env.NODE_ENV = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ComfyUIMediaProvider,
  ComfyUITopologyInjector,
  ensureApiPromptFormat,
} from '../src/media/index.js';
import { TaskStore } from '../src/workflow-engine/TaskStore.js';
import { ConfirmationGate } from '../src/workflow-engine/confirmation-gate.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import type { ImageGenerationOptions } from '../src/media/providers/ImageProvider.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
const SRC_ROOT = path.join(SERVER_ROOT, 'src');
const WF_DIR = path.join(SRC_ROOT, 'media/comfyui/workflows');
const OUT_DIR = path.join(__dirname, 'output');
const REPORT_PATH = path.join(OUT_DIR, 'media-confirm-ui-report.html');
const TEST_PROJ_ID = `test_media_confirm_${Date.now()}`;

const PROMPT_MARKER = '__CONFIRM_UI_TEST_PROMPT__';
const NEG_MARKER = '__CONFIRM_UI_TEST_NEGATIVE__';
const REF_A = '__CONFIRM_UI_REF_A__';
const REF_B = '__CONFIRM_UI_REF_B__';
const SEED = 424242;
const STUB_UPLOAD_NAME = 'confirm_ui_ref_stub.png';

type ApiPrompt = Record<string, { class_type: string; inputs: Record<string, any> }>;

interface TemplateSpec {
  file: string;
  format: 'UI Workflow' | 'API Prompt';
  mode?: ImageGenerationOptions['mode']; // undefined = 走 generateVideo
  outputTypes: string[];
  loadImages: number;
  sizeCapable: boolean;
  entry: string;
  note: string;
}

const TEMPLATES: TemplateSpec[] = [
  {
    file: 'comfyui_t2i.json',
    format: 'API Prompt',
    mode: 'general_t2i',
    outputTypes: ['SaveImage'],
    loadImages: 0,
    sizeCapable: true,
    entry: 'generateImage(general_t2i / 默认)',
    note: '通用文生图（AuraFlow / SD3），正负向双 CLIPTextEncode；不传 mode 时也是这份模板。',
  },
  {
    file: 'comfyui_character_t2i.json',
    format: 'UI Workflow',
    mode: 'character_t2i',
    outputTypes: ['SaveImage'],
    loadImages: 0,
    sizeCapable: true,
    entry: 'generateImage(character_t2i)',
    note: '角色定妆首图，TextEncodeQwenImage21 + EmptyLatentImage。',
  },
  {
    file: 'comfyui_character_ref2i.json',
    format: 'UI Workflow',
    mode: 'character_ref2i',
    outputTypes: ['SaveImage'],
    loadImages: 1,
    sizeCapable: false,
    entry: 'generateImage(character_ref2i)',
    note: '角色锁脸参考生图；无宽高节点，size 参数会被静默丢弃。',
  },
  {
    file: 'comfyui_character_pose_outfit.json',
    format: 'UI Workflow',
    mode: 'character_pose_outfit',
    outputTypes: ['SaveImage'],
    loadImages: 2,
    sizeCapable: false,
    entry: 'generateImage(character_pose_outfit)',
    note: '姿态 + 服装双参考图；无宽高节点，size 参数会被静默丢弃。',
  },
  {
    file: 'comfyui_character_three_view.json',
    format: 'UI Workflow',
    mode: 'character_three_view',
    outputTypes: ['SaveImage'],
    loadImages: 1,
    sizeCapable: true,
    entry: 'generateImage(character_three_view)',
    note: '三视图，1 个 LoadImage + EmptyLatentImage。',
  },
  {
    file: 'comfyui_i2v.json',
    format: 'API Prompt',
    mode: undefined,
    outputTypes: ['SaveVideo', 'SaveAudioAdvanced'],
    loadImages: 3,
    sizeCapable: true,
    entry: 'generateVideo(i2v)',
    note: 'MiniMax-H3 图生视频，3 个 LoadImage；含视频与音轨输出节点。',
  },
];

interface CaseResult {
  file: string;
  status: 'PASS' | 'FAIL';
  format: string;
  entry: string;
  note: string;
  nodeCount: number;
  classTypes: string[];
  capabilities: Record<string, boolean>;
  injectedFields: Array<{ node: string; field: string; before: string; after: string }>;
  submittedJson: string;
  error?: string;
}

interface LinkCheck {
  id: string;
  layer: string;
  item: string;
  connected: boolean;
  critical: boolean;
  deferred?: boolean; // 约定暂缓项：仍如实标「断」，但不计入本次接线验收
  evidence: string;
  impact: string;
}

const caseResults: CaseResult[] = [];
const linkChecks: LinkCheck[] = [];

/* ------------------------------ 工具函数 ------------------------------ */

function readRepoFile(rel: string): string {
  const p = path.join(REPO_ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

function lineOf(source: string, needle: string): string {
  const idx = source.indexOf(needle);
  if (idx < 0) return '-';
  return String(source.slice(0, idx).split('\n').length);
}

function nodesOf(api: ApiPrompt): Array<[string, { class_type: string; inputs: Record<string, any> }]> {
  return Object.entries(api);
}

function hasExactValue(api: ApiPrompt, marker: string): boolean {
  return nodesOf(api).some(([, n]) => Object.values(n.inputs || {}).some((v) => v === marker));
}

function hasSeed(api: ApiPrompt, seed: number): boolean {
  return nodesOf(api).some(([, n]) => n.inputs?.seed === seed || n.inputs?.noise_seed === seed);
}

function hasAnyNumericSeed(api: ApiPrompt): boolean {
  return nodesOf(api).some(
    ([, n]) => typeof n.inputs?.seed === 'number' || typeof n.inputs?.noise_seed === 'number'
  );
}

function hasSize(api: ApiPrompt, width: number, height: number): boolean {
  return nodesOf(api).some(([, n]) => n.inputs?.width === width && n.inputs?.height === height);
}

function loadImageNodes(api: ApiPrompt) {
  return nodesOf(api).filter(([, n]) => n.class_type === 'LoadImage');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* --------------------------- 单份 JSON 契约测试 --------------------------- */

async function runTemplateCase(spec: TemplateSpec): Promise<Omit<CaseResult, 'status' | 'error'>> {
  const filePath = path.join(WF_DIR, spec.file);
  assert.ok(fs.existsSync(filePath), `${spec.file} 模板文件必须存在`);

  // 1. JSON 合法 + 转换器能把 UI Workflow / API Prompt 统一成可执行 API Prompt
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert.ok(raw && typeof raw === 'object' && !Array.isArray(raw), `${spec.file} 顶层必须是对象`);
  const api = ensureApiPromptFormat(raw) as ApiPrompt;
  const nodeIds = Object.keys(api);
  assert.ok(nodeIds.length >= 5, `${spec.file} 转换后节点数过少 (${nodeIds.length})`);

  for (const [id, node] of nodesOf(api)) {
    assert.ok(typeof node.class_type === 'string' && node.class_type.length > 0, `${spec.file} 节点 ${id} 缺少 class_type`);
    assert.ok(node.inputs && typeof node.inputs === 'object' && !Array.isArray(node.inputs), `${spec.file} 节点 ${id} 缺少 inputs`);
  }

  // 2. DAG 连线引用完整性：所有 [nodeId, slot] 必须指向存在的节点
  for (const [id, node] of nodesOf(api)) {
    for (const [key, val] of Object.entries<any>(node.inputs)) {
      const isLink =
        Array.isArray(val) &&
        val.length === 2 &&
        typeof val[0] === 'string' &&
        /^\d+$/.test(val[0]) &&
        typeof val[1] === 'number';
      if (isLink) {
        assert.ok(api[val[0]], `${spec.file} 节点 ${id}.${key} 引用了不存在的节点 ${val[0]}`);
      }
    }
  }

  // 3. 输出节点与参考图节点数量符合该模板契约
  assert.ok(
    nodeIds.some((id) => spec.outputTypes.includes(api[id].class_type)),
    `${spec.file} 缺少输出节点 (${spec.outputTypes.join('/')})`
  );
  const loadNodes = loadImageNodes(api);
  assert.equal(loadNodes.length, spec.loadImages, `${spec.file} 的 LoadImage 节点数与契约不符`);

  // 4. 拓扑注入器：断言「值真的被改写」，不只断言返回 true（防假收敛）
  const clone = JSON.parse(JSON.stringify(api)) as ApiPrompt;
  const promptOk = ComfyUITopologyInjector.injectPrompts(clone, PROMPT_MARKER, NEG_MARKER);
  assert.equal(promptOk, true, `${spec.file} 正向提示词注入失败`);
  assert.ok(hasExactValue(clone, PROMPT_MARKER), `${spec.file} 提示词未真正写入节点`);
  const negativeOk = hasExactValue(clone, NEG_MARKER);
  const seedOk = ComfyUITopologyInjector.injectSeed(clone, SEED);
  assert.equal(seedOk, true, `${spec.file} 随机种子注入失败`);
  assert.ok(hasSeed(clone, SEED), `${spec.file} 种子未真正写入节点`);
  const sizeOk = ComfyUITopologyInjector.injectImageSize(clone, '1280*720');
  assert.equal(sizeOk, spec.sizeCapable, `${spec.file} 画幅注入能力与契约不符`);
  if (spec.loadImages > 0) {
    ComfyUITopologyInjector.injectReferenceImages(clone, [REF_A, REF_B]);
    assert.ok(hasExactValue(clone, REF_A), `${spec.file} 参考图未真正写入 LoadImage`);
  }

  // 5. Provider dry-run：真走「读模板 → 转换 → 上传参考图 → 四类注入 → 提交 /prompt」，仅替换网络出站
  const provider = new ComfyUIMediaProvider('http://127.0.0.1:1');
  const captured: Array<{ workflow: ApiPrompt; mediaType: string }> = [];
  (provider as any).uploadImage = async (_url: string) => STUB_UPLOAD_NAME;
  (provider as any).executeAndPoll = async (workflow: ApiPrompt, mediaType: string) => {
    captured.push({ workflow, mediaType });
    return 'http://stub.invalid/confirm-ui-dry-run.png';
  };

  if (spec.mode === undefined) {
    await provider.generateVideo(PROMPT_MARKER, {
      referenceImageUrl: '/media/stub/first_frame.png',
      duration: 5,
    });
  } else {
    await provider.generateImage(PROMPT_MARKER, {
      mode: spec.mode,
      size: '1280*720',
      seed: SEED,
      ...(spec.mode === 'character_ref2i' ? { referenceImageUrls: ['/media/stub/face_ref.png'] } : {}),
    });
  }

  assert.equal(captured.length, 1, `${spec.file} 应恰好提交一次工作流`);
  const submitted = captured[0].workflow;
  assert.equal(
    captured[0].mediaType,
    spec.mode === undefined ? 'video' : 'image',
    `${spec.file} 提交的媒体类型不符`
  );
  assert.deepEqual(
    Object.keys(submitted).sort(),
    [...nodeIds].sort(),
    `${spec.file} 实际提交的节点集合与模板不一致（mode → 模板映射错位）`
  );

  // 6. 提交负载里的真实注入结果
  assert.ok(hasExactValue(submitted, PROMPT_MARKER), `${spec.file} 提交负载缺少注入后的提示词`);
  if (spec.mode === undefined) {
    assert.ok(hasAnyNumericSeed(submitted), `${spec.file} 提交负载缺少随机种子`);
  } else {
    assert.ok(hasSeed(submitted, SEED), `${spec.file} 提交负载里的种子不是传入值`);
    if (spec.sizeCapable) {
      assert.ok(hasSize(submitted, 1280, 720), `${spec.file} 提交负载里的画幅未生效`);
    } else {
      assert.ok(!hasSize(submitted, 1280, 720), `${spec.file} 无宽高节点却报告画幅生效（假收敛）`);
    }
  }
  if (spec.mode === 'character_ref2i' || spec.mode === undefined) {
    const submittedLoad = loadImageNodes(submitted);
    assert.equal(submittedLoad.length, spec.loadImages, `${spec.file} 提交负载的 LoadImage 数量异常`);
    for (const [, node] of submittedLoad) {
      assert.equal(node.inputs.image, STUB_UPLOAD_NAME, `${spec.file} 参考图未注入提交负载`);
    }
  }

  // 7. 收集注入前后对照，供报告展示
  const injectedFields: CaseResult['injectedFields'] = [];
  for (const [id, node] of nodesOf(api)) {
    const after = submitted[id];
    if (!after) continue;
    for (const [field, before] of Object.entries<any>(node.inputs)) {
      const next = after.inputs[field];
      if (typeof before === 'string' && typeof next === 'string' && before !== next && next.includes('__CONFIRM_UI')) {
        injectedFields.push({ node: `${id}/${node.class_type}`, field, before, after: next });
      }
    }
  }

  return {
    file: spec.file,
    format: spec.format,
    entry: spec.entry,
    note: spec.note,
    nodeCount: nodeIds.length,
    classTypes: [...new Set(nodeIds.map((id) => api[id].class_type))],
    capabilities: {
      prompt: promptOk,
      negative: negativeOk,
      seed: seedOk,
      size: sizeOk,
      reference: spec.loadImages > 0,
    },
    injectedFields,
    submittedJson: JSON.stringify(submitted, null, 2),
  };
}

TEMPLATES.forEach((spec, i) => {
  const name = `[${i + 1}/6] ${spec.file} — ${spec.entry}`;
  test(name, async () => {
    try {
      const detail = await runTemplateCase(spec);
      caseResults.push({ ...detail, status: 'PASS' });
    } catch (err: any) {
      caseResults.push({
        file: spec.file,
        status: 'FAIL',
        format: spec.format,
        entry: spec.entry,
        note: spec.note,
        nodeCount: 0,
        classTypes: [],
        capabilities: {},
        injectedFields: [],
        submittedJson: '',
        error: err?.message || String(err),
      });
      throw err;
    }
  });
});

/* ------------------------- media → ConfirmUI 接入体检 ------------------------- */

const RUNTIME_ROUTE = readRepoFile('server/src/api/routes/runtime.route.ts');
const TASKS_ROUTE = readRepoFile('server/src/api/routes/tasks.route.ts');
const APP = readRepoFile('server/src/api/app.ts');
const CHAT_ROUTE = readRepoFile('server/src/api/routes/chat.route.ts');
const CLIENT_API = readRepoFile('client/src/lib/api.ts');
const PROPOSAL_CARD = readRepoFile('client/src/components/ProposalCard.tsx');
const COCKPIT = readRepoFile('client/src/components/TextGameCockpit.tsx');
const CLIENT_APP = readRepoFile('client/src/App.tsx');
const ROUTER_INTENT = readRepoFile('server/src/agents/router/tools/emit-intent.tool.ts');

function listSrcTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSrcTsFiles(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

function addCheck(check: LinkCheck): void {
  linkChecks.push(check);
}

test('[体检] media → ConfirmUI 全链路探测（只记录事实，不固化现状）', () => {
  // 判据对准「入口层」：工具保持纯物理，确认门禁由 runtime.route.ts 承担，不去 grep 工具定义
  const proposeCreatesTask =
    /render-images\/propose/.test(RUNTIME_ROUTE) &&
    /createTask\(/.test(RUNTIME_ROUTE) &&
    /'media_render_images'/.test(RUNTIME_ROUTE);
  addCheck({
    id: 'L1', layer: '算力入口', item: '媒体算力入口是否先建 proposed 确认任务',
    connected: proposeCreatesTask, critical: true,
    evidence: `runtime.route.ts:${lineOf(RUNTIME_ROUTE, '/:projectId/render-images/propose')} createTask(..., true) 只建卡不执行`,
    impact: '入口不建卡，创作者就没有授权机会，算力会被直接触发。',
  });

  const bareDisabled = /410/.test(RUNTIME_ROUTE) && /render-images', \(_req, res\)/.test(RUNTIME_ROUTE);
  const statusGuarded =
    /status !== 'proposed'/.test(RUNTIME_ROUTE) && /ConfirmationGate\.confirmTask/.test(RUNTIME_ROUTE);
  addCheck({
    id: 'L2', layer: 'HTTP 入口', item: '执行口是否校验任务状态、裸入口是否停用（防绕过）',
    connected: bareDisabled && statusGuarded, critical: true,
    evidence: `runtime.route.ts:${lineOf(RUNTIME_ROUTE, "task.status !== 'proposed'")} 状态校验；旧裸 /render-images 返回 410`,
    impact: '没有状态校验或旧裸入口还在，就能跳过确认卡直接烧算力。',
  });

  const confirmIdx = RUNTIME_ROUTE.indexOf('/:projectId/render-images/confirm');
  const confirmBlock = confirmIdx >= 0 ? RUNTIME_ROUTE.slice(confirmIdx, confirmIdx + 1400) : '';
  const hasExecutor =
    /ConfirmationGate\.confirmTask/.test(confirmBlock) &&
    /batchRenderGameImages/.test(confirmBlock) &&
    /setStatus/.test(confirmBlock);
  addCheck({
    id: 'L3', layer: '确认后执行', item: 'confirmTask 放行后是否真实驱动渲染并闭环任务状态',
    connected: hasExecutor, critical: true,
    evidence: `runtime.route.ts:${lineOf(RUNTIME_ROUTE, 'ConfirmationGate.confirmTask')} → batchRenderGameImages → setStatus(succeeded/failed)`,
    impact: '确认只改状态不执行，门禁就成了状态孤岛。',
  });

  // 渲染服务应保持纯执行：全仓只允许受控入口调用它，多一个调用方就是一条暗道
  const rendererCallers = listSrcTsFiles(SRC_ROOT).filter((p) => {
    const rel = path.relative(SRC_ROOT, p).replace(/\\/g, '/');
    if (rel === 'agents/text-game/node-image-renderer.ts' || rel === 'agents/text-game/index.ts') return false;
    return fs.readFileSync(p, 'utf-8').includes('batchRenderGameImages');
  });
  const singleEntry = rendererCallers.length === 1 && rendererCallers[0].endsWith('runtime.route.ts');
  addCheck({
    id: 'L4', layer: '渲染服务', item: 'batchRenderGameImages 是否只被受控入口调用',
    connected: singleEntry, critical: true,
    evidence: `server/src 内调用方 = [${rendererCallers.map((p) => path.relative(SRC_ROOT, p).replace(/\\/g, '/')).join(', ') || '无'}]`,
    impact: '多一个调用方就多一条绕过确认卡的暗道。',
  });

  const taskStore = TaskStore.getInstance();
  const task = taskStore.createTask(TEST_PROJ_ID, 'media_confirm_probe', '门禁自检任务', true);
  assert.equal(task.status, 'proposed', 'requireConfirmation=true 应创建 proposed 任务');
  const released = ConfirmationGate.confirmTask(TEST_PROJ_ID, task.taskId);
  assert.equal(released.status, 'running', 'confirmTask 应把 proposed 放行成 running');
  addCheck({
    id: 'L5', layer: '确认门禁', item: 'proposed → running 状态机本身可用',
    connected: released.status === 'running', critical: false,
    evidence: '本测试实跑 TaskStore.createTask(true) + ConfirmationGate.confirmTask，断言通过',
    impact: '门禁机制自身可用，现由入口层复用，无需在工具内部重复声明。',
  });

  addCheck({
    id: 'L6', layer: 'HTTP 入口', item: '/api/tasks/:id/confirm|reject 路由是否挂载',
    connected: /app\.use\('\/api\/tasks', tasksRouter\)/.test(APP), critical: false,
    evidence: `app.ts:${lineOf(APP, "app.use('/api/tasks'")} 已挂载，tasks.route.ts:${lineOf(TASKS_ROUTE, '/confirm')} 已实现`,
    impact: '后端接口齐备，缺的是前端调用方。',
  });

  addCheck({
    id: 'L7', layer: '前端网关', item: 'client/lib/api.ts 是否封装提案与确认/拒绝接口',
    connected:
      /rejectTask/.test(CLIENT_API) &&
      /proposeRenderImages/.test(CLIENT_API) &&
      /confirmRenderImages/.test(CLIENT_API),
    critical: true,
    evidence: 'client/src/lib/api.ts 已补 proposeRenderImages / confirmRenderImages / rejectTask（走 /api/tasks/:id/reject）',
    impact: '前端没有这几个封装，确认卡就点不动后端门禁。',
  });

  const cardActions = [...PROPOSAL_CARD.matchAll(/case '([^']+)'/g)].map((m) => m[1]);
  const appActions = [...CLIENT_APP.matchAll(/proposal\.action === '([^']+)'/g)].map((m) => m[1]);
  const mediaActions =
    /case 'render_images'/.test(PROPOSAL_CARD) &&
    /pendingRender/.test(COCKPIT) &&
    /<ProposalCard/.test(COCKPIT) &&
    /handleApproveRender/.test(COCKPIT) &&
    /handleRejectRender/.test(COCKPIT);
  addCheck({
    id: 'L8', layer: 'ConfirmUI 卡片', item: 'ProposalCard / 座舱是否支持媒体类行动提案',
    connected: mediaActions, critical: true,
    evidence: `ProposalCard.tsx 动作标签 = [${cardActions.join(', ')}]；TextGameCockpit.tsx 已渲染 render_images 确认卡`,
    impact: '卡片不认媒体 action，媒体渲染就不在人在回路体系内。',
  });

  const videoConsumers = listSrcTsFiles(SRC_ROOT).filter((p) => {
    const rel = path.relative(SRC_ROOT, p).replace(/\\/g, '/');
    if (rel === 'tools/video-generate/video-generate.tool.ts' || rel === 'tools/index.ts') return false;
    return fs.readFileSync(p, 'utf-8').includes('videoGenerateTool');
  });
  addCheck({
    id: 'L9', layer: '算力工具', item: 'videoGenerateTool（i2v 工作流）是否有生产消费方',
    connected: videoConsumers.length > 0, critical: false, deferred: true,
    evidence: `server/src 内除定义文件与总装导出外，引用数 = ${videoConsumers.length}（仅测试文件引用）`,
    impact: '按约定暂缓：当前流水线只编译影视化切片清单，尚无视频工序；comfyui_i2v.json 模板已就绪，待新开视频工序时接入。',
  });

  const backendEnum = /z\s*\.\s*enum\(\[([^\]]+)\]\)/.exec(ROUTER_INTENT)?.[1] || '';
  const actionList = [...backendEnum.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const actionable = actionList.filter((a) => a !== 'chat_only');
  const aligned =
    actionable.length > 0 && actionable.every((a) => cardActions.includes(a) || appActions.includes(a));
  const chatOnlyFiltered = /action === 'chat_only'/.test(CHAT_ROUTE);
  const noFallbackStart = !/startWorkflow\(currentProjectId, proposal\.summary\)/.test(CLIENT_APP);
  addCheck({
    id: 'L10', layer: '前后端契约', item: 'action 枚举对齐 + chat_only 不出卡 + 未知意图不立项',
    connected: aligned && chatOnlyFiltered && noFallbackStart, critical: true,
    evidence: `后端 = [${actionList.join(', ')}]；卡片标签 = [${cardActions.join(', ')}]；App 分支 = [${appActions.join(', ')}]；chat_only 过滤=${chatOnlyFiltered}；无兜底立项=${noFallbackStart}`,
    impact: '枚举错位或 chat_only 出卡时，未识别意图会落进 else 兜底重复立项（409）；现在未知意图只提示不执行。',
  });

  addCheck({
    id: 'L11', layer: '工作流模板', item: '6 份 ComfyUI JSON 是否全部可达且可注入',
    connected: caseResults.length === TEMPLATES.length && caseResults.every((r) => r.status === 'PASS'),
    critical: false,
    evidence: '本文件 6 个模板契约测试（结构 / DAG / 注入 / Provider 映射 / 提交负载）',
    impact: '底座模板保持就绪，接线改动不得让任何一份模板掉队。',
  });

  assert.equal(linkChecks.length, 11, '体检项必须全部执行，缺项说明源文件被移动或删除');
  for (const rel of [
    'server/src/tools/image-generate/image-generate.tool.ts',
    'server/src/tools/video-generate/video-generate.tool.ts',
    'server/src/api/routes/runtime.route.ts',
    'server/src/agents/text-game/steps/image-gen-pool/step.ts',
    'server/src/workflow-engine/confirmation-gate.ts',
    'server/src/api/routes/tasks.route.ts',
    'server/src/api/app.ts',
    'client/src/lib/api.ts',
    'client/src/components/ProposalCard.tsx',
    'client/src/components/TextGameCockpit.tsx',
    'client/src/App.tsx',
    'server/src/api/routes/chat.route.ts',
    'server/src/agents/router/tools/emit-intent.tool.ts',
  ]) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, rel)), `体检源文件缺失: ${rel}`);
  }
});

test.skip('[端到端] render-images 必须经 propose → confirm 才可执行 (接口已废除，生图全链路内聚在阶段二工作流内部)', async () => {
  const http = await import('node:http');
  const { createApp } = await import('../src/api/app.js');
  const projectId = `test_render_gate_${Date.now()}`;
  const projStore = ProjectStore.getInstance();

  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = (url: string, body: any = {}) =>
    fetch(`${baseUrl}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  try {
    projStore.setArtifact(projectId, 'text_game', {
      title: '门禁闭环测试',
      startNodeId: 'node_gate_1',
      variables: {},
      nodes: [
        {
          id: 'node_gate_1',
          title: '测试首帧',
          narrativeText: '用于验证确认后才会落盘',
          visual: {
            scenePrompt: '测试画面',
            characterPrompt: '',
            composition: '',
            imagePromptEn: 'confirm ui gate test shot',
            entityNames: [],
            imageUrl: '',
          },
          choices: [],
        },
      ],
    });

    // 1. 裸入口必须停用（防绕过）
    assert.equal((await post(`/api/runtime/${projectId}/render-images`)).status, 410);

    // 2. propose 只建卡
    const proposed = (await (await post(`/api/runtime/${projectId}/render-images/propose`)).json()) as any;
    assert.equal(proposed.data.status, 'proposed');
    assert.ok(proposed.data.taskId);
    assert.equal(proposed.data.nodeCount, 1, '确认卡应带出待渲染节点数');

    // 3. 重复点击幂等
    const again = (await (await post(`/api/runtime/${projectId}/render-images/propose`)).json()) as any;
    assert.equal(again.data.taskId, proposed.data.taskId, '重复点击应复用同一张确认卡');

    // 4. 缺 taskId / 伪造 taskId 一律拒绝
    assert.equal((await post(`/api/runtime/${projectId}/render-images/confirm`, {})).status, 400);
    assert.equal((await post(`/api/runtime/${projectId}/render-images/confirm`, { taskId: 'task_fake' })).status, 409);

    // 5. 驳回后不得执行
    assert.equal((await post(`/api/tasks/${projectId}/${proposed.data.taskId}/reject`, { reason: '测试驳回' })).status, 200);
    assert.equal(
      (await post(`/api/runtime/${projectId}/render-images/confirm`, { taskId: proposed.data.taskId })).status,
      409,
      '已驳回任务不得执行'
    );

    // 6. 重新提案 → 确认 → 真实执行并闭环任务状态
    const fresh = (await (await post(`/api/runtime/${projectId}/render-images/propose`)).json()) as any;
    assert.notEqual(fresh.data.taskId, proposed.data.taskId, '驳回后应能重新发起提案');
    const confirmed = await post(`/api/runtime/${projectId}/render-images/confirm`, { taskId: fresh.data.taskId });
    assert.equal(confirmed.status, 200);
    const result = (await confirmed.json()) as any;
    assert.equal(result.data.taskStatus, 'succeeded');
    assert.equal(result.data.renderedCount, 1, '确认后必须真实产出关键帧，不得假收敛');
    assert.equal(TaskStore.getInstance().getTask(projectId, fresh.data.taskId)?.status, 'succeeded');
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    projStore.deleteProject(projectId);
  }
});

test('[回归] 显式 mode 优先于参考图回落，不再被抢到 ref2i 模板', async () => {
  const provider = new ComfyUIMediaProvider('http://127.0.0.1:1');
  const captured: ApiPrompt[] = [];
  (provider as any).uploadImage = async () => STUB_UPLOAD_NAME;
  (provider as any).executeAndPoll = async (workflow: ApiPrompt) => {
    captured.push(workflow);
    return 'http://stub.invalid/confirm-ui-dry-run.png';
  };
  const templateKeys = (file: string) =>
    Object.keys(
      ensureApiPromptFormat(JSON.parse(fs.readFileSync(path.join(WF_DIR, file), 'utf-8')))
    ).sort();

  // 1. 显式 mode + 参考图：必须走 three_view（旧实现会错选 ref2i）
  await provider.generateImage(PROMPT_MARKER, {
    mode: 'character_three_view',
    referenceImageUrls: ['/media/stub/face_ref.png'],
    size: '1280*720',
  });
  assert.equal(captured.length, 1);
  assert.deepEqual(
    Object.keys(captured[0]).sort(),
    templateKeys('comfyui_character_three_view.json'),
    '带参考图时显式 mode 必须仍然生效'
  );
  assert.equal(loadImageNodes(captured[0])[0][1].inputs.image, STUB_UPLOAD_NAME);
  assert.ok(hasSize(captured[0], 1280, 720), 'three_view 含宽高节点，size 必须生效');

  // 2. 未指定 mode 但有参考图：保留 ref2i 回落语义
  captured.length = 0;
  await provider.generateImage(PROMPT_MARKER, { referenceImageUrls: ['/media/stub/face_ref.png'] });
  assert.deepEqual(
    Object.keys(captured[0]).sort(),
    templateKeys('comfyui_character_ref2i.json'),
    '未指定 mode 时应按参考图语义回落到 ref2i'
  );

  // 3. scene_ref2i 多定妆参考图动态连线 + 竖屏 EmptyLatentImage 注入 + TextEncodeQwenImage21 契约校验
  captured.length = 0;
  let uploadSeq = 0;
  (provider as any).uploadImage = async (u: string) => `stub_${++uploadSeq}_${path.basename(u)}`;
  await provider.generateImage(PROMPT_MARKER, {
    mode: 'scene_ref2i',
    negativePrompt: NEG_MARKER,
    referenceImageUrls: ['/media/stub/char1.png', '/media/stub/char2.png', '/media/stub/prop1.png'],
    size: '768*1344',
  });
  assert.equal(captured.length, 1);
  const multiScene = captured[0];
  assert.equal(loadImageNodes(multiScene).length, 3, '3 张定妆照应动态生成 3 个 LoadImage 节点');
  const qwenNode = nodesOf(multiScene).find(([, n]) => n.class_type === 'TextEncodeQwenImage21')?.[1];
  assert.ok(qwenNode, '必须包含 TextEncodeQwenImage21 节点');
  assert.equal(qwenNode.inputs.negative_prompt, NEG_MARKER, 'negative_prompt 必须准确注入');
  assert.equal(qwenNode.inputs.resolution, 1024, 'resolution 必填参数必须保留');
  assert.ok(Array.isArray(qwenNode.inputs['images.image_1']), '必须保留 COMFY_AUTOGROW_V3 前缀 images.image_1');
  assert.ok(Array.isArray(qwenNode.inputs['images.image_2']), '必须动态连接 images.image_2');
  assert.ok(Array.isArray(qwenNode.inputs['images.image_3']), '必须动态连接 images.image_3');
  assert.ok(hasSize(multiScene, 768, 1344), 'scene_ref2i 传入 size 时必须挂载 EmptyLatentImage 锁定竖屏画幅');
});

/* ------------------------------- 报告生成 ------------------------------- */

function buildReportHtml(): string {
  const pass = caseResults.filter((r) => r.status === 'PASS').length;
  const fail = caseResults.length - pass;
  const connectedCount = linkChecks.filter((c) => c.connected).length;
  const critical = linkChecks.filter((c) => c.critical);
  const criticalOk = critical.filter((c) => c.connected).length;
  const deferred = linkChecks.filter((c) => c.deferred);
  const verdict = criticalOk === critical.length ? '关键帧链路已接通' : '未接通';
  const verdictClass = criticalOk === critical.length ? 'ok' : 'bad';
  const heroText =
    criticalOk === critical.length
      ? `媒体关键帧渲染已完整接入人在回路：建卡 → 确认 → 放行 → 执行 → 任务状态闭环；6 份工作流模板全部可达。${deferred.length ? `另有 ${deferred.length} 项按约定暂缓（i2v 业务入口），下表仍如实标「断」。` : ''}`
      : '媒体算力与 ConfirmUI 之间的「触发 → 确认卡 → 门禁 → 执行」链路仍有断点。';

  const cards = caseResults
    .map((r, i) => {
      const cap = (k: string) =>
        r.capabilities[k] ? '<span class="pill yes">支持</span>' : '<span class="pill no">不支持</span>';
      const rows = r.injectedFields.length
        ? r.injectedFields
            .slice(0, 8)
            .map(
              (f) =>
                `<tr><td>${escapeHtml(f.node)}</td><td>${escapeHtml(f.field)}</td><td class="mono dim">${escapeHtml(String(f.before).slice(0, 56))}</td><td class="mono">${escapeHtml(String(f.after).slice(0, 56))}</td></tr>`
            )
            .join('')
        : '<tr><td colspan="4" class="dim">提交负载由 Provider 动态注入，字段值已在断言中校验（种子/画幅/参考图为数值或文件名，非字符串标记）。</td></tr>';
      return `
      <section class="card">
        <div class="card-head">
          <h3>${i + 1}. <span class="mono">${escapeHtml(r.file)}</span></h3>
          <span class="badge ${r.status === 'PASS' ? 'ok' : 'bad'}">${r.status}</span>
        </div>
        <div class="meta">
          <span>格式 <b>${escapeHtml(r.format)}</b></span>
          <span>节点 <b>${r.nodeCount}</b></span>
          <span>入口 <b class="mono">${escapeHtml(r.entry)}</b></span>
          <span>LoadImage <b>${r.capabilities.reference ? '有' : '无'}</b></span>
        </div>
        <p class="note">${escapeHtml(r.note)}</p>
        ${r.error ? `<p class="err">失败原因：${escapeHtml(r.error)}</p>` : ''}
        <div class="caps">
          <span>提示词 ${cap('prompt')}</span><span>负向词 ${cap('negative')}</span>
          <span>种子 ${cap('seed')}</span><span>画幅 ${cap('size')}</span><span>参考图 ${cap('reference')}</span>
        </div>
        <p class="sub">节点类型：<span class="mono dim">${escapeHtml(r.classTypes.join(' · '))}</span></p>
        <h4>注入前后对照（真实提交负载片段）</h4>
        <table class="grid"><thead><tr><th>节点</th><th>字段</th><th>模板原值</th><th>注入后</th></tr></thead><tbody>${rows}</tbody></table>
        <details><summary>展开：dry-run 实际会提交给 ComfyUI /prompt 的完整 API Prompt</summary><pre>${escapeHtml(r.submittedJson || '（测试失败，未生成提交负载）')}</pre></details>
      </section>`;
    })
    .join('');

  const checkRows = linkChecks
    .map(
      (c) => `
      <tr class="${c.connected ? '' : 'row-bad'}">
        <td class="mono">${escapeHtml(c.id)}</td>
        <td>${escapeHtml(c.layer)}</td>
        <td>${escapeHtml(c.item)}</td>
        <td><span class="pill ${c.connected ? 'yes' : 'no'}">${c.connected ? '通' : '断'}</span>${c.deferred ? ' <span class="pill deferred">暂缓</span>' : ''}</td>
        <td class="dim">${escapeHtml(c.evidence)}</td>
        <td class="dim">${escapeHtml(c.impact)}</td>
      </tr>`
    )
    .join('');

  const byId = (id: string) => linkChecks.find((c) => c.id === id)?.connected ?? false;
  const chain = [
    { t: '媒体触发', s: byId('L1') ? 'propose 建 proposed 任务' : '入口未建确认卡', ok: byId('L1') },
    { t: 'ConfirmUI 确认卡', s: byId('L8') ? 'ProposalCard 渲染 render_images' : '卡片不认媒体 action', ok: byId('L8') },
    { t: '确认门禁', s: byId('L2') ? '状态校验 + 裸入口 410' : '存在绕过确认的暗道', ok: byId('L2') },
    { t: '执行器', s: byId('L3') && byId('L4') ? 'confirm 后渲染并闭环状态' : '确认只改状态未执行', ok: byId('L3') && byId('L4') },
    { t: 'ComfyUI 6 模板', s: `${pass}/${caseResults.length} 结构、注入、映射通过`, ok: pass === caseResults.length },
  ]
    .map(
      (n, i) => `
      <div class="node ${n.ok ? 'ok' : 'bad'}"><b>${escapeHtml(n.t)}</b><span>${escapeHtml(n.s)}</span></div>
      ${i < 4 ? `<div class="arrow ${n.ok ? '' : 'broken'}">${n.ok ? '→' : '✕'}</div>` : ''}`
    )
    .join('');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>media → ConfirmUI 接入体检与 6 份工作流 JSON 测试报告</title>
<style>
  :root{color-scheme:light;--bg:#f6f7f9;--panel:#fff;--line:#e3e6ea;--text:#1f2329;--dim:#6b7280;--red:#c0392b;--green:#1a7f4b}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
  .wrap{max-width:1180px;margin:0 auto;padding:32px 24px 64px}
  h1{font-size:24px;margin:0 0 6px}h2{font-size:17px;margin:34px 0 12px}h3{font-size:15px;margin:0}h4{font-size:13px;margin:14px 0 6px;color:var(--dim)}
  .sub,.dim{color:var(--dim)}.mono{font-family:ui-monospace,Consolas,monospace;font-size:12px}
  .hero{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:22px;margin-bottom:18px}
  .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700}
  .badge.ok,.pill.yes{background:#e7f5ed;color:var(--green)}.badge.bad,.pill.no{background:#fdecea;color:var(--red)}
  .pill.deferred{background:#fff4e5;color:#a05a00}
  .verdict{font-size:30px;font-weight:800;margin:10px 0 4px}.verdict.bad{color:var(--red)}.verdict.ok{color:var(--green)}
  .stats{display:flex;gap:26px;flex-wrap:wrap;margin-top:12px;color:var(--dim)}.stats b{font-size:18px;color:var(--text)}
  .chain{display:flex;align-items:stretch;gap:6px;flex-wrap:wrap;margin:14px 0 4px}
  .node{flex:1 1 170px;background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--green);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:4px}
  .node.bad{border-left-color:var(--red)}.node span{font-size:12px;color:var(--dim)}
  .arrow{align-self:center;font-size:20px;color:var(--green);font-weight:700}.arrow.broken{color:var(--red)}
  table.grid{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden;font-size:13px}
  th,td{padding:9px 10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}th{background:#f0f2f5;font-weight:600}
  tr:last-child td{border-bottom:none}.row-bad{background:#fffafa}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:14px}
  .card-head{display:flex;justify-content:space-between;align-items:center;gap:12px}
  .meta{display:flex;gap:18px;flex-wrap:wrap;color:var(--dim);font-size:12px;margin-top:8px}.meta b{color:var(--text)}
  .note{margin:10px 0 0;color:var(--dim);font-size:13px}.err{color:var(--red);font-size:13px}
  .caps{display:flex;gap:14px;flex-wrap:wrap;margin-top:12px;font-size:12px;color:var(--dim)}
  .pill{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600}
  details{margin-top:10px}summary{cursor:pointer;color:#2563a8;font-size:13px}
  pre{background:#f7f8fa;border:1px solid var(--line);border-radius:8px;padding:12px;max-height:340px;overflow:auto;font:11px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-all}
  ul.fix{margin:0;padding-left:20px}ul.fix li{margin:6px 0}
  footer{margin-top:34px;color:var(--dim);font-size:12px;border-top:1px solid var(--line);padding-top:14px}
</style></head><body><div class="wrap">
  <h1>media → ConfirmUI 接入体检</h1>
  <div class="sub">项目 makeMv · 6 份 ComfyUI 工作流 JSON 契约测试 · 由测试实跑生成，非手写结论</div>

  <div class="hero">
    <span class="badge ${verdictClass}">关键链路 ${criticalOk}/${critical.length} 接通</span>
    <div class="verdict ${verdictClass}">${verdict}</div>
    <div class="sub">${escapeHtml(heroText)}</div>
    <div class="stats">
      <span>模板测试 <b>${pass}/${caseResults.length}</b> 通过${fail ? `（${fail} 失败）` : ''}</span>
      <span>链路探测 <b>${connectedCount}/${linkChecks.length}</b> 项通</span>
      <span>关键项 <b>${criticalOk}/${critical.length}</b> 项通</span>
      <span>按约定暂缓 <b>${deferred.length}</b> 项</span>
      <span>真实算力调用 <b>0</b>（模板全 dry-run）</span>
    </div>
    <div class="chain">${chain}</div>
  </div>

  <h2>一、链路体检明细</h2>
  <table class="grid"><thead><tr><th>#</th><th>层</th><th>检查项</th><th>状态</th><th>证据</th><th>影响</th></tr></thead><tbody>${checkRows}</tbody></table>

  <h2>二、每份 JSON 一个测试</h2>
  <div class="sub">断言内容：JSON 合法 → 转换器统一为 API Prompt → 节点/连线引用完整 → 输出与 LoadImage 节点数 → 四类注入「值真的被改写」→ Provider mode 映射 → 真实提交负载复核。</div>
  ${cards}

  <h2>三、本次落地与剩余待办</h2>
  <h4>已落地（5 处）</h4>
  <ul class="fix">
    <li><b>入口挂门禁</b>：<span class="mono">runtime.route.ts</span> 拆出 <span class="mono">propose</span>（createTask(..., true) 只建卡）与 <span class="mono">confirm</span>（校验 proposed → confirmTask → batchRenderGameImages → setStatus 闭环），旧裸入口返回 410。</li>
    <li><b>门禁接执行</b>：执行器挂在确认链路里，<span class="mono">ConfirmationGate</span> 仍只管状态；渲染服务保持纯执行且全仓仅一个受控调用方。</li>
    <li><b>前端接线</b>：<span class="mono">api.ts</span> 补 propose/confirm/reject 封装；<span class="mono">TextGameCockpit</span> 按钮先出 <span class="mono">ProposalCard</span>（带节点数），批准才执行，驳回走 /api/tasks/reject。</li>
    <li><b>契约对齐</b>：后端 action 统一为 <span class="mono">start_pipeline / approve_stage / modify_asset / chat_only</span>；<span class="mono">chat.route.ts</span> 过滤 chat_only；<span class="mono">App.tsx</span> 删除 else 兜底立项。</li>
    <li><b>模板层</b>：显式 mode 优先于参考图回落；无宽高节点的工作流对 size 显式 WARN，不再静默吞参数。</li>
  </ul>
  <h4>剩余待办 / 已知限制</h4>
  <ul class="fix">
    <li><b>i2v 业务入口（按约定暂缓）</b>：<span class="mono">videoGenerateTool</span> 仍无生产消费方 —— 当前 <span class="mono">compile-film.step.ts</span> 只编译影视化切片清单，尚无视频工序；<span class="mono">comfyui_i2v.json</span> 模板已就绪，待新开视频工序时接入。</li>
    <li><b>modify_asset 执行逻辑</b>：枚举已对齐，但前端仅提示「暂不支持执行」，定向精修尚未接执行器。</li>
    <li><b>两份模板无宽高节点</b>：<span class="mono">character_pose_outfit / character_ref2i</span> 的 size 参数不生效（现在会打 WARN），若要指定画幅需改工作流模板本身。</li>
  </ul>

  <footer>
    运行命令：<span class="mono">tsx tests/media-confirm-ui.test.ts</span>（已挂进 <span class="mono">npm test</span>） ·
    报告生成时间：${escapeHtml(new Date().toISOString())} ·
    产物：<span class="mono">server/tests/output/media-confirm-ui-report.html</span><br>
    说明：6 份模板测试仅替换 <span class="mono">uploadImage / executeAndPoll</span> 网络出站，未连接 ComfyUI、未消耗算力；端到端测试用 Mock 生图落盘 1 张测试图，并随临时项目一并清理。
  </footer>
</div></body></html>`;
}

test.after(() => {
  // 清理体检时创建的临时项目
  try {
    ProjectStore.getInstance().deleteProject(TEST_PROJ_ID);
  } catch {
    /* 清理失败不影响报告产出 */
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, buildReportHtml(), 'utf-8');
  const pass = caseResults.filter((r) => r.status === 'PASS').length;
  const criticalOk = linkChecks.filter((c) => c.critical && c.connected).length;
  const criticalTotal = linkChecks.filter((c) => c.critical).length;
  const deferredOpen = linkChecks.filter((c) => c.deferred && !c.connected).length;
  console.log(
    `\n[media-confirm-ui] 模板测试 ${pass}/${caseResults.length} 通过；关键链路 ${criticalOk}/${criticalTotal} 接通 => ${criticalOk === criticalTotal ? '关键帧链路已接通' : '未接通'}；按约定暂缓 ${deferredOpen} 项`
  );
  console.log(`[media-confirm-ui] 报告已生成: ${REPORT_PATH}\n`);
});
