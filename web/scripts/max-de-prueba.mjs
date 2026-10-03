// Un Max de mentira que manda al servidor los mismos mensajes OSC que el patch
// de Juanlu, para probar la sala sin tener Max delante.
//
//   npm run max                        la escena de ejemplo de su patch (S01_SCENE1)
//   npm run max -- --bucle             la misma, una y otra vez (para enseñarla)
//   npm run max -- /tele1/video 3      un mensaje suelto
//   npm run max -- escena.txt          una coll de Max guardada como texto, con
//                                      líneas `3, /tele1/video 3;` y tiempos en segundos
//
// Por defecto va a este mismo ordenador, al puerto 9100. A otro, con OSC_HOST.
//   OSC_HOST=192.168.1.20 npm run max      (y OSC_PORT si no es el 9100)
import { existsSync, readFileSync } from 'node:fs';
import { Client } from 'node-osc';

const HOST = process.env.OSC_HOST || '127.0.0.1';
const PORT = Number(process.env.OSC_PORT) || 9100;

// La coll S01_SCENE1 del patch que mandó Juanlu el 27-sep-2026, tal cual.
const EJEMPLO = `
0, /scene 1;
3, /tele1/video 3;
8, /tele2/video 7;
12, /sound 1;
18, /light 0.5;
23, /tele1/video 0;
`;

// Como los manda Max, «3» sale como entero, «0.5» como decimal y lo demás
// como texto.
const value = (s) => (/^-?\d+$/.test(s) || /^-?\d*\.\d+$/.test(s) ? Number(s) : s);

function parseColl(text) {
  const events = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\d+(?:\.\d+)?)\s*,\s*(\/\S*)\s*(.*?)\s*;?\s*$/.exec(line);
    if (!m) { console.error(`la línea ${i + 1} no la entiendo y me la salto · ${line}`); continue; }
    events.push({ time: Number(m[1]), address: m[2], args: m[3] ? m[3].split(/\s+/).map(value) : [] });
  }
  return events.sort((a, b) => a.time - b.time);
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, Math.max(0, ms)); });
const argv = process.argv.slice(2);
const loop = argv.includes('--bucle');
const rest = argv.filter((a) => a !== '--bucle');
// Una ruta de fichero también puede empezar por «/». Si existe, es una coll.
const isFile = rest[0] !== undefined && existsSync(rest[0]);
if (rest[0] !== undefined && !isFile && !rest[0].startsWith('/')) {
  console.error(`no encuentro el fichero ${rest[0]} (y un mensaje OSC empieza por /)`);
  process.exit(1);
}
const client = new Client(HOST, PORT);

if (rest[0] !== undefined && !isFile) {
  await client.send(rest[0], ...rest.slice(1).map(value));
  console.log(`→ ${HOST}:${PORT}  ${rest.join(' ')}`);
} else {
  const events = parseColl(rest[0] ? readFileSync(rest[0], 'utf8') : EJEMPLO);
  if (!events.length) { console.error('no hay nada que mandar'); process.exit(1); }
  // En bucle, cinco segundos de aire antes de volver a empezar.
  const length = events.at(-1).time + 5;
  console.log(`→ ${HOST}:${PORT}  ${rest[0] ?? 'la escena de ejemplo del patch (S01_SCENE1)'}`
    + `${loop ? `, en bucle cada ${length} s (Ctrl+C para parar)` : ''}`);
  do {
    const t0 = Date.now();
    for (const e of events) {
      await sleep(t0 + e.time * 1000 - Date.now());
      await client.send(e.address, ...e.args);
      console.log(`  ${e.time.toFixed(1).padStart(5)} s  ${[e.address, ...e.args].join(' ')}`);
    }
    if (loop) await sleep(t0 + length * 1000 - Date.now());
  } while (loop);
}
await client.close();
