// Empaqueta las dependencias de la web pública en un único fichero local,
// copia las tipografías y rehace la copia de screen.js para los Chrome viejos.
// Se ejecuta con `npm run build`. El resultado (public/js/vendor.js,
// public/js/screen-viejo.js y public/fonts/*) se versiona en git para que la
// web funcione sin paso de build en el ordenador de la sala.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { DESTINO as VIEJO, screenViejo } from './screen-viejo.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'js', 'vendor.js');

await build({
  entryPoints: [join(root, 'src', 'vendor.js')],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  outfile: out,
  legalComments: 'none',
});

// Una sola familia en dos pesos. La web entera está en máquina de escribir.
const fonts = [
  ['@fontsource/space-mono/files/space-mono-latin-400-normal.woff2', 'space-mono-400.woff2'],
  ['@fontsource/space-mono/files/space-mono-latin-700-normal.woff2', 'space-mono-700.woff2'],
];
mkdirSync(join(root, 'public', 'fonts'), { recursive: true });
for (const [src, dst] of fonts) {
  copyFileSync(join(root, 'node_modules', src), join(root, 'public', 'fonts', dst));
}

writeFileSync(VIEJO, screenViejo());

const kb = (p) => (statSync(p).size / 1024).toFixed(1);
const gz = (p) => (gzipSync(readFileSync(p)).length / 1024).toFixed(1);
console.log(`vendor.js  ${kb(out)} kB  (${gz(out)} kB gzip)`);
console.log(`screen-viejo.js  ${kb(VIEJO)} kB`);
for (const [, dst] of fonts) {
  const p = join(root, 'public', 'fonts', dst);
  console.log(`${dst.padEnd(24)} ${kb(p)} kB`);
}
