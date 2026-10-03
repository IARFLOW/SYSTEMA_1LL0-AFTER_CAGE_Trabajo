// Calcula UNA VEZ la posición de las palabras del mapa y escribe
// public/map.json y public/contents.json a partir de las dos hojas de Guille
// y Juanlu. Cada concepto es su palabra, en tres tamaños (columna «nivel»), y
// ninguna pisa a otra porque van en cajas del tamaño real de cada palabra.
//
//   npm run layout                 → lee data/conceptos.csv y data/relaciones.csv
//   npm run layout -- --keep       → conserva las x/y que ya hay en map.json
//                                    (retoques a mano) y solo coloca los nuevos
//
// El móvil nunca simula física. Recibe coordenadas fijas, y así 30 teléfonos
// no gastan CPU en asentar el grafo y Guille y Juanlu pueden retocar posiciones.
//
// Las hojas se aceptan tal como las guarde cada programa, separadas por comas
// o por punto y coma (Excel en español guarda con punto y coma), con o sin
// comillas, en UTF-8 o en la codificación antigua de Windows o de Mac, y con
// los nombres de columna con o sin tilde. Si algo no cuadra se listan TODOS
// los errores con su línea y no se toca el mapa que había, porque una coma de
// más no puede tumbar la sala.
//
//   conceptos.csv   id, etiqueta, archivo, duracion, numero
//                   y, si se quiere fijar a mano dónde va un concepto, x e y
//                   (en el lienzo del mapa, 1400 de ancho por 2000 de alto).
//                   «numero» es el número con el que Max pide ese vídeo a una
//                   pantalla (/tele1/video 3). El 0 no, que es pantalla en negro.
//                   «nivel» es 1 en los conceptos principales (más grandes y
//                   en negrita), 2 en los secundarios (en negrita) y 3 en el resto
//   relaciones.csv  origen, destino (por id o por etiqueta)
//
// Con ffprobe instalado, además se revisa que cada MP4 sea H.264 y AAC, que
// un móvil lo pueda reproducir y que empiece sin descargarse entero. La
// duración se lee del propio vídeo.
import {
  readFileSync, writeFileSync, existsSync, readdirSync, statSync, openSync, readSync, closeSync,
} from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  forceSimulation, forceLink, forceManyBody, forceX, forceY,
} from 'd3-force';

// RAIZ es otra carpeta con su data/, public/ y media/ (la usan las pruebas).
const root = process.env.RAIZ ? resolvePath(process.env.RAIZ) : join(dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');
const W = 1400; // lienzo vertical, porque los móviles se usan en vertical
const H = 2000;
const PAD = 120;
const errors = [];
const warnings = [];

// ---------- Leer una hoja tal como la guarde cada programa ----------
function decode(buf) {
  let b = buf;
  // El UTF-16 (lo que da «Texto Unicode» en Excel o Numbers) se reconoce por
  // su marca del principio. Sin esto, la cabecera salía llena de basura.
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { /* no es UTF-8 */ }
  // Codificación antigua. En la de Mac las letras con tilde caen entre 0x80 y
  // 0x9F, y en la de Windows, de 0xC0 para arriba. Gana la que explica el texto.
  let mac = 0;
  let win = 0;
  for (const x of b) { if (x >= 0x80 && x <= 0x9f) mac += 1; else if (x >= 0xc0) win += 1; }
  return new TextDecoder(mac > win ? 'macintosh' : 'windows-1252').decode(b);
}

function parseCsv(text) {
  // El separador es el que más aparece en la cabecera.
  const head = text.split(/\r?\n/, 1)[0];
  const times = (ch) => head.split(ch).length - 1;
  const sep = [',', ';', '\t'].reduce((a, b) => (times(b) > times(a) ? b : a));
  const rows = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false;
      else { if (ch === '\n') line += 1; cell += ch; }
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) { cells.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      cells.push(cell);
      rows.push({ cells, line: start });
      cells = [];
      cell = '';
      line += 1;
      start = line;
    } else cell += ch;
  }
  if (cell !== '' || cells.length) { cells.push(cell); rows.push({ cells, line: start }); }
  return rows;
}

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const ALIAS = {
  id: 'id', etiqueta: 'etiqueta', nombre: 'etiqueta', concepto: 'etiqueta', palabra: 'etiqueta',
  archivo: 'archivo', fichero: 'archivo', video: 'archivo', mp4: 'archivo', 'archivo mp4': 'archivo',
  'nombre del archivo': 'archivo', 'nombre del video': 'archivo',
  duracion: 'duracion', segundos: 'duracion', 'duracion (s)': 'duracion', 'duracion (seg)': 'duracion',
  'duracion (segundos)': 'duracion', 'duracion en segundos': 'duracion', tiempo: 'duracion',
  x: 'x', y: 'y', origen: 'origen', destino: 'destino',
  // «video» ya es el archivo, así que el número de Max va en «numero». Los
  // nombres con los que es fácil llamarlo, mirando cómo lo pide Max
  // (/tele1/video 3), cuentan también.
  numero: 'numero', num: 'numero', n: 'numero', 'nº': 'numero', 'n.º': 'numero', 'n°': 'numero', no: 'numero',
  'numero de video': 'numero', 'numero video': 'numero', 'num video': 'numero', 'nº video': 'numero',
  'n.º video': 'numero', 'n° video': 'numero', 'n video': 'numero', 'no video': 'numero', 'video n': 'numero',
  'video nº': 'numero', 'numero max': 'numero', 'numero de max': 'numero', max: 'numero',
  nivel: 'nivel', importancia: 'nivel',
};
const KNOWN = { 'conceptos.csv': ['id', 'etiqueta', 'archivo', 'duracion', 'numero', 'nivel', 'x', 'y'], 'relaciones.csv': ['origen', 'destino'] };

function sheet(name, required) {
  const path = join(root, 'data', name);
  if (!existsSync(path)) { errors.push(`falta data/${name}`); return []; }
  const rows = parseCsv(decode(readFileSync(path)));
  const header = rows.shift() ?? { cells: [] };
  const cols = header.cells.map((h) => ALIAS[norm(h)] ?? norm(h));
  for (const r of required) {
    if (!cols.includes(r)) errors.push(`en ${name} falta la columna «${r}» (la cabecera es ${header.cells.join(' | ') || 'nada'})`);
  }
  // Una columna que no se conoce se avisa (antes se saltaba en silencio, y una
  // «Nº de clip» dejaba la sala sin números para Max). Dos que valen para lo
  // mismo son un error, porque una pisaría a la otra.
  const seenCol = new Map();
  cols.forEach((c, i) => {
    const raw = header.cells[i].trim();
    if (!raw) return;
    if (!KNOWN[name].includes(c)) {
      warnings.push(`en ${name} no conozco la columna «${raw}» y la salto (las que valen son ${KNOWN[name].join(', ')})`);
    } else if (seenCol.has(c)) {
      errors.push(`en ${name} las columnas «${seenCol.get(c)}» y «${raw}» valen las dos para «${c}». Quita o renombra una`);
    } else seenCol.set(c, raw);
  });
  return rows.filter((r) => r.cells.some((c) => c.trim()))
    .map((r) => ({ line: r.line, ...Object.fromEntries(cols.map((c, i) => [c, (r.cells[i] ?? '').trim()]).filter(([c]) => KNOWN[name].includes(c))) }));
}

function fail() {
  console.error(`\nNo he tocado el mapa porque ${errors.length === 1 ? 'hay un error' : `hay ${errors.length} errores`}.\n`);
  for (const e of errors) console.error(`  · ${e}`);
  console.error('');
  process.exit(1);
}

const conceptos = sheet('conceptos.csv', ['etiqueta']);
const relaciones = sheet('relaciones.csv', ['origen', 'destino']);
if (errors.length) fail();
// Una columna «video» que trae números es, casi seguro, el número de Max y no
// el nombre del fichero.
const conArchivo = conceptos.filter((c) => c.archivo);
if (conArchivo.length && conArchivo.every((c) => /^\d+$/.test(c.archivo))) {
  errors.push('en conceptos.csv la columna del archivo solo trae números. Si es el número con el que Max pide el vídeo, '
    + 'llámala «numero». El archivo es el nombre del MP4');
  fail();
}

// ---------- Conceptos ----------
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const ids = new Map();
const byLabel = new Map();
const nums = new Map();
const dupLabels = new Set();
for (const c of conceptos) {
  if (!c.etiqueta) { errors.push(`conceptos.csv, línea ${c.line}, falta la etiqueta`); continue; }
  if (!c.id) {
    c.id = slug(c.etiqueta);
    warnings.push(`conceptos.csv, línea ${c.line}, no tiene id y uso «${c.id}». Si Max va a nombrar este contenido, mejor ponerlo a mano`);
  }
  if (!/^[a-z0-9_]+$/.test(c.id)) {
    errors.push(`conceptos.csv, línea ${c.line}, el id «${c.id}» solo puede llevar a-z, 0-9 y _. Prueba con «${slug(c.id)}»`);
    continue;
  }
  if (ids.has(c.id)) { errors.push(`conceptos.csv, línea ${c.line}, el id «${c.id}» ya está en la línea ${ids.get(c.id).line}`); continue; }
  ids.set(c.id, c);
  // Dos conceptos con la misma etiqueta pueden ser a propósito (dos vídeos de
  // la misma palabra), pero en las relaciones escritas por etiqueta no se
  // sabría cuál es. Se avisa, y si una relación la usa, se pide el id.
  if (!byLabel.has(norm(c.etiqueta))) byLabel.set(norm(c.etiqueta), c.id);
  else {
    const first = ids.get(byLabel.get(norm(c.etiqueta)));
    warnings.push(`conceptos.csv, línea ${c.line}, la etiqueta «${c.etiqueta}» ya la tiene «${first.id}» en la línea ${first.line}`);
    dupLabels.add(norm(c.etiqueta));
  }
  // El número con el que lo pide Max. Dos conceptos con el mismo número
  // harían que la pantalla pusiera uno y el mapa encendiera el otro.
  if (c.numero) {
    const n = Number(c.numero.replace(',', '.'));
    if (!Number.isInteger(n) || n < 1) {
      errors.push(`conceptos.csv, línea ${c.line}, el número «${c.numero}» tiene que ser un entero desde el 1 (el 0 es pantalla en negro)`);
    } else if (nums.has(n)) {
      errors.push(`conceptos.csv, línea ${c.line}, el número ${n} ya lo tiene «${nums.get(n).id}» en la línea ${nums.get(n).line}`);
    } else {
      nums.set(n, c);
      c.num = n;
    }
  }
  // Nivel 1 para los conceptos principales, 2 los secundarios y 3 el resto.
  if (c.nivel) {
    const lv = Number(c.nivel);
    if ([1, 2, 3].includes(lv)) c.lv = lv;
    else errors.push(`conceptos.csv, línea ${c.line}, el nivel «${c.nivel}» tiene que ser 1 (principal), 2 o 3`);
  }
}

// ---------- Relaciones, por id o por etiqueta ----------
const resolve = (v) => (ids.has(v) ? v : byLabel.get(norm(v)));
const seen = new Set();
const links = [];
for (const r of relaciones) {
  if (!r.origen || !r.destino) {
    errors.push(`relaciones.csv, línea ${r.line}, falta ${!r.origen && !r.destino ? 'el origen y el destino' : !r.origen ? 'el origen' : 'el destino'}`);
    continue;
  }
  const ambiguous = [r.origen, r.destino].filter((v) => !ids.has(v) && dupLabels.has(norm(v)));
  if (ambiguous.length) {
    errors.push(`relaciones.csv, línea ${r.line}, hay varios conceptos «${ambiguous[0]}». Escribe su id en vez de la etiqueta`);
    continue;
  }
  const a = resolve(r.origen);
  const b = resolve(r.destino);
  if (!a || !b) {
    const which = [!a && `«${r.origen}»`, !b && `«${r.destino}»`].filter(Boolean).join(' ni ');
    errors.push(`relaciones.csv, línea ${r.line}, no hay ningún concepto ${which}`);
    continue;
  }
  if (a === b) { errors.push(`relaciones.csv, línea ${r.line}, «${r.origen}» se une consigo mismo`); continue; }
  const key = [a, b].sort().join('|');
  if (seen.has(key)) { warnings.push(`relaciones.csv, línea ${r.line}, la relación entre ${a} y ${b} está repetida y cuenta una vez`); continue; }
  seen.add(key);
  links.push({ source: a, target: b });
}
if (errors.length) fail();

// ---------- Que los vídeos existan y un móvil los pueda reproducir ----------
function hasFfprobe() {
  try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

// Está el índice (moov) antes que los datos (mdat)? Si no, el móvil tiene
// que descargarse el fichero entero antes de empezar. Lo arregla exportar con
// `-movflags +faststart`.
function faststart(path) {
  const fd = openSync(path, 'r');
  try {
    const box = Buffer.alloc(16);
    const size = statSync(path).size;
    let pos = 0;
    while (pos + 8 <= size) {
      readSync(fd, box, 0, 16, pos);
      let len = box.readUInt32BE(0);
      const type = box.toString('latin1', 4, 8);
      if (type === 'moov') return true;
      if (type === 'mdat') return false;
      if (len === 1) len = Number(box.readBigUInt64BE(8));
      if (len < 8) return false;
      pos += len;
    }
    return false;
  } finally { closeSync(fd); }
}

function checkVideo(c, path) {
  let info;
  try {
    info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
      'format=duration:stream=codec_type,codec_name,level,pix_fmt,width,height', '-of', 'json', path], { encoding: 'utf8' }));
  } catch { warnings.push(`«${c.id}» lleva ${c.archivo} y ffprobe no lo puede leer. Igual no está entero`); return; }
  const v = info.streams.find((s) => s.codec_type === 'video');
  const a = info.streams.find((s) => s.codec_type === 'audio');
  const d = Number(info.format?.duration);
  if (d > 0) c.probed = Math.round(d * 10) / 10;
  const why = [];
  if (!v) why.push('no tiene imagen (un audio va como MP4 con imagen negra)');
  else {
    if (v.codec_name !== 'h264') why.push(`el vídeo es ${v.codec_name} y no H.264, que muchos móviles no lo abren`);
    else if (v.level > 41) why.push(`nivel ${v.level / 10} de H.264, y para móviles vale hasta el 4.1`);
    if (v.pix_fmt && v.pix_fmt !== 'yuv420p') why.push(`color ${v.pix_fmt}, los móviles quieren yuv420p`);
    if (Math.max(v.width, v.height) > 1920) why.push(`${v.width}×${v.height} es más de lo que necesita un móvil`);
  }
  if (a && a.codec_name !== 'aac') why.push(`el audio es ${a.codec_name} y no AAC`);
  if (!faststart(path)) why.push('no empieza hasta descargarse entero, hay que exportarlo con -movflags +faststart');
  if (why.length) warnings.push(`«${c.id}» (${c.archivo}) · ${why.join(' · ')}`);
}

// En media/ o en las carpetas de versiones (media/movil, media/tablet y
// media/monitor, las que saca `npm run versiones`). El servidor vuelve a
// buscarlos al arrancar y cada vez que cambia algo, así que un vídeo copiado
// después también vale. Lo de aquí sirve para revisarlos y avisar ya.
// Se compara sin mirar mayúsculas ni cómo se guardó la tilde, porque el Finder
// y los zip guardan «á» como «a» más el acento (NFD), y la hoja no.
const mediaDir = join(root, 'media');
const listing = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith('.')) : []);
const key = (f) => f.normalize('NFC').toLowerCase();
const onDisk = new Map(listing(mediaDir).map((f) => [key(f), f]));
const versions = Object.fromEntries(['movil', 'tablet', 'monitor'].map((v) => [v, new Map(listing(join(mediaDir, v)).map((f) => [key(f), f]))]));
const probe = hasFfprobe();
if (!probe && conceptos.some((c) => c.archivo)) warnings.push('sin ffprobe no reviso los MP4 (brew install ffmpeg), pero el servidor lee igual su duración');
for (const c of ids.values()) {
  c.file = null;
  if (!c.archivo) continue;
  c.archivo = c.archivo.normalize('NFC');
  const base = c.archivo.replace(/\.[^.]+$/, '');
  const inVersion = ['movil', 'tablet', 'monitor'].map((v) => [v, versions[v].get(key(`${base}.mp4`))]).find(([, f]) => f);
  const plain = onDisk.get(key(c.archivo));
  const [folder, name] = inVersion ?? (plain ? [null, plain] : [null, null]);
  if (!name) {
    warnings.push(`«${c.id}» lleva ${c.archivo} y no está en media/ (ni sus versiones). Si lo copias luego, el servidor lo encuentra solo`);
    continue;
  }
  if (!inVersion && name.normalize('NFC') !== c.archivo) {
    warnings.push(`para «${c.id}» la lista pone «${c.archivo}» y el fichero se llama «${name}». Uso el del fichero`);
  }
  // ?v= cambia cuando cambia el fichero. Los móviles guardan cada vídeo un
  // mes, así que sustituir un MP4 por otro con el mismo nombre no llegaría
  // nunca a quien ya lo vio. Con la huella en la dirección, sí.
  const path = folder ? join(mediaDir, folder, name) : join(mediaDir, name);
  const st = statSync(path);
  const v = createHash('sha1').update(`${st.size}:${st.mtimeMs}`).digest('hex').slice(0, 8);
  c.file = `/media/${folder ? `${folder}/` : ''}${encodeURIComponent(name)}?v=${v}`;
  if (probe) checkVideo(c, path);
}

// ---------- Relaciones de cada concepto ----------
const degree = new Map([...ids.keys()].map((id) => [id, 0]));
const neighbors = new Map([...ids.keys()].map((id) => [id, []]));
for (const l of links) {
  degree.set(l.source, degree.get(l.source) + 1);
  degree.set(l.target, degree.get(l.target) + 1);
  neighbors.get(l.source).push(l.target);
  neighbors.get(l.target).push(l.source);
}

// ---------- Niveles, el tamaño y el grosor de cada palabra ----------
// Nivel 1, los principales, que van más grandes y en negrita. Nivel 2, en
// negrita. Nivel 3, el resto. Lo deciden Guille y Juanlu con la columna
// «nivel». Si no la usan, sale de las relaciones. Los 8 conceptos más
// conectados son de nivel 1 y los 16 siguientes, de nivel 2. Si la usan, lo
// que dejen vacío es 3, así que se marca lo importante y lo demás es normal.
const byColumn = [...ids.values()].some((c) => c.lv);
[...ids.values()].map((c, i) => ({ c, i }))
  .sort((a, b) => degree.get(b.c.id) - degree.get(a.c.id) || a.i - b.i)
  .forEach(({ c }, rank) => { if (!c.lv) c.lv = byColumn ? 3 : rank < 8 ? 1 : rank < 24 ? 2 : 3; });

// Cuerpo de cada nivel, en unidades del mapa. En un móvil, a la distancia a la
// que entra la web, salen a unos 22, 16 y 12 px. En Space Mono cada letra mide
// 0,612 em en los dos pesos (medido), así que la caja de cada palabra se sabe
// sin navegador. La misma cuenta la hace app.js.
const FONT = { 1: 44, 2: 31, 3: 24 };
const ADVANCE = 0.612;
const GAP = 30;   // aire mínimo entre dos palabras, en unidades del mapa
const wordBox = (label, lv) => {
  const fs = FONT[lv];
  return { w: [...label.normalize('NFC')].length * ADVANCE * fs + fs * 0.6, h: fs * 1.25 };
};

// ---------- Posiciones ----------
const mapPath = join(root, 'public', 'map.json');
const previous = new Map();
let canvas = { width: W, height: H };
if (keep && existsSync(mapPath)) {
  let old;
  try { old = JSON.parse(readFileSync(mapPath, 'utf8')); } catch (err) {
    errors.push(`public/map.json no se puede leer (${err.message}). Arréglalo o lanza layout sin --keep para colocarlo todo de nuevo`);
    fail();
  }
  // Las posiciones de un mapa de puntos (versión 1) no valen, porque las
  // palabras ocupan mucho más y se pisarían. Se colocan de nuevo.
  if (old.version >= 2) {
    for (const n of old.nodes) previous.set(n.id, n);
    canvas = { width: old.width, height: old.height };
  } else {
    warnings.push('el map.json de antes era de puntos, así que las palabras se colocan de nuevo (las columnas x e y se respetan)');
  }
}

const num = (v) => (v === undefined || v === '' ? NaN : Number(String(v).replace(',', '.')));
let byHand = 0;
let kept = 0;
const nodes = [...ids.values()].map((c) => {
  const n = { id: c.id, label: c.etiqueta, lv: c.lv, ...wordBox(c.etiqueta, c.lv) };
  const hx = num(c.x);
  const hy = num(c.y);
  if (Number.isFinite(hx) && Number.isFinite(hy)) {
    if (hx < 0 || hx > canvas.width || hy < 0 || hy > canvas.height) {
      warnings.push(`conceptos.csv, línea ${c.line}, «${c.id}» en (${hx}, ${hy}) cae fuera del lienzo (${canvas.width} × ${canvas.height})`);
    }
    Object.assign(n, { fx: hx, fy: hy });
    byHand += 1;
  } else if (previous.has(c.id)) {
    Object.assign(n, { fx: previous.get(c.id).x, fy: previous.get(c.id).y });
    kept += 1;
  }
  return n;
});
const anchored = byHand + kept > 0;
const byNode = new Map(nodes.map((n) => [n.id, n]));
const simLinks = links.map((l) => ({ ...l }));

// Si dos cajas se pisan, cuánto y por qué eje apartarlas. Por el que menos se
// pisan, en proporción a su tamaño. Una palabra al lado de otra se aparta de
// lado, y una encima de otra, hacia arriba o hacia abajo.
function clash(a, b, ax, ay, bx, by, gap = GAP) {
  const dx = bx - ax;
  const dy = by - ay;
  const ox = (a.w + b.w) / 2 + gap - Math.abs(dx);
  const oy = (a.h + b.h) / 2 + gap - Math.abs(dy);
  if (ox <= 0 || oy <= 0) return null;
  return ox / (a.w + b.w) < oy / (a.h + b.h) ? { axis: 'x', d: ox, sign: dx < 0 ? -1 : 1 } : { axis: 'y', d: oy, sign: dy < 0 ? -1 : 1 };
}

// Choque de cajas para d3-force, que solo trae el de círculos. Una palabra es
// una caja apaisada, y con el círculo que la envuelve el mapa quedaría suelto.
function forceBoxes() {
  let list = [];
  function force() {
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j += 1) {
        const b = list[j];
        const c = clash(a, b, a.x + a.vx, a.y + a.vy, b.x + b.vx, b.y + b.vy);
        if (!c) continue;
        const ma = a.fx === undefined ? 1 : 0;
        const mb = b.fx === undefined ? 1 : 0;
        if (!ma && !mb) continue;
        const s = (c.sign * c.d * 0.5) / (ma + mb);
        const v = c.axis === 'x' ? 'vx' : 'vy';
        a[v] -= s * ma;
        b[v] += s * mb;
      }
    }
  }
  force.initialize = (n) => { list = n; };
  return force;
}

// Lo que la simulación deja rozando se aparta a mano, hasta que no se pise
// nada. Con 2 unidades de más, para que al redondear las posiciones ninguna
// pareja se quede por debajo del aire mínimo. Devuelve las parejas cuyas cajas
// se tocan de verdad (dos fijadas a mano una encima de otra). Quedarse por
// debajo del aire no es pisarse.
// Con `walls`, lo libre no puede salirse por arriba ni por la izquierda al
// apartarse. El sitio se gana hacia la derecha y hacia abajo, donde el lienzo
// crece (es lo que hace falta cuando hay palabras fijadas, que no se mueven).
function unclash(list, walls = false) {
  const wall = (n) => {
    if (!walls || n.fx !== undefined) return;
    n.x = Math.max(n.w / 2 + 20, n.x);
    n.y = Math.max(n.h / 2 + 20, n.y);
  };
  for (let round = 0; round < 500; round += 1) {
    let moved = false;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        const c = clash(a, b, a.x, a.y, b.x, b.y, GAP + 2);
        if (!c) continue;
        const ma = a.fx === undefined ? 1 : 0;
        const mb = b.fx === undefined ? 1 : 0;
        if (!ma && !mb) continue;
        const s = (c.sign * c.d) / (ma + mb);
        a[c.axis] -= s * ma;
        b[c.axis] += s * mb;
        wall(a);
        wall(b);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const left = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (clash(list[i], list[j], list[i].x, list[i].y, list[j].x, list[j].y, 0)) left.push([list[i].id, list[j].id]);
    }
  }
  return left;
}

// La distancia de cada línea sale del tamaño de sus dos palabras. Dos grandes
// necesitan más sitio que dos pequeñas para que la línea se vea entre ellas.
const linkDistance = (l) => 0.35 * (l.source.w + l.target.w) + 80;
let sim;
if (!anchored) {
  // Un mapa nuevo va libre alrededor de (0, 0) y después se centra en el
  // lienzo. Tira más hacia el eje vertical que hacia el horizontal porque el
  // mapa se mira en un móvil en vertical, y así sale más alto que ancho.
  sim = forceSimulation(nodes)
    .force('link', forceLink(simLinks).id((d) => d.id).distance(linkDistance).strength(0.5))
    .force('charge', forceManyBody().strength(-900))
    .force('x', forceX(0).strength(0.1))
    .force('y', forceY(0).strength(0.012))
    .force('boxes', forceBoxes())
    .alphaDecay(0.01)
    .stop();
} else {
  // Con posiciones fijas (retocadas a mano o conservadas con --keep) se
  // simula directamente en el lienzo y NADA se reescala, o lo retocado se
  // movería. Cada nuevo empieza junto a sus vecinos ya colocados.
  let seed = 1;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 - 0.5; };
  for (const n of nodes) {
    if (n.fx !== undefined) { n.x = n.fx; n.y = n.fy; continue; }
    const fixed = neighbors.get(n.id).map((id) => byNode.get(id)).filter((m) => m.fx !== undefined);
    const bx = fixed.length ? fixed.reduce((s, m) => s + m.fx, 0) / fixed.length : canvas.width / 2;
    const by = fixed.length ? fixed.reduce((s, m) => s + m.fy, 0) / fixed.length : canvas.height / 2;
    n.x = bx + rnd() * 80;
    n.y = by + rnd() * 80;
  }
  sim = forceSimulation(nodes)
    .force('link', forceLink(simLinks).id((d) => d.id).distance(linkDistance).strength(0.5))
    .force('charge', forceManyBody().strength(-900))
    .force('x', forceX(canvas.width / 2).strength(0.02))
    .force('y', forceY(canvas.height / 2).strength(0.02))
    .force('boxes', forceBoxes())
    .alphaDecay(0.01)
    .stop();
}
while (sim.alpha() > sim.alphaMin()) sim.tick();
const stuck = unclash(nodes);
for (const [a, b] of stuck) warnings.push(`«${byNode.get(a).label}» y «${byNode.get(b).label}» están fijadas a mano una encima de la otra`);

// ---------- Al lienzo ----------
// Las palabras miden lo mismo en cualquier mapa, así que aquí no se escala
// nada. Un mapa nuevo se centra en el lienzo, y si no cabe, el lienzo crece.
const bounds = (list) => ({
  x0: Math.min(...list.map((n) => n.x - n.w / 2)),
  x1: Math.max(...list.map((n) => n.x + n.w / 2)),
  y0: Math.min(...list.map((n) => n.y - n.h / 2)),
  y1: Math.max(...list.map((n) => n.y + n.h / 2)),
});
if (!anchored) {
  const b = bounds(nodes);
  canvas = {
    width: Math.max(W, Math.ceil(b.x1 - b.x0 + 2 * PAD)),
    height: Math.max(H, Math.ceil(b.y1 - b.y0 + 2 * PAD)),
  };
  const dx = canvas.width / 2 - (b.x0 + b.x1) / 2;
  const dy = canvas.height / 2 - (b.y0 + b.y1) / 2;
  for (const n of nodes) { n.x += dx; n.y += dy; }
} else {
  // Lo nuevo no puede salirse por arriba ni por la izquierda, así que se mete
  // dentro. Por la derecha y por abajo, el lienzo crece. (Antes se metía todo
  // en el lienzo de siempre, y con 100 conceptos y una sola palabra fijada a
  // mano, una de cada cinco acababa fuera sin ningún aviso.)
  for (const n of nodes) {
    if (n.fx !== undefined) continue;
    n.x = Math.max(n.w / 2 + 20, n.x);
    n.y = Math.max(n.h / 2 + 20, n.y);
  }
  for (const [a, b] of unclash(nodes, true)) warnings.push(`«${byNode.get(a).label}» y «${byNode.get(b).label}» se pisan al meterlas en el lienzo`);
  const b = bounds(nodes);
  canvas = { width: Math.max(canvas.width, Math.ceil(b.x1 + PAD)), height: Math.max(canvas.height, Math.ceil(b.y1 + PAD)) };
  for (const n of nodes) {
    if (n.x - n.w / 2 < 0 || n.y - n.h / 2 < 0) warnings.push(`«${n.label}» se sale del lienzo por arriba o por la izquierda. Revisa las x e y de la hoja`);
  }
}
const used = bounds(nodes);

const out = {
  version: 2,
  generated: new Date().toISOString(),
  width: canvas.width,
  height: canvas.height,
  font: FONT,          // cuerpo de cada nivel, en unidades del mapa
  advance: ADVANCE,    // ancho de cada letra, en em
  nodes: nodes.map((n) => ({ id: n.id, label: n.label, lv: n.lv, x: Math.round(n.x), y: Math.round(n.y) })),
  links: simLinks.map((l) => [l.source.id, l.target.id]),
};

// ---------- contents.json, concepto ↔ archivo ↔ duración ----------
// La duración vale tal como la escriba cada uno, sea 90, 90s, 90 seg, 1:30,
// 1'30", 2m30, 1 min o 1 min 30 s. «1,30» y «1.30» con dos cifras detrás se
// leen como minutos y segundos (1:30), con un aviso. Antes se leían como 1,3 s
// y el verde se apagaba casi al momento. Lo que no se entiende es un error con
// su línea. Antes se quedaba en 10 s sin decir nada.
function seconds(v, c) {
  const t = String(v ?? '').trim().toLowerCase().replace(/[’′]/g, "'").replace(/[″”]/g, '"');
  if (!t) return NaN;
  let m = t.match(/^(\d+)\s*[:']\s*(\d{1,2})\s*(?:"|'')?$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = t.match(/^(\d+)\s*(?:m|min|mins|minutos?)\s*(?:(\d{1,2})\s*(?:s|seg|segundos?)?)?$/);
  if (m) return Number(m[1]) * 60 + Number(m[2] ?? 0);
  m = t.match(/^(\d+(?:[.,]\d+)?)\s*(?:s|seg|segs|segundos?)?$/);
  if (m) {
    const dec = m[1].match(/^(\d+)[.,](\d{2})$/);
    if (dec && Number(dec[2]) < 60) {
      warnings.push(`conceptos.csv, línea ${c.line}, la duración «${v}» la leo como ${dec[1]}:${dec[2]} (${Number(dec[1]) * 60 + Number(dec[2])} s). Si eran segundos con decimales, escribe ${m[1].replace(',', '.')}s`);
      return Number(dec[1]) * 60 + Number(dec[2]);
    }
    return Number(m[1].replace(',', '.'));
  }
  errors.push(`conceptos.csv, línea ${c.line}, la duración «${v}» no la entiendo, escribe los segundos (90) o minutos y segundos (1:30)`);
  return NaN;
}
for (const c of ids.values()) c.secs = seconds(c.duracion, c);
if (errors.length) fail();
const contents = Object.fromEntries([...ids.values()].map((c) => [c.id, {
  ...(c.archivo ? { archivo: c.archivo } : {}), // lo que busca el servidor en media/
  file: c.file, // lo que había al pasar el layout (la demo). El servidor lo resuelve en vivo
  duration: c.probed || c.secs || 10,
  ...(c.num ? { num: c.num } : {}), // el número de Max. Sin él, Max no lo puede pedir
}]));
if (conceptos.some((c) => c.archivo) && !nums.size) {
  warnings.push('ningún concepto tiene número, así que Max no podrá poner nada en las pantallas. La columna se llama «numero»');
}

writeFileSync(mapPath, JSON.stringify(out));
writeFileSync(join(root, 'public', 'contents.json'), JSON.stringify(contents));

const fresh = nodes.length - byHand - kept;
const per = [1, 2, 3].map((lv) => nodes.filter((n) => n.lv === lv).length);
console.log(`map.json lleva ${out.nodes.length} palabras (${per.join(' / ')} de nivel 1, 2 y 3${byColumn ? ', según la columna «nivel»' : ', según sus relaciones'}), `
  + `${out.links.length} enlaces y pesa ${(JSON.stringify(out).length / 1024).toFixed(1)} kB`
  + (anchored ? `. Hay ${byHand} fijadas a mano, ${kept} conservadas y ${fresh} colocadas ahora` : ''));
console.log(`lienzo ${canvas.width} × ${canvas.height}, las palabras ocupan ${Math.round(used.x1 - used.x0)} × ${Math.round(used.y1 - used.y0)}`
  + `${stuck.length ? '' : ', ninguna pisa a otra'}`);
console.log(`contents.json lleva ${Object.keys(contents).length} contenidos, ${[...ids.values()].filter((c) => c.file).length} con vídeo y ${nums.size} con número para Max`);
if (warnings.length) {
  console.log(`\n${warnings.length === 1 ? 'Hay un aviso' : `Hay ${warnings.length} avisos`}, pero he escrito el mapa igual.`);
  for (const w of warnings) console.log(`  · ${w}`);
}
