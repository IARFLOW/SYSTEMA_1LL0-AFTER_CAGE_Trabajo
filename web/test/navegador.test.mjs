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
import { Client, Bundle, Message } from 'node-osc';
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
  // Un audio, en negro y con su versión de móvil, como lo deja npm run versiones.
  mkdirSync(join(media, 'movil'));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=1280x720:r=25:d=20',
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', '-movflags', '+faststart', join(media, 'movil', 'voz.mp4')]);
  writeFileSync(join(media, 'versiones.json'), JSON.stringify({ masters: {
    'voz.wav': { soloAudio: true, salidas: { movil: { fichero: 'movil/voz.mp4' } } },
  } }));
  writeFileSync(join(cat, 'contents.json'), JSON.stringify({
    con: { archivo: 'con.mp4', duration: 20, num: 1 },
    sin: { duration: 10, num: 2 },
    roto: { archivo: 'roto.mp4', duration: 10, num: 3 },
    otra: { duration: 10, num: 4 },
    voz: { archivo: 'voz.wav', duration: 20, num: 5 },
  }));
  writeFileSync(join(cat, 'map.json'), JSON.stringify({
    version: 2, width: 1400, height: 2000, font: { 1: 44, 2: 31, 3: 24 }, advance: 0.612,
    nodes: [
      { id: 'con', label: 'Con vídeo', lv: 1, x: 700, y: 700 },
      { id: 'sin', label: 'Sin vídeo', lv: 1, x: 700, y: 1000 },
      { id: 'roto', label: 'Roto', lv: 1, x: 700, y: 1300 },
      { id: 'otra', label: 'Otra', lv: 3, x: 300, y: 400 },
      { id: 'voz', label: 'Voz', lv: 1, x: 700, y: 1600 },
    ],
    links: [['con', 'sin'], ['con', 'otra', 'proceso'], ['sin', 'otra', 'medio']],
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

test('las líneas del proceso van discontinuas y las del medio punteadas, y las demás continuas', { skip }, async () => {
  const trazo = (sel) => b.evaluate(`getComputedStyle(document.querySelector('${sel}')).strokeDasharray`);
  // La prueba de antes deja «Silencio» encendido hasta que llega su
  // /tele1/video 0, y una línea encendida lleva el trazo de la señal.
  await b.until(`!document.querySelector('.link.lit')`, 4000);
  assert.equal(await trazo('.link:not(.proceso):not(.medio)'), 'none');
  assert.equal(await trazo('.link.proceso'), '7px, 5px');
  assert.equal(await trazo('.link.medio'), '1.5px, 4px');
});

// Las vídeo-partituras de los músicos (el 29-oct-2026) van en varios móviles a
// la vez y tienen que ir clavadas. Antes, cada pantalla empezaba cuando tenía
// el vídeo cargado, y la que tardaba se quedaba detrás todo el vídeo.
test('dos pantallas con el mismo vídeo van clavadas, aunque una cargue tarde o se retrase a mitad', { skip, timeout: 60000 }, async (t) => {
  const oscLine = out.find((x) => /Max por OSC en 127\.0\.0\.1:(\d+)/.test(x));
  const max = new Client('127.0.0.1', Number(/127\.0\.0\.1:(\d+)/.exec(oscLine)[1]));
  const espera = (ms) => new Promise((r) => { setTimeout(r, ms); });
  const [p1, p2] = await Promise.all([launch(), launch()]);
  try {
    await goto(p1, `${base}/screen/musico1`);
    await goto(p2, `${base}/screen/musico2`);
    // A la segunda, lo primero del vídeo le llega 1,5 s tarde, como a un móvil con mala Wi-Fi.
    let primera = true;
    p2.on((m) => {
      if (m.method !== 'Fetch.requestPaused') return;
      const sigue = () => p2.send('Fetch.continueRequest', { requestId: m.params.requestId }).catch(() => {});
      if (primera) { primera = false; setTimeout(sigue, 1500); } else sigue();
    });
    await p2.send('Fetch.enable', { patterns: [{ urlPattern: '*/media/*' }] });
    // Juntos en un paquete, como los manda el Max en una línea de su coll. Uno
    // detrás de otro, con dos Chrome cargando el ordenador, el segundo salía
    // hasta 40 ms después, y eso no es desfase de las pantallas.
    await max.send(new Bundle(new Message('/musico1/video', 1), new Message('/musico2/video', 1)));
    // Cuánto va la primera por delante de la segunda, en el mismo instante.
    // Los dos Chrome comparten el reloj del ordenador (timeOrigin).
    const donde = (p) => p.evaluate(`({ t: document.getElementById('video').currentTime, at: performance.timeOrigin + performance.now() })`);
    const desfase = async () => {
      const muestras = [];
      for (let i = 0; i < 5; i += 1) {
        const [a, c] = await Promise.all([donde(p1), donde(p2)]);
        muestras.push(a.t - (c.t + (a.at - c.at) / 1000));
        await espera(200);
      }
      return muestras.sort((x, y) => x - y)[2];
    };
    await p2.until(`document.getElementById('video').currentTime > 2`, 15000);
    await espera(3000);
    const alCargar = await desfase();
    assert.ok(Math.abs(alCargar) < 0.1, `la que cargó tarde va ${alCargar.toFixed(3)} s detrás`);
    // Un tirón a mitad. Se la echa un segundo atrás y tiene que volver sola.
    await p2.evaluate(`document.getElementById('video').currentTime -= 1`);
    await espera(4000);
    const trasElTiron = await desfase();
    assert.ok(Math.abs(trasElTiron) < 0.1, `tras el tirón va ${trasElTiron.toFixed(3)} s detrás`);
    t.diagnostic(`desfase al cargar ${Math.round(alCargar * 1000)} ms, tras el tirón ${Math.round(trasElTiron * 1000)} ms`);
  } finally {
    await max.send('/musico1/video', 0);
    await max.send('/musico2/video', 0);
    await max.close();
    await Promise.all([p1.close(), p2.close()]);
  }
});

// Un móvil apaga la pantalla a los pocos minutos (el Samsung de Guille, a los
// 10 como mucho). Mientras espera en negro, la mantiene encendida un vídeo
// negro en marcha, porque con uno en marcha Chrome no la deja apagarse.
test('un móvil que espera en negro tiene un vídeo en marcha para no apagarse, y una tele no', { skip, timeout: 60000 }, async () => {
  const oscLine = out.find((x) => /Max por OSC en 127\.0\.0\.1:(\d+)/.test(x));
  const max = new Client('127.0.0.1', Number(/127\.0\.0\.1:(\d+)/.exec(oscLine)[1]));
  const res = await fetch(`${base}/despierta.mp4`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  const [m, tele] = await Promise.all([launch(), launch()]);
  try {
    await mobile(m);
    await goto(m, `${base}/screen/musico3`);
    await goto(tele, `${base}/screen/tele3`);
    const enMarcha = `(() => { const a = document.getElementById('awake'); return !a.hidden && !a.paused && a.currentTime > 0; })()`;
    await m.until(enMarcha, 5000);
    assert.equal(await m.evaluate(`document.getElementById('awake').muted`), true, 'en Chrome va sin sonido, sin aviso de «reproduciendo»');
    // Llega la partitura, que ya mantiene la pantalla encendida, y el negro se para.
    await max.send('/musico3/video', 1);
    await m.until(`!document.getElementById('video').paused && document.getElementById('video').currentTime > 0.5`, 8000);
    await m.until(`document.getElementById('awake').paused`, 2000);
    // Acaba, y vuelve el negro en marcha.
    await max.send('/musico3/video', 0);
    await m.until(enMarcha, 3000);
    // Al acabar sus 10 s vuelve a empezar, y no se queda parado.
    await m.evaluate(`document.getElementById('awake').currentTime = 9.7`);
    await m.until(`(() => { const a = document.getElementById('awake'); return !a.paused && a.currentTime < 2; })()`, 5000);
    // En una tele sin pantalla táctil no hace falta.
    assert.equal(await tele.evaluate(`(() => { const a = document.getElementById('awake'); return a.hidden && a.paused && !a.getAttribute('src'); })()`), true);
  } finally {
    await max.send('/musico3/video', 0);
    await max.close();
    await Promise.all([m.close(), tele.close()]);
  }
});

// Pedido el 21-10-2026. El altavoz sale en el móvil del público cuando lo que
// suena es un audio, y nunca en las pantallas de la sala, músicos incluidos.
test('un audio lleva el altavoz en el móvil del público, un vídeo no, y una pantalla de la sala nunca', { skip, timeout: 40000 }, async () => {
  const c = await (await fetch(`${base}/contents.json`)).json();
  assert.equal(c.voz.audio, true, 'el servidor lo marca por el registro');
  assert.equal(c.con.audio, undefined);
  const visible = `(() => { const a = document.getElementById('altavoz'); return !a.hidden && a.complete && a.naturalWidth > 0
    && getComputedStyle(a).display !== 'none'; })()`;
  const v = await centro('voz');
  await b.tap(v.x, v.y);
  await b.until(`!document.getElementById('player').hidden`, 4000);
  await b.until(visible, 4000);
  // En medio de la pantalla y pequeño.
  const r = await b.evaluate(`(() => { const a = document.getElementById('altavoz').getBoundingClientRect();
    return { cx: a.left + a.width / 2, cy: a.top + a.height / 2, w: a.width, vw: innerWidth, vh: innerHeight }; })()`);
  assert.ok(Math.abs(r.cx - r.vw / 2) < 2 && Math.abs(r.cy - r.vh / 2) < 2, JSON.stringify(r));
  assert.ok(r.w > 20 && r.w < r.vw / 4, JSON.stringify(r));
  await b.evaluate(`document.getElementById('back').click()`);
  await b.until(`document.getElementById('player').hidden`, 4000);
  // Un vídeo normal, sin altavoz.
  const p = await centro('con');
  await b.tap(p.x, p.y);
  await b.until(`!document.getElementById('player').hidden`, 4000);
  assert.equal(await b.evaluate(`document.getElementById('altavoz').hidden`), true);
  await b.evaluate(`document.getElementById('back').click()`);
  await b.until(`document.getElementById('player').hidden`, 4000);
  // El móvil de un músico pone el mismo audio, sin altavoz.
  const oscLine = out.find((x) => /Max por OSC en 127\.0\.0\.1:(\d+)/.test(x));
  const max = new Client('127.0.0.1', Number(/127\.0\.0\.1:(\d+)/.exec(oscLine)[1]));
  const m = await launch();
  try {
    await mobile(m);
    await goto(m, `${base}/screen/musico5`);
    await max.send('/musico5/video', 5);
    await m.until(`!document.getElementById('video').paused && document.getElementById('video').currentTime > 0.3`, 8000);
    assert.equal(await m.evaluate(`document.getElementById('altavoz')`), null);
  } finally {
    await max.send('/musico5/video', 0);
    await max.close();
    await m.close();
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
