import test from 'node:test';
import assert from 'node:assert/strict';
import { ComfyUITopologyInjector } from '../src/media/providers/ComfyUIMediaProvider.js';

test('🎬 验证工业级图像微调修改自适应降噪引擎 (Adaptive Latent Denoise Engine)', async (t) => {
  await t.test('1. 拓扑注入器能够精确动态修改 KSampler 的 denoise 参数', () => {
    const mockWorkflow: Record<string, any> = {
      '1': { class_type: 'LoadImage', inputs: { image: 'test.png' } },
      '6': {
        class_type: 'KSampler',
        inputs: {
          seed: 12345,
          steps: 25,
          cfg: 1.0,
          denoise: 1.0,
        },
      },
    };

    const injected = ComfyUITopologyInjector.injectSamplerDenoise(mockWorkflow, 0.52);
    assert.equal(injected, true);
    assert.equal(mockWorkflow['6'].inputs.denoise, 0.52, 'KSampler denoise 必须精准被修改为 0.52');

    // 非法值守卫
    const invalidLow = ComfyUITopologyInjector.injectSamplerDenoise(mockWorkflow, -0.1);
    assert.equal(invalidLow, false);
    const invalidHigh = ComfyUITopologyInjector.injectSamplerDenoise(mockWorkflow, 1.5);
    assert.equal(invalidHigh, false);
  });

  await t.test('2. 采样器多节点拓扑 (KSamplerAdvanced) 同样支持注入', () => {
    const mockWorkflow: Record<string, any> = {
      '10': {
        class_type: 'KSamplerAdvanced',
        inputs: {
          denoise: 1.0,
        },
      },
    };

    const injected = ComfyUITopologyInjector.injectSamplerDenoise(mockWorkflow, 0.45);
    assert.equal(injected, true);
    assert.equal(mockWorkflow['10'].inputs.denoise, 0.45);
  });
});
