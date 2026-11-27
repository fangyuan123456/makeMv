/**
 * tools/game-assembly/steps/02-codegen/fallback.ts
 * 离线无 LLM Key 或 Agent 异常时的最小可玩兜底模板（仅作为最后防线，不干预正常 Agent 创作）。
 */

import type { VirtualFS } from './vfs.js';
import type { StoryBundle } from '../../../shared/story-compiler.js';

export function ensureMinimalFallbackFiles(vfs: VirtualFS, bundle: StoryBundle): void {
  if (!vfs.hasFile('style.css')) {
    const { primary, accent, surface, danger } = bundle.uiTheme.palette;
    vfs.write(
      'style.css',
      `:root{--p:${primary};--a:${accent};--s:${surface};--d:${danger}}*{box-sizing:border-box}html,body,#app{margin:0;width:100%;height:100%;overflow:hidden;background:#07090d;color:var(--p);font-family:system-ui,sans-serif}.mv-screen{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;z-index:20}.mv-card{width:min(680px,92vw);background:var(--s);border:1px solid rgba(255,255,255,.15);border-radius:16px;padding:32px;backdrop-filter:blur(14px)}.mv-btn{border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:var(--p);padding:10px 20px;border-radius:8px;cursor:pointer;margin-right:8px}.mv-btn.primary{background:var(--a);color:#111;border:none}.mv-stage{position:relative;width:100%;height:100%}.player-container{position:absolute;inset:0}.mv-hud{position:absolute;top:16px;left:20px;right:20px;display:flex;justify-content:space-between;z-index:15;pointer-events:none}.mv-hud>*{pointer-events:auto}.mv-pill{background:rgba(0,0,0,.65);padding:6px 12px;border-radius:999px;font-size:13px;margin-right:6px}.mv-overlay{position:absolute;inset:0 0 110px 0;display:flex;align-items:center;justify-content:center;z-index:18;pointer-events:none}.mv-overlay.active{pointer-events:auto}`
    );
  }

  if (!vfs.hasFile('js/main.js')) {
    vfs.write(
      'js/main.js',
      `import { play } from '../runtime/player.js';
import { loadStory, StoryEngine } from '../runtime/engine.js';

async function bootstrap() {
  const app = document.getElementById('app');
  if (!app) return;
  const story = await loadStory('./story.json');
  const engine = new StoryEngine(story);

  const renderHome = () => {
    app.innerHTML = \`<section class="mv-screen"><div class="mv-card"><h1>\${story.title || ''}</h1><p>\${story.logline || ''}</p><button class="mv-btn primary" id="start">开始新故事</button>\${engine.hasSave() ? '<button class="mv-btn" id="cont">继续游戏</button>' : ''}</div></section>\`;
    app.querySelector('#start')?.addEventListener('click', () => playClip(engine.startNewGame()));
    app.querySelector('#cont')?.addEventListener('click', () => playClip(engine.continueGame()));
  };

  const renderEnding = (ed) => {
    app.innerHTML = \`<section class="mv-screen"><div class="mv-card"><h2>\${ed?.title || '结局'}</h2><p>\${ed?.summary || ''}</p><button class="mv-btn primary" id="home">返回主页</button></div></section>\`;
    app.querySelector('#home')?.addEventListener('click', renderHome);
  };

  const playClip = (clip) => {
    if (!clip) return renderHome();
    app.innerHTML = \`<div class="mv-stage"><div class="player-container"></div><div class="mv-hud"><div id="hud"></div><button class="mv-btn" id="pause">暂停</button></div><div class="mv-overlay" id="overlay"></div></div>\`;
    const hud = app.querySelector('#hud');
    if (hud) hud.innerHTML = engine.getHudItems().map((i) => \`<span class="mv-pill">\${i.label}:\${i.value}</span>\`).join('');
    app.querySelector('#pause')?.addEventListener('click', () => { engine.pause(); renderHome(); });
    play(app.querySelector('.player-container'), clip, () => {
      const next = engine.advanceAfterPlayback(clip);
      if (next.type === 'clip') return playClip(next.clip);
      if (next.type === 'ending') return renderEnding(next.ending);
      if (next.type === 'interaction') {
        const ov = app.querySelector('#overlay');
        ov.classList.add('active');
        const opts = (next.interaction.outcomes || []).filter((o) => o.key !== 'TIMEOUT');
        ov.innerHTML = \`<div class="mv-card"><p>\${next.interaction.prompt || '请抉择'}</p>\${opts.map((o) => \`<button class="mv-btn" data-k="\${o.key}">\${o.label || o.key}</button>\`).join('')}</div>\`;
        ov.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => {
          const r = engine.resolveOutcome(clip, next.interaction, b.getAttribute('data-k'));
          if (r.type === 'clip') playClip(r.clip);
          else if (r.type === 'ending') renderEnding(r.ending);
          else renderHome();
        }));
        return;
      }
      renderHome();
    });
  };

  renderHome();
}
bootstrap();
`
    );
  }
}
