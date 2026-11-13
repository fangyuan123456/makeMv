/**
 * scripts/probe-playable.ts
 * 无头浏览器实机试玩探针：加载 text-game/index.html，模拟点击推进，抓取页面文本与控制台报错。
 *
 * 用法：
 *   npx tsx scripts/probe-playable.ts [projectId] [--clicks=10]
 *
 * 为什么需要它：静态体检看不出「点了没反应」「一进互动就卡死」这类问题，
 * 而这些恰恰是互动影游最致命的故障。这里用真实 Chrome 跑一遍最小可玩路径。
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import WebSocket from 'ws';

const projectId = process.argv[2] || 'proj_mwd8sl42_azk1';
const clicksArg = process.argv.find((a) => a.startsWith('--clicks='));
const CLICKS = clicksArg ? parseInt(clicksArg.split('=')[1], 10) : 10;
const idleArg = process.argv.find((a) => a.startsWith('--idle='));
const IDLE_SEC = idleArg ? parseInt(idleArg.split('=')[1], 10) : 0;
const PORT = 9333;
const URL = `http://127.0.0.1:4111/media/${projectId}/text-game/index.html`;

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

function findChrome(): string {
  const hit = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('未找到 Chrome / Edge，无法实机试玩');
  return hit;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForTarget(): Promise<string> {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = (await res.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('Chrome 调试端口未就绪');
}

async function main() {
  const userDataDir = path.resolve(os.tmpdir(), `wb-probe-${Date.now()}`);
  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--window-size=1280,720',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  try {
    const wsUrl = await waitForTarget();
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((res, rej) => {
      ws.once('open', () => res());
      ws.once('error', rej);
    });

    let msgId = 0;
    const pending = new Map<number, (v: any) => void>();
    const errors: string[] = [];
    const logs: string[] = [];

    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)!(msg.result);
        pending.delete(msg.id);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params?.exceptionDetails;
        errors.push(`${d?.text || 'exception'} ${d?.exception?.description || ''}`.trim().slice(0, 300));
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        logs.push((msg.params.args || []).map((a: any) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
      }
    });

    const send = (method: string, params: Record<string, unknown> = {}): Promise<any> => {
      const id = ++msgId;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: URL });
    await sleep(2500);

    // 交互动作：互动点/选项/过场直接点元素；推进正文则按真实坐标点画面（监听挂在舞台层，点 #app 不会冒泡到它）
    const ACT_EXPR = `(() => {
      const vis = (el) => !!(el.offsetWidth || el.offsetHeight);
      // 长按类互动：页面上出现可见的 hold 元件就按下去
      const holdEl = [...document.querySelectorAll('[class*="hold"]')].find(vis);
      if (holdEl) return 'hold';
      // 其它互动与选项一律是按钮：点最后一个可见按钮，避免点到 HUD
      const btns = [...document.querySelectorAll('button')].filter(vis);
      if (btns.length) {
        const btn = btns[btns.length - 1];
        btn.click();
        return 'click:' + (btn.className || 'button');
      }
      // 只剩正文在播：底座不可跳过，点画面没用，交给 waitSettled 等它自己吐完
      return 'wait';
    })()`;

    // 等这一幕自己播完：文本连续 1.2 秒没变化就认为播完了（底座不可跳过，只能等）
    const waitSettled = async (timeoutMs = 40000): Promise<number> => {
      let last = -1;
      let stable = 0;
      let waited = 0;
      while (waited < timeoutMs) {
        await sleep(400);
        waited += 400;
        const len = (await evalText()).length;
        if (len === last) {
          stable += 1;
          if (stable >= 3) break;
        } else {
          stable = 0;
          last = len;
        }
      }
      return waited;
    };

    const act = async (): Promise<string> => {
      const res = await send('Runtime.evaluate', { expression: ACT_EXPR, returnByValue: true });
      const kind = String(res?.result?.value || 'none');
      if (kind === 'wait') {
        const waited = await waitSettled();
        return 'wait:' + waited + 'ms';
      }
      if (kind === 'hold') {
        await send('Runtime.evaluate', {
          expression: `(() => {
            const el = [...document.querySelectorAll('[class*="hold"]')].find((e) => e.offsetWidth || e.offsetHeight);
            if (!el) return false;
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true }));
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            return true;
          })()`,
          returnByValue: true,
        });
        await sleep(1700);
        await send('Runtime.evaluate', {
          expression: `(() => {
            const el = [...document.querySelectorAll('[class*="hold"]')].find((e) => e.offsetWidth || e.offsetHeight);
            if (el) {
              el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, isPrimary: true }));
              el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            }
            return true;
          })()`,
          returnByValue: true,
        });
      }
      await sleep(900);
      return kind;
    };

    const evalText = async (): Promise<string> => {
      const res = await send('Runtime.evaluate', {
        expression: 'document.body.innerText',
        returnByValue: true,
      });
      return String(res?.result?.value || '');
    };

    const initial = await evalText();
    console.log(`[Probe] 首屏文本 ${initial.length} 字：${initial.replace(/\s+/g, ' ').slice(0, 80)}`);

    // 静置观察：不点任何东西，看打字机是否自己往下吐、播完是否自己弹介入点
    if (IDLE_SEC > 0) {
      console.log(`[Probe] 静置 ${IDLE_SEC}s 不做任何操作`);
      let prev = initial.length;
      for (let t = 2; t <= IDLE_SEC; t += 2) {
        await sleep(2000);
        const text = await evalText();
        const grew = text.length > prev;
        console.log(`  +${t}s ${text.length} 字 ${grew ? '↑ 在吐' : '（未变）'}：${text.replace(/\s+/g, ' ').slice(-40)}`);
        prev = text.length;
      }
    }

    let prevLen = initial.length;
    let idle = 0;
    const playLog: string[] = [];
    for (let i = 1; i <= CLICKS; i++) {
      const kind = await act();
      const text = await evalText();
      const changed = text.length !== prevLen;
      idle = changed ? 0 : idle + 1;
      playLog.push(`${i}.${kind}${changed ? '' : '(无变化)'}`);
      console.log(
        `[Probe] 第 ${i} 次动作 ${kind} → ${text.length} 字${changed ? '' : '（无变化）'}：${text
          .replace(/\s+/g, ' ')
          .slice(0, 70)}`
      );
      prevLen = text.length;
      if (idle >= 3) {
        console.log('[Probe] 连续 3 次动作都没有推进，停止试玩');
        break;
      }
    }

    const diag = await send('Runtime.evaluate', {
      expression: `(() => {
        const p = document.querySelector('.stage-paragraph, .rg-paragraph, p');
        if (!p) return '无段落元素';
        const cs = getComputedStyle(p);
        const r = p.getBoundingClientRect();
        return JSON.stringify({
          cls: p.className,
          opacity: cs.opacity,
          visibility: cs.visibility,
          color: cs.color,
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          text: (p.textContent || '').slice(0, 20)
        });
      })()`,
      returnByValue: true,
    });
    console.log(`[Probe] 段落诊断：${diag?.result?.value}`);

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const outPath = path.resolve(`.tmp_probe/probe-${projectId}.png`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));

    console.log(`[Probe] 截图：${outPath}`);
    console.log(errors.length ? `[Probe] ❌ 运行时异常：\n  - ${errors.join('\n  - ')}` : '[Probe] ✅ 无运行时异常');
    if (logs.length) console.log(`[Probe] ⚠️ console.error：\n  - ${logs.join('\n  - ')}`);
    console.log(
      idle >= 3
        ? `[Probe] ❌ 动作序列在卡住：${playLog.join(' ')}`
        : '[Probe] ✅ 整条交互链路都能推进'
    );

    ws.close();
    process.exit(errors.length > 0 ? 1 : 0);
  } finally {
    chrome.kill();
  }
}

main().catch((err) => {
  console.error(`[Probe] ❌ ${err?.message || err}`);
  process.exit(1);
});
