// La página de cada pantalla (public/js/screen.js) pasada a una sintaxis que
// entiende un Chrome de antes del 80, como el de una tablet Android que ya no
// se actualiza. Con ese Chrome, screen.js no llega a arrancar y la pantalla se
// queda en negro. screen.html carga esta copia solo si el navegador no entiende
// «?.», así que los demás siguen con screen.js.
//
// Se versiona en git, como vendor.js, y se rehace cada vez que cambia
// screen.js, con npm run screen-viejo o con npm run build. Una prueba avisa si
// se queda atrás.
import { transformSync } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ORIGEN = join(root, 'public', 'js', 'screen.js');
export const DESTINO = join(root, 'public', 'js', 'screen-viejo.js');

// Chrome 51 es lo más viejo a lo que esbuild sabe bajar screen.js (con el 50
// se para en la desestructuración, y las funciones async pasan a generadores).
// El modo estricto va delante, porque un módulo ya lo es y esta copia no.
// Detrás, lo poco que usa screen.js y que llegó después del 51, solo donde
// falta. append (el «toca para activar») y getOwnPropertyDescriptors (lo usa
// esbuild al copiar el vídeo que se pone) llegan en el 54, y padStart (el clip
// simulado) en el 57.
const CABECERA = `// Hecho con scripts/screen-viejo.mjs a partir de screen.js. No se toca a mano.
"use strict";
if (!Element.prototype.append) {
  Element.prototype.append = function () {
    for (var i = 0; i < arguments.length; i += 1) {
      var n = arguments[i];
      this.appendChild(typeof n === "string" ? document.createTextNode(n) : n);
    }
  };
}
if (!Object.getOwnPropertyDescriptors) {
  Object.getOwnPropertyDescriptors = function (o) {
    var r = {};
    Reflect.ownKeys(o).forEach(function (k) { r[k] = Object.getOwnPropertyDescriptor(o, k); });
    return r;
  };
}
if (!String.prototype.padStart) {
  String.prototype.padStart = function (n, c) {
    var s = String(this), f = c === undefined ? " " : String(c);
    while (f && s.length < n) s = f + s;
    return s;
  };
}
`;

// Sin treeShaking, que con format iife esbuild lo enciende solo y quitaría lo
// que no se usa. Así es screen.js tal cual, sin los comentarios.
export function screenViejo(codigo = readFileSync(ORIGEN, 'utf8')) {
  return CABECERA + transformSync(codigo, { format: 'iife', target: 'chrome51', treeShaking: false, legalComments: 'none' }).code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(DESTINO, screenViejo());
  console.log(`screen-viejo.js  ${(readFileSync(DESTINO).length / 1024).toFixed(1)} kB`);
}
