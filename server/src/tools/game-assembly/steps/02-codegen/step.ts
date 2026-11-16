/**
 * tools/game-assembly/steps/02-codegen/step.ts
 * 互动影游确定性代码装配工序执行器 (codegenStep SSOT)
 *
 * 核心哲学：
 * 彻底消灭 12 轮 LLM 虚拟机的过度设计！
 * 基于生产级底座 player.js 与项目真实剧本分幕，毫秒级直接装配高保真 ES Module 互动影游工程。
 */

import { createStep } from '@mastra/core/workflows';
import path from 'path';
import fs from 'fs';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import {
  CodegenStepInputSchema,
  CodegenStepOutputSchema,
  type CodegenStepInput,
  type CodegenStepOutput,
} from './schema.js';
import type { TechPlanStepOutput } from '../01-tech-plan/schema.js';
import { RUNTIME_FILES } from './runtime-files.js';
import type { UniversalPrdSpec } from '../../../../project-store/contracts/planner/index.js';

export function generateIndexHtml(title: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>${title}</title>
  <link rel="stylesheet" href="./runtime/player.css" />
  <link rel="stylesheet" href="./style.css" />
</head>
<body>
  <div id="app"></div>
  <script type="module" src="./js/main.js"></script>
</body>
</html>
`;
}

export function generateMainJs(params: {
  title: string;
  startSceneId: string;
  initialState: Record<string, any>;
  scenes: any[];
}): string {
  const { title, startSceneId, initialState, scenes } = params;
  const embeddedScript = {
    title,
    startSceneId,
    initialState,
    scenes: scenes || [],
  };

  return `/**
 * js/main.js
 * 互动影游自主装配运行时核心驱动入口 (ES Module)
 */

import { play } from '../runtime/player.js';

// 内嵌分幕工程数据
const SCRIPT_DATA = ${JSON.stringify(embeddedScript, null, 2)};

class StateBlackboard {
  constructor(initialState = {}) {
    this.state = { ...initialState };
    this.history = [];
  }

  get(key) {
    return this.state[key];
  }

  set(key, val) {
    this.state[key] = val;
  }

  applyChange(change = {}) {
    if (change.add) {
      for (const [k, v] of Object.entries(change.add)) {
        this.state[k] = (this.state[k] || 0) + Number(v);
      }
    }
    if (change.set) {
      for (const [k, v] of Object.entries(change.set)) {
        this.state[k] = v;
      }
    }
  }

  snapshot(sceneId) {
    this.history.push({ sceneId, state: { ...this.state } });
  }
}

class InteractiveGameCockpit {
  constructor(hostEl, scriptData) {
    this.host = hostEl;
    this.script = scriptData;
    this.blackboard = new StateBlackboard(scriptData.initialState || {});
    this.currentSceneId = scriptData.startSceneId || (scriptData.scenes[0] && scriptData.scenes[0].sceneId) || 'S1';
  }

  init() {
    this.host.innerHTML = \`
      <div class="cockpit-container">
        <div class="hud-header">
          <div class="game-title">\${this.script.title || '互动影游'}</div>
          <div class="status-tags" id="hud-status"></div>
        </div>
        <div class="stage-viewport" id="stage-viewport"></div>
        <div class="interaction-layer" id="interaction-layer"></div>
      </div>
    \`;

    this.viewportEl = document.getElementById('stage-viewport');
    this.interactionEl = document.getElementById('interaction-layer');
    this.statusEl = document.getElementById('hud-status');

    this.updateHud();
    this.playScene(this.currentSceneId);
  }

  updateHud() {
    if (!this.statusEl) return;
    const items = Object.entries(this.blackboard.state)
      .filter(([_, v]) => typeof v === 'number' || typeof v === 'boolean')
      .map(([k, v]) => \`<span class="hud-badge">\${k}: \${v}</span>\`);
    this.statusEl.innerHTML = items.join('');
  }

  findScene(sceneId) {
    return this.script.scenes.find((s) => s.sceneId === sceneId || s.id === sceneId) || null;
  }

  playScene(sceneId) {
    this.currentSceneId = sceneId;
    this.blackboard.snapshot(sceneId);
    this.interactionEl.innerHTML = '';
    this.interactionEl.classList.remove('is-active');

    const scene = this.findScene(sceneId);
    if (!scene) {
      this.renderEnding({
        type: 'BE',
        title: '信号中断',
        verdict: \`未找到分幕节点 [\${sceneId}]，剧情推演未收敛。\`
      });
      return;
    }

    // 优先读取视频，若无视频直接交付 scene 分幕对象由 player 渲染背景/关键帧/打字机，彻底杜绝 404
    const mediaSource = scene.videoUrl || scene.video || scene;

    play(this.viewportEl, mediaSource, () => {
      this.onSceneEnded(scene);
    });
  }

  onSceneEnded(scene) {
    if (scene.ending) {
      this.renderEnding(scene.ending);
      return;
    }

    const choices = scene.choices || [];
    if (choices.length === 0) {
      this.renderEnding({
        type: 'NE',
        title: '幕终',
        verdict: '本幕故事已告一段落。'
      });
      return;
    }

    this.renderChoices(choices);
  }

  renderChoices(choices) {
    this.interactionEl.innerHTML = \`
      <div class="choices-dialog">
        <div class="choices-prompt">请做出你的抉择：</div>
        <div class="choices-list">
          \${choices.map((c, idx) => \`
            <button class="choice-btn" data-index="\${idx}">
              <span class="choice-index">0\${idx + 1}</span>
              <span class="choice-text">\${c.text || c.label}</span>
            </button>
          \`).join('')}
        </div>
      </div>
    \`;
    this.interactionEl.classList.add('is-active');

    const buttons = this.interactionEl.querySelectorAll('.choice-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = Number(btn.getAttribute('data-index'));
        const choice = choices[idx];
        if (choice) {
          this.handleChoice(choice);
        }
      });
    });
  }

  handleChoice(choice) {
    if (choice.stateChange) {
      this.blackboard.applyChange(choice.stateChange);
      this.updateHud();
    }
    const targetSceneId = choice.to || choice.targetSceneId || choice.nextNodeId;
    if (targetSceneId) {
      this.playScene(targetSceneId);
    } else if (choice.ending) {
      this.renderEnding(choice.ending);
    }
  }

  renderEnding(ending) {
    this.interactionEl.innerHTML = \`
      <div class="ending-card ending-\${(ending.type || 'NE').toLowerCase()}">
        <div class="ending-badge">\${ending.type || 'ENDING'}</div>
        <h2 class="ending-title">\${ending.title || '故事结局'}</h2>
        <p class="ending-verdict">\${ending.verdict || ending.summary || '感谢体验'}</p>
        <button class="restart-btn" id="btn-restart">重新推演</button>
      </div>
    \`;
    this.interactionEl.classList.add('is-active');

    document.getElementById('btn-restart')?.addEventListener('click', () => {
      window.location.reload();
    });
  }
}

// 自动挂载启动
document.addEventListener('DOMContentLoaded', () => {
  const app = document.getElementById('app');
  if (app) {
    const cockpit = new InteractiveGameCockpit(app, SCRIPT_DATA);
    cockpit.init();
  }
});
`;
}

export function generateStyleCss(): string {
  return `/**
 * style.css
 * 互动影游专业级电影视听舞台与交互 HUD 样式
 */

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body, html {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: #000;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: #fff;
  user-select: none;
}

#app {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at center, #0f172a 0%, #020617 100%);
}

.cockpit-container {
  position: relative;
  width: 100%;
  height: 100%;
  max-width: 1920px;
  max-height: 1080px;
  aspect-ratio: 16 / 9;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.hud-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: linear-gradient(180deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%);
  pointer-events: none;
}

.game-title {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #f59e0b;
  text-transform: uppercase;
}

.hud-badge {
  display: inline-block;
  margin-left: 8px;
  padding: 4px 10px;
  font-size: 11px;
  font-family: monospace;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 9999px;
  color: #cbd5e1;
  backdrop-filter: blur(8px);
}

.stage-viewport {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 10;
  background: #000;
}

.interaction-layer {
  position: absolute;
  inset: 0;
  z-index: 300;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
  padding: 24px;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.interaction-layer.is-active {
  display: flex;
  opacity: 1;
}

.choices-dialog {
  width: 100%;
  max-width: 560px;
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(245, 158, 11, 0.4);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.8), 0 0 20px rgba(245, 158, 11, 0.15);
  animation: slideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.choices-prompt {
  font-size: 13px;
  font-weight: 600;
  color: #94a3b8;
  margin-bottom: 16px;
  letter-spacing: 0.5px;
}

.choices-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.choice-btn {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 14px 18px;
  background: rgba(30, 41, 59, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  color: #f1f5f9;
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
}

.choice-btn:hover {
  background: rgba(245, 158, 11, 0.2);
  border-color: rgba(245, 158, 11, 0.8);
  transform: translateX(4px);
  color: #fff;
}

.choice-index {
  font-family: monospace;
  font-size: 11px;
  font-weight: 700;
  color: #f59e0b;
  margin-right: 12px;
  padding: 2px 6px;
  background: rgba(245, 158, 11, 0.15);
  border-radius: 4px;
}

.ending-card {
  width: 100%;
  max-width: 500px;
  text-align: center;
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 20px;
  padding: 36px 28px;
  box-shadow: 0 25px 50px rgba(0,0,0,0.9);
  animation: zoomIn 0.35s ease;
}

.ending-card.ending-he {
  border-color: rgba(16, 185, 129, 0.6);
  box-shadow: 0 0 30px rgba(16, 185, 129, 0.2);
}

.ending-card.ending-be {
  border-color: rgba(239, 68, 68, 0.6);
  box-shadow: 0 0 30px rgba(239, 68, 68, 0.2);
}

.ending-badge {
  display: inline-block;
  font-family: monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 2px;
  padding: 4px 12px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.1);
  color: #e2e8f0;
  margin-bottom: 16px;
}

.ending-title {
  font-size: 22px;
  font-weight: 800;
  margin-bottom: 12px;
  color: #fff;
}

.ending-verdict {
  font-size: 13px;
  line-height: 1.6;
  color: #94a3b8;
  margin-bottom: 24px;
}

.restart-btn {
  padding: 10px 24px;
  font-size: 13px;
  font-weight: 600;
  background: #f59e0b;
  border: none;
  border-radius: 8px;
  color: #000;
  cursor: pointer;
  transition: opacity 0.2s;
}

.restart-btn:hover {
  opacity: 0.9;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes zoomIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
`;
}

export async function executeCodegenStep(
  input: CodegenStepInput
): Promise<CodegenStepOutput> {
  const store = ProjectStore.getInstance();
  const projectDir = store.getProjectDir(input.projectId);
  const gameAssemblyDir = path.resolve(projectDir, 'game-assembly');
  const jsDir = path.resolve(gameAssemblyDir, 'js');
  const runtimeDir = path.resolve(gameAssemblyDir, 'runtime');

  // 1. 初始化目标目录
  fs.mkdirSync(jsDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });

  // 2. 写入底座文件 (player.js & player.css)
  for (const file of RUNTIME_FILES) {
    const target = path.resolve(gameAssemblyDir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, 'utf-8');
  }

  // 3. 提取分幕与初始状态
  const effectivePrd: UniversalPrdSpec = input.prd || store.getArtifact(input.projectId, 'universal_prd') || store.getArtifact(input.projectId, 'prd');
  const title = input.title || effectivePrd?.gameTitle || '未命名互动影游';
  const startSceneId = input.startNodeId || input.script?.startSceneId || effectivePrd?.startNodeId || 'S1';
  const initialState = input.script?.initialState || effectivePrd?.initialState || {};

  let scenes: any[] = (input.scenes && input.scenes.length ? input.scenes : input.script?.scenes) || [];
  if (scenes.length === 0 && effectivePrd?.clips?.length) {
    scenes = effectivePrd.clips.map((c: any) => ({
      sceneId: c.id || c.clipId,
      title: c.title,
      text: c.narrativeText || c.title || '',
      background: c.backgroundImageUrl || '',
      choices: (c.choices || []).map((ch: any) => ({
        text: ch.text || ch.label,
        to: ch.to || ch.targetSceneId || ch.nextNodeId,
      })),
      ending: c.ending,
    }));
  }

  // 4. 写入 index.html
  const indexHtmlPath = path.resolve(gameAssemblyDir, 'index.html');
  fs.writeFileSync(indexHtmlPath, generateIndexHtml(title), 'utf-8');

  // 5. 写入 js/main.js
  const mainJsPath = path.resolve(jsDir, 'main.js');
  fs.writeFileSync(
    mainJsPath,
    generateMainJs({ title, startSceneId, initialState, scenes }),
    'utf-8'
  );

  // 6. 写入 style.css
  const styleCssPath = path.resolve(gameAssemblyDir, 'style.css');
  fs.writeFileSync(styleCssPath, generateStyleCss(), 'utf-8');

  const generatedFiles = [
    'game-assembly/index.html',
    'game-assembly/js/main.js',
    'game-assembly/style.css',
    'game-assembly/runtime/player.js',
    'game-assembly/runtime/player.css',
  ];

  const indexRel = path.relative(projectDir, indexHtmlPath).split(path.sep).join('/');

  return {
    projectId: input.projectId,
    generatedFiles,
    rounds: 1,
    indexPath: indexRel,
    success: true,
  };
}

export const codegenStep = createStep({
  id: 'codegen-step',
  description: '按技术拓扑确定性装配原生 ES Module 互动影游前端运行时与 index.html 可玩入口',
  inputSchema: CodegenStepInputSchema,
  outputSchema: CodegenStepOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const originalInput = ctx.triggerData || ctx.inputData || ctx;
    const projectId = originalInput?.projectId || ctx.projectId;

    const result = await executeCodegenStep({
      projectId,
      ...originalInput,
    });

    return result;
  },
});
