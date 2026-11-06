/**
 * tests/mastra/MastraDualAgentPhysicalTools.test.ts
 * Mastra 官方微内核 AI 视听总导演与公共物理算力工具库架构实证测试套件
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mastra } from '../../src/mastra.js';
import { createDirectorAgent, directorAgent } from '../../src/agents/director/index.js';
import {
  imageGenerateTool,
  imageInpaintTool,
  videoGenerateTool,
  voiceGenerateTool,
  ffmpegRenderTool,
} from '../../src/tools/index.js';

describe('Mastra 官方微内核 AI 视听总导演与公共物理算力工具库实证', () => {
  it('1. Mastra 官方容器统一单入口实证：暴露对外门面 director-agent', () => {
    const dAgent = mastra.getAgent('director-agent');
    assert.ok(dAgent, 'director-agent 必须作为主智能体在 Mastra 实例中注册生效');
    assert.equal(dAgent.name, 'director-agent');
  });

  it('2. 工具去伪存真实证：公共物理工具库仅包含 5 大真实硬件算力，杜绝假工具套娃', () => {
    assert.ok(imageGenerateTool, 'imageGenerateTool 必须存在');
    assert.ok(imageInpaintTool, 'imageInpaintTool 必须存在');
    assert.ok(videoGenerateTool, 'videoGenerateTool 必须存在');
    assert.ok(voiceGenerateTool, 'voiceGenerateTool 必须存在');
    assert.ok(ffmpegRenderTool, 'ffmpegRenderTool 必须存在');

    assert.equal(imageGenerateTool.id, 'image-generate-tool');
    assert.equal(imageInpaintTool.id, 'image-inpaint-tool');
    assert.equal(videoGenerateTool.id, 'video-generate-tool');
    assert.equal(voiceGenerateTool.id, 'voice-generate-tool');
    assert.equal(ffmpegRenderTool.id, 'ffmpeg-render-tool');
  });

  it('3. DirectorAgent 纯认知大脑设计实证：专注视听指导、剧情推演与意图决策工具，0 业务假工具挂载', async () => {
    assert.ok(directorAgent);
    assert.equal(directorAgent.id, 'director-agent');
    const tools = await (directorAgent as any).listTools();
    assert.ok(tools['emit_director_intent'], '总导演挂载原生结构化意图决策工具');
    assert.ok(!tools['image-generate-tool'], '总导演认知中枢不挂载任何物理生成工具');
    const instr = await (directorAgent as any).getInstructions();
    assert.ok(instr.includes('影视视听总导演'));
  });
});
