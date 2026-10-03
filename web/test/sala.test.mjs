// Pruebas de la sala, de Max (OSC) → servidor → pantallas y móviles.
// Arrancan un servidor de verdad en puertos libres (PORT=0 y OSC_PORT=0), le
// mandan OSC como lo mandaría Max y miran qué recibe una página de pantalla y
// qué recibe un móvil.
//
//   npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client, Bundle, Message } from 'node-osc';
import WebSocket from 'ws';

const web = fileURLToPath(new URL('..', import.meta.url));
// Todo lo temporal de estas pruebas, dentro de una carpeta que se borra al
// acabar. Antes se quedaba suelto en la carpeta temporal del sistema.
const raiz = mkdtempSync(join(tmpdir(), 'systema-sala-'));
const temporal = (nombre) => mkdtempSync(join(raiz, `${nombre}-`));
// Un catálogo propio de las pruebas, en una carpeta temporal. Con la hoja de
// verdad, las pruebas se ponían rojas en cuanto llegaran los vídeos de Guille
// y Juanlu (más largos) o menos de 13 conceptos con número, sin que el código
// hubiera cambiado. Dos conceptos cortos (4 y 5 s) para lo que mira cuándo se
// acaba un vídeo, y el resto largos, para que nada se acabe a mitad de prueba.
const catalogo = temporal('catalogo');
const mediaVacia = temporal('media');
const contents = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [
  `c${String(i + 1).padStart(2, '0')}`, { file: null, duration: i === 0 ? 4 : i === 1 ? 5 : 60, num: i + 1 },
]));
const labels = new Map(Object.keys(contents).map((id, i) => [id, `Concepto ${i + 1}`]));
writeFileSync(join(catalogo, 'contents.json'), JSON.stringify(contents));
writeFileSync(join(catalogo, 'map.json'), JSON.stringify({
  version: 2, width: 1400, height: 2000, font: { 1: 44, 2: 31, 3: 24 }, advance: 0.612,
  nodes: [...labels].map(([id, label], i) => ({ id, label, lv: 3, x: 200 + (i % 4) * 300, y: 200 + Math.floor(i / 4) * 400 })),
  links: [],
}));
// Conceptos con número de Max, del más corto al más largo. Cada prueba usa
// uno distinto. Si dos compartieran concepto, lo encendido por una taparía lo
// que mira la otra.
const numbered = Object.entries(contents)
  .filter(([, c]) => Number.isInteger(c.num))
  .map(([id, c]) => ({ id, ...c }))
  .sort((a, b) => a.duration - b.duration);
const take = () => numbered.pop();          // uno largo, que no se acaba en mitad de la prueba
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const run = promisify(execFile);

// Cada servidor de prueba guarda lo que ponen sus pantallas en su propia
// carpeta temporal. Si compartieran fichero, uno recuperaría lo del otro.
const estadoNuevo = () => join(temporal('estado'), 'pantallas.json');

// Los servidores de las pruebas, para esperar a que salgan todos antes de
// borrar la carpeta temporal (al salir guardan su estado ahí).
const procesos = new Set();
function startServer(env = {}, args = ['--dev']) {
  const proc = spawn(process.execPath, ['server/index.js', ...args], {
    cwd: web, env: { ...process.env, PORT: '0', OSC_PORT: '0', ESTADO: estadoNuevo(), CATALOGO: catalogo, MEDIA: mediaVacia, ...env },
  });
  procesos.add(proc);
  proc.once('exit', () => procesos.delete(proc));
  const out = [];
  const waiters = new Set();
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => {
    buf += d;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      out.push(line);
      for (const w of waiters) w(line);
    }
  });
  proc.stderr.on('data', (d) => process.stderr.write(d));
  // Espera a que el registro diga algo, mirando solo desde la línea `from`.
  const waitFor = (re, ms = 5000, from = 0) => new Promise((resolve, reject) => {
    const hit = out.slice(from).find((l) => re.test(l));
    if (hit) { resolve(hit); return; }
    const fn = (line) => {
      if (!re.test(line)) return;
      clearTimeout(timer);
      waiters.delete(fn);
      resolve(line);
    };
    const timer = setTimeout(() => {
      waiters.delete(fn);
      reject(new Error(`el registro no dice ${re}:\n${out.join('\n')}`));
    }, ms);
    waiters.add(fn);
  });
  return { proc, out, waitFor };
}

let srv;
let http;
let oscPort;
let max;

before(async () => {
  srv = startServer();
  http = Number(/0\.0\.0\.0:(\d+)/.exec(await srv.waitFor(/web del público en http:\/\/0\.0\.0\.0:\d+/))[1]);
  oscPort = Number(/127\.0\.0\.1:(\d+)/.exec(await srv.waitFor(/Max por OSC en 127\.0\.0\.1:\d+/))[1]);
  max = new Client('127.0.0.1', oscPort);
});

after(async () => {
  await max?.close();
  srv?.proc.kill();
  await Promise.all([...procesos].map((p) => new Promise((r) => {
    if (p.exitCode !== null || p.signalCode !== null) { r(); return; }
    p.once('exit', r);
    p.kill();
  })));
  rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// Un cliente de WebSocket que se presenta como pantalla, móvil o /dev. `next`
// espera al primer mensaje que cumpla la condición y llegue DESPUÉS de
// llamarlo, así que se llama antes de mandar el OSC, no después. Va al
// servidor de las pruebas, o al del puerto que se le diga.
function connect(hello, port = http) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const seen = [];
  const waiters = new Set();
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    seen.push(m);
    for (const w of waiters) w(m);
  });
  ws.on('open', () => ws.send(JSON.stringify(hello)));
  const next = (pred, ms = 3000) => new Promise((resolve, reject) => {
    const fn = (m) => {
      if (!pred(m)) return;
      clearTimeout(timer);
      waiters.delete(fn);
      resolve(m);
    };
    const timer = setTimeout(() => {
      waiters.delete(fn);
      reject(new Error(`no llega lo esperado, han llegado ${JSON.stringify(seen)}`));
    }, ms);
    waiters.add(fn);
  });
  return { ws, next, close: () => ws.close() };
}

const screen = (name) => connect({ type: 'hello', role: 'screen', name });
const phone = () => connect({ type: 'hello', role: 'phone' });
const isSnapshot = (m) => m.type === 'snapshot';
const isVideo = (m) => m.type === 'video';
const api = async (path) => (await fetch(`http://127.0.0.1:${http}${path}`)).json();

test('Max pone un vídeo en una pantalla, su página lo recibe y el mapa se enciende', async () => {
  const c = take();
  const s = screen('tele1');
  const p = phone();
  const [snap] = await Promise.all([s.next(isSnapshot), p.next(isSnapshot)]);
  assert.equal(snap.video, null, 'recién abierta, en negro');

  const got = s.next(isVideo);
  const lit = p.next((m) => m.type === 'active' && m.active.includes(c.id));
  await max.send('/tele1/video', c.num);
  const { video } = await got;
  assert.equal(video.id, c.id);
  assert.equal(video.num, c.num);
  assert.equal(video.duration, c.duration);
  assert.equal(video.file, c.file);
  assert.ok(video.at < 0.5, `un disparo nuevo empieza desde el principio (at = ${video.at})`);
  await lit;

  const off = s.next(isVideo);
  const dark = p.next((m) => m.type === 'active' && !m.active.includes(c.id));
  await max.send('/tele1/video', 0);
  assert.equal((await off).video, null, 'el 0 es negro');
  await dark;
  s.close();
  p.close();
});

test('un número que no está en la hoja deja la pantalla en negro y lo dice', async () => {
  const c = take();
  const s = screen('tele2');
  await s.next(isSnapshot);
  let got = s.next((m) => isVideo(m) && m.video);
  await max.send('/tele2/video', c.num);
  await got;

  const from = srv.out.length;
  got = s.next(isVideo);
  await max.send('/tele2/video', 999);
  assert.equal((await got).video, null);
  await srv.waitFor(/ningún concepto tiene el número 999/, 3000, from);
  s.close();
});

test('un bundle con varios mensajes, un número decimal y el nombre en mayúsculas', async () => {
  const c = take();
  const s = screen('tele3');
  await s.next(isSnapshot);
  const got = s.next((m) => isVideo(m) && m.video);
  // Un flonum de Max manda 3.0 como decimal, y «Tele3» es la misma que «tele3».
  await max.send(new Bundle(['/scene', 2], new Message('/Tele3/video', { type: 'float', value: c.num })));
  assert.equal((await got).video.id, c.id);
  assert.equal((await api('/api/state')).scene, 2);
  await max.send('/tele3/video', 0);
  s.close();
});

test('el mismo número otra vez vuelve a empezar el vídeo', async () => {
  const c = take();
  const s = screen('tele4');
  await s.next(isSnapshot);
  let got = s.next((m) => isVideo(m) && m.video);
  await max.send('/tele4/video', c.num);
  const a = (await got).video;
  await sleep(50);
  got = s.next((m) => isVideo(m) && m.video);
  await max.send('/tele4/video', c.num);
  const b = (await got).video;
  assert.equal(b.id, a.id);
  assert.ok(b.since > a.since, 'es otro disparo');
  await max.send('/tele4/video', 0);
  s.close();
});

test('una pantalla que se abre a mitad de un vídeo entra por donde va', async () => {
  const c = take();
  await max.send('/tele5/video', c.num);
  await sleep(1200);
  const s = screen('tele5');
  const { video } = await s.next(isSnapshot);
  assert.equal(video.id, c.id);
  assert.ok(video.at >= 1.1 && video.at < 3, `at = ${video.at}`);
  await max.send('/tele5/video', 0);
  s.close();
});

test('al acabar el vídeo se apaga en el mapa aunque Max no mande el 0', { timeout: 30000 }, async () => {
  const c = numbered.shift();                // el más corto
  const p = phone();
  await p.next(isSnapshot);
  const lit = p.next((m) => m.type === 'active' && m.active.includes(c.id));
  await max.send('/tele6/video', c.num);
  await lit;
  const t = Date.now();
  await p.next((m) => m.type === 'active' && !m.active.includes(c.id), (c.duration + 3) * 1000);
  const took = (Date.now() - t) / 1000;
  assert.ok(took > c.duration - 0.5 && took < c.duration + 1.5, `se apagó a los ${took} s y dura ${c.duration}`);
  p.close();
});

test('/sound y /light no cambian nada, y una dirección desconocida se dice una sola vez', async () => {
  const from = srv.out.length;
  const before = await api('/api/state');
  await max.send('/sound', 1);
  await max.send('/light', 0.5);
  await max.send('/audio', 1);
  await max.send('/audio', 1);
  await srv.waitFor(/no sé qué hacer con \/audio/, 3000, from);
  await sleep(200);
  assert.equal(srv.out.slice(from).filter((l) => l.includes('/audio')).length, 1);
  assert.deepEqual((await api('/api/state')).active, before.active);
});

test('basura por el puerto de OSC no tumba el servidor', async () => {
  const from = srv.out.length;
  const sock = createSocket('udp4');
  await new Promise((r) => { sock.send(Buffer.from('esto no es OSC'), oscPort, '127.0.0.1', r); });
  sock.close();
  await srv.waitFor(/OSC ilegible/, 3000, from);
  const health = await (await fetch(`http://127.0.0.1:${http}/health`)).text();
  assert.match(health, /^ok/);
});

test('/dev ve en directo lo que llega de Max', async () => {
  const c = take();
  const d = connect({ type: 'hello', role: 'dev' });
  await d.next((m) => m.type === 'room');
  const got = d.next((m) => m.type === 'room' && m.screens.tele8?.id === c.id);
  await max.send('/tele8/video', c.num);
  const room = await got;
  assert.equal(room.screens.tele8.label, labels.get(c.id));
  assert.equal(room.osc[0].text, `/tele8/video ${c.num}`);
  assert.match(room.osc[0].result, /tele8 pone/);
  await max.send('/tele8/video', 0);
  d.close();
});

test('la página de cada pantalla se sirve en /screen/<nombre>', async () => {
  const ok = await fetch(`http://127.0.0.1:${http}/screen/tele1`);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /\/js\/screen\.js/);
  assert.equal((await fetch(`http://127.0.0.1:${http}/screen/no%20vale`)).status, 404);
});

test('el Max de prueba manda un mensaje suelto y una coll guardada como texto', async () => {
  const c = take();
  const env = { ...process.env, OSC_PORT: String(oscPort) };
  const s = screen('tele7');
  await s.next(isSnapshot);
  let got = s.next((m) => isVideo(m) && m.video);
  await run(process.execPath, ['scripts/max-de-prueba.mjs', '/tele7/video', String(c.num)], { cwd: web, env });
  assert.equal((await got).video.num, c.num);

  const file = join(temporal('escena'), 'escena.txt');
  writeFileSync(file, '0, /scene 7;\n0.2, /tele7/video 0;\n');
  got = s.next((m) => isVideo(m) && m.video === null);
  await run(process.execPath, ['scripts/max-de-prueba.mjs', file], { cwd: web, env });
  await got;
  assert.equal((await api('/api/state')).scene, 7);
  s.close();
});

test('si el puerto de OSC ya lo tiene otro programa, lo dice en vez de repartirse los mensajes', async () => {
  // Con y sin reuseAddr, porque node-osc y Max abren sus puertos compartibles.
  for (const reuseAddr of [false, true]) {
    const sock = createSocket({ type: 'udp4', reuseAddr });
    await new Promise((r) => { sock.bind(0, '127.0.0.1', r); });
    const other = startServer({ OSC_PORT: String(sock.address().port) });
    try {
      await other.waitFor(/el puerto \d+ \(OSC\) ya lo tiene otro programa/);
      const line = await other.waitFor(/web del público en http:\/\/0\.0\.0\.0:\d+/);
      const port = Number(/0\.0\.0\.0:(\d+)/.exec(line)[1]);
      const health = await (await fetch(`http://127.0.0.1:${port}/health`)).text();
      assert.match(health, /osc SIN PUERTO/, `con reuseAddr ${reuseAddr}`);
    } finally {
      other.proc.kill();
      sock.close();
    }
  }
});

test('si el puerto de la web ya lo tiene otro programa, lo dice y se sale', async () => {
  // El puerto de la web de este mismo servidor de pruebas, que ya está cogido.
  const other = startServer({ PORT: String(http) });
  try {
    // 'close' y no 'exit', que llega cuando ya se ha leído toda su salida.
    const code = await new Promise((resolve) => { other.proc.on('close', resolve); });
    assert.equal(code, 1);
    assert.ok(other.out.some((l) => new RegExp(`el puerto ${http} \\(la web\\) ya lo tiene otro programa`).test(l)),
      `el registro no lo dice:\n${other.out.join('\n')}`);
  } finally {
    other.proc.kill();
  }
});

test('lo que ve un móvil se enciende en el mapa de todos, aparte de lo de la sala', async () => {
  const c = take();
  const a = phone();
  const b = phone();
  await Promise.all([a.next(isSnapshot), b.next(isSnapshot)]);
  let got = b.next((m) => m.type === 'active' && m.mobile?.includes(c.id));
  a.ws.send(JSON.stringify({ type: 'phone:play', id: c.id }));
  assert.ok(!(await got).active.includes(c.id), 'no cuenta como de la sala');

  got = b.next((m) => m.type === 'active' && !m.mobile.includes(c.id));
  a.ws.send(JSON.stringify({ type: 'phone:stop', id: c.id }));
  await got;

  // Y si el móvil se va sin cerrar el vídeo (se apaga, pierde la Wi-Fi), también.
  got = b.next((m) => m.type === 'active' && m.mobile?.includes(c.id));
  a.ws.send(JSON.stringify({ type: 'phone:play', id: c.id }));
  await got;
  got = b.next((m) => m.type === 'active' && !m.mobile.includes(c.id));
  a.close();
  await got;
  b.close();
});

test('un móvil que entra ve lo que ya se está viendo en los demás', async () => {
  const c = take();
  const a = phone();
  await a.next(isSnapshot);
  const d = connect({ type: 'hello', role: 'dev' });
  await d.next((m) => m.type === 'room');
  const seen = d.next((m) => m.type === 'room' && m.mobile.includes(c.id));
  a.ws.send(JSON.stringify({ type: 'phone:play', id: c.id }));
  await seen;
  const b = phone();
  assert.ok((await b.next(isSnapshot)).mobile.includes(c.id));
  a.close();
  b.close();
  d.close();
});

test('nadie enciende un concepto que no existe, ni lo enciende quien no es un móvil', async () => {
  const c = take();
  const s = screen('tele10');
  await s.next(isSnapshot);
  s.ws.send(JSON.stringify({ type: 'phone:play', id: c.id }));
  const a = phone();
  await a.next(isSnapshot);
  a.ws.send(JSON.stringify({ type: 'phone:play', id: 'no_existe' }));
  await sleep(300);
  const health = await (await fetch(`http://127.0.0.1:${http}/health`)).text();
  assert.match(health, /^mobile -$/m);
  a.close();
  s.close();
});

// ---------------------------------------------------------------------------
// Lo que vi al revisarlo el 1-oct-2026, con la Wi-Fi de la sala abierta
// a cualquiera. Nada de lo que mande un visitante puede tumbar el servidor, ni
// dejar la sala a oscuras al reiniciarse, ni pintar el mapa de todos.
// ---------------------------------------------------------------------------
const closedWith = (ws, ms = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('el socket no se ha cerrado')), ms);
  ws.on('close', (code) => { clearTimeout(timer); resolve(code); });
});
const opened = (ws) => new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
const alive = async (port = http) => /^ok/.test(await (await fetch(`http://127.0.0.1:${port}/health`)).text());

test('basura por el WebSocket no tumba el servidor (null, más de 4 kB, UTF-8 roto)', async () => {
  // Antes, `null` (JSON válido) y un mensaje de más de 4 kB tumbaban el proceso entero.
  for (const basura of ['null', '[]', '1', '"x"', '{', 'x'.repeat(5000)]) {
    const ws = new WebSocket(`ws://127.0.0.1:${http}/ws`);
    ws.on('error', () => {});
    await opened(ws);
    ws.send(basura);
    ws.send(JSON.stringify({ type: 'hello', role: 'phone' }));
    ws.send('null');
    await sleep(100);
    ws.close();
    assert.ok(await alive(), `tras «${basura.slice(0, 10)}» el servidor sigue vivo`);
  }
  const roto = new WebSocket(`ws://127.0.0.1:${http}/ws`);
  roto.on('error', () => {});
  await opened(roto);
  roto.send(Buffer.from([0xff, 0xfe, 0xfd]), { binary: false });
  assert.equal(await closedWith(roto), 1007, 'ws cierra ese socket por UTF-8 roto');
  assert.ok(await alive());
});

test('un rol que no existe cierra ese socket, una sola vez', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${http}/ws`);
  await opened(ws);
  const from = srv.out.length;
  ws.send(JSON.stringify({ type: 'hello', role: 'x' }));
  ws.send(JSON.stringify({ type: 'hello', role: 'x' }));
  assert.equal(await closedWith(ws), 1008);
  await sleep(100);
  assert.equal(srv.out.slice(from).filter((l) => /móvil conectado/.test(l)).length, 0, 'no se cuenta como móvil');
});

test('quien no se presenta, fuera; y quien inunda de mensajes, también', async () => {
  const other = startServer({ HELLO_S: '1' });
  try {
    const port = Number(/0\.0\.0\.0:(\d+)/.exec(await other.waitFor(/web del público en http:\/\/0\.0\.0\.0:\d+/))[1]);
    const mudo = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await opened(mudo);
    const t = Date.now();
    assert.equal(await closedWith(mudo, 3000), 1008);
    assert.ok(Date.now() - t >= 900, 'le da su segundo para presentarse');

    const pesado = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await opened(pesado);
    pesado.send(JSON.stringify({ type: 'hello', role: 'phone' }));
    for (let i = 0; i < 40; i += 1) pesado.send(JSON.stringify({ type: 'phone:play', id: numbered[i % numbered.length].id }));
    assert.equal(await closedWith(pesado), 1008);
    assert.ok(await alive(port));
  } finally {
    other.proc.kill();
  }
});

// Al pasarse del tope se cierra el mapa más viejo de esa IP, no el nuevo. El
// nuevo es el que el visitante tiene en la mano. Hasta el 2-oct-2026 se
// rechazaba el nuevo, y quien tuviera pestañas viejas del mapa abiertas (cada
// QR abre una) se quedaba sin conexión en la que estaba mirando.
test('cada IP tiene un tope de mapas abiertos, y al pasarse se cierra el más viejo', async () => {
  const other = startServer({ LIMITAR_LOCAL: '1', MOVILES_POR_IP: '2' });
  try {
    const port = Number(/0\.0\.0\.0:(\d+)/.exec(await other.waitFor(/web del público en http:\/\/0\.0\.0\.0:\d+/))[1]);
    const abre = async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      await opened(ws);
      ws.send(JSON.stringify({ type: 'hello', role: 'phone' }));
      await sleep(100);
      return ws;
    };
    const a = await abre();
    const b = await abre();
    const cerrado = closedWith(a);
    const c = await abre();
    assert.equal(await cerrado, 1008, 'el más viejo de la misma IP se cierra');
    await sleep(200);
    assert.equal(b.readyState, WebSocket.OPEN, 'el de en medio sigue');
    assert.equal(c.readyState, WebSocket.OPEN, 'el nuevo se queda');
    assert.match(await (await fetch(`http://127.0.0.1:${port}/health`)).text(), /^phones 2$/m, 'nunca más de 2 a la vez');
    b.close();
    c.close();
  } finally {
    other.proc.kill();
  }
});

// Cada IP tiene tope de conexiones a la vez (páginas, vídeos y WebSocket). Un
// script abría miles de WebSockets presentándose como pantallas y dejaba al
// servidor sin ficheros que abrir. Y las pantallas de una IP también tienen
// tope, cerrando la más vieja.
test('cada IP tiene tope de conexiones y de pantallas, y la web sigue para los demás', async () => {
  const other = startServer({ LIMITAR_LOCAL: '1', CONEXIONES_POR_IP: '10', PANTALLAS_POR_IP: '2' });
  const abiertos = [];
  try {
    const port = Number(/0\.0\.0\.0:(\d+)/.exec(await other.waitFor(/web del público en http:\/\/0\.0\.0\.0:\d+/))[1]);
    const pantalla = async (nombre) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.on('error', () => {});
      abiertos.push(ws);
      await opened(ws);
      ws.send(JSON.stringify({ type: 'hello', role: 'screen', name: nombre }));
      await sleep(80);
      return ws;
    };
    const p1 = await pantalla('tele1');
    const p2 = await pantalla('tele2');
    const cerrada = closedWith(p1);
    await pantalla('tele3');
    assert.equal(await cerrada, 1008, 'la pantalla más vieja de la IP se cierra');
    // Más conexiones de las que caben. Las que sobran se cortan al momento.
    const muchas = await Promise.all(Array.from({ length: 30 }, () => new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      abiertos.push(ws);
      ws.on('open', () => resolve('abierta'));
      ws.on('error', () => resolve('cortada'));
    })));
    assert.ok(muchas.filter((r) => r === 'cortada').length >= 20, `las que pasan de 10 se cortan · ${muchas.join(' ')}`);
    await other.waitFor(/pasa de 10 conexiones a la vez/);
    for (const ws of abiertos) ws.terminate();
    await sleep(300);
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200, 'al irse, todo vuelve');
    assert.equal(p2.readyState, WebSocket.CLOSED);
  } finally {
    for (const ws of abiertos) ws.terminate();
    other.proc.kill();
  }
});

// Lo que llega de la red se apunta con tope, y un socket que ya se está
// cerrando no escribe más. Una inundación llegó a escribir 214 MB de registro
// en 10 s. Y nada de lo que manda una página cuela líneas falsas.
test('una inundación no llena el registro, ni cuela líneas falsas', async () => {
  const other = startServer({});
  try {
    const port = Number(/0\.0\.0\.0:(\d+)/.exec(await other.waitFor(/web del público en http:\/\/0\.0\.0\.0:\d+/))[1]);
    const from = other.out.length;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await opened(ws);
    ws.send(JSON.stringify({ type: 'hello', role: 'screen', name: 'tele1' }));
    ws.send(JSON.stringify({ type: 'screen:status', error: 'mal\n01/10 12:00:00 parado (SIGTERM)' }));
    for (let i = 0; i < 3000; i += 1) ws.send('x');
    await sleep(500);
    const nuevas = other.out.slice(from);
    assert.equal(nuevas.filter((l) => /demasiados mensajes/.test(l)).length, 1, 'el corte se apunta una vez');
    assert.equal(nuevas.filter((l) => /^01\/10 12:00:00 parado/.test(l)).length, 0, 'el salto de línea no cuela una línea falsa');
    assert.ok(nuevas.length < 20, `pocas líneas, han salido ${nuevas.length}`);
  } finally {
    other.proc.kill();
  }
});

test('lo que ve un móvil se apaga solo si no avisa al acabar', { timeout: 20000 }, async () => {
  const corto = [...numbered].sort((x, y) => x.duration - y.duration)[0];
  const other = startServer({ CADUCIDAD_EXTRA_S: '0' });
  try {
    const port = Number(/0\.0\.0\.0:(\d+)/.exec(await other.waitFor(/web del público en http:\/\/0\.0\.0\.0:\d+/))[1]);
    const conecta = (hello) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const seen = [];
      ws.on('message', (d) => seen.push(JSON.parse(d)));
      ws.on('open', () => ws.send(JSON.stringify(hello)));
      return { ws, seen };
    };
    const quien = conecta({ type: 'hello', role: 'phone' });
    const otro = conecta({ type: 'hello', role: 'phone' });
    await sleep(300);
    quien.ws.send(JSON.stringify({ type: 'phone:play', id: corto.id }));
    await sleep(400);
    assert.ok(otro.seen.some((m) => m.type === 'active' && m.mobile.includes(corto.id)), 'se enciende en el otro');
    // Ni `phone:stop` ni cerrar. Un script que se queda «viendo» para siempre.
    await sleep(corto.duration * 1250 + 600);
    const ultimo = otro.seen.filter((m) => m.type === 'active').at(-1);
    assert.ok(!ultimo.mobile.includes(corto.id), `a los ${corto.duration * 1.25} s ya no está encendido`);
    quien.ws.close();
    otro.ws.close();
  } finally {
    other.proc.kill();
  }
});

test('si el servidor se reinicia, cada pantalla sigue con su vídeo', { timeout: 20000 }, async () => {
  const largo = [...numbered].sort((x, y) => y.duration - x.duration)[0];
  const estado = estadoNuevo();
  const arranca = async () => {
    const s = startServer({ ESTADO: estado });
    const port = Number(/0\.0\.0\.0:(\d+)/.exec(await s.waitFor(/web del público en http:\/\/0\.0\.0\.0:\d+/))[1]);
    const osc = Number(/127\.0\.0\.1:(\d+)/.exec(await s.waitFor(/Max por OSC en 127\.0\.0\.1:\d+/))[1]);
    return { s, port, osc };
  };
  const pantallaEn = (port) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const llega = new Promise((resolve) => { ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'snapshot') resolve(m.video); }); });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', role: 'screen', name: 'tele9' })));
    return { ws, llega };
  };
  const a = await arranca();
  const maxA = new Client('127.0.0.1', a.osc);
  await maxA.send('/tele9/video', largo.num);
  await maxA.close();
  await sleep(400);
  const antes = await pantallaEn(a.port).llega;
  assert.equal(antes.id, largo.id);
  a.s.proc.kill();                                   // se para (SIGTERM)
  await new Promise((r) => { a.s.proc.on('close', r); });
  await sleep(1000);
  const b = await arranca();
  try {
    await b.s.waitFor(/del arranque anterior recupero tele9/);
    const p = pantallaEn(b.port);
    const despues = await p.llega;
    assert.equal(despues.id, largo.id, 'la pantalla no se va a negro');
    assert.equal(despues.since, antes.since, 'es el mismo disparo y no vuelve a empezar');
    assert.equal(despues.shot, antes.shot);
    assert.ok(despues.at > antes.at + 1, `sigue por donde iba (${antes.at.toFixed(1)} → ${despues.at.toFixed(1)} s)`);
    p.ws.close();
  } finally {
    b.s.proc.kill();
  }
});

test('dos disparos a la misma pantalla en el mismo instante son dos disparos', async () => {
  const [x, y] = [take(), take()];
  const s = screen('tele10');
  await s.next(isSnapshot);
  const vistos = [];
  const dos = new Promise((resolve) => {
    s.ws.on('message', (d) => { const m = JSON.parse(d); if (isVideo(m) && m.video) { vistos.push(m.video); if (vistos.length === 2) resolve(); } });
  });
  await max.send(new Bundle(new Message('/tele10/video', x.num), new Message('/tele10/video', y.num)));
  await dos;
  assert.notEqual(vistos[0].since, vistos[1].since);
  assert.notEqual(vistos[0].shot, vistos[1].shot);
  assert.equal(vistos[1].id, y.id, 'se queda con el segundo, como Max');
  await max.send('/tele10/video', 0);
  s.close();
});

test('en producción /dev no existe, ni escrito de otra forma, y van las cabeceras de seguridad', async () => {
  const prod = startServer({}, []);
  try {
    const port = Number(/0\.0\.0\.0:(\d+)/.exec(await prod.waitFor(/web del público en http:\/\/0\.0\.0\.0:\d+/))[1]);
    for (const ruta of ['/dev', '/dev.html', '/%64ev.html', '/%64ev', '/dev%2ehtml', '/api/state']) {
      const r = await fetch(`http://127.0.0.1:${port}${ruta}`);
      assert.equal(r.status, 404, `${ruta} da ${r.status}`);
    }
    const r = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  } finally {
    prod.proc.kill();
  }
});

test('las comprobaciones de conectividad de los móviles reciben lo que esperan', async () => {
  const pide = (ruta, host) => fetch(`http://127.0.0.1:${http}${ruta}`, { headers: { Host: host } });
  const apple = await pide('/hotspot-detect.html', 'captive.apple.com');
  assert.equal(apple.status, 200);
  assert.match(await apple.text(), /<TITLE>Success<\/TITLE>/);
  assert.equal((await pide('/generate_204', 'connectivitycheck.gstatic.com')).status, 204);
  assert.equal((await pide('/generate_204', 'connectivitycheck.platform.hicloud.com')).status, 204);
  assert.equal(await (await pide('/connecttest.txt', 'www.msftconnecttest.com')).text(), 'Microsoft Connect Test');
  assert.equal(await (await pide('/success.txt', 'detectportal.firefox.com')).text(), 'success\n');
});

test('/health da el detalle solo a este ordenador, y el registro lleva fecha', async () => {
  const local = await (await fetch(`http://127.0.0.1:${http}/health`)).text();
  assert.match(local, /^uptime \d+$/m);
  assert.match(local, /^started \d{4}-/m);
  const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  if (lan) {
    const fuera = await (await fetch(`http://${lan.address}:${http}/health`)).text();
    assert.equal(fuera, 'ok', 'desde otra IP, solo «ok»');
  }
  assert.ok(srv.out.some((l) => /^\d{2}\/\d{2} \d{2}:\d{2}:\d{2} /.test(l)), 'las líneas empiezan por día y hora');
});

// ---------------------------------------------------------------------------
// Los vídeos se buscan en media/ en vivo, con las versiones de cada aparato,
// sin mirar mayúsculas ni cómo se guardó la tilde, y con la duración leída del
// propio fichero. Copiar un MP4 basta, sin volver a pasar el layout.
// ---------------------------------------------------------------------------
let ffmpeg = true;
try { await run('ffmpeg', ['-version']); } catch { ffmpeg = false; }

test('los vídeos se buscan en media/ en vivo, con versiones, tildes y duración', { skip: ffmpeg ? false : 'sin ffmpeg', timeout: 60000 }, async () => {
  const media = temporal('media-viva');
  const cat = temporal('catalogo-vivo');
  const clip = async (path, s) => run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=320x240:rate=25:duration=${s}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path]);
  mkdirSync(join(media, 'movil'));
  mkdirSync(join(media, 'tablet'));
  await clip(join(media, 'movil', 'Sonido.mp4'), 2);
  await clip(join(media, 'tablet', 'Sonido.mp4'), 2);
  await clip(join(media, 'plano.mp4'), 3);
  // Como lo guarda el Finder, con la tilde separada de la letra (NFD).
  const nfd = 'Canción.mp4'.normalize('NFD');
  await clip(join(media, nfd), 1);
  // Un MP4 fragmentado (como el de OBS). Su cabecera solo cuenta el primer
  // trozo. Hasta el 2-oct-2026 esa duración pisaba la de la hoja.
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=3',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '25', '-movflags', '+frag_keyframe', join(media, 'trozos.mp4')]);
  // Un enlace roto con el nombre de un concepto (a un disco que no está). Antes
  // tumbaba el servidor al arrancar y en cada latido.
  symlinkSync(join(media, 'no-existe', 'roto.mp4'), join(media, 'roto.mp4'));
  writeFileSync(join(cat, 'contents.json'), JSON.stringify({
    sonido: { archivo: 'Sonido.mov', duration: 99, num: 1 },
    plano: { archivo: 'plano.mp4', duration: 99, num: 2 },
    cancion: { archivo: 'CANCIÓN.mp4', duration: 99, num: 3 },
    falta: { archivo: 'falta.mp4', duration: 7, num: 4 },
    trozos: { archivo: 'trozos.mp4', duration: 3.04, num: 5 },
    roto: { archivo: 'roto.mp4', duration: 6, num: 6 },
  }));
  writeFileSync(join(cat, 'map.json'), JSON.stringify({ version: 2, width: 1400, height: 2000, nodes: [
    { id: 'sonido', label: 'Sonido' }, { id: 'plano', label: 'Plano' }, { id: 'cancion', label: 'Canción' }, { id: 'falta', label: 'Falta' },
    { id: 'trozos', label: 'Trozos' }, { id: 'roto', label: 'Roto' }], links: [] }));
  const s = startServer({ CATALOGO: cat, MEDIA: media });
  try {
    const port = Number(/0\.0\.0\.0:(\d+)/.exec(await s.waitFor(/web del público en http:\/\/0\.0\.0\.0:\d+/))[1]);
    await s.waitFor(/sin el vídeo en media\/: falta \(falta\.mp4\), roto \(roto\.mp4\)/);
    const c = await (await fetch(`http://127.0.0.1:${port}/contents.json`)).json();
    assert.match(c.sonido.file, /^\/media\/movil\/Sonido\.mp4\?v=[0-9a-f]{8}$/, 'el móvil, su versión');
    assert.deepEqual(Object.keys(c.sonido.files), ['movil', 'tablet']);
    assert.ok(Math.abs(c.sonido.duration - 2) < 0.1, `la duración sale del MP4: ${c.sonido.duration}`);
    assert.match(c.plano.file, /^\/media\/plano\.mp4\?v=/);
    assert.ok(!c.plano.files, 'sin versiones, sin files');
    assert.ok(c.cancion.file, 'la tilde del Finder casa con la de la hoja');
    assert.equal((await fetch(`http://127.0.0.1:${port}${c.cancion.file}`, { headers: { Range: 'bytes=0-99' } })).status, 206);
    assert.equal(c.falta.file, null);
    assert.equal(c.falta.duration, 7, 'sin fichero, la duración de la hoja');
    assert.match(c.trozos.file, /^\/media\/trozos\.mp4\?v=/);
    assert.equal(c.trozos.duration, 3.04, 'un MP4 fragmentado no pisa la duración de la hoja');
    assert.equal(c.roto.file, null, 'un enlace roto cuenta como que falta');
    assert.match(await (await fetch(`http://127.0.0.1:${port}/health`)).text(), /^sinvideo 2$/m);
    // Se copia el que faltaba, sin pasar el layout. Mientras se copia (aquí,
    // recién escrito) no se sirve. Cuenta cuando lleva 5 s sin cambiar.
    await clip(join(media, 'falta.mp4'), 1);
    await sleep(1100);
    const d = await (await fetch(`http://127.0.0.1:${port}/contents.json`)).json();
    assert.equal(d.falta.file, null, 'recién copiado, todavía no');
    await sleep(5200);
    const e = await (await fetch(`http://127.0.0.1:${port}/contents.json`)).json();
    assert.match(e.falta.file ?? '', /^\/media\/falta\.mp4\?v=/, 'quieto 5 s, ya está');
    assert.ok(await alive(port), 'el enlace roto no ha tumbado el servidor en ningún repaso');
  } finally {
    s.proc.kill();
  }
});

// Lo que tiene que decir el servidor cuando algo de su sitio está roto, sin
// llenar el registro (desde el 2-oct-2026).
test('un catálogo ilegible se apunta una vez, y un estado roto se dice', async () => {
  const vacio = temporal('catalogo-roto');
  const estado = estadoNuevo();
  mkdirSync(join(estado, '..'), { recursive: true });
  writeFileSync(estado, '{"version":1,"screens":{"tele1":');
  const other = startServer({ CATALOGO: vacio, ESTADO: estado });
  try {
    const port = Number(/0\.0\.0\.0:(\d+)/.exec(await other.waitFor(/web del público en http:\/\/0\.0\.0\.0:\d+/))[1]);
    await other.waitFor(/no puedo leer lo que ponían las pantallas/);
    for (let i = 0; i < 20; i += 1) await fetch(`http://127.0.0.1:${port}/contents.json`);
    assert.equal(other.out.filter((l) => /no puedo leer el catálogo/.test(l)).length, 1, 'el catálogo que falta, una sola línea');
  } finally {
    other.proc.kill();
  }
});

test('si el puerto de OSC estaba cogido al arrancar, lo coge en cuanto se libera', { timeout: 30000 }, async () => {
  const sock = createSocket('udp4');
  await new Promise((r) => { sock.bind(0, '127.0.0.1', r); });
  const puerto = sock.address().port;
  const other = startServer({ OSC_PORT: String(puerto) });
  try {
    await other.waitFor(/el puerto \d+ \(OSC\) ya lo tiene otro programa/);
    sock.close();
    await other.waitFor(new RegExp(`Max por OSC en 127\\.0\\.0\\.1:${puerto}.*el puerto ya está libre`), 15000);
    const port = Number(/0\.0\.0\.0:(\d+)/.exec(await other.waitFor(/web del público en http:\/\/0\.0\.0\.0:\d+/))[1]);
    assert.match(await (await fetch(`http://127.0.0.1:${port}/health`)).text(), new RegExp(`^osc 127\\.0\\.0\\.1:${puerto}$`, 'm'));
  } finally {
    other.proc.kill();
  }
});

// ---------------------------------------------------------------------------
// El panel de la sala (/panel). Solo desde este ordenador o con la clave, ve
// lo que cuenta cada pantalla y sus órdenes (identificar, recargar) llegan.
// ---------------------------------------------------------------------------
test('el panel ve cada pantalla y le llegan sus órdenes; desde fuera, solo con clave', async () => {
  assert.equal((await fetch(`http://127.0.0.1:${http}/panel`)).status, 200);
  const s = screen('tele11');
  await s.next(isSnapshot);
  s.ws.send(JSON.stringify({ type: 'screen:status', sound: false, playing: null, error: 'no puedo poner «Prueba»', version: 'tablet' }));
  const panel = connect({ type: 'hello', role: 'panel' });
  const visto = await panel.next((m) => m.type === 'panel' && m.screens.some((x) => x.name === 'tele11' && x.pages[0]?.error));
  const t11 = visto.screens.find((x) => x.name === 'tele11');
  assert.equal(t11.pages[0].sound, false, 'dice que le falta el toque');
  assert.equal(t11.pages[0].version, 'tablet');
  assert.ok(visto.avisos.some((a) => /tele11 · no puedo poner «Prueba»/.test(a.text)), 'el error sale en los avisos');
  const orden = s.next((m) => m.type === 'identify');
  panel.ws.send(JSON.stringify({ type: 'panel:identify', screen: 'tele11' }));
  assert.equal((await orden).seconds, 8);
  const recarga = s.next((m) => m.type === 'reload');
  panel.ws.send(JSON.stringify({ type: 'panel:reload', screen: 'tele11' }));
  await recarga;
  panel.close();
  s.close();
  // Desde otra IP de este mismo ordenador (la de la red) y sin clave, no se
  // abre ni la página ni el WebSocket del panel.
  const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  if (lan) {
    assert.equal((await fetch(`http://${lan.address}:${http}/panel`)).status, 404);
    const fuera = new WebSocket(`ws://${lan.address}:${http}/ws`);
    await opened(fuera);
    fuera.send(JSON.stringify({ type: 'hello', role: 'panel' }));
    assert.equal(await closedWith(fuera), 1008);
  }
});

test('con PANEL_CLAVE, el panel se abre desde otro aparato de la red', async () => {
  const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  if (!lan) return;
  const other = startServer({ PANEL_CLAVE: 'una-clave-larga-de-prueba' });
  try {
    const port = Number(/0\.0\.0\.0:(\d+)/.exec(await other.waitFor(/web del público en http:\/\/0\.0\.0\.0:\d+/))[1]);
    assert.equal((await fetch(`http://${lan.address}:${port}/panel?clave=mala`)).status, 404);
    assert.equal((await fetch(`http://${lan.address}:${port}/panel?clave=una-clave-larga-de-prueba`)).status, 200);
    const ws = new WebSocket(`ws://${lan.address}:${port}/ws`);
    const llega = new Promise((resolve) => { ws.on('message', (d) => { if (JSON.parse(d).type === 'panel') resolve(true); }); });
    await opened(ws);
    ws.send(JSON.stringify({ type: 'hello', role: 'panel', clave: 'una-clave-larga-de-prueba' }));
    assert.equal(await llega, true);
    ws.close();
  } finally {
    other.proc.kill();
  }
});

// Con la lista de la sala, el panel sabe qué tele falta aunque no se haya
// encendido nunca (antes solo veía las que ya habían dado señales), y un
// nombre que no está en la lista se dice, una vez, porque suele ser una errata.
test('con PANTALLAS, el panel dice cuál falta aunque no se haya encendido nunca', async () => {
  const other = startServer({ PANTALLAS: 'tele1, TELE2;tele.3' });
  let otroMax;
  try {
    const port = Number(/0\.0\.0\.0:(\d+)/.exec(await other.waitFor(/web del público en http:\/\/0\.0\.0\.0:\d+/))[1]);
    const oscOtro = Number(/127\.0\.0\.1:(\d+)/.exec(await other.waitFor(/Max por OSC en 127\.0\.0\.1:\d+/))[1]);
    await other.waitFor(/las pantallas de la sala son tele1, tele2$/);
    await other.waitFor(/en PANTALLAS, «tele\.3» no vale como nombre/);
    const health = async () => (await fetch(`http://127.0.0.1:${port}/health`)).text();

    const panel = connect({ type: 'hello', role: 'panel' }, port);
    const primero = await panel.next((m) => m.type === 'panel');
    assert.deepEqual(primero.expected, ['tele1', 'tele2']);
    assert.deepEqual(primero.screens.map((s) => [s.name, s.listed, s.pages.length]), [['tele1', true, 0], ['tele2', true, 0]],
      'las dos salen, sin página, aunque ninguna se haya conectado nunca');
    assert.match(await health(), /^missing tele1 tele2$/m);

    const t1 = connect({ type: 'hello', role: 'screen', name: 'tele1' }, port);
    await t1.next(isSnapshot);
    await panel.next((m) => m.type === 'panel' && m.screens.find((s) => s.name === 'tele1')?.pages.length === 1);
    assert.match(await health(), /^missing tele2$/m);

    // Max manda a una que no está en la lista. Se hace igual, y se dice.
    otroMax = new Client('127.0.0.1', oscOtro);
    const avisado = panel.next((m) => m.type === 'panel' && m.avisos.some((a) => /«tel3», que no está en la lista/.test(a.text)));
    await otroMax.send('/tel3/video', 3);
    const visto = await avisado;
    assert.equal(visto.screens.find((s) => s.name === 'tel3')?.listed, false);
    await other.waitFor(/«tel3» no está en PANTALLAS/);
    await otroMax.send('/tel3/video', 0);
    await sleep(300);
    assert.equal(other.out.filter((l) => /«tel3» no está en PANTALLAS/.test(l)).length, 1, 'se dice una sola vez');
    panel.close();
    t1.close();
  } finally {
    await otroMax?.close();
    other.proc.kill();
  }
});
