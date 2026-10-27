// La web del público en un móvil, en producción (sin --dev), con Chrome sin
// ventana. Mira lo que ve un visitante cuando una palabra no tiene vídeo o el
// vídeo no se puede poner, el toque que se queda corto y el aviso sin
// conexión. Sin Chrome o sin ffmpeg, se salta.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  // Sin pista de sonido, como una vídeo-partitura.
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=20',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', join(media, 'mudo.mp4')]);
  // Tres vídeos de la misma palabra, como los de Guille para varias pantallas.
  for (const f of ['b1', 'b2', 'b3']) copyFileSync(join(media, 'con.mp4'), join(media, `${f}.mp4`));
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
    bosque: { archivo: 'b1.mp4', duration: 20, num: 200 },
    bosque_201: { archivo: 'b2.mp4', duration: 20, num: 201 },
    bosque_202: { archivo: 'b3.mp4', duration: 20, num: 202 },
    bosque_sin: { duration: 20, num: 203 },
    // Del 900 en adelante, solo para Max. Está en contents.json y no en el mapa.
    partitura: { archivo: 'con.mp4', duration: 20, num: 901 },
    mudo: { archivo: 'mudo.mp4', duration: 20, num: 6 },
  }));
  writeFileSync(join(cat, 'map.json'), JSON.stringify({
    version: 2, width: 1400, height: 2000, font: { 1: 44, 2: 31, 3: 24 }, advance: 0.612,
    nodes: [
      { id: 'con', label: 'Con vídeo', lv: 1, x: 700, y: 700 },
      { id: 'sin', label: 'Sin vídeo', lv: 1, x: 700, y: 1000 },
      { id: 'roto', label: 'Roto', lv: 1, x: 700, y: 1300 },
      { id: 'otra', label: 'Otra', lv: 3, x: 300, y: 400 },
      { id: 'voz', label: 'Voz', lv: 1, x: 700, y: 1600 },
      { id: 'bosque', label: 'Bosque', lv: 1, x: 700, y: 400, videos: ['bosque', 'bosque_201', 'bosque_202', 'bosque_sin'] },
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
  // Y un toque en el vídeo parado lo reanuda. Antes no hacía nada.
  await b.tap(195, 420);
  await b.until(`!document.getElementById('video').paused`, 4000);
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

// Juanlu, el 26-10-2026: el 102 sonaba entrecortado en la pantalla y bien
// abierto tal cual. Para ir al compás la pantalla aceleraba y frenaba un poco,
// y el navegador, para no cambiar el tono, estiraba el sonido a trozos.
test('lo que suena en una pantalla no se acelera ni se frena, y lo que no suena o es una partitura sigue yendo al compás', { skip, timeout: 90000 }, async () => {
  const oscLine = out.find((x) => /Max por OSC en 127\.0\.0\.1:(\d+)/.test(x));
  const max = new Client('127.0.0.1', Number(/127\.0\.0\.1:(\d+)/.exec(oscLine)[1]));
  const espera = (ms) => new Promise((r) => { setTimeout(r, ms); });
  const v = `document.getElementById('video')`;
  const s = await launch();
  const poner = async (num, fichero) => {
    await max.send('/tele5/video', num);
    // Que ya sea el fichero nuevo. Si no, el tiempo que se mira es el del de antes.
    await s.until(`${v}.currentSrc.includes('/${fichero}') && ${v}.currentTime > 1.5`, 10000);
  };
  // Se la echa 0,15 s atrás, menos de lo que hace saltar, y se apuntan las
  // velocidades por las que pasa en los 2,5 s siguientes. Si antes no se
  // corregía, se le deja `asentar` para que empiece clavada, que si ya iba
  // atrasada pasaría de 0,3 s y saltaría en vez de acelerar.
  const velocidades = async (asentar = 0) => {
    await espera(asentar);
    await s.evaluate(`(() => { window.vel = []; ${v}.onratechange = () => { window.vel.push(${v}.playbackRate); }; ${v}.currentTime -= 0.15; return true; })()`);
    await espera(2500);
    return s.evaluate('window.vel');
  };
  const vuelveAlCompas = (vel, que) => assert.ok(Math.max(...vel) > 1.05, `${que} acelera para volver al compás (${vel.slice(0, 8).join(', ')})`);
  const noSeToca = async (vel, que) => {
    assert.deepEqual(vel, [], `${que} no cambia de velocidad`);
    assert.equal(await s.evaluate(`${v}.playbackRate`), 1);
  };
  try {
    await goto(s, `${base}/screen/tele5`);
    // Sin el toque va en silencio y se corrige como siempre. El toque la deja
    // a velocidad normal en ese mismo momento, antes de que suene. Se mira
    // justo después de que la página atienda el toque, que si no lo haría
    // igual el compás en el siguiente cuarto de segundo.
    await poner(1, 'con.mp4');
    assert.equal(await s.evaluate(`${v}.muted`), true, 'sin el toque no suena');
    await s.evaluate(`(() => { ${v}.currentTime -= 0.15; return true; })()`);
    await s.until(`${v}.playbackRate > 1.05`, 3000);
    await s.evaluate(`(() => { document.addEventListener('touchend', () => { window.alTocar ??= [${v}.playbackRate, ${v}.muted]; }); return true; })()`);
    await s.tap(100, 100);
    assert.deepEqual(await s.evaluate('window.alTocar'), [1, false], 'al tocar, velocidad normal y con sonido');

    // Con el sonido activado, un vídeo con sonido no cambia de velocidad.
    await espera(500);
    assert.ok(await s.evaluate(`${v}.webkitAudioDecodedByteCount > 0`), 'con.mp4 suena');
    await noSeToca(await velocidades(), 'con sonido');

    // Uno sin pista de sonido sí, y hacia donde tiene que ir.
    await poner(6, 'mudo.mp4');
    assert.equal(await s.evaluate(`${v}.webkitAudioDecodedByteCount`), 0, 'mudo.mp4 no trae sonido');
    vuelveAlCompas(await velocidades(1500), 'sin sonido');

    // Una partitura (del 900 en adelante) también, aunque traiga sonido.
    await poner(901, 'con.mp4');
    assert.ok(await s.evaluate(`${v}.webkitAudioDecodedByteCount > 0`), 'la partitura de prueba suena');
    vuelveAlCompas(await velocidades(1500), 'una partitura con sonido');

    // Safari dice si hay sonido en audioTracks, que Chrome no tiene. Se le pone
    // al vídeo para ver que manda sobre lo demás.
    const pistas = (n) => s.evaluate(`(() => { Object.defineProperty(${v}, 'audioTracks', { configurable: true, get: () => ({ length: ${n} }) }); return true; })()`);
    await poner(6, 'mudo.mp4');
    await pistas(1);
    await espera(500);   // si iba acelerando, que vuelva a la normal antes de mirar
    await noSeToca(await velocidades(), 'con audioTracks de 1');
    await poner(1, 'con.mp4');
    await pistas(0);
    vuelveAlCompas(await velocidades(1500), 'con audioTracks de 0');
    await s.evaluate(`(() => { delete ${v}.audioTracks; return true; })()`);
    assert.deepEqual(s.errores, [], 'ningún error de JavaScript');
  } finally {
    await max.send('/tele5/video', 0);
    await max.close();
    await s.close();
  }
});

// En el iPad, la pantalla completa de Safari saca cada pocos segundos su aviso
// de cómo salir, así que ahí el toque no la pide. En Android y en un ordenador
// sí. El iPad se presenta como un Mac con pantalla táctil, o como iPad si se
// le pide la web de móvil. Se cuenta cuántas veces la pide la página.
test('el toque pide la pantalla completa en un ordenador y en una tablet Android, y en un iPad no', { skip, timeout: 60000 }, async () => {
  const SAFARI_IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15';
  const SAFARI_IPAD_MOVIL = 'Mozilla/5.0 (iPad; CPU OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1';
  const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 7.1.1; SM-P550) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';
  const pedidas = async (agente) => {
    const s = await launch();
    try {
      if (agente) {
        await s.send('Emulation.setUserAgentOverride', { userAgent: agente });
        await s.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      }
      await s.send('Page.addScriptToEvaluateOnNewDocument', { source: `
        window.pedidas = 0;
        Element.prototype.requestFullscreen = function () { window.pedidas += 1; return Promise.resolve(); };
      ` });
      await goto(s, `${base}/screen/ipad9`);
      await s.tap(100, 100);
      // El toque quita el silencio y pide la pantalla completa en la misma
      // función, así que cuando ya suena la petición ya se ha hecho o no.
      await s.until(`document.getElementById('video').muted === false`, 3000);
      assert.deepEqual(s.errores, [], 'ningún error de JavaScript');
      // Con await, que si no el finally cierra Chrome antes de que conteste.
      return await s.evaluate('window.pedidas');
    } finally {
      await s.close();
    }
  };
  assert.ok(await pedidas() > 0, 'en un ordenador la pide');
  assert.ok(await pedidas(CHROME_ANDROID) > 0, 'en una tablet Android la pide');
  assert.equal(await pedidas(SAFARI_IPAD), 0, 'en un iPad no la pide');
  assert.equal(await pedidas(SAFARI_IPAD_MOVIL), 0, 'en un iPad con la web de móvil tampoco');
});

// Un Chrome de antes del 80 no entiende screen.js. Se hace como si fuera uno.
// screen.js no llega, la comprobación de «?.» falla y faltan append,
// getOwnPropertyDescriptors y padStart, que llegaron en el 54 y el 57. Tiene
// que entrar screen-viejo.js, poner el vídeo del Max y sonar al tocarla. Un
// Chrome de ahora ni la baja.
test('en un Chrome viejo la pantalla arranca con screen-viejo.js, pone el vídeo y suena al tocarla, y en uno nuevo ni la baja', { skip, timeout: 40000 }, async () => {
  const oscLine = out.find((x) => /Max por OSC en 127\.0\.0\.1:(\d+)/.test(x));
  const max = new Client('127.0.0.1', Number(/127\.0\.0\.1:(\d+)/.exec(oscLine)[1]));
  const v = `document.getElementById('video')`;
  const bajada = (que) => `performance.getEntriesByType('resource').some((r) => r.name.includes('${que}'))`;
  const viejo = await launch();
  const nuevo = await launch();
  try {
    viejo.on((m) => {
      if (m.method !== 'Fetch.requestPaused') return;
      viejo.send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'Failed' }).catch(() => {});
    });
    await viejo.send('Fetch.enable', { patterns: [{ urlPattern: '*/js/screen.js' }] });
    await viejo.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      const F = window.Function;
      window.Function = function (...a) {
        if (String(a[a.length - 1]).includes('?.')) throw new SyntaxError('Chrome viejo');
        return F(...a);
      };
      delete Element.prototype.append;
      delete Object.getOwnPropertyDescriptors;
      delete String.prototype.padStart;
    ` });
    await goto(viejo, `${base}/screen/tablet9`);
    assert.ok(await viejo.evaluate(bajada('/js/screen-viejo.js')), 'baja screen-viejo.js');
    await viejo.until(`document.getElementById('tag').textContent.length > 0`, 5000);
    await max.send('/tablet9/video', 1);
    await viejo.until(`!${v}.paused && ${v}.currentSrc.includes('/con.mp4') && ${v}.currentTime > 0.5`, 10000);
    await viejo.tap(100, 100);
    await viejo.until(`${v}.muted === false`, 3000);
    assert.deepEqual(viejo.errores, [], 'ningún error de JavaScript');

    await goto(nuevo, `${base}/screen/tablet8`);
    assert.ok(await nuevo.evaluate(bajada('/js/screen.js')), 'uno de ahora baja screen.js');
    assert.equal(await nuevo.evaluate(bajada('screen-viejo')), false, 'y no baja screen-viejo.js');
  } finally {
    await max.send('/tablet9/video', 0);
    await max.close();
    await viejo.close();
    await nuevo.close();
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
// Guille, el 22-10-2026: el mismo concepto visto desde varias pantallas es una
// sola palabra con varios vídeos.
test('una palabra con varios vídeos pone uno al azar, otro al volver a tocarla, y se enciende con cualquiera', { skip, timeout: 40000 }, async () => {
  const fichero = { 'b1.mp4': 'bosque', 'b2.mp4': 'bosque_201', 'b3.mp4': 'bosque_202' };
  const puestos = [];
  for (let i = 0; i < 4; i += 1) {
    const p = await centro('bosque');
    await b.tap(p.x, p.y);
    await b.until(`!document.getElementById('player').hidden`, 4000);
    const src = await b.evaluate(`document.getElementById('video').getAttribute('src')`);
    const f = /^\/media\/(b[123]\.mp4)\?v=/.exec(src)?.[1];
    assert.ok(f, `uno de los tres con fichero, nunca el que no lo tiene (${src})`);
    assert.notEqual(f, puestos.at(-1), 'no repite el que acaba de ver');
    puestos.push(f);
    assert.equal(await b.evaluate(`document.getElementById('now-label').textContent`), 'Bosque');
    // Al servidor le llega cuál de los vídeos es.
    const re = new RegExp(`^mobile ${fichero[f]}$`, 'm');
    for (let j = 0; j < 30 && !re.test(await health()); j += 1) await new Promise((r) => { setTimeout(r, 100); });
    assert.match(await health(), re);
    await b.evaluate(`document.getElementById('back').click()`);
    await b.until(`document.getElementById('player').hidden`, 4000);
  }
  for (let j = 0; j < 30 && !/^mobile -$/m.test(await health()); j += 1) await new Promise((r) => { setTimeout(r, 100); });
  assert.match(await health(), /^mobile -$/m, 'al cerrar, el servidor lo suelta');
  // Max pone en una tele el tercero, y en el móvil se enciende la palabra.
  const oscLine = out.find((x) => /Max por OSC en 127\.0\.0\.1:(\d+)/.test(x));
  const max = new Client('127.0.0.1', Number(/127\.0\.0\.1:(\d+)/.exec(oscLine)[1]));
  const verde = `document.querySelector('[data-id="bosque"]').classList.contains('active')`;
  try {
    await max.send('/tele1/video', 202);
    await b.until(verde, 4000);
    await max.send('/tele1/video', 0);
    await b.until(`!${verde}`, 4000);
  } finally {
    await max.close();
  }
});

// Las partituras del concierto (del 900 en adelante) las pone Max en el móvil
// de un músico, pero no están en el mapa. Al público le llega igual que suenan.
test('una partitura en el móvil de un músico no rompe el del público ni le enciende nada', { skip, timeout: 20000 }, async () => {
  const antes = b.errores.length;
  const oscLine = out.find((x) => /Max por OSC en 127\.0\.0\.1:(\d+)/.test(x));
  const max = new Client('127.0.0.1', Number(/127\.0\.0\.1:(\d+)/.exec(oscLine)[1]));
  const con = `document.querySelector('[data-id="con"]').classList.contains('active')`;
  try {
    await max.send('/musico1/video', 901);
    for (let j = 0; j < 30 && !/^active .*partitura/m.test(await health()); j += 1) await new Promise((r) => { setTimeout(r, 100); });
    assert.match(await health(), /^active .*partitura/m, 'el servidor la pone por su número');
    // Contraprueba: lo que sí está en el mapa se enciende, así que al móvil le
    // llegan los avisos de la sala, también el de la partitura.
    await max.send('/tele1/video', 1);
    await b.until(con, 4000);
    assert.equal(await b.evaluate(`document.querySelectorAll('[data-id].active').length`), 1, 'solo la palabra del mapa');
    assert.equal(await b.evaluate(`document.querySelectorAll('#live-list .entry:not([aria-hidden="true"])').length`), 1, 'y en «en sala», solo ella (la que se está borrando de la prueba de antes no cuenta)');
    assert.deepEqual(b.errores.slice(antes), [], 'ningún error de JavaScript');
  } finally {
    await max.send('/musico1/video', 0);
    await max.send('/tele1/video', 0);
    await max.close();
  }
  await b.until(`!${con}`, 4000);
});

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
