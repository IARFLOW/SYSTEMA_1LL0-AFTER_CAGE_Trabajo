// Genera docs/demo.html, la web del público en UN solo fichero, sin servidor.
// Lleva incrustados el CSS, las fuentes, d3-zoom, el código y el mapa, y la
// sala se simula en el propio navegador. Sirve para enseñarla en el móvil o
// abrirla con doble clic. Con --fragment escribe además una versión sin
// <html>/<head>/<body> en la ruta indicada (para publicarla como página).
//
//   npm run demo
//   node scripts/demo.mjs --fragment /ruta/salida.html
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = (p) => join(root, 'public', p);
const read = (p) => readFileSync(pub(p), 'utf8');

// 1. El JS, app.js + vendor.js en un único módulo
const bundle = await build({
  entryPoints: [pub('js/app.js')],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  write: false,
  legalComments: 'none',
});
const js = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

// 2. CSS con las fuentes como data URI
const css = read('css/app.css').replace(/url\('\/fonts\/([^']+)'\)/g, (m, f) => {
  const b64 = readFileSync(pub(`fonts/${f}`)).toString('base64');
  return `url('data:font/woff2;base64,${b64}')`;
});

// 3. Marcado del cuerpo, sin el <script> que carga app.js
const html = read('index.html');
const body = html
  .slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
  .replace(/\s*<script type="module" src="\/js\/app.js"><\/script>/, '')
  .trim();

// 4. Datos. Sin servidor no hay carpeta media/, así que cada concepto va con
// su clip simulado aunque en la sala ya tenga MP4, o la demo abriría vídeos
// que no existen y volvería al mapa sin enseñar nada.
const contents = Object.fromEntries(Object.entries(JSON.parse(read('contents.json')))
  .map(([id, c]) => [id, { ...c, file: null }]));
const data = JSON.stringify({
  map: JSON.parse(read('map.json')),
  contents,
}).replace(/<\/script/gi, '<\\/script');

const inner = `<title>Systema 1LL0~ After Cage</title>
<style>
${css}
/* en la demo va todo en un solo fichero, con el alto real del contenedor */
html, body { height: 100%; }
</style>
${body}
<script>window.SYSTEMA_DEMO = ${data};</script>
<script type="module">${js}</script>
`;

const doc = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0c0c0c">
<title>Systema 1LL0~ After Cage</title>
<script>try { if (localStorage.getItem('systema-theme') === 'light') document.documentElement.dataset.theme = 'light'; } catch (e) {}</script>
<style>
${css}
html, body { height: 100%; }
</style>
</head>
<body>
${body}
<script>window.SYSTEMA_DEMO = ${data};</script>
<script type="module">${js}</script>
</body>
</html>
`;

mkdirSync(join(root, 'docs'), { recursive: true });
const out = join(root, 'docs', 'demo.html');
writeFileSync(out, doc);
console.log(`docs/demo.html  ${(doc.length / 1024).toFixed(0)} kB`);

const i = process.argv.indexOf('--fragment');
if (i > -1 && process.argv[i + 1]) {
  writeFileSync(process.argv[i + 1], inner);
  console.log(`fragmento → ${process.argv[i + 1]}`);
}
