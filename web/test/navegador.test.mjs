// La web del público en un móvil, en producción (sin --dev), con Chrome sin
// ventana. Mira lo que ve un visitante cuando una palabra no tiene vídeo o el
// vídeo no se puede poner, el toque que se queda corto y el aviso sin
// conexión. Sin Chrome o sin ffmpeg, se salta.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'node-osc';
import { chrome, launch, mobile, goto } from './cdp.mjs';

const web = fileURLToPath(new URL('..', import.meta.url));
let ffmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpeg = false; }
const skip = !chrome() ? 'sin Chrome' : !ffmpeg ? 'sin ffmpeg' : false;

let srv;
let out = [];
let base;
let b;
// Todo lo temporal, dentro de una carpeta que se borra al acabar.
let raiz;
const temporal = (nombre) => { const d = join(raiz, nombre); mkdirSync(d); return d; };

before(async () => {
  if (skip) return;
  raiz = mkdtempSync(join(tmpdir(), 'systema-nav-'));
  const cat = temporal('catalogo');
  const media = temporal('media');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=20',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', '-movflags', '+faststart', join(media, 'con.mp4')]);
  writeFileSync(join(media, 'roto.mp4'), Buffer.alloc(4096, 7));      // no es un vídeo
  writeFileSync(join(cat, 'contents.json'), JSON.stringify({
    con: { archivo: 'con.mp4', duration: 20, num: 1 },
    sin: { duration: 10, num: 2 },
    roto: { archivo: 'roto.mp4', duration: 10, num: 3 },
    otra: { duration: 10, num: 4 },
  }));
  writeFileSync(join(cat, 'map.json'), JSON.stringify({
    version: 2, width: 1400, height: 2000, font: { 1: 44, 2: 31, 3: 24 }, advance: 0.612,
    nodes: [
      { id: 'con', label: 'Con vídeo', lv: 1, x: 700, y: 700 },
      { id: 'sin', label: 'Sin vídeo', lv: 1, x: 700, y: 1000 },
      { id: 'roto', label: 'Roto', lv: 1, x: 700, y: 1300 },
      { id: 'otra', label: 'Otra', lv: 3, x: 300, y: 400 },
    ],
    links: [['con', 'sin']],
  }));
  srv = spawn(process.execPath, ['server/index.js'], {
    cwd: web,
    env: {
      ...process.env, PORT: '0', OSC_PORT: '0', CATALOGO: cat, MEDIA: media, ESTADO: join(temporal('estado'), 'p.json'),
    },
  });
  srv.stdout.setEncoding('utf8');
  srv.stdout.on('data', (d) => { out.push(...d.split('\n')); });
  for (let i = 0; i < 100 && !base; i += 1) {
    const l = out.find((x) => /web del público en http:\/\/0\.0\.0\.0:(\d+)/.test(x));
    if (l) base = `http://127.0.0.1:${/:(\d+)/.exec(l.split('http://0.0.0.0')[1])[1]}`;
    else await new Promise((r) => { setTimeout(r, 100); });
  }
  b = await launch();
  await mobile(b);
  await goto(b, `${base}/`);
});

after(async () => {
  await b?.close();
  if (srv && srv.exitCode === null && srv.signalCode === null) await new Promise((r) => { srv.once('exit', r); srv.kill(); });
  if (raiz) rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const centro = (id) => b.evaluate(`(() => { const r = document.querySelector('[data-id="${id}"] .word').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, bottom: r.bottom }; })()`);
const health = async () => (await fetch(`${base}/health`)).text();

test('una palabra sin vídeo no abre nada, lo dice abajo y no se enciende en los demás', { skip }, async () => {
  const p = await centro('sin');
  await b.tap(p.x, p.y);
  await b.until(`document.getElementById('note').textContent.includes('no tiene vídeo')`, 4000);
  assert.equal(await b.evaluate(`document.getElementById('player').hidden`), true, 'el reproductor no se abre');
  assert.match(await health(), /^mobile -$/m, 'no se enciende en el mapa de nadie');
  assert.equal(await b.evaluate(`document.getElementById('sim').hidden`), true, 'nada de «clip simulado» en la sala');
});

test('un vídeo que no se puede poner lo dice, y el servidor lo apunta', { skip }, async () => {
  const p = await centro('roto');
  await b.tap(p.x, p.y);
  await b.until(`document.getElementById('note').textContent.includes('no se puede ver ahora')`, 8000);
  assert.equal(await b.evaluate(`document.getElementById('player').hidden`), true);
  for (let i = 0; i < 30 && !out.some((l) => /no ha podido poner «Roto»/.test(l)); i += 1) await new Promise((r) => { setTimeout(r, 100); });
  assert.ok(out.some((l) => /no ha podido poner «Roto»/.test(l)), 'el registro dice qué vídeo falla');
});

test('un toque que se queda corto abre la palabra más cercana, y el vídeo suena', { skip }, async () => {
  const p = await centro('con');
  await b.tap(p.x, p.bottom + 8);                    // 8 px por debajo de la palabra
  await b.until(`!document.getElementById('player').hidden`, 4000);
  assert.match(await b.evaluate(`document.getElementById('video').getAttribute('src')`), /^\/media\/con\.mp4\?v=/);
  await b.until(`document.getElementById('video').currentTime > 0.3`, 8000);
  assert.equal(await b.evaluate(`document.getElementById('timer').classList.contains('loading')`), false, 'ya no dice que carga');
  // El magenta llega a los demás, porque el servidor lo tiene como «viendo».
  for (let i = 0; i < 30 && !/^mobile con$/m.test(await health()); i += 1) await new Promise((r) => { setTimeout(r, 100); });
  assert.match(await health(), /^mobile con$/m);
  await b.evaluate(`document.getElementById('back').click()`);
  await b.until(`document.getElementById('player').hidden`, 4000);
});

// Una pausa del sistema (quitarse un AirPod, el centro de control, una
// llamada) no es un atasco. Antes, a los 15 s el móvil cerraba el vídeo con
// «no se puede ver» y el panel apuntaba un fallo que no era (hasta el
// 2-oct-2026). Desde la página se ve igual que un video.pause() de fuera.
test('una pausa del sistema no cierra el vídeo como atascado', { skip, timeout: 40000 }, async () => {
  const p = await centro('con');
  await b.tap(p.x, p.y);
  await b.until(`document.getElementById('video').currentTime > 0.3`, 8000);
  await b.evaluate(`document.getElementById('video').pause()`);
  await new Promise((r) => { setTimeout(r, 16500); });
  assert.equal(await b.evaluate(`document.getElementById('player').hidden`), false, 'el reproductor sigue abierto');
  assert.ok(!(await b.evaluate(`document.getElementById('note').textContent`)).includes('«Con vídeo» no se puede ver'), 'ni el aviso de que no se puede ver');
  assert.ok(!out.some((l) => /no ha podido poner «Con vídeo» \(atascado\)/.test(l)), 'el servidor no apunta un fallo que no es');
  await b.evaluate(`document.getElementById('back').click()`);
  await b.until(`document.getElementById('player').hidden`, 4000);
});

// Una pantalla de la sala con la red caída justo cuando el Max dispara. El
// navegador da un error 4 (antes de tener los metadatos, como manda la
// especificación) y la pantalla se quedaba en negro hasta el siguiente
// número aunque la red volviera al segundo (hasta el 2-oct-2026). Ahora
// reintenta mientras dure el disparo.
test('una pantalla recupera el vídeo cuando vuelve la red, aunque fallara al empezar', { skip, timeout: 40000 }, async () => {
  const oscLine = out.find((x) => /Max por OSC en 127\.0\.0\.1:(\d+)/.test(x));
  const max = new Client('127.0.0.1', Number(/127\.0\.0\.1:(\d+)/.exec(oscLine)[1]));
  const t = await launch();
  try {
    await goto(t, `${base}/screen/tele1`);
    let cortada = true;
    t.on((m) => {
      if (m.method !== 'Fetch.requestPaused') return;
      const { requestId } = m.params;
      if (cortada) t.send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' }).catch(() => {});
      else t.send('Fetch.continueRequest', { requestId }).catch(() => {});
    });
    await t.send('Fetch.enable', { patterns: [{ urlPattern: '*/media/*' }] });
    await max.send('/tele1/video', 1);
    await t.until(`document.getElementById('video').error !== null`, 8000);
    cortada = false;
    await t.until(`document.getElementById('video').currentTime > 0.5`, 12000);
    await t.send('Fetch.disable');
  } finally {
    await max.send('/tele1/video', 0);
    await max.close();
    await t.close();
  }
});

test('el punto de conexión no usa el verde de «suena en la sala», y los botones van subrayados', { skip }, async () => {
  const dot = await b.evaluate(`getComputedStyle(document.getElementById('conn')).backgroundColor`);
  const verde = await b.evaluate(`(() => { const s = document.createElement('i'); s.style.color = 'var(--accent)'; document.body.append(s);
    const c = getComputedStyle(s).color; s.remove(); return c; })()`);
  assert.notEqual(dot, verde);
  assert.equal(await b.evaluate(`getComputedStyle(document.getElementById('theme')).textDecorationStyle`), 'dotted');
  assert.deepEqual(b.errores, [], 'ningún error de JavaScript');
});

test('sin conexión, el aviso tapa al hint y la barra se apaga', { skip }, async () => {
  srv.kill();
  await b.until(`!document.getElementById('toast').hidden`, 8000);
  assert.equal(await b.evaluate(`document.body.classList.contains('offline')`), true);
  assert.equal(await b.evaluate(`getComputedStyle(document.getElementById('hint')).opacity`), '0');
});
