/**
 * runtime/engine.js
 * 互动影游确定性系统运行时（系统提供，请勿修改）
 *
 * 职责：
 * 1. 加载静态数据剧本 story.json
 * 2. 维护 StateBlackboard（幂等状态变更 + 中文 stateSchema 映射 + 历史快照）
 * 3. 管理 6 屏状态机（loading / home / stage / pause / chapters / ending）
 * 4. 驱动 wiring 路由推进、节点回溯（Rewind）、暂停冻结倒计时
 * 5. 持久化存档与多结局图鉴（localStorage）
 */

export async function loadStory(url = './story.json') {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(`无法加载剧本数据 ${url}（HTTP ${res.status}）`);
  }
  return res.json();
}

export class StoryEngine {
  constructor(story) {
    this.story = story || {};
    this.clips = Array.isArray(this.story.clips) ? this.story.clips : [];
    this.endings = Array.isArray(this.story.endings) ? this.story.endings : [];
    this.wiring = Array.isArray(this.story.wiring) ? this.story.wiring : [];
    this.stateSchema = this.story.stateSchema || {};
    this.initialState = { ...(this.story.initialState || {}) };

    const slug = encodeURIComponent(
      String(this.story.projectId || this.story.title || 'makemv-story').slice(0, 48)
    );
    this.saveKey = `makemv_save_${slug}`;
    this.galleryKey = `makemv_gallery_${slug}`;

    this.screen = 'home';
    this.paused = false;
    this.currentClipId = this.story.startClipId || this.clips[0]?.id || 'S1';
    this.currentEnding = null;
    this.state = { ...this.initialState };
    this.history = [];
    this.visitedClipIds = new Set();
    this.appliedActionKeys = new Set();
    this.unlockedEndings = this._readGallery();
    this.listeners = new Set();
    this._countdown = null;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _emit(event = { type: 'change' }) {
    for (const fn of this.listeners) {
      try {
        fn(event, this);
      } catch (err) {
        console.error('[StoryEngine] listener error:', err);
      }
    }
  }

  setScreen(screen) {
    this.screen = screen;
    this._emit({ type: 'screen', screen });
  }

  getClip(clipId = this.currentClipId) {
    return this.clips.find((c) => c.id === clipId || c.sceneId === clipId) || null;
  }

  getEnding(endingId) {
    return this.endings.find((e) => e.id === endingId) || null;
  }

  hasSave() {
    try {
      const raw = localStorage.getItem(this.saveKey);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return Boolean(parsed && parsed.currentClipId && this.getClip(parsed.currentClipId));
    } catch {
      return false;
    }
  }

  saveProgress() {
    try {
      const payload = {
        currentClipId: this.currentClipId,
        state: this.state,
        history: this.history.slice(-40),
        visitedClipIds: Array.from(this.visitedClipIds),
        appliedActionKeys: Array.from(this.appliedActionKeys),
        savedAt: Date.now(),
      };
      localStorage.setItem(this.saveKey, JSON.stringify(payload));
    } catch {
      // 忽略无痕模式或配额限制
    }
  }

  startNewGame() {
    this.clearCountdown();
    this.paused = false;
    this.currentEnding = null;
    this.state = { ...this.initialState };
    this.currentClipId = this.story.startClipId || this.clips[0]?.id || 'S1';
    this.visitedClipIds = new Set([this.currentClipId]);
    this.appliedActionKeys = new Set();
    this.history = [
      {
        clipId: this.currentClipId,
        state: { ...this.state },
        appliedActionKeys: [],
        timestamp: Date.now(),
      },
    ];
    this.saveProgress();
    this.setScreen('stage');
    return this.getClip(this.currentClipId);
  }

  continueGame() {
    this.clearCountdown();
    this.paused = false;
    this.currentEnding = null;
    try {
      const raw = localStorage.getItem(this.saveKey);
      if (!raw) return this.startNewGame();
      const saved = JSON.parse(raw);
      if (!saved || !this.getClip(saved.currentClipId)) {
        return this.startNewGame();
      }
      this.currentClipId = saved.currentClipId;
      this.state = { ...this.initialState, ...(saved.state || {}) };
      this.history = Array.isArray(saved.history) ? saved.history : [];
      this.visitedClipIds = new Set(
        Array.isArray(saved.visitedClipIds) ? saved.visitedClipIds : [this.currentClipId]
      );
      this.appliedActionKeys = new Set(
        Array.isArray(saved.appliedActionKeys) ? saved.appliedActionKeys : []
      );
      this.setScreen('stage');
      return this.getClip(this.currentClipId);
    } catch {
      return this.startNewGame();
    }
  }

  rewindTo(clipId) {
    this.clearCountdown();
    this.paused = false;
    this.currentEnding = null;
    const idx = [...this.history].reverse().findIndex((h) => h.clipId === clipId);
    if (idx >= 0) {
      const realIdx = this.history.length - 1 - idx;
      const snap = this.history[realIdx];
      this.history = this.history.slice(0, realIdx + 1);
      this.state = { ...this.initialState, ...(snap.state || {}) };
      this.appliedActionKeys = new Set(snap.appliedActionKeys || []);
      this.currentClipId = clipId;
    } else if (this.getClip(clipId)) {
      this.currentClipId = clipId;
      this.visitedClipIds.add(clipId);
      this.history.push({
        clipId,
        state: { ...this.state },
        appliedActionKeys: Array.from(this.appliedActionKeys),
        timestamp: Date.now(),
      });
    }
    this.saveProgress();
    this.setScreen('stage');
    return this.getClip(this.currentClipId);
  }

  applyStateChange(change, idempotencyKey) {
    if (!change || typeof change !== 'object') return false;
    if (idempotencyKey && this.appliedActionKeys.has(idempotencyKey)) {
      return false;
    }
    if (change.add && typeof change.add === 'object') {
      for (const [k, delta] of Object.entries(change.add)) {
        const current = Number(this.state[k] ?? 0);
        this.state[k] = current + Number(delta || 0);
      }
    }
    if (change.set && typeof change.set === 'object') {
      for (const [k, val] of Object.entries(change.set)) {
        this.state[k] = val;
      }
    }
    if (idempotencyKey) {
      this.appliedActionKeys.add(idempotencyKey);
    }
    this._emit({ type: 'state', state: { ...this.state } });
    return true;
  }

  getHudItems() {
    const keys = new Set([
      ...Object.keys(this.stateSchema || {}),
      ...Object.keys(this.state || {}),
    ]);
    const items = [];
    for (const key of keys) {
      const schema = this.stateSchema?.[key];
      if (schema && schema.visibleInHud === false) continue;
      const value = this.state[key];
      if (value === undefined) continue;
      items.push({
        key,
        label: schema?.label || key,
        type: schema?.type || (typeof value === 'boolean' ? 'flag' : 'number'),
        value,
        max: schema?.max ?? null,
      });
    }
    return items;
  }

  advanceAfterPlayback(clip = this.getClip()) {
    if (!clip) return { type: 'complete' };
    if (clip.interaction) {
      return { type: 'interaction', interaction: clip.interaction, clip };
    }
    if (clip.ending) {
      this._enterEnding(clip.ending);
      return { type: 'ending', ending: this.currentEnding };
    }
    if (clip.next) {
      const nextClip = this._moveToClip(clip.next);
      if (nextClip) return { type: 'clip', clip: nextClip };
    }
    return { type: 'complete' };
  }

  resolveOutcome(clip, interaction, outcomeKey) {
    this.clearCountdown();
    const outcomes = Array.isArray(interaction?.outcomes) ? interaction.outcomes : [];
    const matched =
      outcomes.find((o) => String(o.key) === String(outcomeKey)) ||
      outcomes.find((o) => String(o.key).toUpperCase() === 'FAIL') ||
      outcomes[0];

    if (!matched) {
      if (clip?.next) {
        const nextClip = this._moveToClip(clip.next);
        if (nextClip) return { type: 'clip', clip: nextClip, outcome: null };
      }
      return { type: 'complete', outcome: null };
    }

    const actionKey = `${clip?.id || this.currentClipId}:${interaction?.id || interaction?.kind}:${matched.key}`;
    this.applyStateChange(matched.stateChange, actionKey);

    if (matched.ending || matched.endingId) {
      const ed = matched.ending || this.getEnding(matched.endingId);
      if (ed) {
        this._enterEnding(ed);
        return { type: 'ending', ending: this.currentEnding, outcome: matched };
      }
    }

    const targetId = matched.to || clip?.next;
    if (targetId) {
      const maybeEnding = this.getEnding(targetId);
      if (maybeEnding) {
        this._enterEnding(maybeEnding);
        return { type: 'ending', ending: this.currentEnding, outcome: matched };
      }
      const nextClip = this._moveToClip(targetId);
      if (nextClip) {
        return { type: 'clip', clip: nextClip, outcome: matched };
      }
    }

    return { type: 'complete', outcome: matched };
  }

  _moveToClip(clipId) {
    const nextClip = this.getClip(clipId);
    if (!nextClip) return null;
    this.currentClipId = nextClip.id;
    this.visitedClipIds.add(nextClip.id);
    this.history.push({
      clipId: nextClip.id,
      state: { ...this.state },
      appliedActionKeys: Array.from(this.appliedActionKeys),
      timestamp: Date.now(),
    });
    this.saveProgress();
    this._emit({ type: 'clip', clip: nextClip });
    return nextClip;
  }

  _enterEnding(ending) {
    this.clearCountdown();
    this.currentEnding = ending;
    if (ending?.id || ending?.title) {
      const id = ending.id || ending.title;
      this.unlockedEndings[id] = {
        id,
        title: ending.title || '结局',
        endingType: ending.endingType || ending.type || 'NEUTRAL',
        unlockedAt: Date.now(),
      };
      this._writeGallery();
    }
    this.setScreen('ending');
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.setScreen('pause');
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.setScreen('stage');
  }

  startCountdown(totalSec, onTick, onTimeout) {
    this.clearCountdown();
    const sec = Number(totalSec);
    if (!Number.isFinite(sec) || sec <= 0) return;

    const ctx = {
      totalMs: sec * 1000,
      remainingMs: sec * 1000,
      lastTs: performance.now(),
      rafId: null,
    };
    this._countdown = ctx;

    const step = (now) => {
      if (this._countdown !== ctx) return;
      const dt = now - ctx.lastTs;
      ctx.lastTs = now;
      if (!this.paused && this.screen === 'stage') {
        ctx.remainingMs = Math.max(0, ctx.remainingMs - dt);
      }
      if (typeof onTick === 'function') {
        onTick(ctx.remainingMs / 1000, ctx.totalMs / 1000);
      }
      if (ctx.remainingMs <= 0) {
        this._countdown = null;
        if (typeof onTimeout === 'function') onTimeout();
        return;
      }
      ctx.rafId = requestAnimationFrame(step);
    };

    ctx.rafId = requestAnimationFrame(step);
  }

  clearCountdown() {
    if (this._countdown?.rafId) {
      cancelAnimationFrame(this._countdown.rafId);
    }
    this._countdown = null;
  }

  getChapters() {
    return this.clips.map((c, idx) => ({
      id: c.id,
      index: idx + 1,
      title: c.title || `第 ${idx + 1} 幕`,
      visited: this.visitedClipIds.has(c.id),
      isCurrent: this.currentClipId === c.id,
      hasInteraction: Boolean(c.interaction),
      isEnding: Boolean(c.ending),
    }));
  }

  getEndingsGallery() {
    return this.endings.map((ed) => ({
      ...ed,
      unlocked: Boolean(this.unlockedEndings[ed.id] || this.unlockedEndings[ed.title]),
    }));
  }

  _readGallery() {
    try {
      const raw = localStorage.getItem(this.galleryKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  _writeGallery() {
    try {
      localStorage.setItem(this.galleryKey, JSON.stringify(this.unlockedEndings));
    } catch {
      // 忽略存储异常
    }
  }
}
