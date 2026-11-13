/**
 * runtime/player.js
 * 播放底座（系统提供，请勿修改）
 *
 *   play(container, url, onEnded)
 *
 *   container —— 父容器节点，播放在这里面发生
 *   url       —— 这一幕的地址：现在指向 scenes/S1.json（背景图 + 台词），将来换成 mp4 就传 mp4
 *   onEnded   —— 播完调它，一次，且只调一次
 *
 * 除此之外没有别的东西：不用 new、不用 init、不用查状态。
 * 再调一次 play 会自动收掉上一次（同一容器里永远只有一幕在播）。
 * 播放不可跳过：台词必须吐完（视频必须播到结尾）才回调，点画面不会加速。
 */

const CHAR_MS = 34; // 每个字的间隔
const MAX_TYPE_MS = 6000; // 单段最长打字时长，超了自动提速
const GAP_MS = 300; // 两段之间的自然停顿
const VIDEO_RE = /\.(mp4|webm|m4v|mov)(\?|#|$)/i;

const states = new WeakMap();

/**
 * 播这一幕。播完调用 onEnded()。
 * @param {HTMLElement} container 父容器节点
 * @param {string} url 这一幕的地址
 * @param {() => void} onEnded 播完回调
 */
export function play(container, url, onEnded) {
  if (!container) throw new Error('play 需要一个父容器节点');

  const state = ensureState(container);
  teardown(state);

  // 每次播放一个代号，旧的异步回调回来时发现代号变了就安静退出
  const gen = state.gen;
  const finish = () => {
    if (state.gen !== gen) return;
    teardown(state);
    if (typeof onEnded === 'function') onEnded();
  };

  state.root.classList.add('is-playing');

  loadMedia(url)
    .then((media) => {
      if (state.gen !== gen) return;
      if (media.videoUrl) {
        startVideo(state, media.videoUrl, finish);
        return;
      }
      setBackground(state, media.background);
      startKeyframes(state, media.keyframes);
      startTypewriter(state, media.text, gen, finish, media.backgrounds);
    })
    .catch((err) => {
      if (state.gen !== gen) return;
      showNotice(state, err && err.message ? err.message : String(err));
    });
}

// ---- 以下都是内部实现 ----

function ensureState(container) {
  let state = states.get(container);
  if (state) return state;

  const root = document.createElement('div');
  root.className = 'cp-root';
  root.innerHTML =
    '<div class="cp-bg"></div>' +
    '<img class="cp-bg-img" alt="" aria-hidden="true" />' +
    '<div class="cp-shade"></div>' +
    '<video class="cp-video" playsinline preload="auto"></video>' +
    '<div class="cp-text"></div>';
  container.appendChild(root);

  state = {
    root,
    bgEl: root.querySelector('.cp-bg'),
    bgImgEl: root.querySelector('.cp-bg-img'),
    videoEl: root.querySelector('.cp-video'),
    textEl: root.querySelector('.cp-text'),
    gen: 0,
    timer: null,
  };
  const playerLayer = container.closest('.player-container');
  if (playerLayer) playerLayer.style.setProperty('z-index', '1', 'important');
  if (state.bgImgEl) state.bgImgEl.style.setProperty('z-index', '100', 'important');
  state.bgEl.style.setProperty('z-index', '99', 'important');
  state.root.querySelector('.cp-shade')?.style.setProperty('z-index', '101', 'important');
  state.textEl.style.setProperty('z-index', '102', 'important');
  states.set(container, state);
  return state;
}

/** 停掉当前这一幕的一切动静，并让还在路上的旧回调失效 */
function teardown(state) {
  state.gen += 1;
  stopTimer(state);
  state.root.classList.remove('is-playing', 'is-video');
  state.textEl.innerHTML = '';
  state.videoEl.pause();
  state.videoEl.removeAttribute('src');
}

function stopTimer(state) {
  if (state.timer) {
    clearInterval(state.timer);
    clearTimeout(state.timer);
    state.timer = null;
  }
}

function setBackground(state, url) {
  const value = typeof url === 'string' ? url.trim() : '';
  state.bgEl.style.backgroundImage = value ? 'url("' + value.replace(/"/g, '%22') + '")' : 'none';
  if (state.bgImgEl) {
    state.bgImgEl.src = value;
    state.bgImgEl.style.display = value ? 'block' : 'none';
  }
}

/** 地址是视频就播视频，是这一幕的 json 就取出画面与台词 */
async function loadMedia(url) {
  if (VIDEO_RE.test(url)) return { videoUrl: url };

  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(url + ' 读取失败（HTTP ' + res.status + '）');
  const data = await res.json();
  return {
    // game-assembly 优先播放 film-production 写入的真实视频地址；
    // clipUrl 保留为旧产物兼容字段。
    videoUrl: data.videoUrl || data.clipUrl || '',
    background: data.background || '',
    backgrounds: Array.isArray(data.backgrounds) ? data.backgrounds.filter(Boolean) : [],
    keyframes: Array.isArray(data.keyframes) ? data.keyframes.filter((x) => x && x.imageUrl) : [],
    text: typeof data.text === 'string' ? data.text : '',
  };
}

function startKeyframes(state, keyframes) {
  if (!Array.isArray(keyframes) || keyframes.length === 0) return;
  let index = 0;
  const show = () => {
    const frame = keyframes[index];
    if (!frame) return;
    setBackground(state, frame.imageUrl);
    index += 1;
    if (index < keyframes.length) state.keyframeTimer = setTimeout(show, Math.max(500, Number(frame.durationSec || 3) * 1000));
  };
  if (state.keyframeTimer) clearTimeout(state.keyframeTimer);
  show();
}

function startVideo(state, url, finish) {
  state.root.classList.add('is-video');
  const onEnded = () => {
    state.videoEl.removeEventListener('ended', onEnded);
    finish();
  };
  state.videoEl.addEventListener('ended', onEnded);
  state.videoEl.src = url;
  const started = state.videoEl.play();
  if (started && typeof started.catch === 'function') started.catch(() => finish());
}

function startTypewriter(state, raw, gen, finish, backgrounds) {
  const segments = String(raw || '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) segments.push('');

  let index = 0;
  const next = () => {
    stopTimer(state);
    if (state.gen !== gen) return;

    const text = segments[index] || '';
    const bg = Array.isArray(backgrounds) && backgrounds.length
      ? backgrounds[Math.min(index, backgrounds.length - 1)]
      : '';
    if (bg) setBackground(state, bg);
    const p = document.createElement('p');
    p.className = 'cp-segment';
    state.textEl.appendChild(p);

    const advance = () => {
      if (state.gen !== gen) return;
      if (index < segments.length - 1) {
        index += 1;
        state.timer = setTimeout(next, GAP_MS);
      } else {
        finish();
      }
    };

    if (!text) {
      advance();
      return;
    }

    let step = CHAR_MS;
    if (text.length * step > MAX_TYPE_MS) step = Math.max(8, Math.floor(MAX_TYPE_MS / text.length));

    let i = 0;
    p.textContent = '';
    state.timer = setInterval(() => {
      if (state.gen !== gen) {
        stopTimer(state);
        return;
      }
      i += 1;
      p.textContent = text.slice(0, i);
      if (i >= text.length) {
        stopTimer(state);
        advance();
      }
    }, step);
  };

  next();
}

/** 素材读不到时，直接在画面上说清楚，别白屏；这种情况不回调，剧情停在这里 */
function showNotice(state, message) {
  state.root.classList.add('is-playing');
  const p = document.createElement('p');
  p.className = 'cp-segment';
  p.textContent = '这一幕加载失败：' + message;
  state.textEl.appendChild(p);
}
