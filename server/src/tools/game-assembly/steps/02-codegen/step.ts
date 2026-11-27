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

  clearInteractionTimers() {
    if (this._timerId) {
      clearInterval(this._timerId);
      this._timerId = null;
    }
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  onSceneEnded(scene) {
    this.clearInteractionTimers();
    if (scene.ending) {
      this.renderEnding(scene.ending);
      return;
    }

    if (scene.interaction && scene.interaction.kind) {
      this.renderInteraction(scene.interaction);
      return;
    }

    const choices = scene.choices || [];
    if (choices.length > 0) {
      this.renderChoices(choices, null, scene.interaction?.prompt);
      return;
    }

    if (scene.next) {
      this.playScene(scene.next);
      return;
    }

    this.renderEnding({
      type: 'NE',
      title: '幕终',
      verdict: '本幕故事已告一段落。'
    });
  }

  completeOutcome(outcome, options = {}) {
    this.clearInteractionTimers();
    if (outcome?.stateChange) {
      this.blackboard.applyChange(outcome.stateChange);
      this.updateHud();
    }

    const nextFn = () => {
      const targetSceneId = outcome?.to || outcome?.targetSceneId || outcome?.nextNodeId;
      if (targetSceneId) {
        this.playScene(targetSceneId);
      } else if (outcome?.ending) {
        this.renderEnding(outcome.ending);
      } else {
        this.renderEnding({ type: 'NE', title: '幕终', verdict: '剧情已推演结束。' });
      }
    };

    if (options.flash) {
      this.interactionEl.innerHTML = '<div class="impact-flash"></div>';
      this.interactionEl.classList.add('is-active');
      setTimeout(nextFn, 180);
      return;
    }

    if (outcome?.feedback) {
      this.interactionEl.innerHTML = \`<div class="feedback-toast">\${outcome.feedback}</div>\`;
      this.interactionEl.classList.add('is-active');
      setTimeout(nextFn, 650);
      return;
    }

    nextFn();
  }

  startCountdown(timeoutSec, barEl, onTimeout) {
    if (!timeoutSec || timeoutSec <= 0 || !barEl) return;
    const totalMs = timeoutSec * 1000;
    const startAt = Date.now();
    this._timerId = setInterval(() => {
      const elapsed = Date.now() - startAt;
      const pct = Math.max(0, 100 - (elapsed / totalMs) * 100);
      barEl.style.width = pct + '%';
      if (elapsed >= totalMs) {
        this.clearInteractionTimers();
        onTimeout();
      }
    }, 50);
  }

  pickOutcome(interaction, preferredKeys) {
    const outcomes = interaction.outcomes || [];
    for (const k of preferredKeys) {
      const found = outcomes.find((o) => String(o.key).toUpperCase() === k);
      if (found) return found;
    }
    return outcomes[0] || null;
  }

  renderInteraction(inter) {
    const kind = String(inter.kind || 'CHOICE').toUpperCase();
    const outcomes = inter.outcomes || [];
    const cfg = inter.config || {};

    if (kind === 'SEARCH') {
      this.renderSearch(inter, cfg, outcomes);
      return;
    }
    if (kind === 'HOLD') {
      this.renderHold(inter, cfg, outcomes);
      return;
    }
    if (kind === 'QTE_TAP') {
      this.renderQteTap(inter, cfg, outcomes);
      return;
    }
    if (kind === 'TIMING') {
      this.renderTiming(inter, cfg, outcomes);
      return;
    }
    if (kind === 'CLICK') {
      this.renderClick(inter, outcomes);
      return;
    }
    if (kind === 'ACTION_ZONE') {
      this.renderActionZones(inter, outcomes);
      return;
    }

    const mappedChoices = outcomes.filter((o) => String(o.key).toUpperCase() !== 'TIMEOUT').map((o) => ({
      text: o.label,
      to: o.to,
      ending: o.ending,
      stateChange: o.stateChange,
      feedback: o.feedback,
    }));
    const timeoutOutcome = outcomes.find((o) => String(o.key).toUpperCase() === 'TIMEOUT') || outcomes[outcomes.length - 1];
    this.renderChoices(mappedChoices, kind === 'TIMED_CHOICE' ? inter.timeoutSec : null, inter.prompt, timeoutOutcome);
  }

  renderSearch(inter, cfg, outcomes) {
    const targets = Array.isArray(cfg.targets) && cfg.targets.length > 0
      ? cfg.targets
      : [{ name: outcomes[0]?.label || '关键线索', feedback: outcomes[0]?.feedback || '找到了关键线索！' }];
    const decoys = Array.isArray(cfg.decoys) ? cfg.decoys : [];
    const items = [
      ...targets.map((t, idx) => ({ ...t, isTarget: true, id: 't_' + idx })),
      ...decoys.map((d, idx) => ({ ...d, isTarget: false, id: 'd_' + idx })),
    ];
    // 确定性安全散落位置（避开边缘与顶部任务栏）
    const slots = [
      { left: '22%', top: '38%' },
      { left: '72%', top: '34%' },
      { left: '48%', top: '62%' },
      { left: '24%', top: '72%' },
      { left: '76%', top: '68%' },
    ];
    const successOutcome = this.pickOutcome(inter, ['FOUND', 'SUCCESS', 'A']) || outcomes[0];
    const timeoutOutcome = this.pickOutcome(inter, ['TIMEOUT', 'FAIL']) || successOutcome;

    const isFlashlight = String(cfg.searchMode || '').toUpperCase() === 'FLASHLIGHT';
    this.interactionEl.innerHTML = \`
      <div class="search-stage\${isFlashlight ? ' is-flashlight' : ''}" id="search-stage">
        \${isFlashlight ? '<div class="flashlight-mask" id="flashlight-mask"></div>' : ''}
        <div class="hook-header">
          <div class="hook-badge">\${isFlashlight ? '暗室探照搜证' : '场景搜证'}</div>
          <div class="hook-prompt">\${inter.prompt || '在画面中寻找关键物品'}</div>
          \${inter.timeoutSec ? '<div class="countdown-track"><div class="countdown-fill" id="hook-cd-fill"></div></div>' : ''}
        </div>
        <div class="search-field">
          \${items.map((it, idx) => {
            const pos = slots[idx % slots.length];
            const imgHtml = it.imageUrl
              ? \`<img class="search-item-img" src="\${it.imageUrl}" alt="\${it.name}" />\`
              : \`<span class="search-item-icon">✦</span>\`;
            return \`
              <button class="search-hotspot" data-idx="\${idx}" style="left:\${pos.left};top:\${pos.top};">
                \${imgHtml}
                <span class="search-item-name">\${it.name}</span>
              </button>
            \`;
          }).join('')}
        </div>
        <div class="search-clue-toast" id="search-clue-toast"></div>
      </div>
    \`;
    this.interactionEl.classList.add('is-active');

    if (isFlashlight) {
      const stageEl = document.getElementById('search-stage');
      const maskEl = document.getElementById('flashlight-mask');
      const updateSpot = (clientX, clientY) => {
        if (!stageEl || !maskEl) return;
        const rect = stageEl.getBoundingClientRect();
        const x = ((clientX - rect.left) / Math.max(1, rect.width)) * 100;
        const y = ((clientY - rect.top) / Math.max(1, rect.height)) * 100;
        maskEl.style.setProperty('--fx', x.toFixed(1) + '%');
        maskEl.style.setProperty('--fy', y.toFixed(1) + '%');
      };
      stageEl?.addEventListener('mousemove', (e) => updateSpot(e.clientX, e.clientY));
      stageEl?.addEventListener('touchmove', (e) => {
        const t = e.touches?.[0];
        if (t) updateSpot(t.clientX, t.clientY);
      }, { passive: true });
    }

    const toastEl = document.getElementById('search-clue-toast');
    let foundCount = 0;
    const totalTargets = targets.length;
    const collectedAdds = { ...(successOutcome?.stateChange?.add || {}) };

    this.interactionEl.querySelectorAll('.search-hotspot').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('is-found') || btn.classList.contains('is-checked')) return;
        const it = items[Number(btn.getAttribute('data-idx'))];
        if (!it) return;
        if (it.isTarget) {
          btn.classList.add('is-found');
          foundCount += 1;
          if (it.stateTag) {
            String(it.stateTag).split(/[+,，\s]+/).map((s) => s.trim()).filter(Boolean).forEach((k) => {
              collectedAdds[k] = 1;
            });
          }
          if (foundCount >= totalTargets) {
            this.completeOutcome({
              ...successOutcome,
              ...(Object.keys(collectedAdds).length > 0 ? { stateChange: { add: collectedAdds } } : {}),
              feedback: it.feedback || successOutcome?.feedback || \`获得：\${it.name}\`,
            });
          } else if (toastEl) {
            toastEl.textContent = (it.feedback || \`找到【\${it.name}】！\`) + \`（已找到 \${foundCount}/\${totalTargets}）\`;
            toastEl.classList.add('is-visible');
          }
        } else {
          btn.classList.add('is-checked');
          if (toastEl) {
            toastEl.textContent = it.feedback || \`只是【\${it.name}】，再找找别处。\`;
            toastEl.classList.add('is-visible');
          }
        }
      });
    });

    if (inter.timeoutSec) {
      this.startCountdown(inter.timeoutSec, document.getElementById('hook-cd-fill'), () => {
        this.completeOutcome(timeoutOutcome);
      });
    }
  }

  renderHold(inter, cfg, outcomes) {
    const holdMs = Number(cfg.holdDurationMs) || 2000;
    const successOutcome = this.pickOutcome(inter, ['SUCCESS', 'A']) || outcomes[0];
    const failOutcome = this.pickOutcome(inter, ['FAIL', 'TIMEOUT', 'B']) || successOutcome;

    this.interactionEl.innerHTML = \`
      <div class="qte-dialog">
        <div class="hook-badge">长按蓄力</div>
        <div class="hook-prompt">\${inter.prompt || '按住屏幕保持动作'}</div>
        \${inter.timeoutSec ? '<div class="countdown-track"><div class="countdown-fill" id="hook-cd-fill"></div></div>' : ''}
        <button class="hold-trigger-btn" id="hold-btn">
          <span class="hold-ring-fill" id="hold-fill"></span>
          <span class="hold-label">按住不放</span>
        </button>
        <div class="qte-hint" id="hold-hint">长按以完成动作</div>
      </div>
    \`;
    this.interactionEl.classList.add('is-active');

    let progress = 0;
    let holding = false;
    let lastTs = 0;
    const fillEl = document.getElementById('hold-fill');
    const hintEl = document.getElementById('hold-hint');
    const btnEl = document.getElementById('hold-btn');

    const tick = (ts) => {
      if (!lastTs) lastTs = ts;
      const dt = ts - lastTs;
      lastTs = ts;
      if (holding) {
        progress = Math.min(100, progress + (dt / holdMs) * 100);
        if (fillEl) fillEl.style.height = progress + '%';
        if (progress >= 100) {
          this.completeOutcome(successOutcome);
          return;
        }
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);

    const startHold = (e) => {
      e.preventDefault();
      holding = true;
      btnEl?.classList.add('is-holding');
      if (hintEl) hintEl.textContent = '保持住……';
    };
    const endHold = () => {
      holding = false;
      btnEl?.classList.remove('is-holding');
      if (progress < 100 && hintEl) {
        hintEl.textContent = '松手了！请重新按住不放';
      }
    };
    btnEl?.addEventListener('mousedown', startHold);
    btnEl?.addEventListener('touchstart', startHold, { passive: false });
    window.addEventListener('mouseup', endHold, { once: false });
    window.addEventListener('touchend', endHold, { once: false });

    if (inter.timeoutSec && inter.isBranching) {
      this.startCountdown(inter.timeoutSec, document.getElementById('hook-cd-fill'), () => {
        this.completeOutcome(failOutcome);
      });
    }
  }

  renderQteTap(inter, cfg, outcomes) {
    const targetTaps = Number(cfg.targetTaps) || 10;
    const successOutcome = this.pickOutcome(inter, ['SUCCESS', 'A']) || outcomes[0];
    const failOutcome = this.pickOutcome(inter, ['FAIL', 'TIMEOUT', 'B']) || successOutcome;
    let taps = 0;

    this.interactionEl.innerHTML = \`
      <div class="qte-dialog">
        <div class="hook-badge">快速连点</div>
        <div class="hook-prompt">\${inter.prompt || '连续点击完成破局'}</div>
        \${inter.timeoutSec ? '<div class="countdown-track"><div class="countdown-fill" id="hook-cd-fill"></div></div>' : ''}
        <div class="tap-bar"><div class="tap-bar-fill" id="tap-fill"></div></div>
        <button class="tap-trigger-btn" id="tap-btn">连点响应！</button>
      </div>
    \`;
    this.interactionEl.classList.add('is-active');

    const fillEl = document.getElementById('tap-fill');
    document.getElementById('tap-btn')?.addEventListener('click', () => {
      taps += 1;
      const pct = Math.min(100, (taps / targetTaps) * 100);
      if (fillEl) fillEl.style.width = pct + '%';
      if (taps >= targetTaps) {
        this.completeOutcome(successOutcome, { flash: true });
      }
    });

    if (inter.timeoutSec && inter.isBranching) {
      this.startCountdown(inter.timeoutSec, document.getElementById('hook-cd-fill'), () => {
        this.completeOutcome(failOutcome);
      });
    }
  }

  renderTiming(inter, cfg, outcomes) {
    const [minPct, maxPct] = Array.isArray(cfg.sweetSpotPct) ? cfg.sweetSpotPct : [38, 62];
    const successOutcome = this.pickOutcome(inter, ['SUCCESS', 'A']) || outcomes[0];
    const failOutcome = this.pickOutcome(inter, ['FAIL', 'TIMEOUT', 'B']) || successOutcome;

    this.interactionEl.innerHTML = \`
      <div class="qte-dialog">
        <div class="hook-badge">时机判定</div>
        <div class="hook-prompt">\${inter.prompt || '指针进入高亮区时点击命中'}</div>
        <div class="timing-track">
          <div class="timing-zone" style="left:\${minPct}%;width:\${maxPct - minPct}%;"></div>
          <div class="timing-cursor" id="timing-cursor"></div>
        </div>
        <button class="tap-trigger-btn" id="timing-btn">立即出手！</button>
        <div class="qte-hint" id="timing-hint">找准时机点击</div>
      </div>
    \`;
    this.interactionEl.classList.add('is-active');

    let pos = 0;
    let dir = 1;
    let lastTs = 0;
    const cursorEl = document.getElementById('timing-cursor');
    const hintEl = document.getElementById('timing-hint');

    const tick = (ts) => {
      if (!lastTs) lastTs = ts;
      const dt = ts - lastTs;
      lastTs = ts;
      pos += dir * (dt * 0.11);
      if (pos >= 100) { pos = 100; dir = -1; }
      if (pos <= 0) { pos = 0; dir = 1; }
      if (cursorEl) cursorEl.style.left = pos + '%';
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);

    document.getElementById('timing-btn')?.addEventListener('click', () => {
      if (pos >= minPct && pos <= maxPct) {
        this.completeOutcome(successOutcome, { flash: true });
      } else if (inter.isBranching) {
        this.completeOutcome(failOutcome);
      } else if (hintEl) {
        hintEl.textContent = '差了一点，重新看准靶区！';
      }
    });
  }

  renderClick(inter, outcomes) {
    const targetOutcome = outcomes[0];
    this.interactionEl.innerHTML = \`
      <div class="qte-dialog">
        <button class="click-pulse-btn" id="click-btn">\${inter.prompt || '点击继续'}</button>
      </div>
    \`;
    this.interactionEl.classList.add('is-active');
    document.getElementById('click-btn')?.addEventListener('click', () => {
      this.completeOutcome(targetOutcome);
    });
  }

  renderActionZones(inter, outcomes) {
    const validOutcomes = outcomes.filter((o) => String(o.key).toUpperCase() !== 'TIMEOUT');
    const timeoutOutcome = outcomes.find((o) => String(o.key).toUpperCase() === 'TIMEOUT') || outcomes[outcomes.length - 1];
    this.interactionEl.innerHTML = \`
      <div class="action-zone-stage">
        <div class="hook-header">
          <div class="hook-badge">动作抉择</div>
          <div class="hook-prompt">\${inter.prompt || '立即做出反应'}</div>
          \${inter.timeoutSec ? '<div class="countdown-track"><div class="countdown-fill" id="hook-cd-fill"></div></div>' : ''}
        </div>
        <div class="action-zone-row">
          \${validOutcomes.map((o, idx) => \`
            <button class="action-zone-btn" data-idx="\${idx}">\${o.label}</button>
          \`).join('')}
        </div>
      </div>
    \`;
    this.interactionEl.classList.add('is-active');
    this.interactionEl.querySelectorAll('.action-zone-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const o = validOutcomes[Number(btn.getAttribute('data-idx'))];
        if (o) this.completeOutcome(o);
      });
    });
    if (inter.timeoutSec) {
      this.startCountdown(inter.timeoutSec, document.getElementById('hook-cd-fill'), () => {
        this.completeOutcome(timeoutOutcome);
      });
    }
  }

  renderChoices(choices, timeoutSec = null, promptText = '请做出你的抉择：', timeoutOutcome = null) {
    this.interactionEl.innerHTML = \`
      <div class="choices-dialog">
        <div class="choices-prompt">\${promptText || '请做出你的抉择：'}</div>
        \${timeoutSec ? '<div class="countdown-track"><div class="countdown-fill" id="choice-cd-fill"></div></div>' : ''}
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
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-index'));
        const choice = choices[idx];
        if (choice) {
          this.handleChoice(choice);
        }
      });
    });

    if (timeoutSec) {
      this.startCountdown(timeoutSec, document.getElementById('choice-cd-fill'), () => {
        this.completeOutcome(timeoutOutcome || choices[choices.length - 1]);
      });
    }
  }

  handleChoice(choice) {
    this.completeOutcome(choice);
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

.hook-header {
  width: 100%;
  max-width: 620px;
  text-align: center;
  margin-bottom: 18px;
}

.hook-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.2);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.45);
  margin-bottom: 8px;
}

.hook-prompt {
  font-size: 16px;
  font-weight: 600;
  color: #f8fafc;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8);
}

.countdown-track {
  width: 100%;
  height: 5px;
  margin-top: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  overflow: hidden;
}

.countdown-fill {
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, #ef4444, #f59e0b);
  transition: width 0.05s linear;
}

.search-stage {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 20px;
}

.flashlight-mask {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
  background: radial-gradient(circle 140px at var(--fx, 50%) var(--fy, 50%), transparent 0%, rgba(2, 6, 23, 0.92) 95%);
}

.search-stage.is-flashlight .hook-header,
.search-stage.is-flashlight .search-clue-toast {
  position: relative;
  z-index: 5;
}

.search-field {
  position: relative;
  width: 100%;
  flex: 1;
}

.search-hotspot {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: rgba(15, 23, 42, 0.78);
  border: 1px solid rgba(245, 158, 11, 0.5);
  border-radius: 12px;
  color: #f8fafc;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 0 18px rgba(245, 158, 11, 0.2);
}

.search-hotspot:hover {
  transform: translate(-50%, -50%) scale(1.06);
  border-color: #fbbf24;
  box-shadow: 0 0 24px rgba(251, 191, 36, 0.45);
}

.search-hotspot.is-checked {
  opacity: 0.45;
  border-color: rgba(148, 163, 184, 0.4);
  box-shadow: none;
}

.search-hotspot.is-found {
  border-color: #10b981;
  box-shadow: 0 0 26px rgba(16, 185, 129, 0.7);
}

.search-item-img {
  width: 54px;
  height: 54px;
  object-fit: cover;
  border-radius: 8px;
}

.search-item-icon {
  font-size: 20px;
  color: #fbbf24;
}

.search-item-name {
  font-size: 12px;
  font-weight: 600;
}

.search-clue-toast {
  min-height: 28px;
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #e2e8f0;
  font-size: 13px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.search-clue-toast.is-visible {
  opacity: 1;
}

.qte-dialog {
  width: 100%;
  max-width: 440px;
  text-align: center;
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(245, 158, 11, 0.4);
  border-radius: 16px;
  padding: 24px;
}

.hold-trigger-btn {
  position: relative;
  overflow: hidden;
  width: 132px;
  height: 132px;
  margin: 18px auto 12px;
  border-radius: 50%;
  border: 2px solid rgba(245, 158, 11, 0.7);
  background: rgba(30, 41, 59, 0.8);
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hold-ring-fill {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 0%;
  background: rgba(245, 158, 11, 0.45);
  transition: height 0.05s linear;
}

.hold-label {
  position: relative;
  z-index: 1;
}

.tap-bar, .timing-track {
  position: relative;
  width: 100%;
  height: 14px;
  margin: 18px 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}

.tap-bar-fill {
  width: 0%;
  height: 100%;
  background: linear-gradient(90deg, #f59e0b, #10b981);
  transition: width 0.08s ease;
}

.timing-zone {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(16, 185, 129, 0.45);
  border-left: 2px solid #34d399;
  border-right: 2px solid #34d399;
}

.timing-cursor {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 4px;
  background: #fbbf24;
  transform: translateX(-50%);
}

.tap-trigger-btn, .click-pulse-btn, .action-zone-btn {
  padding: 12px 24px;
  border-radius: 10px;
  border: 1px solid rgba(245, 158, 11, 0.75);
  background: rgba(245, 158, 11, 0.2);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tap-trigger-btn:hover, .click-pulse-btn:hover, .action-zone-btn:hover {
  background: rgba(245, 158, 11, 0.35);
}

.qte-hint {
  margin-top: 10px;
  font-size: 12px;
  color: #94a3b8;
}

.action-zone-stage {
  width: 100%;
  max-width: 640px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.action-zone-row {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 20px;
  margin-top: 18px;
}

.action-zone-btn {
  flex: 1;
  padding: 18px 20px;
}

.impact-flash {
  position: fixed;
  inset: 0;
  background: rgba(255, 255, 255, 0.85);
  animation: fadeOut 0.18s ease forwards;
}

.feedback-toast {
  padding: 14px 24px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid rgba(245, 158, 11, 0.55);
  color: #f8fafc;
  font-size: 15px;
  font-weight: 600;
}

@keyframes fadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
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
  const effectivePrd: UniversalPrdSpec = input.prd || store.getArtifact(input.projectId, 'prd');
  const title = input.title || effectivePrd?.gameTitle || '未命名互动影游';
  const startSceneId = input.startNodeId || input.script?.startSceneId || effectivePrd?.startNodeId || 'S1';
  const initialState = input.script?.initialState || effectivePrd?.initialState || {};

  let scenes: any[] = (input.scenes && input.scenes.length ? input.scenes : input.script?.scenes) || [];
  if (scenes.length === 0 && effectivePrd?.clips?.length) {
    const filmSpec: any = store.getArtifact(input.projectId, 'film_spec');
    const lookdevEntities: any = store.getArtifact(input.projectId, 'lookdev_entities');
    const storyData: any = store.getArtifact(input.projectId, 'story');

    const itemImgByName = new Map<string, string>();
    for (const item of lookdevEntities?.items || []) {
      const img = item?.imageUrl || item?.url;
      if (item?.name && img) itemImgByName.set(String(item.name).trim(), img);
    }

    const endingMap = new Map<string, any>();
    for (const ed of effectivePrd.endings || []) {
      endingMap.set(ed.id, {
        type: ed.endingType,
        title: ed.title,
        verdict: ed.summary,
        rewindTo: ed.rewindTargetClipId,
      });
    }

    const interactionMap = new Map<string, any>();
    for (const inter of effectivePrd.interactions || []) {
      interactionMap.set(inter.id, inter);
    }

    const wiring = effectivePrd.wiring || [];
    const clipScenes = effectivePrd.clips.map((c: any) => {
      const clipId = c.id || c.clipId;
      const filmAct = (filmSpec?.acts || []).find((a: any) => a.clipId === clipId);
      const storySection = storyData?.[clipId];

      // 寻找当前 clip 的出边
      const clipOutEdge = wiring.find((w: any) => w.from === clipId);
      let nextClipId: string | null = null;
      let attachedInteraction: any = null;
      let attachedChoices: any[] = [];
      let attachedEnding: any = c.ending || null;

      if (clipOutEdge) {
        if (interactionMap.has(clipOutEdge.to)) {
          const inter = interactionMap.get(clipOutEdge.to);
          const interEdges = wiring.filter((w: any) => w.from === inter.id);
          const mappedOutcomes = (inter.outcomes || []).map((o: any) => {
            const edge = interEdges.find((w: any) => w.onOutcome === o.key);
            const targetId = edge?.to;
            const targetEnding = targetId ? endingMap.get(targetId) : undefined;
            return {
              key: o.key,
              label: o.label,
              ...(targetEnding ? { ending: targetEnding } : targetId ? { to: targetId } : {}),
              ...(o.stateChange ? { stateChange: o.stateChange } : {}),
              ...(o.feedback ? { feedback: o.feedback } : {}),
            };
          });

          // 为 SEARCH 道具注入 lookdev 已生成的道具定妆图
          const hydratedConfig = inter.config
            ? {
                ...inter.config,
                targets: Array.isArray(inter.config.targets)
                  ? inter.config.targets.map((t: any) => ({
                      ...t,
                      imageUrl: t.imageUrl || itemImgByName.get(String(t.name || '').trim()),
                    }))
                  : undefined,
                decoys: Array.isArray(inter.config.decoys)
                  ? inter.config.decoys.map((d: any) => ({
                      ...d,
                      imageUrl: d.imageUrl || itemImgByName.get(String(d.name || '').trim()),
                    }))
                  : undefined,
              }
            : undefined;

          attachedInteraction = {
            kind: inter.kind,
            isBranching: inter.isBranching,
            prompt: inter.prompt,
            timeoutSec: inter.timeoutSec ?? null,
            ...(hydratedConfig ? { config: hydratedConfig } : {}),
            outcomes: mappedOutcomes,
          };

          attachedChoices = mappedOutcomes
            .filter((o: any) => String(o.key).toUpperCase() !== 'TIMEOUT')
            .map((o: any) => ({
              text: o.label,
              to: o.to,
              ending: o.ending,
              stateChange: o.stateChange,
            }));
        } else if (endingMap.has(clipOutEdge.to)) {
          attachedEnding = endingMap.get(clipOutEdge.to);
        } else {
          nextClipId = clipOutEdge.to;
        }
      }

      return {
        sceneId: clipId,
        title: c.title,
        text: storySection?.narrativeText || c.narrativeText || c.title || '',
        background: filmAct?.firstFrameUrl || c.backgroundImageUrl || '',
        videoUrl: filmAct?.videoUrl || undefined,
        ...(attachedInteraction ? { interaction: attachedInteraction } : {}),
        ...(nextClipId ? { next: nextClipId } : {}),
        ...(attachedChoices.length ? { choices: attachedChoices } : {}),
        ...(attachedEnding ? { ending: attachedEnding } : {}),
      };
    });

    scenes = clipScenes;
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
