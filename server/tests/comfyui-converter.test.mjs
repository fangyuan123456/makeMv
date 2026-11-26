import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { ensureApiPromptFormat } from '../dist/media/comfyui/comfyui-converter.js';
import { ComfyUITopologyInjector } from '../dist/media/providers/ComfyUIMediaProvider.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workflowsDir = path.resolve(__dirname, '../src/media/comfyui/workflows');

const readTemplate = (filename) =>
  JSON.parse(fs.readFileSync(path.join(workflowsDir, filename), 'utf8'));

test('all workflow templates are /prompt API format (no UI canvas files)', () => {
  for (const filename of fs.readdirSync(workflowsDir).filter((name) => name.endsWith('.json'))) {
    const raw = readTemplate(filename);
    assert.ok(
      !Array.isArray(raw.nodes),
      `${filename} 仍是 UI 画布格式，请用 ComfyUI「Save (API Format)」重新导出`
    );
    const prompt = ensureApiPromptFormat(raw);
    assert.ok(Object.keys(prompt).length > 0, filename);
    for (const [id, node] of Object.entries(prompt)) {
      assert.ok(node.class_type, `${filename} 节点 ${id} 缺 class_type`);
      assert.ok(node.inputs && typeof node.inputs === 'object', `${filename} 节点 ${id} 缺 inputs`);
    }
  }
});

// 回归：旧画布模板在运行时按位置猜字段名，导致 ComfyUI 400 required_input_missing
// （vae_name / clip_name / resolution / weight_dtype / filename_prefix 全部丢失）
test('character templates keep every loader widget field', () => {
  const required = {
    UNETLoader: ['unet_name', 'weight_dtype'],
    CLIPLoader: ['clip_name', 'type'],
    VAELoader: ['vae_name'],
    LoadImage: ['image'],
    TextEncodeQwenImage21: ['prompt', 'negative_prompt', 'resolution'],
    EmptyLatentImage: ['width', 'height', 'batch_size'],
    KSampler: ['seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
    SaveImage: ['filename_prefix'],
  };
  for (const filename of fs
    .readdirSync(workflowsDir)
    .filter((name) => name.startsWith('comfyui_character_'))) {
    const prompt = ensureApiPromptFormat(readTemplate(filename));
    for (const [id, node] of Object.entries(prompt)) {
      for (const key of required[node.class_type] || []) {
        assert.ok(key in node.inputs, `${filename} 节点 ${id} (${node.class_type}) 缺 ${key}`);
      }
    }
  }
});

test('H3 ref2v video prompt keeps required inputs and rejects UI canvas format', () => {
  const prompt = ensureApiPromptFormat(readTemplate('comfyui_h3_ref2v_6step.json'));
  const ref2vNode = Object.values(prompt).find((n) => n?.class_type === 'MiniMaxH3ReferenceToVideo');
  assert.ok(ref2vNode && ref2vNode.inputs, '必须包含 MiniMaxH3ReferenceToVideo 节点');
  assert.ok('width' in ref2vNode.inputs && 'height' in ref2vNode.inputs && 'length' in ref2vNode.inputs);
  assert.ok(ComfyUITopologyInjector.injectPrompts(prompt, '<Picture 1> 为角色外观基准。\n陈守义缓慢推门进入正厅。'));
  assert.equal(ref2vNode.inputs.prompt, '<Picture 1> 为角色外观基准。\n陈守义缓慢推门进入正厅。');
  assert.throws(() => ensureApiPromptFormat({ nodes: [], links: [] }), /不是 \/prompt API 格式/);
});
