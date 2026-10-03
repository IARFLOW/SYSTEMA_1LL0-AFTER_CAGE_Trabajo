// Un Chrome sin ventana manejado por el protocolo de depuración (CDP), para
// las pruebas de navegador, con toques de verdad (de confianza, como un dedo),
// pantalla de móvil y lo que pasa dentro de la página. Sin Chrome, Chromium ni
// Brave instalados, `chrome()` da null y las pruebas se saltan.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

export function chrome() {
  const candidatos = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  return candidatos.find((c) => c && existsSync(c)) ?? null;
}

const freePort = () => new Promise((resolve) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

export async function launch() {
  const port = await freePort();
  const perfil = mkdtempSync(join(tmpdir(), 'prueba-chrome-'));
  const proc = spawn(chrome(), [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${perfil}`, '--use-mock-keychain',
    '--no-first-run', '--no-default-browser-check', '--mute-audio', 'about:blank',
  ], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 150 && !targets; i += 1) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(100); }
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.once('open', r); });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) for (const l of listeners) l(m);
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const errores = [];
  listeners.push((m) => {
    if (m.method === 'Runtime.exceptionThrown') errores.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  });
  const tap = async (x, y) => {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(60);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  // Espera a que se cumpla algo dentro de la página.
  const until = async (expr, ms = 5000) => {
    const t0 = Date.now();
    for (;;) {
      if (await evaluate(expr)) return true;
      if (Date.now() - t0 > ms) throw new Error(`no se cumple · ${expr}`);
      await sleep(100);
    }
  };
  // Se espera a que Chrome salga antes de borrar su perfil. Con un borrado a
  // los 500 ms y sin esperar, la prueba acababa antes y cada perfil se quedaba
  // en la carpeta temporal del sistema (443 MB juntados el 2-oct-2026).
  const close = () => new Promise((resolve) => {
    try { ws.close(); } catch { /* ya cerrado */ }
    const borra = () => {
      try { rmSync(perfil, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* temporal del sistema */ }
      resolve();
    };
    if (proc.exitCode !== null || proc.signalCode !== null) { borra(); return; }
    proc.once('exit', borra);
    proc.kill('SIGKILL');
  });
  await send('Page.enable');
  await send('Runtime.enable');
  // Para escuchar eventos del navegador (por ejemplo Fetch.requestPaused).
  const on = (fn) => { listeners.push(fn); };
  return { send, evaluate, tap, until, close, errores, on };
}

export async function mobile(b, { width = 390, height = 844, dpr = 3 } = {}) {
  await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: true });
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}

export async function goto(b, url, settle = 1500) {
  await b.send('Page.navigate', { url });
  await b.until('document.readyState === "complete"', 10000);
  await sleep(settle);
}
