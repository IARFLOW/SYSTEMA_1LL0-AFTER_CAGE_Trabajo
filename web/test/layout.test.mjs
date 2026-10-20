// Pruebas de `npm run layout`, el paso con el que Guille y Juanlu pasan sus
// hojas al mapa. Van hojas como las guardaría cada uno (columnas con otro
// nombre, duraciones escritas de cualquier manera, etiquetas repetidas,
// UTF-16), y se mira que los errores digan qué pasa y en qué línea. Cada una
// en su carpeta (RAIZ).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/layout.mjs', import.meta.url));
// Todas las hojas de prueba, dentro de una carpeta que se borra al acabar.
const todas = mkdtempSync(join(tmpdir(), 'systema-layout-'));
after(() => rmSync(todas, { recursive: true, force: true }));

function hoja({ conceptos, relaciones = 'origen,destino\n', media = {} }) {
  const raiz = mkdtempSync(join(todas, 'hoja-'));
  for (const d of ['data', 'public', 'media']) mkdirSync(join(raiz, d));
  writeFileSync(join(raiz, 'data', 'conceptos.csv'), conceptos);
  writeFileSync(join(raiz, 'data', 'relaciones.csv'), relaciones);
  for (const [name, bytes] of Object.entries(media)) {
    mkdirSync(join(raiz, 'media', name, '..'), { recursive: true });
    writeFileSync(join(raiz, 'media', name), bytes);
  }
  return raiz;
}
const layout = (raiz, ...args) => spawnSync(process.execPath, [script, ...args], { env: { ...process.env, RAIZ: raiz }, encoding: 'utf8' });
const leer = (raiz, f) => JSON.parse(readFileSync(join(raiz, 'public', f), 'utf8'));

test('con una hoja normal salen el mapa, los números de Max y el archivo para el servidor', () => {
  const raiz = hoja({ conceptos: 'id,etiqueta,archivo,duracion,numero\nsilencio,Silencio,Silencio.mov,12,1\nruido,Ruido,,9,2\n', relaciones: 'origen,destino\nsilencio,ruido\n' });
  const r = layout(raiz);
  assert.equal(r.status, 0, r.stderr);
  const c = leer(raiz, 'contents.json');
  assert.equal(c.silencio.archivo, 'Silencio.mov', 'el servidor busca este nombre en media/');
  assert.equal(c.silencio.num, 1);
  assert.equal(c.ruido.duration, 9);
  assert.equal(leer(raiz, 'map.json').nodes.length, 2);
});

test('«Nº vídeo» o «duración (s)» valen; una columna que no se conoce se avisa', () => {
  const raiz = hoja({ conceptos: 'Etiqueta;Nº vídeo;Duración (s);Notas\nSilencio;1;12;para la entrada\nRuido;2;9;\n' });
  const r = layout(raiz);
  assert.equal(r.status, 0, r.stderr);
  const c = leer(raiz, 'contents.json');
  assert.equal(c.silencio.num, 1);
  assert.equal(c.silencio.duration, 12);
  assert.match(r.stdout, /no conozco la columna «Notas»/);
});

test('una columna «video» con números se explica, y dos columnas para lo mismo son un error', () => {
  let r = layout(hoja({ conceptos: 'etiqueta,video\nSilencio,1\nRuido,2\n' }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /solo trae números.*llámala «numero»/s);
  r = layout(hoja({ conceptos: 'etiqueta,archivo,video\nSilencio,a.mp4,b.mp4\n' }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /«archivo» y «video» valen las dos para «archivo»/);
});

test('las duraciones, escritas de cualquier manera', () => {
  const raiz = hoja({ conceptos: 'id,etiqueta,duracion\na,A,90\nb,B,1:30\nc,C,45s\nd,D,2m30\ne,E,1 min\nf,F,1\'30"\ng,G,"1,30"\nh,H,12.5\n' });
  const r = layout(raiz);
  assert.equal(r.status, 0, r.stderr);
  const c = leer(raiz, 'contents.json');
  assert.deepEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k) => c[k].duration), [90, 90, 45, 150, 60, 90, 90, 12.5]);
  assert.match(r.stdout, /«1,30» la leo como 1:30/);
  const mal = layout(hoja({ conceptos: 'id,etiqueta,duracion\na,A,un rato\n' }));
  assert.equal(mal.status, 1);
  assert.match(mal.stderr, /línea 2, la duración «un rato» no la entiendo/);
});

test('con etiquetas repetidas se avisa, y una relación por etiqueta pide el id', () => {
  let r = layout(hoja({ conceptos: 'id,etiqueta\na,Ruido\nb,Ruido\nc,Azar\n', relaciones: 'origen,destino\na,c\n' }));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /la etiqueta «Ruido» ya la tiene «a» en la línea 2/);
  r = layout(hoja({ conceptos: 'id,etiqueta\na,Ruido\nb,Ruido\nc,Azar\n', relaciones: 'origen,destino\nRuido,Azar\n' }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /hay varios conceptos «Ruido»\. Escribe su id/);
});

test('una relación con una celda vacía dice qué falta', () => {
  const r = layout(hoja({ conceptos: 'id,etiqueta\na,A\nb,B\n', relaciones: 'origen,destino\na,\n,b\n' }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /línea 2, falta el destino/);
  assert.match(r.stderr, /línea 3, falta el origen/);
});

test('una hoja guardada en UTF-16 se lee bien', () => {
  const texto = 'etiqueta,numero\nCanción,1\n';
  const raiz = hoja({ conceptos: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(texto, 'utf16le')]) });
  const r = layout(raiz);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(leer(raiz, 'map.json').nodes[0].label, 'Canción');
});

test('--keep con un map.json roto dice qué pasa y no toca nada', () => {
  const raiz = hoja({ conceptos: 'id,etiqueta\na,A\n' });
  writeFileSync(join(raiz, 'public', 'map.json'), '{"version":2, roto');
  const r = layout(raiz, '--keep');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /public\/map\.json no se puede leer/);
  assert.equal(readFileSync(join(raiz, 'public', 'map.json'), 'utf8'), '{"version":2, roto');
});

test('con 100 conceptos y una palabra fijada a mano, ninguna se sale del lienzo', () => {
  const filas = Array.from({ length: 100 }, (_, i) => `c${i},Concepto número ${i}${i === 0 ? ',700,1000' : ',,'}`);
  const rel = Array.from({ length: 99 }, (_, i) => `c${i},c${(i * 7 + 3) % 100 === i ? (i + 1) % 100 : (i * 7 + 3) % 100}`);
  const raiz = hoja({ conceptos: `id,etiqueta,x,y\n${filas.join('\n')}\n`, relaciones: `origen,destino\n${rel.join('\n')}\n` });
  const r = layout(raiz);
  assert.equal(r.status, 0, r.stderr);
  const map = leer(raiz, 'map.json');
  const fuera = map.nodes.filter((n) => n.x < 0 || n.y < 0 || n.x > map.width || n.y > map.height);
  assert.equal(fuera.length, 0, `${fuera.length} palabras fuera de ${map.width} × ${map.height}`);
  const fijada = map.nodes.find((n) => n.id === 'c0');
  assert.deepEqual([fijada.x, fijada.y], [700, 1000], 'lo fijado no se mueve');
});

// Lo que piden Guille y Juanlu (19-10-2026): cada concepto con su sección, su
// proceso y su medio, y las líneas salen solas entre los que comparten algo,
// en nube y no todos con todos.
const etiquetadas = 'id,etiqueta,seccion,proceso,medio\n'
  + 'a,A,T1,golpe,audio\nb,B,T1,golpe,audio\nc,C,t1,"gota/rebote, golpe",audio\nd,D,T1,ciclo,audio\n'
  + 'e,E,T1,ciclo,audio\nf,F,T1,fricción,audio\ng,G,T2,Fricción,audio\nh,H,T2,,vídeo\n';
const porTipo = (map, tipo) => map.links.filter((l) => l[2] === tipo);
const cuantas = (lineas, id) => lineas.filter((l) => l[0] === id || l[1] === id).length;

test('la sección, el proceso y el medio unen solos a los que comparten algo, sin unirlos todos con todos', () => {
  const raiz = hoja({ conceptos: etiquetadas, relaciones: 'origen,destino\na,b\n' });
  const r = layout(raiz);
  assert.equal(r.status, 0, r.stderr);
  const map = leer(raiz, 'map.json');
  const de = {
    seccion: { a: 't1', b: 't1', c: 't1', d: 't1', e: 't1', f: 't1', g: 't2', h: 't2' },
    proceso: { a: ['golpe'], b: ['golpe'], c: ['gota/rebote', 'golpe'], d: ['ciclo'], e: ['ciclo'], f: ['friccion'], g: ['friccion'], h: [] },
    medio: { a: 'audio', b: 'audio', c: 'audio', d: 'audio', e: 'audio', f: 'audio', g: 'audio', h: 'video' },
  };
  for (const [x, y, tipo] of map.links) {
    if (!tipo) continue;
    const comparten = tipo === 'proceso' ? de.proceso[x].some((p) => de.proceso[y].includes(p)) : de[tipo][x] === de[tipo][y];
    assert.ok(comparten, `${x} y ${y} van unidos por ${tipo} sin compartirlo`);
  }
  // La de relaciones.csv gana, y la pareja no se pinta otra vez por la sección.
  assert.deepEqual(map.links.filter((l) => [l[0], l[1]].sort().join() === 'a,b'), [['a', 'b']]);
  // «T1» y «t1» son la misma sección. Cada uno lleva una o dos de ella, y uno
  // como mucho una de más para que nadie se quede suelto, nunca las 15 de
  // todos con todos.
  const t1 = porTipo(map, 'seccion').filter((l) => de.seccion[l[0]] === 't1');
  const llevan = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => cuantas(t1, id) + (id === 'a' || id === 'b' ? 1 : 0));
  assert.ok(llevan.every((n) => n >= 1 && n <= 3), `llevan ${llevan}`);
  assert.ok(llevan.filter((n) => n === 3).length <= 1, `llevan ${llevan}`);
  assert.ok(t1.length < 15);
  // «gota/rebote» es un proceso, y «Fricción» y «fricción», el mismo.
  assert.match(r.stdout, /«C» es el único con el proceso «gota\/rebote»/);
  assert.ok(porTipo(map, 'proceso').some((l) => [l[0], l[1]].sort().join() === 'f,g'), 'f y g comparten fricción');
  assert.match(r.stdout, /«H» es el único con el medio «vídeo»/);
  assert.match(r.stdout, /\d+ enlaces \(1 a mano, \d+ por sección, \d+ por proceso y \d+ por medio\)/);
  // Con la misma hoja sale lo mismo.
  const otra = hoja({ conceptos: etiquetadas, relaciones: 'origen,destino\na,b\n' });
  assert.equal(layout(otra).status, 0);
  assert.deepEqual(leer(otra, 'map.json').links, map.links);
});

test('--enlaces dice con cuántos de su grupo se une cada uno, y un número que no vale se explica', () => {
  const raiz = hoja({ conceptos: etiquetadas });
  let r = layout(raiz, '--enlaces', '1');
  assert.equal(r.status, 0, r.stderr);
  const map = leer(raiz, 'map.json');
  for (const tipo of ['seccion', 'medio']) {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) assert.ok(cuantas(porTipo(map, tipo), id) <= 1, `${id} lleva más de una por ${tipo}`);
  }
  r = layout(raiz, '--enlaces', '3');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(porTipo(leer(raiz, 'map.json'), 'seccion').length > porTipo(map, 'seccion').length);
  r = layout(raiz, '--enlaces', 'muchos');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--enlaces va con un número del 1 al 20/);
});

let ffmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpeg = false; }

test('un MP4 con tilde guardado como lo guarda el Finder casa con la hoja', { skip: ffmpeg ? false : 'sin ffmpeg' }, () => {
  const raiz = hoja({ conceptos: 'id,etiqueta,archivo,numero\ncancion,Canción,Canción.mp4,1\n' });
  const nfd = 'Canción.mp4'.normalize('NFD');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=1',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(raiz, 'media', nfd)]);
  const r = layout(raiz);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /no está/);
  assert.ok(leer(raiz, 'contents.json').cancion.file, 'lo encuentra');
});
