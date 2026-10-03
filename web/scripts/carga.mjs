// Prueba de carga con móviles de mentira que se portan como el público, contra
// un servidor de verdad.
//
//   npm run carga                                  25 móviles, 2 minutos, contra este ordenador
//   npm run carga -- --moviles 50 --minutos 5
//   npm run carga -- --servidor http://192.168.8.10   contra el servidor de la sala, desde otro
//                                                    portátil por Wi-Fi. Así se carga el router.
//                                                    Todos salen de una IP, así que ese servidor
//                                                    va sin topes por IP (MOVILES_POR_IP=0
//                                                    CONEXIONES_POR_IP=0 PANTALLAS_POR_IP=0)
//   npm run carga -- --sin-max                     sin disparos de Max (si el servidor no es este
//                                                    ordenador, Max no llega porque OSC solo entra desde 127.0.0.1)
//
// Cada móvil hace lo que hace una persona. Abre la página (index, CSS, JS,
// letra, mapa), se conecta por WebSocket, pasea un rato por el mapa, toca una
// palabra y se baja ese vídeo al ritmo al que se ve (como un <video>, que
// arranca con algo de colchón y luego va al paso), avisa de que lo está viendo
// y, al acabar, de que ha terminado. Unos cuantos se van a mitad y vuelven.
// A la vez, Max (de mentira) manda a las pantallas un vídeo cada pocos
// segundos, y unas pantallas de mentira escuchan.
//
// Mide lo que se nota en la sala.
//   · lo que tarda la primera carga de la página
//   · desde que Max manda /teleN/video hasta que la palabra se enciende en
//     CADA móvil, y hasta que lo recibe la pantalla
//   · desde que un móvil abre un vídeo hasta que se enciende en los demás
//   · lo que tarda en empezar un vídeo (la primera respuesta del servidor)
//   · lo que se sirve por la red, y la CPU y la memoria del servidor si va en
//     este mismo ordenador
//   · errores y desconexiones
import { createSocket } from 'node:dgram';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';
import { encode } from 'node-osc';

// ---------------------------------------------------------------------------
// Opciones
// ---------------------------------------------------------------------------
function opciones(argv) {
  const o = { servidor: 'http://127.0.0.1:8080', moviles: 25, minutos: 2, pantallas: 4, max: true, osc: 9100, cada: 6 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const toma = () => { if (argv[i + 1] === undefined) fallar(`falta el valor de ${a}`); i += 1; return argv[i]; };
    if (a === '--servidor') o.servidor = toma().replace(/\/$/, '');
    else if (a === '--moviles') o.moviles = Number(toma());
    else if (a === '--minutos') o.minutos = Number(toma());
    else if (a === '--segundos') o.minutos = Number(toma()) / 60;
    else if (a === '--pantallas') o.pantallas = Number(toma());
    else if (a === '--osc') o.osc = Number(toma());
    else if (a === '--cada') o.cada = Number(toma());
    else if (a === '--sin-max') o.max = false;
    else fallar(`no conozco la opción ${a}`);
  }
  for (const k of ['moviles', 'minutos', 'pantallas', 'osc', 'cada']) {
    if (!(o[k] >= 0) || !Number.isFinite(o[k])) fallar(`--${k} quiere un número`);
  }
  return o;
}
function fallar(t) { console.error(`no puedo hacer la prueba de carga, ${t}`); process.exit(1); }

const o = opciones(process.argv.slice(2));
const base = new URL(o.servidor);
const wsUrl = `${base.protocol === 'https:' ? 'wss' : 'ws'}://${base.host}/ws`;
const fin = Date.now() + o.minutos * 60_000;
const azar = (a, b) => a + Math.random() * (b - a);
const elige = (xs) => xs[Math.floor(Math.random() * xs.length)];

// ---------------------------------------------------------------------------
// Medidas
// ---------------------------------------------------------------------------
const m = {
  primeraCarga: [], salaMovil: [], salaPantalla: [], movilMovil: [], arranqueVideo: [],
  bytes: 0, errores: [], desconexiones: 0, maxEnviados: 0, perdidos: 0, cpu: [], rss: [],
};
const error = (t) => { if (m.errores.length < 200) m.errores.push(t); };
function pct(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
const ms = (x) => (x === null ? '-' : `${Math.round(x)} ms`);

// ---------------------------------------------------------------------------
// Lo que hay en la sala
// ---------------------------------------------------------------------------
async function json(path) {
  const r = await fetch(new URL(path, base));
  if (!r.ok) throw new Error(`${path} da ${r.status}`);
  return r.json();
}
let contents;
try { contents = await json('/contents.json'); } catch (e) { fallar(`no llego al servidor ${o.servidor} (${e.message})`); }
const ids = Object.keys(contents);
const porNumero = new Map(Object.entries(contents).filter(([, c]) => Number.isInteger(c.num)).map(([id, c]) => [c.num, id]));
const conVideo = ids.filter((id) => contents[id].file);

// Lo que pide un navegador al abrir la página, sacado del propio index.html.
async function recursosDeLaPagina() {
  const html = await (await fetch(new URL('/', base))).text();
  const refs = [...html.matchAll(/(?:href|src)="(\/[^"]+)"/g)].map((x) => x[1]);
  return [...new Set(['/', ...refs, '/map.json', '/contents.json', '/js/vendor.js'])];
}
const recursos = await recursosDeLaPagina();

// ---------------------------------------------------------------------------
// Un móvil
// ---------------------------------------------------------------------------
// Encendidos esperados. Quién espera ver qué id, desde cuándo y de dónde viene.
const esperas = new Set();
const movilesVivos = new Set();
// Lo último que se sabe encendido en la sala. Un disparo de algo que ya está
// encendido no cambia el mapa, así que el servidor no avisa a nadie (bien
// hecho), y ese disparo no se mide.
let encendidosSala = new Set();
let encendidosMovil = new Set();

async function primeraCarga() {
  const t0 = performance.now();
  await Promise.all(recursos.map(async (p) => {
    const r = await fetch(new URL(p, base));
    if (!r.ok) throw new Error(`${p} da ${r.status}`);
    const b = await r.arrayBuffer();
    m.bytes += b.byteLength;
  }));
  m.primeraCarga.push(performance.now() - t0);
}

function conectar(rol, extra = {}) {
  return new Promise((ok, mal) => {
    const ws = new WebSocket(wsUrl);
    ws.vivo = true;
    ws.on('open', () => { ws.send(JSON.stringify({ type: 'hello', role: rol, ...extra })); ok(ws); });
    ws.on('error', (e) => { if (ws.vivo) { error(`ws ${rol} · ${e.message}`); } mal(e); });
    ws.on('close', () => { if (ws.vivo && Date.now() < fin) m.desconexiones += 1; ws.vivo = false; });
  });
}

// Bajarse un vídeo como lo haría un <video>, con un colchón al principio (unos
// 10 s de vídeo) y después al paso de la reproducción. Se corta al acabar.
async function verVideo(id) {
  const c = contents[id];
  const dur = Math.min(c.duration || 10, 90);
  const t0 = performance.now();
  if (!c.file) { await sleep(dur * 1000); return; }
  const ctl = new AbortController();
  try {
    const r = await fetch(new URL(c.file, base), { headers: { Range: 'bytes=0-' }, signal: ctl.signal });
    if (r.status !== 206 && r.status !== 200) { error(`vídeo ${c.file} da ${r.status}`); return; }
    m.arranqueVideo.push(performance.now() - t0);
    const total = Number(r.headers.get('content-length')) || 0;
    const porSegundo = total && c.duration ? total / c.duration : 300_000;
    const lector = r.body.getReader();
    let llevo = 0;
    for (;;) {
      const t = (performance.now() - t0) / 1000;
      if (t > dur) break;
      const toca = porSegundo * (t + 10);
      if (llevo > toca) { await sleep(200); continue; }
      const { done, value } = await lector.read();
      if (done) break;
      llevo += value.byteLength;
      m.bytes += value.byteLength;
      // Con el fichero entero ya no se lee más. Un <video> tampoco. (Si se
      // espera a pedir el final, el servidor cierra la conexión, ya libre, a
      // los 5 s, y el fetch de Node lo da como error aunque no falte nada. Lo
      // medí el 1-oct-2026 y todos esos «cortes» tenían el 100 % de los bytes.)
      if (total && llevo >= total) break;
    }
    await sleep(Math.max(0, dur * 1000 - (performance.now() - t0)));
    ctl.abort();
  } catch (e) {
    if (e.name !== 'AbortError') error(`vídeo ${c.file} · ${e.message}${e.cause ? ` (${e.cause.code ?? ''} ${e.cause.message ?? e.cause})` : ''}`);
  }
}

async function movil(n) {
  await sleep(azar(0, 4000));                     // no entra todo el mundo a la vez
  while (Date.now() < fin) {
    let ws;
    try {
      await primeraCarga();
      ws = await conectar('phone');
    } catch (e) { error(`móvil ${n} · ${e.message}`); await sleep(2000); continue; }
    movilesVivos.add(ws);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'snapshot' || msg.type === 'active') {
        encendidosSala = new Set(msg.active ?? []);
        encendidosMovil = new Set(msg.mobile ?? []);
      }
      if (msg.type !== 'active') return;
      const ahora = performance.now();
      for (const e of esperas) {
        // Solo cuenta quien ya estaba conectado cuando se disparó. Al que entra
        // después le llega en la instantánea, y medirle sería medir su llegada.
        if (e.yo === ws || e.vistos.has(ws) || !e.medir || !e.destinatarios.has(ws)) continue;
        const lista = e.de === 'sala' ? msg.active : msg.mobile;
        if (!lista?.includes(e.id)) continue;
        e.vistos.add(ws);
        (e.de === 'sala' ? m.salaMovil : m.movilMovil).push(ahora - e.t0);
      }
    });
    // Una visita son unas cuantas palabras, con paseos por el mapa entre medias.
    const visita = Date.now() + azar(60_000, 240_000);
    while (Date.now() < Math.min(visita, fin) && ws.readyState === ws.OPEN) {
      await sleep(azar(3000, 12000));
      if (Date.now() >= fin) break;
      const id = conVideo.length && Math.random() < 0.8 ? elige(conVideo) : elige(ids);
      const espera = {
        de: 'movil', id, t0: performance.now(), yo: ws, vistos: new Set(),
        medir: !encendidosMovil.has(id), destinatarios: new Set(movilesVivos),
      };
      esperas.add(espera);
      ws.send(JSON.stringify({ type: 'phone:play', id }));
      setTimeout(() => esperas.delete(espera), 5000);
      await verVideo(id);
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'phone:stop', id }));
    }
    movilesVivos.delete(ws);
    ws.vivo = false;
    ws.close();
    await sleep(azar(500, 3000));                 // se va y entra otro
  }
}

// ---------------------------------------------------------------------------
// Pantallas y Max
// ---------------------------------------------------------------------------
const pantallas = new Map();
async function pantalla(nombre) {
  try {
    const ws = await conectar('screen', { name: nombre });
    pantallas.set(nombre, ws);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type !== 'video' || !msg.video) return;
      for (const e of esperas) {
        if (e.de === 'sala' && e.pantalla === nombre && e.id === msg.video.id && !e.llegoPantalla) {
          e.llegoPantalla = true;
          m.salaPantalla.push(performance.now() - e.t0);
        }
      }
    });
  } catch (e) { error(`pantalla ${nombre} · ${e.message}`); }
}

async function max() {
  const sock = createSocket('udp4');
  const numeros = [...porNumero.keys()];
  await sleep(3000);
  while (Date.now() < fin && numeros.length) {
    const nombre = `tele${1 + Math.floor(Math.random() * Math.max(1, o.pantallas))}`;
    const num = elige(numeros);
    const id = porNumero.get(num);
    const medir = !encendidosSala.has(id);
    const espera = { de: 'sala', id, pantalla: nombre, t0: performance.now(), vistos: new Set(), medir, destinatarios: new Set(movilesVivos) };
    esperas.add(espera);
    sock.send(encode({ address: `/${nombre}/video`, args: [{ type: 'integer', value: num }] }), o.osc, '127.0.0.1');
    m.maxEnviados += 1;
    setTimeout(() => {
      esperas.delete(espera);
      // Un móvil que estaba conectado al disparo, sigue conectado y no lo vio
      // en 3 s se da por perdido.
      if (medir) {
        for (const ws of espera.destinatarios) if (ws.readyState === ws.OPEN && !espera.vistos.has(ws)) m.perdidos += 1;
      }
    }, 3000);
    await sleep(o.cada * 1000);
  }
  sock.close();
}

// CPU y memoria del servidor, si va en este ordenador.
function pidDelServidor() {
  if (!['127.0.0.1', 'localhost', '::1'].includes(base.hostname)) return null;
  try {
    return execFileSync('lsof', ['-t', '-nP', `-iTCP:${base.port || 80}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n')[0] || null;
  } catch { return null; }
}
async function vigilar(pid) {
  while (Date.now() < fin) {
    try {
      const [cpu, rss] = execFileSync('ps', ['-o', '%cpu=,rss=', '-p', pid], { encoding: 'utf8' }).trim().split(/\s+/).map(Number);
      m.cpu.push(cpu);
      m.rss.push(rss / 1024);
    } catch { /* se acabó */ }
    await sleep(2000);
  }
}

// ---------------------------------------------------------------------------
// En marcha
// ---------------------------------------------------------------------------
const pid = pidDelServidor();
console.log(`pruebo con ${o.moviles} móviles y ${o.pantallas} pantallas contra ${o.servidor} durante ${o.minutos} min`
  + `${o.max ? `, con Max disparando cada ${o.cada} s al ${o.osc}` : ', sin Max'}`
  + `${conVideo.length ? `. Hay ${conVideo.length} conceptos con vídeo` : '. Ningún concepto tiene vídeo, así que solo pruebo el WebSocket'}`);
const t0 = Date.now();
const trabajos = [
  ...Array.from({ length: o.pantallas }, (_, i) => pantalla(`tele${i + 1}`)),
  ...Array.from({ length: o.moviles }, (_, i) => movil(i + 1)),
  ...(o.max ? [max()] : []),
  ...(pid ? [vigilar(pid)] : []),
];
const latido = setInterval(() => {
  const s = Math.round((Date.now() - t0) / 1000);
  process.stdout.write(`\r  ${s} s · ${movilesVivos.size} móviles conectados · ${(m.bytes / 1e6).toFixed(0)} MB servidos · ${m.errores.length} errores   `);
}, 1000);
await Promise.all(trabajos);
clearInterval(latido);
for (const ws of pantallas.values()) { ws.vivo = false; ws.close(); }

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------
const seg = (Date.now() - t0) / 1000;
const linea = (t, xs) => `  ${t.padEnd(44)} mediana ${ms(pct(xs, 50)).padStart(7)} · p95 ${ms(pct(xs, 95)).padStart(7)} · peor ${ms(pct(xs, 100)).padStart(7)}  (${xs.length})`;
console.log(`\n\nlo que he medido en ${Math.round(seg)} s`);
console.log(linea('primera carga de la página', m.primeraCarga));
console.log(linea('Max → la palabra se enciende en cada móvil', m.salaMovil));
console.log(linea('Max → le llega a la pantalla', m.salaPantalla));
console.log(linea('un móvil abre un vídeo → se ve en los demás', m.movilMovil));
console.log(linea('el vídeo empieza a llegar', m.arranqueVideo));
console.log(`  se han servido ${(m.bytes / 1e6).toFixed(1)} MB, a una media de ${((m.bytes * 8) / seg / 1e6).toFixed(1)} Mbps`);
if (o.max) console.log(`  Max ha disparado ${m.maxEnviados} veces, y ${m.perdidos} veces un móvil no lo vio en 3 s`);
if (m.cpu.length) {
  console.log(`  el servidor (pid ${pid}) ha ido a ${(m.cpu.reduce((a, b) => a + b, 0) / m.cpu.length).toFixed(1)} % de CPU de media, con un pico de ${Math.max(...m.cpu).toFixed(1)} %, y la memoria ha llegado a ${Math.max(...m.rss).toFixed(0)} MB`);
}
console.log(`  ha habido ${m.desconexiones} desconexiones inesperadas y ${m.errores.length} errores`);
for (const e of [...new Set(m.errores)].slice(0, 10)) console.log(`    · ${e}`);
process.exitCode = m.errores.length || m.desconexiones ? 1 : 0;
