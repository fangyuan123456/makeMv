/**
 * tests/comfyui-workflows.test.ts
 * 验证 4 套角色 ComfyUI 工作流模板与其转换机制
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureApiPromptFormat } from '../src/media/workflows/comfyui-converter.js';
import { ComfyUIMediaProvider } from '../src/media/providers/ComfyUIMediaProvider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('ComfyUI 角色工作流模板测试', () => {
  const workflowsDir = path.resolve(__dirname, '../src/tools/character-portrait/workflows');

  const targetWorkflows = [
    'comfyui_character_t2i.json',
    'comfyui_character_ref2i.json',
    'comfyui_character_pose_outfit.json',
    'comfyui_character_three_view.json',
  ];

  it('4 个角色工作流文件均已规范重命名并存在于 workflows 目录', () => {
    for (const file of targetWorkflows) {
      const fullPath = path.join(workflowsDir, file);
      assert.strictEqual(fs.existsSync(fullPath), true, `文件 ${file} 应存在`);
      const stat = fs.statSync(fullPath);
      assert.ok(stat.size > 1000, `文件 ${file} 大小应大于 1KB`);
    }
  });

  it('ensureApiPromptFormat 能成功将 4 套 UI 工作流转换为合法的 API Prompt 结构', () => {
    for (const file of targetWorkflows) {
      const fullPath = path.join(workflowsDir, file);
      const raw = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      const apiPrompt = ensureApiPromptFormat(raw);

      assert.strictEqual(typeof apiPrompt, 'object');
      assert.ok(Object.keys(apiPrompt).length > 0);

      for (const [nodeId, nodeData] of Object.entries(apiPrompt)) {
        assert.ok('class_type' in nodeData, `节点 ${nodeId} 缺少 class_type`);
        assert.ok('inputs' in nodeData, `节点 ${nodeId} 缺少 inputs`);
        assert.strictEqual(typeof nodeData.class_type, 'string');
        assert.strictEqual(typeof nodeData.inputs, 'object');
      }
    }
  });

  it('单图三视图与换姿换装工作流转换后节点关键参数映射正确', () => {
    const threeViewPath = path.join(workflowsDir, 'comfyui_character_three_view.json');
    const raw = JSON.parse(fs.readFileSync(threeViewPath, 'utf-8'));
    const apiPrompt = ensureApiPromptFormat(raw);

    // Node 4 是 LoadImage
    assert.strictEqual(apiPrompt['4'].class_type, 'LoadImage');
    assert.strictEqual(apiPrompt['4'].inputs.image, '单角色图.png');

    // Node 5 是 TextEncodeQwenImage21，应该包含 prompt 和连线
    assert.strictEqual(apiPrompt['5'].class_type, 'TextEncodeQwenImage21');
    assert.ok('prompt' in apiPrompt['5'].inputs);
    assert.deepStrictEqual(apiPrompt['5'].inputs.image_1, ['4', 0]);

    // Node 6 是 EmptyLatentImage 1536x768
    assert.strictEqual(apiPrompt['6'].class_type, 'EmptyLatentImage');
    assert.strictEqual(apiPrompt['6'].inputs.width, 1536);
    assert.strictEqual(apiPrompt['6'].inputs.height, 768);
  });

  it('ComfyUIMediaProvider 拥有通用工作流执行能力，CharacterRenderer 能够成功挂载这 4 套工作流路径', () => {
    const provider = new ComfyUIMediaProvider('http://127.0.0.1:8188');
    assert.strictEqual(provider.name, 'comfyui');
    assert.strictEqual(typeof provider.generateImage, 'function');
    assert.strictEqual(typeof provider.generateVideo, 'function');
    assert.strictEqual(typeof provider.executeWorkflow, 'function');
    assert.strictEqual(typeof provider.uploadImage, 'function');

    for (const file of targetWorkflows) {
      const fullPath = path.join(workflowsDir, file);
      assert.strictEqual(fs.existsSync(fullPath), true);
    }
  });
});
