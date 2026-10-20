// Una hoja con un QR por pantalla, para no teclear la dirección en cada
// móvil. Salió para los 10 móviles de los músicos del 29-oct-2026, que abren
// su vídeo-partitura como una pantalla más (/screen/musico1…), pero vale
// para cualquier pantalla con nombre (un iPad que hace de tele, por ejemplo).
//
//   npm run qr-pantallas -- --web http://192.168.0.10/ --musicos 10
//                       musico1 hasta musico10, con la versión «movil» de los
//                       vídeos, que pesa menos de la mitad que la «tablet» que
//                       cogería un móvil (2,2 Mbps frente a 5). Diez partituras
//                       de 20 minutos a la vez, con el público en la misma Wi-Fi
//   npm run qr-pantallas -- --web http://192.168.0.10/ tele1 monitor2
//                       las que se digan, con su nombre de Max
//   npm run qr-pantallas -- … --version tablet            otra versión (movil, tablet o
//                       monitor), o «ninguna» para que la elija cada aparato
//   npm run qr-pantallas -- … --salida otra/carpeta       carteles/ por defecto
//
// La dirección es la del Mac en la red de la sala, con el puerto si no es el
// 80. El router de la sala no da nombres, así que va con la IP.
//
// Deja en carteles/ la hoja en HTML (se abre e imprime desde cualquier
// navegador, con la letra dentro) y, si encuentra Chrome, también en PDF.
// Además, cada QR suelto en SVG. Caben 10 por hoja, y con más salen más hojas.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svgDeQr, esc, fuentes, TILDE, chrome, imprimir } from './carteles.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const POR_HOJA = 10;

export const TEXTOS = {
  titulo: 'las pantallas',
  pie: [
    'cada móvil escanea el suyo con la cámara y se le abre su página',
    'antes, el móvil en la wifi de la sala y sin bloqueo automático, que si no se apaga a mitad',
    'si el vídeo lleva sonido, toca la pantalla una vez al abrirla',
  ],
};

function opciones(argv) {
  const o = { web: null, nombres: [], salida: join(root, 'carteles'), version: undefined, musicos: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = argv[i + 1];
    const toma = () => { if (v === undefined) fallar(`falta el valor de ${a}`); i += 1; return v; };
    if (a === '--web') o.web = toma();
    else if (a === '--musicos') {
      const n = Number(toma());
      if (!Number.isInteger(n) || n < 1 || n > 99) fallar('--musicos es cuántos, de 1 a 99');
      for (let k = 1; k <= n; k += 1) o.nombres.push(`musico${k}`);
      o.musicos = true;
    } else if (a === '--version') {
      o.version = toma().toLowerCase();
      if (!['movil', 'tablet', 'monitor', 'ninguna'].includes(o.version)) fallar('--version es movil, tablet, monitor o ninguna');
    } else if (a === '--salida') o.salida = resolve(toma());
    else if (a.startsWith('--')) fallar(`no conozco la opción ${a}`);
    else o.nombres.push(a);
  }
  if (!o.web) fallar('falta la dirección del Mac en la sala, por ejemplo --web http://192.168.0.10/');
  let url;
  try { url = new URL(o.web); } catch { fallar(`la dirección no vale (${o.web})`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') fallar(`la dirección tiene que empezar por http:// (${o.web})`);
  if (!o.nombres.length) fallar('faltan las pantallas, por ejemplo --musicos 10 o tele1 tele2');
  // El mismo criterio que el servidor (screenName), en minúsculas.
  o.nombres = o.nombres.map((n) => n.toLowerCase());
  const malo = o.nombres.find((n) => !/^[a-z0-9_-]{1,32}$/.test(n));
  if (malo) fallar(`el nombre «${malo}» no vale, solo letras sin tilde, números, - y _`);
  const repe = o.nombres.find((n, i) => o.nombres.indexOf(n) !== i);
  if (repe) fallar(`«${repe}» sale dos veces`);
  o.url = url;
  if (o.version === undefined) o.version = o.musicos ? 'movil' : 'ninguna';
  if (o.version === 'ninguna') o.version = null;
  return o;
}

function fallar(texto) {
  console.error(`no puedo hacer la hoja de QR, ${texto}`);
  process.exit(1);
}

// La dirección de cada pantalla, sobre la del Mac, y con la versión de los
// vídeos si se dice (la lee screen.js).
export function direccion(url, nombre, version = null) {
  const u = new URL(`screen/${nombre}`, url.href.endsWith('/') ? url.href : `${url.href}/`);
  if (version) u.searchParams.set('version', version);
  return u.href;
}

// La dirección va en dos líneas, el Mac y la página, para que no se parta a
// mitad de palabra. En el registro de los carteles (Space Mono, regla punteada, marcas de
// esquina), en papel blanco y tinta negra.
function hoja(grupos) {
  const pagina = (pantallas) => `<section class="hoja">
<i class="marca si"></i><i class="marca sd"></i><i class="marca ii"></i><i class="marca id"></i>
<p class="marca-obra"><span>SYSTEMA 1LL0${TILDE}</span><span class="sub">after cage</span></p>
<hr class="regla">
<p class="titulo">${esc(TEXTOS.titulo)}</p>
<div class="rejilla">${pantallas.map(({ nombre, href, qr }) => `<figure class="qr">${qr}<figcaption><b>${esc(nombre)}</b><span>${esc(new URL(href).origin)}</span><span>${esc(new URL(href).pathname)}</span></figcaption></figure>`).join('')}</div>
<hr class="regla">
<ul class="pie">${TEXTOS.pie.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
</section>`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Systema 1LL0~ · ${esc(TEXTOS.titulo)}</title>
<style>
${fuentes()}
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; color: #000; font-family: 'Space Mono', monospace; }
.hoja { position: relative; width: 210mm; height: 297mm; padding: 16mm 18mm; display: flex; flex-direction: column; break-after: page; }
.hoja:last-child { break-after: auto; }
.marca { position: absolute; width: 6mm; height: 6mm; border: 0 solid #000; }
.marca.si { top: 8mm; left: 8mm; border-top-width: .3mm; border-left-width: .3mm; }
.marca.sd { top: 8mm; right: 8mm; border-top-width: .3mm; border-right-width: .3mm; }
.marca.ii { bottom: 8mm; left: 8mm; border-bottom-width: .3mm; border-left-width: .3mm; }
.marca.id { bottom: 8mm; right: 8mm; border-bottom-width: .3mm; border-right-width: .3mm; }
.marca-obra { margin: 0; font-weight: 700; font-size: 14pt; letter-spacing: .02em; display: flex; align-items: baseline; gap: .5em; }
.marca-obra .sub { font-weight: 400; font-size: .75em; letter-spacing: .08em; }
.tilde { width: 1.1em; height: .5em; vertical-align: baseline; }
.regla { border: 0; border-top: .35mm dotted #000; margin: 5mm 0; }
.titulo { margin: 0 0 4mm; font-size: 24pt; line-height: 1; font-weight: 700; }
.rejilla { flex: 1; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(5, 1fr); gap: 3mm 10mm; min-height: 0; }
.qr { margin: 0; display: flex; align-items: center; gap: 4mm; min-height: 0; }
/* 38 mm se leen bien con el móvil en la mano. */
.qr svg { width: 38mm; height: 38mm; flex: none; display: block; }
.qr figcaption { display: flex; flex-direction: column; min-width: 0; }
.qr b { font-size: 16pt; margin-bottom: 1.5mm; }
.qr span { font-size: 7.5pt; word-break: break-all; }
.pie { margin: 0; padding: 0; list-style: none; font-size: 10pt; line-height: 1.45; }
</style>
</head>
<body>
${grupos.map(pagina).join('\n')}
</body>
</html>
`;
}

async function main() {
  const o = opciones(process.argv.slice(2));
  mkdirSync(o.salida, { recursive: true });
  const pantallas = o.nombres.map((nombre) => {
    const href = direccion(o.url, nombre, o.version);
    const qr = svgDeQr(href);
    writeFileSync(join(o.salida, `qr-${nombre}.svg`), qr);
    return { nombre, href, qr };
  });
  const grupos = [];
  for (let i = 0; i < pantallas.length; i += POR_HOJA) grupos.push(pantallas.slice(i, i + POR_HOJA));
  const html = join(o.salida, 'qr-pantallas.html');
  writeFileSync(html, hoja(grupos));
  const c = chrome();
  if (c) await imprimir(c, html, join(o.salida, 'qr-pantallas.pdf'));
  console.log(`la hoja está en ${o.salida}`);
  console.log(`  qr-pantallas     ${pantallas.length} pantallas en ${grupos.length === 1 ? '1 hoja' : `${grupos.length} hojas`}, de ${pantallas[0].href} a ${pantallas.at(-1).href}`);
  if (o.version) console.log(`  con la versión «${o.version}» de los vídeos`);
  console.log(c ? '  en HTML y en PDF, y cada QR suelto en SVG' : '  en HTML (sin Chrome no sale el PDF, se imprime desde el navegador), y cada QR suelto en SVG');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => fallar(e.message));
}
