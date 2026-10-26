// Calcula UNA VEZ la posición de las palabras del mapa y escribe
// public/map.json y public/contents.json a partir de las dos hojas de Guille
// y Juanlu. Cada concepto es su palabra, en tres tamaños (columna «nivel»), y
// ninguna pisa a otra porque van en cajas del tamaño real de cada palabra.
//
//   npm run layout                 → lee data/conceptos.csv y data/relaciones.csv
//   npm run layout -- --keep       → conserva las x/y que ya hay en map.json
//                                    (retoques a mano) y solo coloca los nuevos
//   npm run layout -- --enlaces 3  → por sección, proceso y medio, cada concepto
//                                    se une con 3 de su grupo (si no, con 2)
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
//                   en negrita), 2 en los secundarios (en negrita) y 3 en el resto.
//                   «seccion» (T0, T1…), «proceso» (golpe, gota/rebote…) y
//                   «medio» (audio, vídeo…) unen solos a los que comparten algo,
//                   y cada una sale con su línea (continua, discontinua y
//                   punteada). Una celda puede llevar varios, con comas
//   relaciones.csv  origen, destino (por id o por etiqueta), para unir dos a mano
//
// Las filas con la misma etiqueta son una sola palabra con varios vídeos, y el
// móvil del público pone uno al azar (ver «Palabras, una por etiqueta»).
//
// Un vídeo de media/ que se llame «número_Etiqueta_Sección_Proceso»
// (101_Piedra_T0_G.mp4) y no esté en la hoja se añade a conceptos.csv con esas
// columnas rellenas (ver «Lo que dice el nombre de cada vídeo»).
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
const enlacesArg = process.argv.indexOf('--enlaces');
const enlaces = enlacesArg === -1 ? 2 : Number(process.argv[enlacesArg + 1]);
if (!Number.isInteger(enlaces) || enlaces < 1 || enlaces > 20) {
  console.error('--enlaces va con un número del 1 al 20, por ejemplo npm run layout -- --enlaces 3');
  process.exit(1);
}
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

// El separador es el que más aparece en la cabecera.
function separador(text) {
  const head = text.split(/\r?\n/, 1)[0];
  const times = (ch) => head.split(ch).length - 1;
  return [',', ';', '\t'].reduce((a, b) => (times(b) > times(a) ? b : a));
}

function parseCsv(text) {
  const sep = separador(text);
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
  seccion: 'seccion', secciones: 'seccion', section: 'seccion', apartado: 'seccion',
  proceso: 'proceso', procesos: 'proceso', familia: 'proceso', familias: 'proceso',
  'proceso sonoro': 'proceso', 'tipo de proceso': 'proceso',
  medio: 'medio', medios: 'medio', 'tipo de medio': 'medio', soporte: 'medio',
};
const KNOWN = {
  'conceptos.csv': ['id', 'etiqueta', 'archivo', 'duracion', 'numero', 'nivel', 'seccion', 'proceso', 'medio', 'x', 'y'],
  'relaciones.csv': ['origen', 'destino'],
};

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

let conceptos = sheet('conceptos.csv', ['etiqueta']);
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

const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
// Los vídeos se comparan sin mirar mayúsculas ni cómo se guardó la tilde,
// porque el Finder y los zip guardan «á» como «a» más el acento (NFD), y la
// hoja no.
const mediaDir = join(root, 'media');
const listing = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith('.')) : []);
const key = (f) => f.normalize('NFC').toLowerCase();

// ---------- Lo que dice el nombre de cada vídeo ----------
// Un vídeo de media/ (o de sus versiones) que se llame
// «número_Etiqueta_Sección_Proceso», como 101_Piedra_T0_G.mp4, y no esté en
// la hoja se añade al final de conceptos.csv con esas columnas rellenas. Así
// no se escribe dos veces lo mismo (lo pidió Juanlu el 20-10-2026, con unos
// 80 audios). La sección y el proceso pueden faltar, y la etiqueta lleva
// espacios y tildes, pero no «_», que es lo que separa las partes. Las filas
// que ya hay no se tocan, porque manda lo que diga la hoja.
const DE_NOMBRE = /^(\d+)_([^_]+)(?:_([^_]+))?(?:_([^_]+))?$/;
// Con «Unique Suffix», TouchDesigner deja detrás «.mov.0» («particulas
// prueba.mov.0.mov» llegó así el 22-10-2026), y la sección salía «T0.mov.0».
// Se quita solo para leer las partes. El archivo sigue con su nombre de
// verdad, que es el que busca el servidor.
const SUFIJO_TD = /(?:\.(?:mov|mp4|m4v))*\.\d+$/i;
function porNombre() {
  const enHoja = new Set(conceptos.filter((c) => c.archivo).map((c) => key(c.archivo.replace(/\.[^.]+$/, ''))));
  const usados = new Map();   // número de Max → quién lo tiene
  const sinArchivo = new Set();   // números cuya fila no dice qué vídeo es
  for (const c of conceptos) {
    const n = Number(String(c.numero ?? '').replace(',', '.'));
    if (c.numero && Number.isInteger(n)) {
      usados.set(n, c.id || slug(c.etiqueta));
      if (c.archivo) sinArchivo.delete(n); else sinArchivo.add(n);
    }
  }
  const tomados = new Set(conceptos.map((c) => c.id || slug(c.etiqueta)));
  // Cada vídeo una vez, esté en media/ o solo en sus versiones.
  const vistos = new Map();
  for (const dir of ['', 'movil', 'tablet', 'monitor']) {
    for (const f of listing(join(mediaDir, dir))) {
      if (!/\.(mp4|m4v|mov|webm)$/i.test(f)) continue;
      const base = f.normalize('NFC').replace(/\.[^.]+$/, '');
      if (!vistos.has(key(base))) vistos.set(key(base), { base, archivo: dir ? `${base}.mp4` : f.normalize('NFC') });
    }
  }
  const nuevas = [];
  const orden = [...vistos].sort(([a], [b]) => a.localeCompare(b, 'es', { numeric: true }));
  for (const [k, { base, archivo }] of orden) {
    if (enHoja.has(k)) continue;
    const limpio = base.replace(SUFIJO_TD, '');
    const m = DE_NOMBRE.exec(limpio);
    // Empieza por un número, así que iba para la hoja, pero tiene más partes
    // de la cuenta. Antes se saltaba sin decir nada.
    if (!m && /^\d+_/.test(limpio)) {
      warnings.push(`${archivo} no lo añado a la hoja, porque no lo leo como número_Etiqueta_Sección_Proceso. `
        + 'La etiqueta no puede llevar «_», que es lo que separa las partes. Usa espacios, como en 213_Gran Bosque_T2_G');
    }
    if (!m) continue;
    const n = Number(m[1]);
    const etiqueta = m[2].trim();
    if (!etiqueta || n < 1) continue;
    if (usados.has(n)) {
      const falta = sinArchivo.has(n) ? `, pero esa fila no tiene archivo. Si es este vídeo, escribe ${archivo} en su columna archivo` : '';
      warnings.push(`${archivo} no lo añado a la hoja, porque el ${n} ya lo tiene «${usados.get(n)}»${falta}`);
      continue;
    }
    // Con las cuatro partes y una sección que no es T0, T1…, lo normal es que
    // la etiqueta lleve un «_» y todo se haya corrido un sitio.
    if (m[4] !== undefined && !/^T\d+$/i.test(m[3].trim())) {
      warnings.push(`${archivo} lo añado con la sección «${m[3].trim()}», que no es como T0 o T1. `
        + 'Si la etiqueta lleva «_», cámbialo por un espacio (213_Gran Bosque_T2_G)');
    }
    let id = slug(etiqueta) || `concepto_${n}`;
    if (tomados.has(id)) id = `${id}_${n}`;
    tomados.add(id);
    usados.set(n, id);
    nuevas.push({ id, etiqueta, archivo, numero: String(n), seccion: (m[3] ?? '').trim(), proceso: (m[4] ?? '').trim() });
  }
  return nuevas;
}

// Las filas nuevas van al final de la hoja, como la guardó su programa (el
// separador, los saltos de línea y la marca de UTF-8 del principio). Las
// columnas que falten van al final de la cabecera, y las filas de antes, que
// no las tienen, se leen vacías.
function escribirFilas(nuevas) {
  const path = join(root, 'data', 'conceptos.csv');
  const buf = readFileSync(path);
  const texto = decode(buf);
  let utf8 = !((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff));
  if (utf8) { try { new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { utf8 = false; } }
  const marca = !utf8 || (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf);
  const salto = texto.includes('\r\n') ? '\r\n' : (texto.includes('\r') && !texto.includes('\n') ? '\r' : '\n');
  const sep = separador(texto);
  const fin = texto.search(/\r\n|\r|\n/);
  const cabecera = fin === -1 ? texto : texto.slice(0, fin);
  let resto = fin === -1 ? '' : texto.slice(fin);
  if (!/(\r\n|\r|\n)$/.test(resto)) resto += salto;
  const cols = parseCsv(cabecera)[0].cells.map((h) => ALIAS[norm(h)] ?? norm(h));
  const faltan = ['id', 'etiqueta', 'archivo', 'numero', 'seccion', 'proceso'].filter((c) => !cols.includes(c) && nuevas.some((f) => f[c]));
  const todas = [...cols, ...faltan];
  const celda = (v) => (/["\r\n]|^\s|\s$/.test(v) || v.includes(sep) ? `"${v.replace(/"/g, '""')}"` : v);
  const filas = nuevas.map((f) => todas.map((c) => celda(f[c] ?? '')).join(sep) + salto).join('');
  writeFileSync(path, (marca ? '\ufeff' : '') + cabecera + faltan.map((c) => sep + c).join('') + resto + filas);
  if (!utf8) warnings.push('conceptos.csv iba en una codificación antigua, y al añadirle filas la he guardado en UTF-8, que Excel y Numbers abren igual');
}

const nuevas = porNombre();
if (nuevas.length) {
  escribirFilas(nuevas);
  const lista = nuevas.map((f) => `${f.etiqueta} (${f.numero})`);
  console.log(`añado ${nuevas.length} a conceptos.csv, con lo que dice el nombre de su vídeo: ${lista.slice(0, 12).join(', ')}${lista.length > 12 ? ` y ${lista.length - 12} más` : ''}`);
  // Leída otra vez, la hoja repetiría los avisos de la primera.
  const avisos = warnings.length;
  conceptos = sheet('conceptos.csv', ['etiqueta']);
  warnings.length = avisos;
  if (errors.length) fail();
}

// ---------- Conceptos ----------
// Desde este número, Max lo puede poner en una pantalla, pero no sale en el
// mapa del público. Es para las partituras de los músicos (901_Partitura
// 1_P.mov y así), que se piden por número y no son palabras (lo pidió Juanlu el
// 26-10-2026, para el concierto del 29). Van en contents.json, que es de donde
// saca el servidor los números, y en map.json no.
const SOLO_MAX = 900;
const ids = new Map();
const byLabel = new Map();
const nums = new Map();
const soloMax = new Map();   // id y etiqueta → fila, para explicar una relación con ellas
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
  if (c.num >= SOLO_MAX) {
    soloMax.set(c.id, c);
    soloMax.set(norm(c.etiqueta), c);
    continue;
  }
  // Las filas con la misma etiqueta son una sola palabra en el mapa con varios
  // vídeos, uno por fila, cada uno con su número para Max (lo pidió Guille el
  // 22-10-2026, con el mismo concepto visto desde varias pantallas). La
  // palabra lleva el id de la primera fila. Hasta entonces salía la misma
  // palabra repetida, una por fila.
  if (!byLabel.has(norm(c.etiqueta))) {
    byLabel.set(norm(c.etiqueta), c.id);
    c.filas = [c];
  } else ids.get(byLabel.get(norm(c.etiqueta))).filas.push(c);
  // Nivel 1 para los conceptos principales, 2 los secundarios y 3 el resto.
  if (c.nivel) {
    const lv = Number(c.nivel);
    if ([1, 2, 3].includes(lv)) c.lv = lv;
    else errors.push(`conceptos.csv, línea ${c.line}, el nivel «${c.nivel}» tiene que ser 1 (principal), 2 o 3`);
  }
}

// ---------- Palabras, una por etiqueta ----------
// Cada palabra del mapa es su primera fila, con todas las de su etiqueta en
// «filas». Lo que va al mapa (relaciones, nivel, posición) es de la palabra,
// y lo que va a las pantallas (número, vídeo, duración) sigue siendo de cada
// fila. El nivel es el más importante de sus filas, y la posición fijada a
// mano, la de la primera que la tenga.
const palabras = [...ids.values()].filter((c) => c.filas);
const palabraDe = new Map();
for (const p of palabras) {
  for (const f of p.filas) palabraDe.set(f.id, p.id);
  const lvs = p.filas.map((f) => f.lv).filter(Boolean);
  if (lvs.length) p.lv = Math.min(...lvs);
}

// ---------- Relaciones, por id o por etiqueta ----------
// Una relación con el id de cualquier fila, o con la etiqueta, va a su palabra.
const resolve = (v) => palabraDe.get(ids.has(v) ? v : byLabel.get(norm(v)));
const seen = new Set();
const links = [];
for (const r of relaciones) {
  if (!r.origen || !r.destino) {
    errors.push(`relaciones.csv, línea ${r.line}, falta ${!r.origen && !r.destino ? 'el origen y el destino' : !r.origen ? 'el origen' : 'el destino'}`);
    continue;
  }
  const a = resolve(r.origen);
  const b = resolve(r.destino);
  // Con una partitura no es un error que pare el mapa, porque la fila está
  // bien. Solo que no hay palabra que unir.
  const fuera = [!a && r.origen, !b && r.destino].map((v) => v && (soloMax.get(v) ?? soloMax.get(norm(v)))).find(Boolean);
  if (fuera) {
    warnings.push(`relaciones.csv, línea ${r.line}, «${fuera.etiqueta}» lleva el ${fuera.num}, y desde el ${SOLO_MAX} no sale en el mapa, así que esa relación no la pinto`);
    continue;
  }
  if (!a || !b) {
    const which = [!a && `«${r.origen}»`, !b && `«${r.destino}»`].filter(Boolean).join(' ni ');
    errors.push(`relaciones.csv, línea ${r.line}, no hay ningún concepto ${which}`);
    continue;
  }
  if (a === b) {
    errors.push(`relaciones.csv, línea ${r.line}, ${r.origen === r.destino ? `«${r.origen}» se une consigo mismo` : `«${r.origen}» y «${r.destino}» son la misma palabra «${ids.get(a).etiqueta}»`}`);
    continue;
  }
  const key = [a, b].sort().join('|');
  if (seen.has(key)) { warnings.push(`relaciones.csv, línea ${r.line}, la relación entre ${a} y ${b} está repetida y cuenta una vez`); continue; }
  seen.add(key);
  links.push({ source: a, target: b });
}
if (errors.length) fail();
const aMano = links.length;

// ---------- Relaciones por sección, por proceso y por medio ----------
// A cada concepto se le pone su sección (T0, T1…), su proceso (golpe,
// gota/rebote, ciclo…) y su medio (audio, vídeo…), y de ahí salen solas las
// líneas entre los que comparten algo. No se une cada uno con todos los de su
// grupo, que con 30 en una sección serían 435 líneas, sino con «enlaces» de
// ellos como mucho (2 si no se dice), y sale como una nube. Las parejas se
// recorren en el orden de una huella de cada una, no al azar, y se une la que
// todavía tiene sitio en los dos. Así, con la misma hoja sale siempre lo
// mismo, y un concepto nuevo apenas cambia las líneas de los demás. El que se
// quede sin ninguna se une con el que menos lleve, aunque ese pase del tope,
// porque una palabra suelta de su sección parecería una errata. Una celda puede llevar varios,
// separados por comas («golpe, ciclo»), y la barra va dentro del nombre
// («gota/rebote» es uno). Mayúsculas y tildes dan igual («T1» y «t1» son la
// misma sección). Una pareja que ya está unida no se repite. Gana la de
// relaciones.csv, y si no, la sección, luego el proceso y luego el medio.
const TIPOS = { seccion: 'la sección', proceso: 'el proceso', medio: 'el medio' };
const porTipo = { seccion: 0, proceso: 0, medio: 0 };
const huella = (s) => createHash('sha1').update(s).digest().readUInt32BE(0);
for (const tipo of Object.keys(TIPOS)) {
  const grupos = new Map();
  // Una palabra con varias filas está en el grupo de cualquiera de ellas.
  for (const p of palabras) {
    for (const v of p.filas.flatMap((f) => (f[tipo] ?? '').split(',')).map((x) => x.trim()).filter(Boolean)) {
      const k = norm(v);
      if (!grupos.has(k)) grupos.set(k, { nombre: v, miembros: [] });
      const g = grupos.get(k);
      if (!g.miembros.includes(p.id)) g.miembros.push(p.id);
    }
  }
  for (const [k, { nombre, miembros }] of grupos) {
    if (miembros.length < 2) {
      warnings.push(`«${ids.get(miembros[0]).etiqueta}» es el único con ${TIPOS[tipo]} «${nombre}», así que por ahí no se une con nadie. Si es una errata, mira cómo está escrito en los demás`);
      continue;
    }
    const parejas = [];
    for (let i = 0; i < miembros.length; i += 1) {
      for (let j = i + 1; j < miembros.length; j += 1) {
        const [a, b] = [miembros[i], miembros[j]].sort();
        parejas.push({ a, b, h: huella(`${tipo}|${k}|${a}|${b}`) });
      }
    }
    parejas.sort((x, y) => x.h - y.h || (`${x.a}|${x.b}` < `${y.a}|${y.b}` ? -1 : 1));
    // Las que ya une otra cosa cuentan, que una pareja no se pinta dos veces.
    const lleva = new Map(miembros.map((id) => [id, 0]));
    for (const { a, b } of parejas) {
      if (seen.has(`${a}|${b}`)) { lleva.set(a, lleva.get(a) + 1); lleva.set(b, lleva.get(b) + 1); }
    }
    const unir = (a, b) => {
      seen.add(`${a}|${b}`);
      links.push({ source: a, target: b, tipo });
      porTipo[tipo] += 1;
      lleva.set(a, lleva.get(a) + 1);
      lleva.set(b, lleva.get(b) + 1);
    };
    for (const { a, b } of parejas) {
      if (!seen.has(`${a}|${b}`) && lleva.get(a) < enlaces && lleva.get(b) < enlaces) unir(a, b);
    }
    for (const id of miembros) {
      if (lleva.get(id)) continue;
      const suyas = parejas.filter((x) => (x.a === id || x.b === id) && !seen.has(`${x.a}|${x.b}`));
      const otro = (x) => (x.a === id ? x.b : x.a);
      const p = suyas.reduce((m, x) => (!m || lleva.get(otro(x)) < lleva.get(otro(m)) ? x : m), null);
      if (p) unir(p.a, p.b);
    }
  }
}

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
// Se compara sin mirar mayúsculas ni cómo se guardó la tilde (ver «key»).
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
  // En media/ el servidor solo pone .mp4, por su nombre o con .mp4 en vez de
  // su extensión. Un .mov suelto ahí contaba aquí como vídeo y en la sala no
  // salía.
  const suelto = onDisk.get(key(c.archivo));
  const plain = [suelto, onDisk.get(key(`${base}.mp4`))].find((f) => f && /\.mp4$/i.test(f));
  const [folder, name] = inVersion ?? (plain ? [null, plain] : [null, null]);
  if (!name && suelto) {
    warnings.push(`«${c.id}» lleva ${suelto}, que está en media/, pero el servidor solo pone .mp4. Mételo en masters/ y pasa npm run versiones`);
    continue;
  }
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
const degree = new Map(palabras.map((p) => [p.id, 0]));
const neighbors = new Map(palabras.map((p) => [p.id, []]));
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
const byColumn = palabras.some((c) => c.lv);
palabras.map((c, i) => ({ c, i }))
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
const nodes = palabras.map((p) => {
  const n = { id: p.id, label: p.etiqueta, lv: p.lv, ...wordBox(p.etiqueta, p.lv) };
  if (p.filas.length > 1) n.videos = p.filas.map((f) => f.id);
  const c = p.filas.find((f) => Number.isFinite(num(f.x)) && Number.isFinite(num(f.y))) ?? p;
  const hx = num(c.x);
  const hy = num(c.y);
  if (Number.isFinite(hx) && Number.isFinite(hy)) {
    if (hx < 0 || hx > canvas.width || hy < 0 || hy > canvas.height) {
      warnings.push(`conceptos.csv, línea ${c.line}, «${c.id}» en (${hx}, ${hy}) cae fuera del lienzo (${canvas.width} × ${canvas.height})`);
    }
    Object.assign(n, { fx: hx, fy: hy });
    byHand += 1;
  } else if (previous.has(p.id)) {
    Object.assign(n, { fx: previous.get(p.id).x, fy: previous.get(p.id).y });
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
// Las de relaciones.csv y las de la sección juntan las palabras, y así cada
// sección sale como una isla. Las del proceso tiran menos, y las del medio
// casi nada, porque unen palabras de todas las secciones y apelotonarían el
// mapa entero. Se pintan igual, solo cambia cuánto acercan.
const TIRA = { seccion: 0.5, proceso: 0.15, medio: 0.03 };
const linkStrength = (l) => TIRA[l.tipo] ?? 0.5;
let sim;
if (!anchored) {
  // Un mapa nuevo va libre alrededor de (0, 0) y después se centra en el
  // lienzo. Tira más hacia el eje vertical que hacia el horizontal porque el
  // mapa se mira en un móvil en vertical, y así sale más alto que ancho.
  sim = forceSimulation(nodes)
    .force('link', forceLink(simLinks).id((d) => d.id).distance(linkDistance).strength(linkStrength))
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
    .force('link', forceLink(simLinks).id((d) => d.id).distance(linkDistance).strength(linkStrength))
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
  // «videos» va solo en las palabras con más de una fila, con el id de cada
  // una. El móvil pone una de ellas al azar.
  nodes: nodes.map((n) => ({ id: n.id, label: n.label, lv: n.lv, x: Math.round(n.x), y: Math.round(n.y), ...(n.videos ? { videos: n.videos } : {}) })),
  // Las de sección, proceso y medio llevan su tipo detrás, que es lo que
  // decide su línea. Las de relaciones.csv van como siempre, sin tipo.
  links: simLinks.map((l) => (l.tipo ? [l.source.id, l.target.id, l.tipo] : [l.source.id, l.target.id])),
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
  + `${out.links.length} enlaces${aMano < out.links.length ? ` (${aMano} a mano, ${porTipo.seccion} por sección, ${porTipo.proceso} por proceso y ${porTipo.medio} por medio)` : ''} y pesa ${(JSON.stringify(out).length / 1024).toFixed(1)} kB`
  + (anchored ? `. Hay ${byHand} fijadas a mano, ${kept} conservadas y ${fresh} colocadas ahora` : ''));
console.log(`lienzo ${canvas.width} × ${canvas.height}, las palabras ocupan ${Math.round(used.x1 - used.x0)} × ${Math.round(used.y1 - used.y0)}`
  + `${stuck.length ? '' : ', ninguna pisa a otra'}`);
const partituras = [...ids.values()].filter((c) => c.num >= SOLO_MAX).length;
console.log(`contents.json lleva ${Object.keys(contents).length} contenidos, ${[...ids.values()].filter((c) => c.file).length} con vídeo y ${nums.size} con número para Max`
  + (partituras ? `. De ellos, ${partituras === 1 ? 'uno es' : `${partituras} son`} del ${SOLO_MAX} en adelante, que solo pone Max y no salen en el mapa` : ''));
const varias = palabras.filter((p) => p.filas.length > 1);
if (varias.length) {
  console.log(`${varias.length === 1 ? 'una palabra lleva' : `${varias.length} palabras llevan`} varios vídeos. Sale una sola vez en el mapa, `
    + 'cada vídeo va a la pantalla con su número y el móvil del público pone uno al azar:');
  for (const p of varias) console.log(`  · «${p.etiqueta}», ${p.filas.length} vídeos (${p.filas.map((f) => f.num ?? `${f.id}, sin número`).join(', ')})`);
}
if (warnings.length) {
  console.log(`\n${warnings.length === 1 ? 'Hay un aviso' : `Hay ${warnings.length} avisos`}, pero he escrito el mapa igual.`);
  for (const w of warnings) console.log(`  · ${w}`);
}
