// Servidor SYSTEMA · la web del público, las pantallas fijas de la sala y Max.
//
//   npm start          → sirve la web en http://0.0.0.0:8080 (en la sala, el 80)
//                        y escucha a Max por OSC en 127.0.0.1:9100
//   npm run dev        → igual, y además simula pantallas de la sala que
//                        activan y desactivan conceptos al azar, con el
//                        simulador manual en /dev
//   node server/index.js --dev
//                      → solo el simulador manual, sin azar, para enseñar
//                        a mano que lo que suena se enciende en todos los móviles,
//                        y para ver en /dev lo que llega de Max
//
// Sirve la web y los MP4 (con peticiones de rango, que iPhone las exige),
// recibe de Max qué pone cada pantalla (/tele1/video 3), se lo manda a la
// página de esa pantalla (/screen/tele1) y difunde por WebSocket a todos los
// móviles lo que suena en la sala y lo que está viendo cada móvil. Lo que
// ponen las pantallas se guarda en disco, así que si el servidor se reinicia
// cada pantalla sigue con su vídeo en vez de irse a negro. Falta el canal de
// vuelta hacia Max (qué pantallas están vivas).
//
// PORT (8080) es el puerto de la web y OSC_PORT (9100) el de Max. OSC_HOST
// dice desde dónde se aceptan los mensajes de Max. Por defecto es 127.0.0.1
// (este ordenador), y 0.0.0.0 si Max va en otro, pero entonces cualquiera en
// la Wi-Fi de la sala podría mandar OSC.
import { createServer } from 'node:http';
import { createSocket } from 'node:dgram';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  closeSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { writeFile, rename } from 'node:fs/promises';
import express from 'express';
import compression from 'compression';
import { WebSocketServer } from 'ws';
import { decode } from 'node-osc';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
// Un 0 vale, y el sistema elige un puerto libre. Lo usan las pruebas.
const port = (v, dflt) => (/^\d+$/.test(v ?? '') ? Number(v) : dflt);
const PORT = port(process.env.PORT, 8080);
const OSC_PORT = port(process.env.OSC_PORT, 9100);
// Max va en el mismo ordenador que el servidor (el M4 de Juanlu), así que por
// defecto solo se aceptan mensajes de este ordenador. La Wi-Fi de la sala es
// abierta y cualquiera podría mandar OSC y poner vídeos en las pantallas.
const OSC_HOST = process.env.OSC_HOST || '127.0.0.1';
const SIMULATE = process.argv.includes('--simulate');
// El simulador /dev y la API que lo mueve, solo en desarrollo. En la sala la
// Wi-Fi es abierta, y sin esto cualquier visitante que escribiera /dev en el
// móvil podría encender conceptos en los mapas de todos.
const DEV = SIMULATE || process.argv.includes('--dev');
// Dónde se guarda lo que pone cada pantalla, para seguir tras un reinicio.
const ESTADO = process.env.ESTADO || join(root, 'estado', 'pantallas.json');
// La hoja ya pasada por `npm run layout` (contents.json y map.json) y los
// vídeos. Las pruebas usan los suyos, para no depender de la hoja de verdad.
const CATALOGO = process.env.CATALOGO || join(root, 'public');
const MEDIA = process.env.MEDIA || join(root, 'media');
// Las versiones que saca `npm run versiones`, cada una en su carpeta de media/.
const VERSIONES = ['movil', 'tablet', 'monitor'];

// Límites para una Wi-Fi abierta (los puse al revisarlo el 1-oct-2026). Un
// visitante no nota ninguno, porque están muy por encima de lo que hace un
// móvil de verdad.
//   · cada IP, como mucho MOVILES_POR_IP mapas abiertos a la vez (un móvil
//     que recarga abre el nuevo antes de cerrar el viejo, y 4 da margen).
//   · cada socket, como mucho 5 mensajes por segundo seguidos (ráfagas de 10).
//   · quien no se presenta en HELLO_S segundos, fuera.
//   · lo que «ve» un móvil caduca con la duración del vídeo más un margen, y
//     así un script no puede dejar el mapa en magenta durante días.
// Desde este mismo ordenador no hay tope por IP (las pruebas de carga abren
// cien móviles desde aquí), salvo con LIMITAR_LOCAL=1.
const MOVILES_POR_IP = port(process.env.MOVILES_POR_IP, 4);
// Conexiones abiertas a la vez por IP (la web, los vídeos y el WebSocket,
// todo junto). Un móvil de verdad abre unas pocas. Sin tope, un portátil con
// un script abría miles de WebSockets que se presentaban como pantallas y
// dejaba al servidor sin ficheros que abrir, así que todas las páginas y todos
// los vídeos daban error (lo arreglé el 2-oct-2026). También hay tope de
// pantallas por IP. Una Raspberry o un iPad abren una, y las ventanas de
// Chrome del Mac, una por monitor. Para una prueba de carga desde otro
// portátil, todo a 0 (sin tope).
const CONEXIONES_POR_IP = port(process.env.CONEXIONES_POR_IP, 48);
const PANTALLAS_POR_IP = port(process.env.PANTALLAS_POR_IP, 6);
const LIMITAR_LOCAL = process.env.LIMITAR_LOCAL === '1';
const HELLO_S = Number(process.env.HELLO_S) > 0 ? Number(process.env.HELLO_S) : 10;
const CADUCIDAD_EXTRA_S = Number(process.env.CADUCIDAD_EXTRA_S) >= 0 && process.env.CADUCIDAD_EXTRA_S !== undefined
  ? Number(process.env.CADUCIDAD_EXTRA_S) : 15;

// El panel de la sala (/panel) se abre siempre desde este mismo ordenador, y
// desde otro aparato de la red solo con PANEL_CLAVE en la dirección (?clave=…).
const PANEL_CLAVE = process.env.PANEL_CLAVE || '';

// Las pantallas que tiene que haber en la sala, con el nombre que usa Max,
// por ejemplo PANTALLAS=tele1,tele2,tele3. Con la lista, el panel dice cuál
// falta aunque no se haya encendido nunca (sin ella solo ve las que ya han
// dado señales), y avisa si Max manda a una que no está, que suele ser una
// errata del patch (/tel3/video). Sin la lista, todo funciona igual.
const PANTALLAS_MAL = [];
const PANTALLAS = [...new Set((process.env.PANTALLAS ?? '').split(/[\s,;]+/).filter(Boolean).flatMap((raw) => {
  const name = screenName(raw);
  if (!name) PANTALLAS_MAL.push(raw);
  return name ? [name] : [];
}))];
const fueraDeLista = (screen) => PANTALLAS.length > 0 && !PANTALLAS.includes(screen);

const isLocal = (addr) => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
const plainIp = (addr) => String(addr ?? '').replace(/^::ffff:/, '');

// ---------------------------------------------------------------------------
// El estado global va en memoria, y lo de las pantallas también en disco.
// «Activo» = lo está reproduciendo alguna pantalla estática de la sala. Lo
// que ve cada móvil va aparte, porque el mapa lo pinta con otro color.
// ---------------------------------------------------------------------------
const state = {
  screens: new Map(),   // screen_id → content_id que reproduce (o null)
  playing: new Map(),   // screen_id → lo que pone, copiado al dispararlo (id, label, file, files, duration, num)
  since: new Map(),     // screen_id → identidad del disparo (ms de reloj, estrictamente creciente)
  shot: new Map(),      // screen_id → número de disparo, único en la vida del servidor
  t0: new Map(),        // screen_id → cuándo empezó, en reloj monótono, para «por dónde va»
  ends: new Map(),      // screen_id → temporizador que la apaga al acabar el vídeo
  phones: new Set(),    // sockets de móviles conectados
  watching: new Map(),  // socket de un móvil → concepto que está viendo
  watchEnds: new Map(), // socket de un móvil → temporizador que caduca lo que ve
  displays: new Map(),  // screen_id → sockets de sus páginas /screen/<screen_id>
  devs: new Set(),      // simuladores /dev abiertos (solo desarrollo)
  panels: new Set(),    // paneles de la sala abiertos (/panel)
  avisos: [],           // lo último que ha fallado (vídeos que no se pueden poner), para el panel
  scene: null,          // la última /scene de Max
  osc: [],              // los últimos mensajes de Max, para /dev
  oscListening: null,   // dirección en la que escucha a Max, o por qué no escucha
  started: new Date(),
};
let lastSince = 0;
let shotSeq = 0;

function activeIds() {
  const ids = new Set();
  for (const id of state.screens.values()) if (id) ids.add(id);
  return [...ids];
}

// Lo que se está viendo en algún móvil, sin repetir. Se enciende para todos
// con otro color (lo pidieron en la reunión del 23-09-2026).
function mobileIds() {
  return [...new Set(state.watching.values())];
}

// Para saber si hay que avisar a los móviles. Cambia con lo de la sala o con
// lo de algún móvil.
const lit = () => `${activeIds().join(',')}|${mobileIds().join(',')}`;

// El nombre de una pantalla es el de sus mensajes de Max (/tele1/video 3) y
// el de su página (/screen/tele1). Va en minúsculas, así que «Tele1» y
// «tele1» son la misma.
function screenName(s) {
  const name = String(s ?? '').toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(name) ? name : null;
}

// Todas las pantallas de las que se sabe algo. Son las de la lista PANTALLAS,
// las que ha nombrado Max y las que tienen una página abierta. Van por orden
// natural, con tele2 antes que tele10.
function screenNames() {
  return [...new Set([...PANTALLAS, ...state.screens.keys(), ...state.displays.keys()])]
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
}

// ---------------------------------------------------------------------------
// El catálogo dice qué concepto es cada número de Max, cómo se llama, cuánto
// dura y qué fichero pone (y, si hay versiones, cuál para cada aparato). La
// hoja sale de contents.json y map.json, que escribe `npm run layout`. Los
// vídeos se buscan aquí, mirando media/ en vivo, así que basta con copiar un
// MP4 a media/, sin volver a pasar el layout (antes contents.json se quedaba
// con lo que había en media/ en el Mac donde se pasó, y la sala ponía el
// «clip simulado»). El nombre se compara sin mirar mayúsculas ni cómo se
// guardó la tilde, porque el Finder y los zip guardan «á» como «a» más el
// acento (NFD), y la hoja no. La duración se lee del propio MP4, sin ffprobe.
// Todo se vuelve a mirar cuando cambia algo, sin reiniciar, y como mucho una
// vez por segundo, porque mirarlo en cada mensaje dejaba que una ráfaga
// atascara el servidor. Si un fichero está a medio escribir, se sigue con el
// último que se pudo leer.
// ---------------------------------------------------------------------------
const catalog = { items: new Map(), byNum: new Map(), stamp: '', checked: 0, json: '{}', missing: [], version: '' };

// Lo que hay en media/ y en cada carpeta de versión (nombre normalizado → real).
function mediaIndex() {
  const read = (dir) => {
    try { return readdirSync(dir).filter((f) => !f.startsWith('.') && f.toLowerCase().endsWith('.mp4')); } catch { return []; }
  };
  const index = (files) => new Map(files.map((f) => [f.normalize('NFC').toLowerCase(), f]));
  const out = { raiz: index(read(MEDIA)) };
  for (const v of VERSIONES) out[v] = index(read(join(MEDIA, v)));
  return out;
}

// La duración de un MP4, sacada de su cabecera (moov › mvhd), así no hace
// falta ffprobe en el Mac de la sala. null si no se puede saber, y entonces
// manda la de la hoja. En un MP4 fragmentado (el «MP4 fragmentado» de OBS, o
// ffmpeg con frag_keyframe) la cabecera solo cuenta el primer trozo, o 0. Ahí
// vale la de mvex › mehd si la trae, y si no, null. Hasta el 2-oct-2026 se
// tomaba la del primer trozo, y un vídeo de 30 s se apagaba en el mapa a los 10.
function mp4Duration(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const head = Buffer.alloc(16);
    // Las cajas que hay entre `from` y `to`, leyendo solo sus cabeceras.
    function* cajas(from, to) {
      let pos = from;
      while (pos + 8 <= to) {
        readSync(fd, head, 0, 16, pos);
        let len = head.readUInt32BE(0);
        let hdr = 8;
        if (len === 1) { len = Number(head.readBigUInt64BE(8)); hdr = 16; } else if (len === 0) len = to - pos;
        if (len < hdr || pos + len > to) return;
        yield { type: head.toString('latin1', 4, 8), start: pos + hdr, end: pos + len };
        pos += len;
      }
    }
    // La versión 0 va en 32 bits y la 1, en 64. Todo unos es «no se sabe».
    const leer = (at, v1) => {
      const b = Buffer.alloc(8);
      readSync(fd, b, 0, 8, at);
      return v1 ? (b.readBigUInt64BE(0) === 0xffffffffffffffffn ? 0 : Number(b.readBigUInt64BE(0)))
        : (b.readUInt32BE(0) === 0xffffffff ? 0 : b.readUInt32BE(0));
    };
    const version = (at) => { const b = Buffer.alloc(1); readSync(fd, b, 0, 1, at); return b[0] === 1; };
    for (const moov of cajas(0, size)) {
      if (moov.type !== 'moov') continue;
      let scale = 0;
      let dur = 0;
      let fragmentado = false;
      let mehd = 0;
      for (const c of cajas(moov.start, moov.end)) {
        if (c.type === 'mvhd') {
          const v1 = version(c.start);
          scale = leer(c.start + (v1 ? 20 : 12), false);
          dur = leer(c.start + (v1 ? 24 : 16), v1);
        } else if (c.type === 'mvex') {
          fragmentado = true;
          for (const m of cajas(c.start, c.end)) if (m.type === 'mehd') mehd = leer(m.start + 4, version(m.start));
        }
      }
      const total = fragmentado ? mehd : dur;
      return scale > 0 && total > 0 ? Math.round((total / scale) * 100) / 100 : null;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// ?v= cambia cuando cambia el fichero. Los móviles guardan cada vídeo un mes,
// y sin ella un MP4 corregido con el mismo nombre no le llegaría a quien ya
// lo vio.
//
// Un MP4 que alguien está copiando a media/ no cuenta hasta que lleva unos
// segundos sin cambiar. Antes entraba desde el primer byte, así que su huella
// cambiaba cada segundo, los móviles recargaban la página en cada latido y
// quien lo abría recibía medio fichero (lo arreglé el 2-oct-2026). Lo que ya
// está al arrancar vale desde el principio (si algo se estuviera copiando
// justo entonces, su huella cambia en la pasada siguiente y desde ahí espera).
// Un fichero que desaparece entre medias, o un enlace roto, cuenta como que
// falta. Antes tumbaba el servidor.
const ASENTADO_MS = 5000;
const vistos = new Map();   // ruta → { stamp, desde, pasada }
let pasada = 0;
function mediaUrl(folder, name, now) {
  const path = folder ? join(MEDIA, folder, name) : join(MEDIA, name);
  let st;
  try { st = statSync(path); } catch { return null; }
  if (!st.isFile()) return null;
  const stamp = `${st.size}:${st.mtimeMs}`;
  const visto = vistos.get(path);
  if (!visto || visto.stamp !== stamp) {
    const quieto = pasada === 1;
    vistos.set(path, { stamp, desde: quieto ? -Infinity : now, pasada });
    if (!quieto) return null;
  } else {
    visto.pasada = pasada;
    if (now - visto.desde < ASENTADO_MS) return null;
  }
  const v = createHash('sha1').update(stamp).digest('hex').slice(0, 8);
  return { url: `/media/${folder ? `${folder}/` : ''}${encodeURIComponent(name)}?v=${v}`, path, stamp };
}

// La duración se lee una vez por fichero y se guarda con su huella en
// `vistos`. Un fichero cambiado entra como uno nuevo, sin la duración, y se
// vuelve a leer. Antes se abría cada MP4 en cada repaso del catálogo, y con
// 160 conceptos eso eran unos 30 ms parados delante de cada disparo del Max.
function duracion(path) {
  const v = vistos.get(path);
  if (v && 'dur' in v) return v.dur;
  const d = mp4Duration(path);
  if (v) v.dur = d;
  return d;
}

// Los vídeos que salieron de un master que solo era audio, según el registro
// de npm run versiones (media/versiones.json). En el móvil del público llevan
// el altavoz encima del negro. Las pantallas de la sala no lo miran. Sin
// registro, o si no se puede leer, ninguno.
function soloAudio() {
  const ruta = join(MEDIA, 'versiones.json');
  let stamp = '-';
  const nombres = new Set();
  try {
    stamp = String(statSync(ruta).mtimeMs);
    const m = JSON.parse(readFileSync(ruta, 'utf8'));
    for (const e of Object.values(m?.masters ?? {})) {
      if (!e?.soloAudio) continue;
      for (const s of Object.values(e.salidas ?? {})) {
        if (typeof s?.fichero === 'string') nombres.add(basename(s.fichero).normalize('NFC').toLowerCase());
      }
    }
  } catch { /* sin registro */ }
  return { nombres, stamp };
}

// El archivo de un concepto, tal como lo dejó layout (o, en un contents.json
// de antes, sacado de su «file»).
function archivoDe(c) {
  if (typeof c.archivo === 'string' && c.archivo.trim()) return c.archivo.trim();
  if (typeof c.file === 'string' && c.file.startsWith('/media/')) {
    try { return decodeURIComponent(c.file.slice(7).split('?')[0]); } catch { return null; }
  }
  return null;
}

function refreshCatalog() {
  const now = Date.now();
  // Como mucho una vez por segundo, también si aún no se ha podido leer nunca
  // (antes, sin catálogo, cada petición lo volvía a intentar y lo apuntaba).
  if (catalog.checked && now - catalog.checked < 1000) return catalog;
  catalog.checked = now;
  const sheets = ['contents.json', 'map.json'].map((f) => join(CATALOGO, f));
  let contents;
  let labels;
  let sheetStamp;
  try {
    sheetStamp = sheets.map((f) => statSync(f).mtimeMs).join();
    contents = JSON.parse(readFileSync(sheets[0], 'utf8'));
    // Una palabra con varios vídeos (sus «videos») da su nombre a cada uno.
    labels = new Map(JSON.parse(readFileSync(sheets[1], 'utf8')).nodes
      .flatMap((n) => (Array.isArray(n.videos) ? n.videos : [n.id]).map((id) => [id, n.label])));
  } catch (err) {
    if (!catalog.failed) log(`no puedo leer el catálogo (${err.message}); sigo con el anterior`);
    catalog.failed = true;
    return catalog;
  }
  catalog.failed = false;
  pasada += 1;
  const media = mediaIndex();
  const audio = soloAudio();
  const items = new Map();
  const byNum = new Map();
  const missing = [];
  const stamps = [sheetStamp, audio.stamp];
  for (const [id, c] of Object.entries(contents ?? {})) {
    if (!c || typeof c !== 'object') continue;
    const archivo = archivoDe(c);
    let file = null;
    let files = null;
    let duration = Number(c.duration) || 0;
    if (archivo) {
      const name = archivo.normalize('NFC');
      const base = name.replace(/\.[^.]+$/, '');
      const found = {};
      for (const v of VERSIONES) {
        const real = media[v].get(`${base}.mp4`.toLowerCase());
        const u = real ? mediaUrl(v, real, now) : null;
        if (u) found[v] = u;
      }
      const plain = media.raiz.get(name.toLowerCase()) ?? media.raiz.get(`${base}.mp4`.toLowerCase());
      const u = plain ? mediaUrl(null, plain, now) : null;
      if (u) found.raiz = u;
      const first = found.movil ?? found.raiz ?? found.tablet ?? found.monitor;
      if (first) {
        file = first.url;
        if (VERSIONES.some((v) => found[v])) files = Object.fromEntries(VERSIONES.filter((v) => found[v]).map((v) => [v, found[v].url]));
        // Solo si se sabe de verdad. Un 0 o un «no se sabe» no pisan la de la hoja.
        const d = duracion(first.path);
        if (d > 0) duration = d;
        for (const f of Object.values(found)) stamps.push(f.stamp);
      } else missing.push(`${id} (${archivo})`);
    }
    const base = archivo ? archivo.normalize('NFC').replace(/\.[^.]+$/, '') : null;
    const sonido = Boolean(file && base && audio.nombres.has(`${base}.mp4`.toLowerCase()));
    items.set(id, { id, label: labels.get(id) ?? id, archivo, file, files, duration: duration || 10, num: c.num ?? null, audio: sonido });
    if (Number.isInteger(c.num)) byNum.set(c.num, id);
  }
  for (const [ruta, v] of vistos) if (v.pasada !== pasada) vistos.delete(ruta);
  const stamp = stamps.join('|');
  if (stamp === catalog.stamp) return catalog;
  const json = JSON.stringify(Object.fromEntries([...items.values()].map((it) => [it.id, {
    file: it.file, ...(it.files ? { files: it.files } : {}), duration: it.duration, ...(it.num ? { num: it.num } : {}),
    ...(it.audio ? { audio: true } : {}),
  }])));
  const withVideo = [...items.values()].filter((it) => it.file).length;
  // Una marca de lo que tienen los móviles. Si cambia (otra hoja, otro mapa,
  // un vídeo nuevo), un móvil que ya estaba dentro recarga en cuanto no esté
  // viendo nada. Antes se quedaba con la lista vieja toda la visita.
  const version = createHash('sha1').update(`${json}|${sheetStamp}`).digest('hex').slice(0, 8);
  Object.assign(catalog, { items, byNum, stamp, json, missing, version });
  log(`en el catálogo hay ${items.size} conceptos, ${withVideo} con vídeo y ${byNum.size} con número para Max`
    + (missing.length ? ` · sin el vídeo en media/: ${missing.join(', ')}` : ''));
  return catalog;
}

// ---------------------------------------------------------------------------
// Lo que ponen las pantallas, en disco. Se escribe un poco después de cada
// cambio (todo junto si llegan varios) en un fichero aparte que luego se
// renombra, así que un corte a mitad nunca deja un fichero roto. Al arrancar
// se recupera lo que aún no ha acabado, y cada pantalla que reconecta sigue
// por donde iba sin volver a empezar.
// ---------------------------------------------------------------------------
let saveTimer = null;
let saving = false;
let saveAgain = false;
let saveWarned = false;
let tmpSeq = 0;
const tmpName = () => `${ESTADO}.${process.pid}.${(tmpSeq += 1)}.tmp`;
function snapshotForDisk() {
  const screens = {};
  for (const [name, item] of state.playing) {
    screens[name] = {
      ...item, since: state.since.get(name), shot: state.shot.get(name),
      startedAt: Date.now() - (performance.now() - state.t0.get(name)),
    };
  }
  return JSON.stringify({ version: 1, saved: new Date().toISOString(), scene: state.scene, screens });
}
// Lo que cambie en los 200 ms siguientes va en la misma escritura, y nunca
// hay dos a la vez, porque la segunda espera a que acabe la primera.
function saveState() {
  if (saveTimer) return;
  saveTimer = setTimeout(flushState, 200);
}
async function flushState() {
  saveTimer = null;
  if (saving) { saveAgain = true; return; }
  saving = true;
  const tmp = tmpName();
  try {
    mkdirSync(dirname(ESTADO), { recursive: true });
    await writeFile(tmp, snapshotForDisk());
    await rename(tmp, ESTADO);
  } catch (err) {
    if (!saveWarned) { saveWarned = true; log(`no puedo guardar el estado de las pantallas en ${ESTADO} (${err.message})`); }
  }
  saving = false;
  if (saveAgain) { saveAgain = false; saveState(); }
}
// Al salir (parada ordenada o fallo), lo último, ya mismo.
function saveStateNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    mkdirSync(dirname(ESTADO), { recursive: true });
    const tmp = tmpName();
    writeFileSync(tmp, snapshotForDisk());
    renameSync(tmp, ESTADO);
  } catch { /* se intentó */ }
}
function restoreState() {
  let saved;
  try { saved = JSON.parse(readFileSync(ESTADO, 'utf8')); } catch (err) {
    // Sin fichero es lo normal la primera vez. Uno roto (un corte de luz justo
    // al escribirlo) se dice. Antes se callaba, y nadie sabía por qué las
    // pantallas empezaban en negro (lo arreglé el 2-oct-2026).
    if (err.code !== 'ENOENT') {
      log(`no puedo leer lo que ponían las pantallas (${ESTADO}, ${err.message}). Empiezan en negro hasta el siguiente número de Max`);
      aviso('lo guardado de las pantallas estaba roto, así que empiezan en negro hasta el siguiente número de Max');
    }
    return;
  }
  if (!saved?.screens || typeof saved.screens !== 'object') return;
  const now = Date.now();
  const back = [];
  for (const [rawName, s] of Object.entries(saved.screens)) {
    const name = screenName(rawName);
    if (!name || !s?.id || !(s.duration > 0) || !Number.isFinite(s.startedAt)) continue;
    const elapsed = (now - s.startedAt) / 1000;
    if (elapsed < 0 || elapsed >= s.duration - 0.5) continue;
    const item = { id: s.id, label: s.label ?? s.id, file: s.file ?? null, files: s.files ?? null, duration: s.duration, num: s.num ?? null };
    state.screens.set(name, item.id);
    state.playing.set(name, item);
    state.since.set(name, s.since);
    state.shot.set(name, s.shot);
    state.t0.set(name, performance.now() - elapsed * 1000);
    lastSince = Math.max(lastSince, Number(s.since) || 0);
    shotSeq = Math.max(shotSeq, Number(s.shot) || 0);
    scheduleEnd(name, item.duration - elapsed);
    back.push(`${name} «${item.label}» (le quedan ${Math.round(item.duration - elapsed)} s)`);
  }
  if (saved.scene !== undefined) state.scene = saved.scene;
  if (back.length) log(`del arranque anterior recupero ${back.join(', ')}`);
}

// ---------------------------------------------------------------------------
// HTTP para la web pública y los ficheros
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');

// Tres cabeceras a mano, y no una plantilla tipo helmet, porque su CSP por
// defecto trae upgrade-insecure-requests y script-src 'self', que con HTTP y
// el script del tema en index.html romperían la carga.
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
  });
  next();
});

// Las comprobaciones de conectividad de los móviles. En la sala, el DNS del
// router manda estos nombres a este servidor (ver sala/router). Si contesta lo
// que esperan, el iPhone da la red por buena y no abre la ventanita de «portal
// cautivo», y Android se queda en la Wi-Fi en vez de irse a los datos. Fuera
// de la sala nadie pide estas rutas, y la web no tiene ninguna parecida.
const APPLE_OK = '<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>';
app.get(['/hotspot-detect.html', '/library/test/success.html'], (req, res) => {
  res.set('Cache-Control', 'no-store').type('html').send(APPLE_OK);
});
app.get(['/generate_204', '/gen_204'], (req, res) => { res.set('Cache-Control', 'no-store').status(204).end(); });
app.get('/connecttest.txt', (req, res) => { res.set('Cache-Control', 'no-store').type('text').send('Microsoft Connect Test'); });
app.get('/ncsi.txt', (req, res) => { res.set('Cache-Control', 'no-store').type('text').send('Microsoft NCSI'); });
app.get('/success.txt', (req, res) => { res.set('Cache-Control', 'no-store').type('text').send('success\n'); });

app.use(compression());

// map.json y contents.json cambian cuando Guille y Juanlu editan la hoja, así que sin caché.
// contents.json sale del catálogo ya resuelto contra media/ (más arriba).
app.get('/contents.json', (req, res) => {
  res.set('Cache-Control', 'no-cache').type('json').send(refreshCatalog().json);
});
app.get('/map.json', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile('map.json', { root: CATALOGO });
});
// Vídeos con caché larga, para que un concepto repetido no vuelva a bajar por
// la Wi-Fi. Al sustituir un MP4 cambia su ?v= (sale del tamaño y la fecha del
// fichero, en mediaUrl), y los móviles que ya lo vieron se bajan el nuevo.
app.use('/media', express.static(MEDIA, {
  maxAge: '30d',
  immutable: true,
  acceptRanges: true,
}));
// Página de cada pantalla fija (/screen/tele1, /screen/tele2…). Es la misma
// para todas, y el nombre lo lee la propia página de la dirección.
app.get('/screen/:name', (req, res, next) => {
  if (!screenName(req.params.name)) return next();
  res.set('Cache-Control', 'no-cache');
  // Con `root` y no con la ruta entera, porque si no sendFile se niega a
  // servirla cuando la web está instalada bajo una carpeta que empieza por punto.
  res.sendFile('screen.html', { root: join(root, 'public') });
});
// El simulador /dev vive fuera de public/, así que en producción no existe,
// se pida como se pida (/dev, /dev.html o /%64ev.html, que antes se colaba).
if (DEV) {
  app.get(['/dev', '/dev.html'], (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile('dev.html', { root: join(root, 'dev') });
  });
}
// La página, el CSS y el JS se revalidan siempre (con ETag, que en la red
// local no cuesta nada) para que un cambio de la víspera llegue a todos los
// móviles sin borrar cachés. Las fuentes y vendor.js no cambian y llevan
// caché larga.
app.use(express.static(join(root, 'public'), {
  extensions: ['html'],
  setHeaders(res, path) {
    const long = /\/fonts\/|\/js\/vendor\.js$/.test(path);
    res.set('Cache-Control', long ? 'public, max-age=2592000, immutable' : 'no-cache');
  },
}));

// El panel de la sala enseña qué pantallas están abiertas y si suenan, qué
// pone cada una, lo que ha fallado y lo que llega de Max. Es para quien monta
// y para quien enciende cada mañana. Solo desde este ordenador, o con la clave.
const panelAllowed = (req) => isLocal(req.socket.remoteAddress) || Boolean(PANEL_CLAVE && req.query.clave === PANEL_CLAVE);
app.get('/panel', (req, res) => {
  if (!panelAllowed(req)) { res.status(404).end(); return; }
  res.set('Cache-Control', 'no-cache');
  res.sendFile('panel.html', { root: join(root, 'panel') });
});

// Estado en texto plano. El detalle solo para este mismo ordenador (el panel,
// las pruebas, quien vigile la sala desde el Mac). A los demás les dice «ok».
app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  // Con ?pantallas, también a los demás qué pantallas tienen su página abierta,
  // y nada más. Es lo que mira el arrancador de cada ordenador para abrir otra
  // vez una pestaña caída, que con Chrome vivo no se nota desde fuera.
  if (!isLocal(req.socket.remoteAddress)) {
    const abiertas = 'pantallas' in req.query ? `\ndisplays ${[...state.displays.keys()].join(' ') || '-'}` : '';
    res.type('text').send(`ok${abiertas}`);
    return;
  }
  const displays = [...state.displays.keys()];
  const uptime = Math.round(process.uptime());
  res.type('text').send([
    `ok`,
    `phones ${state.phones.size}`,
    `screens ${state.screens.size}`,
    `active ${activeIds().join(' ') || '-'}`,
    `mobile ${mobileIds().join(' ') || '-'}`,
    `displays ${displays.join(' ') || '-'}`,
    // Con PANTALLAS, las que tiene que haber y las que no tienen su página abierta.
    `expected ${PANTALLAS.join(' ') || '-'}`,
    `missing ${PANTALLAS.filter((s) => !state.displays.get(s)?.size).join(' ') || '-'}`,
    `osc ${state.oscListening ?? '-'}`,
    `scene ${state.scene ?? '-'}`,
    `version ${VERSION}`,
    `started ${state.started.toISOString()}`,
    `uptime ${uptime}`,
    `rss ${Math.round(process.memoryUsage().rss / 1e6)}`,
    `sockets ${wss.clients.size}`,
    `sinvideo ${refreshCatalog().missing.length}`,
  ].join('\n'));
});

// API de desarrollo para marcar un contenido como activo/inactivo en una pantalla.
// Lo de verdad lo manda Max por OSC (más abajo).
if (DEV) {
  app.use(express.json());
  app.get('/api/state', (req, res) => {
    res.json({
      active: activeIds(), phones: state.phones.size, screens: Object.fromEntries(state.screens), scene: state.scene,
    });
  });
  app.post('/api/screen/:screen', (req, res) => {
    const screen = screenName(req.params.screen);
    if (!screen) { res.status(400).json({ ok: false }); return; }
    const content = req.body?.content ?? null;
    refreshCatalog();
    setScreen(screen, content);
    res.json({ ok: true, active: activeIds() });
  });
}

// ---------------------------------------------------------------------------
// Por WebSocket, cada móvil recibe una instantánea al conectar y después solo
// diferencias (agrupadas en una ventana de 100 ms). Cada página de pantalla
// recibe qué tiene que poner, y /dev, el estado entero de la sala.
// ---------------------------------------------------------------------------
const server = createServer(app);
// Plazos más cortos que los de Node (60 s para las cabeceras y 300 s para la
// petición), así un cliente lento a propósito ocupa menos. No afectan a las
// descargas largas de vídeo, porque cuentan hasta recibir la petición y no la
// respuesta.
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
// Los móviles solo mandan mensajes de unos bytes. El tope es de 4 kB (ws
// acepta 100 MB por defecto, y la Wi-Fi de la sala es abierta).
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

let pending = null;
let lastLoggedActive = '';
let mobileChanged = false;
function broadcastActive() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    const active = activeIds();
    const msg = JSON.stringify({ type: 'active', active, mobile: mobileIds() });
    for (const ws of state.phones) if (ws.readyState === ws.OPEN) ws.send(msg);
    // En el registro va lo de la sala cada vez que cambia, y lo de los móviles
    // resumido cada minuto (más abajo). Con público, apuntar cada vídeo que
    // abre un móvil eran unas 140 líneas por minuto, y enterraban lo útil.
    const now = active.join(' ') || '-';
    if (now !== lastLoggedActive) { lastLoggedActive = now; log(`suena en sala ${now}`); }
  }, 100);
}
setInterval(() => {
  flushOscRepeats();
  if (!mobileChanged) return;
  mobileChanged = false;
  log(`${state.phones.size} móviles conectados · viendo ${mobileIds().join(' ') || '-'}`);
}, 60_000).unref();

// Lo que tiene que poner una pantalla, tal como se lo manda a su página. Un
// null es negro. `since` y `shot` identifican cada disparo (una página que
// reconecta a mitad no vuelve a empezar el mismo) y `at` dice por dónde va.
function nowPlaying(screen) {
  const item = state.playing.get(screen);
  if (!item) return null;
  return {
    id: item.id, label: item.label, file: item.file, files: item.files, duration: item.duration, num: item.num,
    since: state.since.get(screen), shot: state.shot.get(screen),
    at: (performance.now() - state.t0.get(screen)) / 1000,
    // Cuándo empezó, en el reloj de este servidor. Con la hora que le da
    // `time`, la pantalla sabe por dónde va sin contar lo que tardó el mensaje.
    start: state.t0.get(screen),
  };
}

function tellDisplays(screen) {
  const set = state.displays.get(screen);
  if (!set) return;
  const msg = JSON.stringify({ type: 'video', video: nowPlaying(screen) });
  for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(msg);
}

function changed(before) {
  if (lit() !== before) broadcastActive();
  roomChanged();
}

function scheduleEnd(screen, seconds) {
  clearTimeout(state.ends.get(screen));
  state.ends.delete(screen);
  if (!(seconds > 0)) return;
  // Con tope de un día, porque un setTimeout de más de 24,8 días se desborda
  // y salta al momento, y el verde no llegaba ni a encenderse.
  seconds = Math.min(seconds, 86_400);
  state.ends.set(screen, setTimeout(() => {
    const b = lit();
    state.ends.delete(screen);
    state.screens.set(screen, null);
    state.playing.delete(screen);
    saveState();
    // Su página ya ha llegado al final por su cuenta, así que no se le dice nada.
    changed(b);
  }, seconds * 1000 + 250));
}

// Una pantalla pasa a poner `content`, o nada. Cada llamada es un disparo, y
// el mismo contenido otra vez vuelve a empezar. Con `ttl` (la duración del
// vídeo) se apaga sola al acabar aunque Max no mande el 0. Si no, el mapa
// seguiría en verde con la pantalla ya en negro.
function setScreen(screen, content, ttl = 0) {
  // Un 0 para una pantalla que nunca ha puesto nada no deja rastro, y así un
  // patch que manda negros a pantallas que no existen no llena el estado.
  if (!content && !state.screens.has(screen)) { tellDisplays(screen); return; }
  const before = lit();
  const item = content ? catalog.items.get(content) : null;
  state.screens.set(screen, item ? content : null);
  if (item) {
    state.playing.set(screen, { ...item });
    // Identidad del disparo. Dos disparos en el mismo milisegundo (un bundle
    // de Max) eran el mismo para la pantalla, que se quedaba con el primero.
    lastSince = Math.max(Date.now(), lastSince + 1);
    state.since.set(screen, lastSince);
    state.shot.set(screen, ++shotSeq);
    // Por dónde va, con reloj monótono, y así un salto de la hora del Mac no
    // mueve los vídeos de las pantallas que reconectan.
    state.t0.set(screen, performance.now());
    scheduleEnd(screen, ttl);
  } else {
    state.playing.delete(screen);
    scheduleEnd(screen, 0);
  }
  saveState();
  tellDisplays(screen);
  changed(before);
}

// /dev recibe la sala entera cada vez que cambia algo, agrupado como los móviles.
let roomPending = null;
function roomMsg() {
  const screens = {};
  for (const s of screenNames()) {
    const item = state.playing.get(s);
    screens[s] = {
      id: item?.id ?? null, label: item?.label ?? null, num: item?.num ?? null,
      displays: state.displays.get(s)?.size ?? 0,
    };
  }
  return JSON.stringify({
    type: 'room', screens, scene: state.scene, active: activeIds(), mobile: mobileIds(), phones: state.phones.size,
    osc: state.osc, oscListening: state.oscListening,
  });
}
function roomChanged() {
  if (roomPending || (!state.devs.size && !state.panels.size)) return;
  roomPending = setTimeout(() => {
    roomPending = null;
    if (state.devs.size) {
      const msg = roomMsg();
      for (const ws of state.devs) if (ws.readyState === ws.OPEN) ws.send(msg);
    }
    if (state.panels.size) {
      const msg = panelMsg();
      for (const ws of state.panels) if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  }, 150);
}

// El panel ve cada pantalla con sus páginas abiertas y lo que cuenta cada
// una (si suena, qué pone, si algo ha fallado), y lo demás de la sala.
// `listed` dice si está en la lista PANTALLAS (null si no hay lista).
function panelMsg() {
  const screens = screenNames().map((s) => {
    const item = state.playing.get(s);
    return {
      name: s,
      listed: PANTALLAS.length ? PANTALLAS.includes(s) : null,
      playing: item ? { id: item.id, label: item.label, num: item.num, at: (performance.now() - state.t0.get(s)) / 1000, duration: item.duration } : null,
      pages: [...(state.displays.get(s) ?? [])].map((ws) => ({ ip: ws.ip, since: ws.connectedAt, ...(ws.status ?? {}) })),
    };
  });
  const cat = refreshCatalog();
  return JSON.stringify({
    type: 'panel',
    version: VERSION, started: state.started.toISOString(), uptime: Math.round(process.uptime()),
    screens, expected: PANTALLAS, scene: state.scene, phones: state.phones.size,
    // Una palabra con varios vídeos sale una vez, aunque suenen dos de ellos.
    active: [...new Set(activeIds().map((id) => cat.items.get(id)?.label ?? id))],
    mobile: [...new Set(mobileIds().map((id) => cat.items.get(id)?.label ?? id))],
    osc: state.osc, oscListening: state.oscListening, avisos: state.avisos, now: Date.now(),
    catalog: { conceptos: cat.items.size, conVideo: [...cat.items.values()].filter((it) => it.file).length, missing: cat.missing },
  });
}
function aviso(text) {
  state.avisos.unshift({ t: stamp(), text });
  state.avisos.length = Math.min(state.avisos.length, 30);
  roomChanged();
}
// Lo que viene de una página, recortado y sin caracteres de control, porque
// es la Wi-Fi del público y un salto de línea dentro de un texto colaba líneas
// falsas en el registro (lo arreglé el 2-oct-2026).
const limpio = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').slice(0, n);
const short = (v, n) => (typeof v === 'string' ? limpio(v, n) : null);

// Lo que ve un móvil, y cuándo deja de verlo aunque no lo diga.
function stopWatching(ws) {
  clearTimeout(state.watchEnds.get(ws));
  state.watchEnds.delete(ws);
  state.watching.delete(ws);
}
function startWatching(ws, item) {
  stopWatching(ws);
  state.watching.set(ws, item.id);
  const secs = Math.min(Math.max((item.duration || 10) * 1.25, (item.duration || 10) + CADUCIDAD_EXTRA_S), 86_400);
  state.watchEnds.set(ws, setTimeout(() => {
    const before = lit();
    stopWatching(ws);
    mobileChanged = true;
    changed(before);
  }, secs * 1000));
}

const phoneErrors = new Map();
function phoneErrorOnce(id) {
  const t = Date.now();
  if (t - (phoneErrors.get(id) ?? 0) < 60_000) return false;
  if (phoneErrors.size > 500) phoneErrors.clear();
  phoneErrors.set(id, t);
  return true;
}

// Los mapas y las pantallas que tiene abiertos cada IP, del más viejo al más
// nuevo, y cuántas conexiones.
const phonesByIp = new Map();
const screensByIp = new Map();
const conexionesPorIp = new Map();
const countsIp = (addr) => !isLocal(addr) || LIMITAR_LOCAL;

// Al pasar del tope se cierra el socket más viejo de esa IP y no el nuevo,
// que es el que el visitante tiene en la mano. Antes se rechazaba el nuevo,
// y quien tuviera pestañas viejas del mapa abiertas (cada QR abre una) se
// quedaba sin conexión en la que estaba mirando.
function hacerSitio(porIp, ip, tope, ws) {
  const set = porIp.get(ip) ?? new Set();
  porIp.set(ip, set);
  while (tope > 0 && set.size >= tope) {
    const viejo = set.values().next().value;
    set.delete(viejo);
    viejo.close(1008, 'otra pestaña');
    logRed(`${ip} tenía ${tope} ${ws.role === 'screen' ? 'pantallas abiertas' : 'mapas abiertos'}, así que cierro el más viejo`);
  }
  set.add(ws);
}
function quitarDe(porIp, ip, ws) {
  const set = porIp.get(ip);
  if (!set) return;
  set.delete(ws);
  if (!set.size) porIp.delete(ip);
}

// Las conexiones de cada IP, todas juntas (páginas, vídeos y WebSocket).
// maxConnections queda muy por debajo de los ficheros que deja abrir macOS.
server.maxConnections = 4000;
server.on('connection', (socket) => {
  const addr = socket.remoteAddress;
  if (!CONEXIONES_POR_IP || !countsIp(addr)) return;
  const ip = plainIp(addr);
  const n = (conexionesPorIp.get(ip) ?? 0) + 1;
  if (n > CONEXIONES_POR_IP) {
    socket.destroy();
    if (onceOnly(`conexiones:${ip}`)) {
      logRed(`${ip} pasa de ${CONEXIONES_POR_IP} conexiones a la vez y corto las que sobran (solo lo digo una vez)`);
      aviso(`un aparato (${ip}) abría demasiadas conexiones a la vez, así que corto las que sobran`);
    }
    return;
  }
  conexionesPorIp.set(ip, n);
  socket.once('close', () => {
    const m = (conexionesPorIp.get(ip) ?? 1) - 1;
    if (m > 0) conexionesPorIp.set(ip, m); else conexionesPorIp.delete(ip);
  });
});

wss.on('connection', (ws, req) => {
  const addr = req.socket.remoteAddress;
  const ip = plainIp(addr);
  // Sin esto, un mensaje de más de 4 kB o con UTF-8 roto hacía que ws emitiera
  // 'error' sin nadie escuchando, y el servidor entero se caía. ws ya cierra
  // ese socket por su cuenta, y aquí solo se apunta.
  ws.on('error', (err) => {
    logRed(`websocket ${ws.role ?? 'sin presentar'} ${ip} (${err.code || err.message})`);
  });
  ws.isAlive = true;
  ws.ip = ip;
  ws.connectedAt = stamp();
  ws.on('pong', () => { ws.isAlive = true; });
  // Quien no se presenta en HELLO_S segundos no es una página de la web.
  ws.helloTimer = setTimeout(() => { if (!ws.role) ws.close(1008, 'hello'); }, HELLO_S * 1000);
  // Cubo de fichas, con 5 mensajes por segundo de media y ráfagas de 10.
  ws.tokens = 10;
  ws.refill = performance.now();

  ws.on('message', (raw, isBinary) => {
    // Un socket que ya se está cerrando no cuenta. ws sigue entregando sus
    // mensajes hasta que el otro lado contesta al cierre (hasta 30 s), y cada
    // uno escribía otra línea de «lo corto» (lo arreglé el 2-oct-2026).
    if (ws.readyState !== ws.OPEN) return;
    // Un mensaje raro no puede tumbar la sala. Se ignora o se corta ese socket.
    try {
      const t = performance.now();
      ws.tokens = Math.min(10, ws.tokens + ((t - ws.refill) / 1000) * 5);
      ws.refill = t;
      if (ws.tokens < 1) {
        logRed(`websocket ${ws.role ?? 'sin presentar'} ${ip} manda demasiados mensajes y lo corto`);
        ws.close(1008, 'demasiados mensajes');
        return;
      }
      ws.tokens -= 1;
      if (isBinary) return;
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      // JSON.parse('null') no falla, devuelve null, y antes eso tumbaba el servidor.
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
      onMessage(ws, msg, ip, addr);
    } catch (err) {
      logRed(`websocket ${ip}, fallo al tratar un mensaje · ${err.stack || err}`);
    }
  });

  ws.on('close', () => {
    clearTimeout(ws.helloTimer);
    if (ws.role === 'screen') {
      const set = state.displays.get(ws.screen);
      set?.delete(ws);
      if (set && !set.size) state.displays.delete(ws.screen);
      quitarDe(screensByIp, ip, ws);
      logRed(`pantalla ${ws.screen} desconectada`);
      roomChanged();
    } else if (ws.role === 'dev') {
      state.devs.delete(ws);
    } else if (ws.role === 'panel') {
      state.panels.delete(ws);
    } else if (ws.role === 'phone') {
      const before = lit();
      state.phones.delete(ws);
      if (state.watching.has(ws)) mobileChanged = true;
      stopWatching(ws);
      quitarDe(phonesByIp, ip, ws);
      logRed(`móvil desconectado (${state.phones.size})`);
      changed(before);
    }
  });
});

function onMessage(ws, msg, ip, addr) {
  // Lo que abre y cierra un móvil se enciende en el mapa de todos, con otro
  // color que lo de la sala. Hasta la reunión del 23-09-2026 solo contaban
  // las pantallas, como pedía el documento, y allí se cambió.
  // Un vídeo que un móvil no ha podido poner se apunta (una vez por vídeo y
  // minuto), para saber desde la sala qué falla. El visitante ya ha visto su aviso.
  if (ws.role === 'phone' && msg.type === 'phone:error') {
    const item = typeof msg.id === 'string' ? refreshCatalog().items.get(msg.id) : null;
    if (item && phoneErrorOnce(item.id)) {
      const why = limpio(msg.why ?? '?', 40);
      logRed(`un móvil (${ip}) no ha podido poner «${item.label}» (${why}) · ${item.file ?? 'sin fichero'}`);
      aviso(`un móvil no ha podido poner «${item.label}» (${why})`);
    }
    return;
  }
  // Lo que cuenta una pantalla de sí misma, para el panel. `waiting` quiere
  // decir que el vídeo está esperando datos (se ha atascado o la red va lenta).
  if (ws.role === 'screen' && msg.type === 'screen:status') {
    ws.status = {
      sound: msg.sound === true, playing: short(msg.playing, 64), paused: msg.paused === true, waiting: msg.waiting === true,
      error: short(msg.error, 200), version: short(msg.version, 16), size: short(msg.size, 20), hidden: msg.hidden === true,
    };
    if (ws.status.error && ws.status.error !== ws.lastError) {
      logRed(`pantalla ${ws.screen} · ${ws.status.error}`);
      aviso(`${ws.screen} · ${ws.status.error}`);
    }
    ws.lastError = ws.status.error;
    roomChanged();
    return;
  }
  // La pantalla pregunta la hora para ir al compás de las demás (el reloj de
  // screen.js). Se le devuelve su marca tal cual, con la del servidor al lado.
  if (ws.role === 'screen' && msg.type === 'time') {
    if (Number.isFinite(msg.c)) ws.send(JSON.stringify({ type: 'time', c: msg.c, s: performance.now() }));
    return;
  }
  // El panel pide identificar o recargar una pantalla (o todas).
  if (ws.role === 'panel' && (msg.type === 'panel:identify' || msg.type === 'panel:reload')) {
    const target = msg.screen ? screenName(msg.screen) : null;
    const sets = target ? [state.displays.get(target)].filter(Boolean) : [...state.displays.values()];
    const order = JSON.stringify(msg.type === 'panel:identify' ? { type: 'identify', seconds: 8 } : { type: 'reload' });
    for (const set of sets) for (const s of set) if (s.readyState === s.OPEN) s.send(order);
    log(`desde el panel, ${msg.type === 'panel:identify' ? 'identificar' : 'recargar'} ${target ?? 'todas las pantallas'}`);
    return;
  }
  // El panel borra los avisos. El servidor no se para por la noche, y por la
  // mañana se mezclaban con los nuevos los de ayer.
  if (ws.role === 'panel' && msg.type === 'panel:clear') {
    state.avisos.length = 0;
    log('desde el panel, avisos borrados');
    roomChanged();
    return;
  }
  if (ws.role === 'phone' && (msg.type === 'phone:play' || msg.type === 'phone:stop')) {
    const before = lit();
    const { items } = refreshCatalog();
    if (msg.type === 'phone:play' && typeof msg.id === 'string' && items.has(msg.id)) {
      startWatching(ws, items.get(msg.id));
      mobileChanged = true;
    } else if (msg.type === 'phone:stop' && (!msg.id || state.watching.get(ws) === msg.id)) {
      if (state.watching.has(ws)) mobileChanged = true;
      stopWatching(ws);
    }
    changed(before);
    return;
  }
  if (msg.type !== 'hello' || ws.role) return;
  clearTimeout(ws.helloTimer);
  if (msg.role === 'screen') {
    const name = screenName(msg.name);
    if (!name) { ws.close(1008, 'nombre'); return; }
    ws.role = 'screen';
    ws.screen = name;
    if (countsIp(addr)) hacerSitio(screensByIp, ip, PANTALLAS_POR_IP, ws);
    if (!state.displays.has(name)) state.displays.set(name, new Set());
    state.displays.get(name).add(ws);
    refreshCatalog();
    ws.send(JSON.stringify({ type: 'snapshot', video: nowPlaying(name), beat: BEAT_S, dev: DEV, cat: catalog.version }));
    logRed(`pantalla ${name} conectada ${ip}`);
    // Si una Raspberry tiene el nombre mal puesto (tele03 por tele3), en el
    // panel saldría «falta tele3» y, aparte, esta.
    if (fueraDeLista(name) && onceOnly(`pagina:${name}`)) {
      logRed(`la pantalla ${name} no está en PANTALLAS (${PANTALLAS.join(', ')}), igual su nombre está mal escrito (solo lo digo una vez)`);
      aviso(`se ha abierto /screen/${name}, que no está en la lista de pantallas`);
    }
    roomChanged();
    return;
  }
  if (msg.role === 'panel') {
    if (!isLocal(addr) && !(PANEL_CLAVE && msg.clave === PANEL_CLAVE)) {
      ws.role = 'nadie';
      ws.close(1008, 'panel');
      return;
    }
    ws.role = 'panel';
    state.panels.add(ws);
    ws.send(panelMsg());
    return;
  }
  if (msg.role === 'dev' && DEV) {
    ws.role = 'dev';
    state.devs.add(ws);
    refreshCatalog();
    ws.send(roomMsg());
    return;
  }
  if (msg.role !== 'phone') {
    // Un rol que no existe (o /dev en producción) termina aquí, una sola vez.
    ws.role = 'nadie';
    ws.close(1008, 'rol');
    return;
  }
  ws.role = 'phone';
  if (countsIp(addr)) hacerSitio(phonesByIp, ip, MOVILES_POR_IP, ws);
  state.phones.add(ws);
  // `beat` dice cada cuántos segundos late el servidor (ver más abajo). Va en
  // la instantánea para que el móvil vigile desde el primer segundo, no
  // desde el primer latido.
  // Con `dev` (--dev o --simulate), una palabra sin vídeo abre el «clip
  // simulado» de pruebas. En la sala (sin ellos), no se le enseña al público.
  ws.send(JSON.stringify({
    type: 'snapshot', active: activeIds(), mobile: mobileIds(), beat: BEAT_S, dev: DEV, cat: refreshCatalog().version,
  }));
  logRed(`móvil conectado ${ip} (${state.phones.size})`);
  roomChanged();
}

// Ping cada 10 s. Un socket que no ha contestado al anterior se da por caído
// (se detecta entre 10 y 20 s después de que se vaya). Y en el mismo golpe va
// un latido de aplicación hacia los móviles y las pantallas. El navegador no
// ve los ping del protocolo, así que sin esto no se entera de que la sala se
// ha caído si la conexión muere sin cerrarse (se fue la Wi-Fi sin despedirse,
// se apagó el ordenador de golpe). Con el latido, en 25 s como mucho avisa y
// reconecta.
const BEAT_S = 10;
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  // El latido lleva la marca del catálogo (ver refreshCatalog).
  const tick = JSON.stringify({ type: 'tick', cat: refreshCatalog().version });
  for (const ws of state.phones) if (ws.readyState === ws.OPEN) ws.send(tick);
  for (const set of state.displays.values()) {
    for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(tick);
  }
}, BEAT_S * 1000).unref();

// ---------------------------------------------------------------------------
// OSC desde Max, como lo acordamos con Juanlu (24 y 25-sep-2026).
//
//   /<pantalla>/video <n>   esa pantalla pone el vídeo n, el de la columna
//                           «numero» de la hoja. 0 = negro
//   /scene <n>              la escena de su timeline, que solo se apunta
//   /sound, /light          son de Max para la sala y aquí no hacen nada
//
// Un solo puerto para todas las pantallas. Una pantalla nueva es una línea
// más en Max, no un puerto nuevo. Sin reuseAddr, a propósito. Si el puerto ya
// lo tiene otro programa (otro servidor de pruebas, el propio Max), falla y
// se dice, en vez de repartirse los mensajes entre los dos sin avisar.
// ---------------------------------------------------------------------------
const OSC_KEEP = 40;
const toldOnce = new Set();
function onceOnly(key) {
  if (toldOnce.has(key)) return false;
  if (toldOnce.size >= 200) toldOnce.clear();
  toldOnce.add(key);
  return true;
}

// El registro de OSC no repite. Si Max manda lo mismo en bucle (un metro
// conectado por error), se apunta una vez y luego cuántas veces se repitió.
const oscLog = { text: '', at: 0, repeats: 0 };
function logOsc(text) {
  const now = Date.now();
  if (text === oscLog.text && now - oscLog.at < 5000) {
    oscLog.repeats += 1;
    return;
  }
  flushOscRepeats();
  Object.assign(oscLog, { text, at: now, repeats: 0 });
  log(text);
}
function flushOscRepeats() {
  if (!oscLog.repeats) return;
  log(`OSC (lo anterior, ${oscLog.repeats === 1 ? 'una vez' : `${oscLog.repeats} veces`} más)`);
  oscLog.repeats = 0;
}

function oscRecord(text, result, level = 'ok') {
  const t = new Date().toLocaleTimeString('es-ES', { hour12: false });
  state.osc.unshift({ t, ms: Date.now(), text, result, level });
  state.osc.length = Math.min(state.osc.length, OSC_KEEP);
  roomChanged();
}

// Un número de vídeo tal como llegue de Max, sea entero (3), decimal (3.0, de
// un flonum) o texto ("3").
function videoNumber(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  return Math.abs(n - Math.round(n)) < 1e-6 ? Math.round(n) : null;
}

function onOscMessage(address, args, from) {
  const text = [address, ...args].join(' ');
  const who = from === '127.0.0.1' ? '' : ` (desde ${from})`;
  const m = /^\/([^/]+)\/video$/i.exec(address);
  if (m) {
    const screen = screenName(m[1]);
    const n = videoNumber(args[0]);
    if (!screen || n === null) {
      logOsc(`OSC ${text}${who} → no lo entiendo, tiene que ser /<pantalla>/video <número>`);
      oscRecord(text, 'no lo entiendo', 'warn');
      return;
    }
    // Se hace igual, pero se dice. Con la lista puesta, un nombre que no está
    // en ella suele ser una errata del patch, y esa tele se quedaría en negro.
    if (fueraDeLista(screen) && onceOnly(`lista:${screen}`)) {
      log(`OSC ${text}${who} → «${screen}» no está en PANTALLAS (${PANTALLAS.join(', ')}), igual es una errata en el patch (solo lo digo una vez)`);
      aviso(`Max manda a «${screen}», que no está en la lista de pantallas (${PANTALLAS.join(', ')})`);
    }
    if (n === 0) {
      setScreen(screen, null);
      logOsc(`OSC ${text}${who} → ${screen} en negro`);
      oscRecord(text, `${screen} en negro`);
      return;
    }
    const { byNum, items } = refreshCatalog();
    const id = byNum.get(n);
    if (!id) {
      // Mejor negro que dejar puesto lo de antes. Max ya cree que ha cambiado.
      setScreen(screen, null);
      logOsc(`OSC ${text}${who} → ningún concepto tiene el número ${n} en la hoja, así que ${screen} se queda en negro`);
      oscRecord(text, `no hay vídeo ${n} en la hoja · ${screen} en negro`, 'warn');
      return;
    }
    const item = items.get(id);
    // En la sala, un concepto sin su vídeo en media/ (falta, tiene una errata
    // o se está copiando) deja la pantalla en negro y no se enciende en el
    // mapa, igual que en el móvil. Antes la palabra se ponía verde en todos
    // los móviles sin que sonara nada. Con --dev sigue entrando, para probar
    // sin los vídeos.
    if (!item.file && !DEV) {
      setScreen(screen, null);
      logOsc(`OSC ${text}${who} → «${item.label}» no tiene su vídeo en media/, así que ${screen} se queda en negro`);
      oscRecord(text, `«${item.label}» no tiene vídeo en media/ · ${screen} en negro`, 'warn');
      return;
    }
    setScreen(screen, id, item.duration);
    logOsc(`OSC ${text}${who} → ${screen} pone «${item.label}»`);
    oscRecord(text, `${screen} pone «${item.label}»`);
    return;
  }
  if (/^\/scene$/i.test(address)) {
    state.scene = args[0] ?? null;
    saveState();
    logOsc(`OSC ${text}${who} → escena ${state.scene ?? '-'}`);
    oscRecord(text, `escena ${state.scene ?? '-'}`);
    return;
  }
  if (/^\/(sound|light)$/i.test(address)) {
    oscRecord(text, 'es para la sala, no para el servidor', 'dim');
    return;
  }
  // Una errata en el patch (como «audio» por «sound») se dice una vez por
  // dirección, sin llenar el registro si llega en bucle.
  if (onceOnly(address)) log(`OSC ${text}${who} → no sé qué hacer con ${address} (solo lo digo una vez)`);
  oscRecord(text, 'no sé qué hacer con esto', 'warn');
}

// Un bundle de OSC trae varios mensajes (y bundles dentro). Van todos, en
// orden y en el acto, sin mirar su hora.
function oscMessages(packet) {
  if (packet.oscType === 'bundle') return packet.elements.flatMap(oscMessages);
  return [packet];
}

// Si al arrancar el puerto lo tiene otro programa (un [udpreceive 9100] dentro
// del propio patch, por ejemplo), se vuelve a intentar cada 10 s, y en cuanto
// lo suelte el servidor lo coge sin reiniciarlo. Antes se quedaba sordo hasta
// un reinicio, y con el arranque solo nadie sabría cómo hacerlo.
let oscOcupado = false;
function escucharOsc() {
  const osc = createSocket('udp4');
  osc.on('message', (buf, rinfo) => {
    let packet;
    try { packet = decode(buf); } catch (err) {
      if (onceOnly(`roto:${rinfo.address}`)) log(`OSC ilegible desde ${rinfo.address} (${err.message}, solo lo digo una vez)`);
      oscRecord(`${buf.length} bytes ilegibles`, err.message, 'warn');
      return;
    }
    // Un mensaje raro no puede tumbar la sala. Se apunta y se sigue.
    try {
      for (const m of oscMessages(packet)) onOscMessage(m.address, m.args.map((a) => a.value), rinfo.address);
    } catch (err) {
      log(`OSC, fallo al tratar un mensaje de ${rinfo.address} · ${err.stack || err}`);
    }
  });
  osc.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') {
      state.oscListening = `ERROR: ${err.message}`;
      log(`OSC · ${err.message}`);
      return;
    }
    state.oscListening = `SIN PUERTO: el ${OSC_PORT} lo tiene otro programa`;
    if (!oscOcupado) log(`el puerto ${OSC_PORT} (OSC) ya lo tiene otro programa, así que lo que mande Max no llegará a este servidor (lo vuelvo a intentar cada 10 s)`);
    oscOcupado = true;
    roomChanged();
    try { osc.close(); } catch { /* ya estaba cerrado */ }
    setTimeout(escucharOsc, 10_000);
  });
  osc.bind(OSC_PORT, OSC_HOST, () => {
    const a = osc.address();
    state.oscListening = `${a.address}:${a.port}`;
    log(`Max por OSC en ${a.address}:${a.port}${a.address === '127.0.0.1' ? ' (solo desde este ordenador)' : ''}${oscOcupado ? ', el puerto ya está libre' : ''}`);
    oscOcupado = false;
    roomChanged();
  });
}
escucharOsc();

// ---------------------------------------------------------------------------
// Simulador de sala (solo desarrollo), con 4 pantallas ficticias que lanzan
// conceptos al azar y los sueltan cuando acaba su duración.
// ---------------------------------------------------------------------------
if (SIMULATE) {
  const { items } = refreshCatalog();
  const ids = [...items.keys()];
  const screens = ['screen_01', 'screen_02', 'screen_03', 'screen_04'];
  const tick = () => {
    const screen = screens[Math.floor(Math.random() * screens.length)];
    const id = ids[Math.floor(Math.random() * ids.length)];
    setScreen(screen, id);
    setTimeout(() => { if (state.screens.get(screen) === id) setScreen(screen, null); },
      Math.min(items.get(id).duration, 40) * 1000);
    setTimeout(tick, 3000 + Math.random() * 5000);
  };
  tick();
  log('simulador de sala activo (4 pantallas ficticias)');
}

// Fecha y hora local en cada línea. Quien vigile la sala varios días lee la
// hora de Pamplona, y sin el día no se sabe de cuándo es «17:43 móvil desconectado».
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function log(s) {
  console.log(`${stamp()} ${s}`);
}

// Lo que provoca la red (conexiones, mensajes, errores de un socket) se apunta
// con tope de 60 líneas por minuto, y luego cuántas se han callado. Sin él, un
// script que inundaba el WebSocket escribió 214 MB de registro en 10 s (lo
// medí el 2-oct-2026). En una noche, eso llena el disco entero del Mac de la
// sala, que es también el del Max.
const RED_POR_MINUTO = 60;
let redApuntadas = 0;
let redCalladas = 0;
setInterval(() => {
  if (redCalladas) log(`(y ${redCalladas} líneas más de la red en el último minuto, sin apuntar)`);
  redApuntadas = 0;
  redCalladas = 0;
}, 60_000).unref();
function logRed(s) {
  if (redApuntadas < RED_POR_MINUTO) {
    redApuntadas += 1;
    log(s);
  } else redCalladas += 1;
}

// Un fallo que nadie esperaba se apunta con fecha, se guarda lo que ponen
// las pantallas y se sale, para que el arranque automático lo levante limpio
// (seguir con el estado a medias sería peor).
process.on('uncaughtException', (err) => {
  log(`fallo inesperado, me reinicio · ${err.stack || err}`);
  saveStateNow();
  process.stdout.write('', () => process.exit(1));
});
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    saveStateNow();
    log(`parado (${sig})`);
    process.stdout.write('', () => process.exit(0));
  });
}

log(`Systema ${VERSION} · Node ${process.version} · pid ${process.pid} · arrancado el ${state.started.toLocaleString('es-ES')}`);
if (PANTALLAS.length) log(`las pantallas de la sala son ${PANTALLAS.join(', ')}`);
for (const raw of PANTALLAS_MAL) log(`en PANTALLAS, «${raw}» no vale como nombre (letras, números, _ y -, como en Max) y no la cuento`);
refreshCatalog();
restoreState();
// Si el puerto de la web ya lo tiene otro programa, se dice claro y se sale,
// en vez de una traza de error que no explica nada. El error llega dos veces,
// del servidor y del WebSocket, que lo repite, así que se atiende en los dos
// y se dice una vez.
let cannotListen = false;
function failedToListen(err) {
  if (cannotListen) return;
  cannotListen = true;
  log(err.code === 'EADDRINUSE'
    ? `el puerto ${PORT} (la web) ya lo tiene otro programa, ciérralo o arranca en otro, por ejemplo con PORT=8090`
    : `la web no puede arrancar (${err.message})`);
  // Se sale cuando la línea ya ha salido entera, porque en macOS la salida
  // hacia una tubería (la del arranque automático, la de las pruebas) va en
  // diferido, y un exit directo se la comía.
  process.stdout.write('', () => process.exit(1));
}
server.on('error', failedToListen);
wss.on('error', failedToListen);
server.listen(PORT, '0.0.0.0', () => {
  const { port: p } = server.address();
  log(`web del público en http://0.0.0.0:${p}  (WebSocket en /ws, estado en /health)`);
  log(`pantallas fijas en http://<este ordenador>:${p}/screen/<nombre>  (tele1, tele2…)`);
  if (DEV) log(`simulador manual en http://localhost:${p}/dev`);
});
