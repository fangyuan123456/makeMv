/**
 * agents/text-game/steps/codegen/step.ts
 * 互动文游代码生成工序 (codegenStep) - 基于 Mastra 官方微内核原生 Step
 *
 * 核心产出：
 * 1. SceneTypes.ts: 强类型数据契约
 * 2. StateBlackboard.ts: 全局状态黑板与时光倒流快照
 * 3. SceneLoader.ts: 无清单自驱动独立分幕加载器
 * 4. InteractiveShell.ts: 竖屏四层视听沉浸交互座舱
 * 5. main.ts: 启动入口
 */

import { createStep } from '@mastra/core/workflows';
import path from 'path';
import fs from 'fs';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { runTaskRecordedStep } from '../../../../workflow-engine/TaskStore.js';
import {
  CodegenInputSchema,
  CodegenOutputSchema,
  type CodegenInput,
  type CodegenOutput,
} from './schema.js';

export function getSceneTypesCode(): string {
  return `/**
 * SceneTypes.ts - 独立分幕原子契约定义 (对齐 Stage 1 UniversalPrdSpec)
 */

export type PrdStateValue = number | boolean | string | string[];

export interface PrdStateChange {
  add?: Record<string, number>;
  set?: Record<string, PrdStateValue>;
}

export interface PrdInteractionOutcome {
  key: string;
  label: string;
  stateChange?: PrdStateChange;
  feedback?: string;
}

export interface PrdInteractionNode {
  id: string;
  kind: string;
  prompt: string;
  timeoutSec: number | null;
  config?: Record<string, any>;
  outcomes: PrdInteractionOutcome[];
}

export interface PrdEndingNode {
  id: string;
  endingType: 'TE' | 'HE' | 'BE' | 'NE' | 'SE';
  title: string;
  isVictory: boolean;
  summary: string;
  rewindTargetClipId?: string;
}

export interface PrdTransitionCard {
  text: string;
  durationSec: number;
}

export interface PrdWiringEdge {
  from: string;
  onOutcome: string;
  condition: string | null;
  transition: PrdTransitionCard | null;
  to: string;
}

export interface SceneDialogueLine {
  speaker: string;
  line: string;
  emotion?: string;
  audioClipPath?: string;
}

export interface SceneChoiceItem {
  choiceId: string;
  text: string;
  nextSceneJson: string;
  stateChange?: PrdStateChange;
  condition?: string | null;
}

export interface SingleSceneJson {
  sceneId: string;
  level: number;
  title: string;
  targetVideoClipName: string;
  estimatedDurationSeconds: number;
  entityIds?: string[];
  entityRefs?: Record<string, string>;
  visualAnchor: {
    endFrameMoment: string;
    cameraAngle: string;
    lighting: string;
    promptZh: string;
    promptEn: string;
    assembledPrompt?: string;
    sceneImagePath?: string;
    sceneImageUrl?: string;
  };
  screenplay: {
    storyContext: string;
    videoActionDescription: string;
    dialogues: SceneDialogueLine[];
  };
  interaction: {
    steps: PrdInteractionNode[];
    wiring: PrdWiringEdge[];
    endings: PrdEndingNode[];
    choices: SceneChoiceItem[];
    isEnding: boolean;
    endingType?: 'HE' | 'BE' | 'NE' | 'TE' | 'SE';
    endingTitle?: string;
    verdict?: string;
    rewindTargetScene?: string;
  };
}
`;
}

export function getStateBlackboardCode(): string {
  return `/**
 * StateBlackboard.ts - 全局流外状态黑板、安全条件求值器与回溯快照管理
 */

import { PrdStateChange, PrdStateValue } from './SceneTypes';

export interface StateSnapshot {
  sceneFileName: string;
  state: Record<string, PrdStateValue>;
  timestamp: number;
}

export class StateBlackboard {
  private initialState: Record<string, PrdStateValue>;
  private state: Record<string, PrdStateValue>;
  private history: StateSnapshot[] = [];

  constructor(initialState: Record<string, PrdStateValue> = {}) {
    this.initialState = this.cloneState(initialState);
    this.state = this.cloneState(initialState);
  }

  private cloneState(src: Record<string, PrdStateValue>): Record<string, PrdStateValue> {
    const out: Record<string, PrdStateValue> = {};
    for (const k of Object.keys(src || {})) {
      const v = src[k];
      out[k] = Array.isArray(v) ? [...v] : v;
    }
    return out;
  }

  public resetToInitial(): void {
    this.state = this.cloneState(this.initialState);
    this.history = [];
  }

  public getAllVariables(): Record<string, PrdStateValue> {
    return this.cloneState(this.state);
  }

  public getVariable(key: string, defaultValue: any = 0): any {
    return this.state[key] !== undefined ? this.state[key] : defaultValue;
  }

  public setVariable(key: string, value: PrdStateValue): void {
    this.state[key] = Array.isArray(value) ? [...value] : value;
  }

  public applyStateChange(change?: PrdStateChange): void {
    if (!change) return;
    if (change.add) {
      for (const [k, delta] of Object.entries(change.add)) {
        const cur = typeof this.state[k] === 'number' ? (this.state[k] as number) : 0;
        this.state[k] = cur + delta;
      }
    }
    if (change.set) {
      for (const [k, val] of Object.entries(change.set)) {
        this.state[k] = Array.isArray(val) ? [...val] : val;
      }
    }
  }

  public evaluateCondition(condition?: string | null): boolean {
    if (!condition || condition === 'default') return true;
    const trimmed = condition.trim();
    if (!trimmed) return true;
    try {
      return Boolean(this.evalExpr(trimmed));
    } catch {
      return false;
    }
  }

  private evalExpr(expr: string): any {
    const tokens: Array<{ type: string; val: any }> = [];
    let i = 0;
    const isSpace = (c: string) => c === ' ' || c === '\\t' || c === '\\n' || c === '\\r';
    const isDigit = (c: string) => c >= '0' && c <= '9';
    const isAlpha = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';

    while (i < expr.length) {
      const ch = expr[i];
      if (isSpace(ch)) { i++; continue; }
      if (ch === '(') { tokens.push({ type: '(', val: '(' }); i++; continue; }
      if (ch === ')') { tokens.push({ type: ')', val: ')' }); i++; continue; }
      if (ch === '.') { tokens.push({ type: '.', val: '.' }); i++; continue; }
      if (expr.startsWith('&&', i)) { tokens.push({ type: '&&', val: '&&' }); i += 2; continue; }
      if (expr.startsWith('||', i)) { tokens.push({ type: '||', val: '||' }); i += 2; continue; }
      if (expr.startsWith('===', i)) { tokens.push({ type: 'op', val: '===' }); i += 3; continue; }
      if (expr.startsWith('!==', i)) { tokens.push({ type: 'op', val: '!==' }); i += 3; continue; }
      if (expr.startsWith('==', i)) { tokens.push({ type: 'op', val: '==' }); i += 2; continue; }
      if (expr.startsWith('!=', i)) { tokens.push({ type: 'op', val: '!=' }); i += 2; continue; }
      if (expr.startsWith('>=', i)) { tokens.push({ type: 'op', val: '>=' }); i += 2; continue; }
      if (expr.startsWith('<=', i)) { tokens.push({ type: 'op', val: '<=' }); i += 2; continue; }
      if (ch === '>' || ch === '<') { tokens.push({ type: 'op', val: ch }); i++; continue; }
      if (ch === '!') { tokens.push({ type: '!', val: '!' }); i++; continue; }

      if (ch.charCodeAt(0) === 39 || ch.charCodeAt(0) === 34) {
        const q = ch;
        i++;
        let s = '';
        while (i < expr.length && expr[i] !== q) {
          s += expr[i++];
        }
        i++;
        tokens.push({ type: 'str', val: s });
        continue;
      }

      if (isDigit(ch) || (ch === '-' && i + 1 < expr.length && isDigit(expr[i + 1]))) {
        let numStr = ch;
        i++;
        while (i < expr.length && (isDigit(expr[i]) || expr[i] === '.')) {
          numStr += expr[i++];
        }
        tokens.push({ type: 'num', val: Number(numStr) });
        continue;
      }

      if (isAlpha(ch)) {
        let id = '';
        while (i < expr.length && (isAlpha(expr[i]) || isDigit(expr[i]))) {
          id += expr[i++];
        }
        if (id === 'true') tokens.push({ type: 'bool', val: true });
        else if (id === 'false') tokens.push({ type: 'bool', val: false });
        else if (id === 'null') tokens.push({ type: 'null', val: null });
        else tokens.push({ type: 'ident', val: id });
        continue;
      }

      i++;
    }

    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];

    const parseOr = (): any => {
      let left = parseAnd();
      while (peek()?.type === '||') {
        next();
        const right = parseAnd();
        left = Boolean(left) || Boolean(right);
      }
      return left;
    };

    const parseAnd = (): any => {
      let left = parseUnary();
      while (peek()?.type === '&&') {
        next();
        const right = parseUnary();
        left = Boolean(left) && Boolean(right);
      }
      return left;
    };

    const parseUnary = (): any => {
      if (peek()?.type === '!') {
        next();
        return !parseUnary();
      }
      return parseCompare();
    };

    const parseCompare = (): any => {
      const left = parsePrimary();
      const opTok = peek();
      if (opTok?.type === 'op') {
        next();
        const right = parsePrimary();
        switch (opTok.val) {
          case '===': return left === right;
          case '!==': return left !== right;
          case '==': return left == right;
          case '!=': return left != right;
          case '>=': return left >= right;
          case '<=': return left <= right;
          case '>': return left > right;
          case '<': return left < right;
        }
      }
      return left;
    };

    const parsePrimary = (): any => {
      const t = next();
      if (!t) return false;
      if (t.type === '(') {
        const v = parseOr();
        if (peek()?.type === ')') next();
        return v;
      }
      if (t.type === 'num' || t.type === 'str' || t.type === 'bool' || t.type === 'null') {
        return t.val;
      }
      if (t.type === 'ident') {
        let val: any = this.state[t.val];
        while (peek()?.type === '.') {
          next();
          const prop = next();
          if (prop?.val === 'includes' && peek()?.type === '(') {
            next();
            const arg = parseOr();
            if (peek()?.type === ')') next();
            val = Array.isArray(val) ? val.includes(arg) : false;
          } else if (prop?.val === 'length') {
            val = val && typeof val.length === 'number' ? val.length : 0;
          }
        }
        return val;
      }
      return false;
    };

    return parseOr();
  }

  public createSnapshot(sceneFileName: string): void {
    this.history.push({
      sceneFileName,
      state: this.cloneState(this.state),
      timestamp: Date.now(),
    });
  }

  public restoreSnapshot(targetSceneFileName: string): boolean {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const snap = this.history[i];
      if (snap.sceneFileName === targetSceneFileName) {
        this.state = this.cloneState(snap.state);
        this.history = this.history.slice(0, i + 1);
        return true;
      }
    }
    return false;
  }
}
`;
}

export function getSceneLoaderCode(): string {
  return `/**
 * SceneLoader.ts - 无清单自驱动独立分幕加载与有序接线引擎
 */

import { SingleSceneJson, PrdWiringEdge, PrdStateChange } from './SceneTypes';
import { StateBlackboard } from './StateBlackboard';

export class SceneLoader {
  private cache = new Map<string, SingleSceneJson>();
  private currentScene: SingleSceneJson | null = null;
  private basePath: string;
  private blackboard: StateBlackboard;

  constructor(basePath: string = '../scenes', blackboard?: StateBlackboard) {
    this.basePath = basePath;
    this.blackboard = blackboard || new StateBlackboard();
  }

  public getBlackboard(): StateBlackboard {
    return this.blackboard;
  }

  public getCurrentScene(): SingleSceneJson | null {
    return this.currentScene;
  }

  public async loadScene(sceneFileName: string): Promise<SingleSceneJson> {
    const cleanName = sceneFileName.endsWith('.json') ? sceneFileName : \`\${sceneFileName}.json\`;

    if (this.cache.has(cleanName)) {
      const scene = this.cache.get(cleanName)!;
      this.currentScene = scene;
      return scene;
    }

    const res = await fetch(\`\${this.basePath}/\${cleanName}\`);
    if (!res.ok) {
      throw new Error(\`[SceneLoader] 无法加载场景配置文件: \${cleanName} (HTTP \${res.status})\`);
    }

    const scene: SingleSceneJson = await res.json();
    this.cache.set(cleanName, scene);
    this.currentScene = scene;
    return scene;
  }

  public matchWiringEdge(
    fromId: string,
    outcomeKey: string,
    wiring: PrdWiringEdge[]
  ): PrdWiringEdge | null {
    for (const edge of wiring || []) {
      if (edge.from !== fromId) continue;
      if (edge.onOutcome !== outcomeKey && edge.onOutcome !== '*') continue;
      if (this.blackboard.evaluateCondition(edge.condition)) {
        return edge;
      }
    }
    return null;
  }

  public async navigateTo(
    nextSceneFileName: string,
    stateChange?: PrdStateChange
  ): Promise<SingleSceneJson> {
    if (this.currentScene) {
      this.blackboard.createSnapshot(\`\${this.currentScene.sceneId}.json\`);
    }
    this.blackboard.applyStateChange(stateChange);
    return await this.loadScene(nextSceneFileName);
  }

  public async rewindTo(targetSceneFileName: string): Promise<SingleSceneJson> {
    this.blackboard.restoreSnapshot(targetSceneFileName);
    return await this.loadScene(targetSceneFileName);
  }
}
`;
}

export function getInteractiveShellCode(): string {
  return `/**
 * InteractiveShell.ts - 通用 onEnded 互动影游交互座舱渲染器
 */

import { SceneLoader } from './SceneLoader';
import { SingleSceneJson, PrdInteractionNode, PrdInteractionOutcome, PrdEndingNode, PrdWiringEdge } from './SceneTypes';

export class InteractiveShell {
  private loader: SceneLoader;
  private container!: HTMLElement;
  private startSceneFileName: string = 'S1.json';
  private currentDialogueIndex: number = 0;
  private endedTriggered: boolean = false;
  private activeTimer: number | null = null;
  private countdownInterval: number | null = null;

  constructor(loader?: SceneLoader) {
    this.loader = loader || new SceneLoader();
  }

  private clearTimers(): void {
    if (this.activeTimer !== null) {
      window.clearTimeout(this.activeTimer);
      this.activeTimer = null;
    }
    if (this.countdownInterval !== null) {
      window.clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  public async mount(container: HTMLElement, startSceneFileName: string = 'S1.json'): Promise<void> {
    this.container = container;
    this.startSceneFileName = startSceneFileName.endsWith('.json')
      ? startSceneFileName
      : \`\${startSceneFileName}.json\`;
    this.injectStyles();
    this.container.innerHTML = \`
      <div class="shell-viewport">
        <!-- 1. 顶部 HUD -->
        <header class="shell-hud">
          <div class="hud-item"><span class="label">当前场景</span><span id="hud-scene-title" class="val">--</span></div>
          <div class="hud-item"><span class="label">流外状态</span><span id="hud-vars" class="val">--</span></div>
        </header>

        <!-- 2. 背景与运镜画幅 (铺满 16:9 画幅) -->
        <div class="shell-stage">
          <img id="stage-bg-image" class="stage-bg" src="" alt="背景" />
          <div class="stage-overlay"></div>
          <div id="camera-watermark" class="camera-tag">机位：稳健推进</div>
          <div id="feedback-toast" class="feedback-toast" style="display:none"></div>
        </div>

        <!-- 3 & 4. 底部电影对白字幕与互动选项区 (横向分栏 1fr 380px) -->
        <div class="shell-bottom-bar">
          <div class="shell-screenplay">
            <div id="speaker-badge" class="speaker-tag">--</div>
            <div id="dialogue-text" class="dialogue-content">--</div>
            <div id="dialogue-next-tip" class="next-tip">点击继续 ▼</div>
          </div>
          <div id="choices-container" class="shell-choices"></div>
        </div>

        <!-- 5. 过场提示卡与结局覆盖层 -->
        <div id="transition-modal" class="ending-overlay" style="display:none">
          <div class="ending-card">
            <p id="transition-text" class="dialogue-content"></p>
          </div>
        </div>
        <div id="ending-modal" class="ending-overlay" style="display:none">
          <div class="ending-card">
            <div id="ending-badge" class="speaker-tag">结局</div>
            <h2 id="ending-title" class="ending-title"></h2>
            <p id="ending-verdict" class="ending-verdict"></p>
            <div id="ending-actions" class="ending-btn-group"></div>
          </div>
        </div>
      </div>
    \`;

    const screenplayArea = this.container.querySelector('.shell-screenplay') as HTMLElement;
    screenplayArea.addEventListener('click', () => this.advanceDialogue());

    const scene = await this.loader.loadScene(this.startSceneFileName);
    this.renderScene(scene);
  }

  private updateHud(scene?: SingleSceneJson): void {
    const titleEl = document.getElementById('hud-scene-title');
    const varsEl = document.getElementById('hud-vars');
    if (scene && titleEl) titleEl.innerText = scene.title;
    if (varsEl) {
      const vars = this.loader.getBlackboard().getAllVariables();
      const summary = Object.entries(vars)
        .map(([k, v]) => \`\${k}: \${Array.isArray(v) ? v.join(',') : String(v)}\`)
        .join(' | ');
      varsEl.innerText = summary || '无';
    }
  }

  private renderScene(scene: SingleSceneJson): void {
    this.clearTimers();
    this.currentDialogueIndex = 0;
    this.endedTriggered = false;

    const choicesEl = document.getElementById('choices-container');
    const endingModal = document.getElementById('ending-modal');
    const transModal = document.getElementById('transition-modal');
    const toastEl = document.getElementById('feedback-toast');
    if (choicesEl) choicesEl.innerHTML = '';
    if (endingModal) endingModal.style.display = 'none';
    if (transModal) transModal.style.display = 'none';
    if (toastEl) toastEl.style.display = 'none';

    this.updateHud(scene);

    const bgImg = document.getElementById('stage-bg-image') as HTMLImageElement;
    const cameraEl = document.getElementById('camera-watermark');
    if (bgImg) {
      bgImg.src = scene.visualAnchor.sceneImagePath
        ? \`../\${scene.visualAnchor.sceneImagePath}\`
        : '';
    }
    if (cameraEl) {
      cameraEl.innerText = \`📷 \${scene.visualAnchor.cameraAngle || '叙事视角'}\`;
    }

    this.advanceDialogue();
  }

  private advanceDialogue(): void {
    const scene = this.loader.getCurrentScene();
    if (!scene) return;
    const dialogues = scene.screenplay.dialogues || [];
    if (dialogues.length === 0) {
      if (!this.endedTriggered) {
        this.endedTriggered = true;
        this.triggerOnEnded(scene);
      }
      return;
    }

    if (this.currentDialogueIndex >= dialogues.length) {
      this.currentDialogueIndex = dialogues.length - 1;
    }

    const d = dialogues[this.currentDialogueIndex];
    const spkEl = document.getElementById('speaker-badge');
    const txtEl = document.getElementById('dialogue-text');
    const tipEl = document.getElementById('dialogue-next-tip');

    if (spkEl) spkEl.innerText = d.speaker;
    if (txtEl) txtEl.innerText = d.line;

    if (this.currentDialogueIndex < dialogues.length - 1) {
      this.currentDialogueIndex++;
      if (tipEl) tipEl.style.visibility = 'visible';
    } else {
      if (tipEl) tipEl.style.visibility = 'hidden';
      if (!this.endedTriggered) {
        this.endedTriggered = true;
        this.triggerOnEnded(scene);
      }
    }
  }

  private triggerOnEnded(scene: SingleSceneJson): void {
    const edge = this.loader.matchWiringEdge(
      scene.sceneId,
      'onEnded',
      scene.interaction.wiring || []
    );
    if (edge) {
      this.followWiringEdge(scene, edge);
      return;
    }

    if (scene.interaction.isEnding) {
      this.showEnding(scene, {
        id: \`END_\${scene.sceneId}\`,
        endingType: scene.interaction.endingType || 'HE',
        title: scene.interaction.endingTitle || scene.title || '全剧终',
        isVictory: scene.interaction.endingType !== 'BE',
        summary: scene.interaction.verdict || '',
      });
      return;
    }

    this.renderFallbackChoices(scene);
  }

  private followWiringEdge(scene: SingleSceneJson, edge: PrdWiringEdge): void {
    this.clearTimers();
    const enterTarget = () => {
      const transModal = document.getElementById('transition-modal');
      if (transModal) transModal.style.display = 'none';
      const step = (scene.interaction.steps || []).find((s) => s.id === edge.to);
      if (step) {
        this.renderInteractionStep(scene, step);
        return;
      }
      const ending = (scene.interaction.endings || []).find((e) => e.id === edge.to);
      if (ending) {
        this.showEnding(scene, ending);
        return;
      }
      const nextJson = edge.to.endsWith('.json') ? edge.to : \`\${edge.to}.json\`;
      this.loader.navigateTo(nextJson).then((nextScene) => this.renderScene(nextScene));
    };

    if (edge.transition && edge.transition.text) {
      const transModal = document.getElementById('transition-modal');
      const transText = document.getElementById('transition-text');
      if (transText) transText.innerText = edge.transition.text;
      if (transModal) {
        transModal.style.display = 'flex';
        transModal.onclick = () => {
          this.clearTimers();
          enterTarget();
        };
      }
      const ms = Math.min(Math.max((edge.transition.durationSec || 1.2) * 1000, 400), 2500);
      this.activeTimer = window.setTimeout(enterTarget, ms);
      return;
    }

    enterTarget();
  }

  private renderInteractionStep(scene: SingleSceneJson, step: PrdInteractionNode): void {
    this.clearTimers();
    const container = document.getElementById('choices-container');
    if (!container) return;
    container.innerHTML = '';

    let settled = false;
    const settle = (outcome: PrdInteractionOutcome) => {
      if (settled) return;
      settled = true;
      this.clearTimers();
      this.loader.getBlackboard().applyStateChange(outcome.stateChange);
      this.updateHud(scene);

      const finishAdvance = () => {
        const toastEl = document.getElementById('feedback-toast');
        if (toastEl) toastEl.style.display = 'none';
        const nextEdge =
          this.loader.matchWiringEdge(step.id, outcome.key, scene.interaction.wiring || []) ||
          this.loader.matchWiringEdge(step.id, '*', scene.interaction.wiring || []);
        if (nextEdge) {
          this.followWiringEdge(scene, nextEdge);
        }
      };

      if (outcome.feedback) {
        const toastEl = document.getElementById('feedback-toast');
        if (toastEl) {
          toastEl.innerText = outcome.feedback;
          toastEl.style.display = 'block';
        }
        this.activeTimer = window.setTimeout(finishAdvance, 650);
      } else {
        finishAdvance();
      }
    };

    if (step.prompt) {
      const promptTag = document.createElement('div');
      promptTag.className = 'interaction-prompt';
      promptTag.innerText = step.prompt;
      container.appendChild(promptTag);
    }

    if (typeof step.timeoutSec === 'number' && step.timeoutSec > 0) {
      const timerWrap = document.createElement('div');
      timerWrap.className = 'timeout-track';
      const timerFill = document.createElement('div');
      timerFill.className = 'timeout-fill';
      timerWrap.appendChild(timerFill);
      container.appendChild(timerWrap);

      const totalMs = step.timeoutSec * 1000;
      const startMs = Date.now();
      this.countdownInterval = window.setInterval(() => {
        const remain = Math.max(0, 1 - (Date.now() - startMs) / totalMs);
        timerFill.style.width = \`\${Math.round(remain * 100)}%\`;
      }, 60);

      const timeoutOutcome =
        step.outcomes.find((o) => o.key === 'TIMEOUT') ||
        step.outcomes[step.outcomes.length - 1] || {
          key: 'TIMEOUT',
          label: '超时触发',
        };
      this.activeTimer = window.setTimeout(() => settle(timeoutOutcome), totalMs);
    }

    const activeOutcomes = step.outcomes.filter((o) => o.key !== 'TIMEOUT');
    const kindUpper = (step.kind || 'CHOICE').toUpperCase();

    if (kindUpper === 'INPUT') {
      const row = document.createElement('div');
      row.className = 'input-row';
      const inputEl = document.createElement('input');
      inputEl.type = 'text';
      inputEl.className = 'shell-input';
      inputEl.placeholder = step.prompt || '请输入...';
      const submitBtn = document.createElement('button');
      submitBtn.className = 'choice-btn';
      submitBtn.innerText = '确认提交';
      submitBtn.onclick = () => {
        const expected = step.config && typeof step.config.answer === 'string' ? step.config.answer : null;
        if (expected && inputEl.value.trim() !== expected) {
          const failOutcome = activeOutcomes.find((o) => o.key !== 'SUCCESS') || activeOutcomes[0];
          if (failOutcome) settle(failOutcome);
          return;
        }
        const okOutcome = activeOutcomes.find((o) => o.key === 'SUCCESS') || activeOutcomes[0];
        if (okOutcome) settle(okOutcome);
      };
      row.appendChild(inputEl);
      row.appendChild(submitBtn);
      container.appendChild(row);
      return;
    }

    if (kindUpper === 'CHOICE' || activeOutcomes.length > 1) {
      for (const outcome of activeOutcomes) {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.innerText = outcome.label;
        btn.onclick = () => settle(outcome);
        container.appendChild(btn);
      }
      return;
    }

    const singleOutcome = activeOutcomes[0] || step.outcomes[0];
    if (!singleOutcome) return;

    if (kindUpper === 'HOLD' || kindUpper === 'LONG_PRESS') {
      const holdSec =
        step.config && typeof step.config.durationSec === 'number'
          ? step.config.durationSec
          : 1.2;
      const btn = document.createElement('button');
      btn.className = 'choice-btn hold-btn';
      btn.innerText = \`✋ 按住不放（\${holdSec} 秒）：\${singleOutcome.label || step.prompt}\`;
      let holdTimer: number | null = null;
      const startHold = () => {
        if (holdTimer !== null) return;
        btn.classList.add('holding');
        holdTimer = window.setTimeout(() => {
          holdTimer = null;
          settle(singleOutcome);
        }, Math.max(holdSec * 1000, 300));
      };
      const cancelHold = () => {
        if (holdTimer !== null) {
          window.clearTimeout(holdTimer);
          holdTimer = null;
          btn.classList.remove('holding');
        }
      };
      btn.addEventListener('pointerdown', startHold);
      btn.addEventListener('pointerup', cancelHold);
      btn.addEventListener('pointerleave', cancelHold);
      container.appendChild(btn);
      return;
    }

    const actionBtn = document.createElement('button');
    actionBtn.className = 'choice-btn';
    actionBtn.innerText = \`✨ [\${step.kind}] \${singleOutcome.label || step.prompt}\`;
    actionBtn.onclick = () => settle(singleOutcome);
    container.appendChild(actionBtn);
  }

  private renderFallbackChoices(scene: SingleSceneJson): void {
    const container = document.getElementById('choices-container');
    if (!container) return;
    container.innerHTML = '';

    for (const choice of scene.interaction.choices) {
      if (!this.loader.getBlackboard().evaluateCondition(choice.condition)) continue;
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.innerText = choice.text;
      btn.onclick = async () => {
        const nextScene = await this.loader.navigateTo(choice.nextSceneJson, choice.stateChange);
        this.renderScene(nextScene);
      };
      container.appendChild(btn);
    }
  }

  private showEnding(scene: SingleSceneJson, ending: PrdEndingNode): void {
    this.clearTimers();
    const endingModal = document.getElementById('ending-modal');
    if (!endingModal) return;
    endingModal.style.display = 'flex';

    const endBadge = document.getElementById('ending-badge');
    const endTitle = document.getElementById('ending-title');
    const endVerdict = document.getElementById('ending-verdict');
    const endActions = document.getElementById('ending-actions');

    if (endBadge) endBadge.innerText = ending.endingType || '终局';
    if (endTitle) endTitle.innerText = ending.title || '全剧终';
    if (endVerdict) endVerdict.innerText = ending.summary || '';

    if (endActions) {
      endActions.innerHTML = '';
      const rewindTarget = ending.rewindTargetClipId
        ? (ending.rewindTargetClipId.endsWith('.json')
            ? ending.rewindTargetClipId
            : \`\${ending.rewindTargetClipId}.json\`)
        : scene.interaction.rewindTargetScene;
      if (!ending.isVictory && rewindTarget) {
        const btn = document.createElement('button');
        btn.className = 'choice-btn be-rewind-btn';
        btn.innerText = '⏪ 返回上一分岔重新选择';
        btn.onclick = async () => {
          endingModal.style.display = 'none';
          const rewindScene = await this.loader.rewindTo(rewindTarget);
          this.renderScene(rewindScene);
        };
        endActions.appendChild(btn);
      }
      const replayBtn = document.createElement('button');
      replayBtn.className = 'choice-btn he-btn';
      replayBtn.innerText = '🔁 从头重玩';
      replayBtn.onclick = async () => {
        endingModal.style.display = 'none';
        this.loader.getBlackboard().resetToInitial();
        const s1 = await this.loader.loadScene(this.startSceneFileName);
        this.renderScene(s1);
      };
      endActions.appendChild(replayBtn);
    }
  }

  private injectStyles(): void {
    if (document.getElementById('interactive-shell-styles')) return;
    const style = document.createElement('style');
    style.id = 'interactive-shell-styles';
    style.innerHTML = \`
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      html, body { width: 100%; height: 100%; margin: 0; padding: 0; background: #000; color: #fff; display: flex; justify-content: center; align-items: center; overflow: hidden; }
      #app { width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; }
      .shell-viewport {
        width: min(100vw, calc(100vh * 16 / 9), 1280px);
        height: min(100vh, calc(100vw * 9 / 16), 720px);
        aspect-ratio: 16 / 9;
        position: relative;
        background: #09090b;
        overflow: hidden;
        box-shadow: 0 0 50px rgba(0,0,0,0.9);
        display: flex;
        flex-direction: column;
      }
      .shell-hud {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 20;
        padding: 14px 24px;
        display: flex;
        justify-content: space-between;
        gap: 16px;
        background: linear-gradient(180deg, rgba(0,0,0,0.85) 0%, transparent 100%);
        font-size: 12px;
        pointer-events: none;
      }
      .hud-item { display: flex; flex-direction: column; gap: 2px; max-width: 45%; pointer-events: auto; }
      .hud-item .label { color: #a1a1aa; font-size: 11px; }
      .hud-item .val { font-weight: bold; color: #fbbf24; word-break: break-all; }
      .shell-stage {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        background: #18181b;
        overflow: hidden;
        z-index: 1;
      }
      .stage-bg { width: 100%; height: 100%; object-fit: cover; transition: opacity 0.3s; }
      .stage-overlay {
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(0,0,0,0.45) 0%, transparent 25%, transparent 55%, rgba(9,9,11,0.95) 100%);
        pointer-events: none;
      }
      .camera-tag {
        position: absolute;
        bottom: 160px;
        right: 28px;
        background: rgba(0,0,0,0.65);
        border: 1px solid rgba(255,255,255,0.1);
        padding: 3px 10px;
        border-radius: 4px;
        font-size: 11px;
        color: #d4d4d8;
        z-index: 10;
      }
      .feedback-toast {
        position: absolute;
        bottom: 180px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(15,23,42,0.95);
        border: 1px solid #38bdf8;
        color: #e0f2fe;
        padding: 10px 18px;
        border-radius: 8px;
        font-size: 13px;
        text-align: center;
        z-index: 30;
        box-shadow: 0 4px 20px rgba(0,0,0,0.6);
        max-width: 480px;
      }
      .shell-bottom-bar {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 15;
        padding: 16px 28px 20px;
        display: grid;
        grid-template-columns: 1fr 380px;
        gap: 20px;
        align-items: end;
        background: linear-gradient(0deg, rgba(9,9,11,0.96) 0%, rgba(9,9,11,0.85) 60%, transparent 100%);
        box-sizing: border-box;
      }
      .shell-bottom-bar:has(#choices-container:empty) {
        grid-template-columns: 1fr;
      }
      #choices-container:empty {
        display: none;
      }
      .shell-screenplay {
        background: rgba(18, 24, 38, 0.75);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        padding: 14px 18px;
        min-height: 100px;
        cursor: pointer;
        user-select: none;
        transition: border-color 0.2s, background-color 0.2s;
      }
      .shell-screenplay:hover {
        border-color: rgba(0, 210, 255, 0.45);
        background: rgba(18, 24, 38, 0.85);
      }
      .speaker-tag {
        display: inline-block;
        background: rgba(0, 210, 255, 0.15);
        border: 1px solid rgba(0, 210, 255, 0.35);
        color: #38bdf8;
        padding: 2px 10px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 700;
        margin-bottom: 6px;
      }
      .dialogue-content { font-size: 14px; line-height: 1.6; color: #f4f4f5; text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
      .next-tip { font-size: 11px; color: #71717a; text-align: right; margin-top: 6px; }
      .shell-choices { display: flex; flex-direction: column; gap: 8px; justify-content: flex-end; }
      .interaction-prompt { font-size: 12px; color: #fde68a; background: rgba(120,53,15,0.35); border: 1px solid rgba(251,191,36,0.4); border-radius: 8px; padding: 8px 12px; }
      .timeout-track { width: 100%; height: 4px; background: #27272a; border-radius: 2px; overflow: hidden; }
      .timeout-fill { width: 100%; height: 100%; background: #f59e0b; transition: width 0.06s linear; }
      .input-row { display: flex; gap: 8px; }
      .shell-input { flex: 1; background: #18181b; border: 1px solid #3f3f46; color: #fff; padding: 10px 12px; border-radius: 8px; font-size: 13px; }
      .choice-btn {
        background: rgba(24, 24, 27, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #fafafa;
        padding: 11px 16px;
        border-radius: 10px;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
        transition: all 0.2s;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        backdrop-filter: blur(6px);
      }
      .choice-btn:hover {
        background: #27272a;
        border-color: #38bdf8;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(56, 189, 248, 0.2);
      }
      .hold-btn.holding { border-color: #22c55e; background: #14532d; }
      .ending-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,0.85);
        backdrop-filter: blur(8px);
        z-index: 50;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px;
      }
      .ending-card {
        background: #18181b;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 16px;
        padding: 28px 36px;
        text-align: center;
        max-width: 540px;
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 14px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8);
      }
      .ending-title { font-size: 20px; color: #fafafa; font-weight: 700; }
      .ending-verdict { font-size: 13px; color: #a1a1aa; line-height: 1.6; margin-bottom: 8px; }
      .ending-btn-group { display: flex; flex-direction: column; gap: 10px; }
      .be-rewind-btn { background: #991b1b !important; border-color: #dc2626 !important; text-align: center; }
      .he-btn { background: #15803d !important; border-color: #22c55e !important; text-align: center; }
    \`;
    document.head.appendChild(style);
  }
}
`;
}

export function getMainEntryCode(options?: {
  startNodeId?: string;
  initialState?: Record<string, any>;
}): string {
  const startNode = (options?.startNodeId || 'S1').replace(/\.json$/, '');
  const startJson = `${startNode}.json`;
  const initialStateJson = JSON.stringify(options?.initialState || {});
  return `/**
 * main.ts - 互动影游启动主入口 (由 PRD startNodeId 与 initialState 动态驱动)
 */

import { StateBlackboard } from './StateBlackboard';
import { SceneLoader } from './SceneLoader';
import { InteractiveShell } from './InteractiveShell';

const INITIAL_STATE: Record<string, any> = ${initialStateJson};
const START_SCENE = '${startJson}';

document.addEventListener('DOMContentLoaded', () => {
  const app = document.getElementById('app') || document.body;
  const blackboard = new StateBlackboard(INITIAL_STATE);
  const loader = new SceneLoader('../scenes', blackboard);
  const shell = new InteractiveShell(loader);
  shell.mount(app, START_SCENE).catch((err) => {
    console.error('互动影游加载失败:', err);
  });
});
`;
}

export async function executeCodegenStep(input: CodegenInput): Promise<CodegenOutput> {
  const { projectId, startNodeId, initialState } = input;
  const store = ProjectStore.getInstance();
  const projectDir = store.getProjectDir(projectId);

  const textGameSrcDir = path.resolve(projectDir, 'text-game', 'src');
  fs.mkdirSync(textGameSrcDir, { recursive: true });

  const files = [
    { name: 'SceneTypes.ts', content: getSceneTypesCode() },
    { name: 'StateBlackboard.ts', content: getStateBlackboardCode() },
    { name: 'SceneLoader.ts', content: getSceneLoaderCode() },
    { name: 'InteractiveShell.ts', content: getInteractiveShellCode() },
    { name: 'main.ts', content: getMainEntryCode({ startNodeId, initialState }) },
  ];

  const generatedFiles: string[] = [];
  for (const f of files) {
    const fullPath = path.resolve(textGameSrcDir, f.name);
    fs.writeFileSync(fullPath, f.content, 'utf-8');
    generatedFiles.push(`text-game/src/${f.name}`);
  }

  return {
    projectId,
    generatedFiles,
    success: true,
  };
}

export const codegenStep = createStep({
  id: 'codegen-step',
  inputSchema: CodegenInputSchema,
  outputSchema: CodegenOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const trigger = ctx.triggerData || ctx;
    const projectId = trigger.projectId || ctx.projectId;
    const techPlan = ctx.steps?.['tech-plan-step']?.output || ctx.techPlan || (await import('../tech-plan/index.js')).getStandardTechPlan();
    return await runTaskRecordedStep(
      'codegen-step',
      () =>
        executeCodegenStep({
          projectId,
          title: trigger.title || ctx.title || '互动短剧',
          techPlan,
          startNodeId: trigger.prd?.startNodeId || ctx.startNodeId,
          initialState: trigger.prd?.initialState || ctx.initialState,
        }),
      {
        verifyCached: (cached) => {
          const projectDir = ProjectStore.getInstance().getProjectDir(projectId);
          return (
            Array.isArray(cached.generatedFiles) &&
            cached.generatedFiles.length > 0 &&
            cached.generatedFiles.every((rel) => fs.existsSync(path.resolve(projectDir, rel)))
          );
        },
      }
    );
  },
});
