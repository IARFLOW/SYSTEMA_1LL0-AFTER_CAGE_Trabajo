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

// Juanlu nombra cada audio como «número_Etiqueta_Sección_Proceso» y no quiere
// escribir lo mismo otra vez en la hoja (20-10-2026). Se añade solo, y en el
// formato en que la guardó su programa.
test('un vídeo que se llama número_Etiqueta_Sección_Proceso y no está en la hoja se añade a ella', () => {
  const conceptos = '﻿id;etiqueta;archivo;numero\r\nsilencio;Silencio;;1\r\n';
  const raiz = hoja({
    conceptos,
    media: {
      '101_Piedra_T0_G.mp4': 'x',
      // Solo en una versión, con tilde y espacio, y la tilde como la guarda el Finder.
      ['movil/102_Cámara anecoica_T1_F.mp4'.normalize('NFD')]: 'x',
      'ruido.mp4': 'x',
      'versiones.json': '{}',
    },
  });
  const r = layout(raiz);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /añado 2 a conceptos\.csv/);
  const bytes = readFileSync(join(raiz, 'data', 'conceptos.csv'));
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'con la marca de UTF-8 del principio, como estaba');
  const texto = bytes.toString('utf8').slice(1);
  assert.equal(texto, 'id;etiqueta;archivo;numero;seccion;proceso\r\nsilencio;Silencio;;1\r\n'
    + 'piedra;Piedra;101_Piedra_T0_G.mp4;101;T0;G\r\ncamara_anecoica;Cámara anecoica;102_Cámara anecoica_T1_F.mp4;102;T1;F\r\n',
    'la fila de antes igual, las columnas que faltaban al final de la cabecera y con punto y coma y saltos de Windows');
  const c = leer(raiz, 'contents.json');
  assert.equal(c.piedra.num, 101);
  assert.equal(c.camara_anecoica.num, 102);
  assert.ok(leer(raiz, 'map.json').nodes.some((n) => n.label === 'Cámara anecoica'));
  // Otra pasada no añade nada.
  const otra = layout(raiz);
  assert.equal(otra.status, 0, otra.stderr);
  assert.doesNotMatch(otra.stdout, /añado/);
  assert.equal(readFileSync(join(raiz, 'data', 'conceptos.csv')).toString('utf8').slice(1), texto);
});

test('un vídeo con un número que ya está en la hoja no se añade, y se dice', () => {
  const raiz = hoja({
    conceptos: 'id,etiqueta,archivo,numero,notas\npiedra,Piedra,101_piedra_t0_g.mp4,101,la de la entrada\n',
    media: { '101_Piedra_T0_G.mp4': 'x', '105_Otra_T0_G.mp4': 'x', '101_Repetido_T2_C.mp4': 'x' },
  });
  const r = layout(raiz);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /101_Repetido_T2_C\.mp4.*el 101 ya lo tiene «piedra»/);
  assert.equal(r.stdout.split('no conozco la columna «notas»').length - 1, 1, 'el aviso de la columna, una vez aunque la hoja se lea dos');
  const texto = readFileSync(join(raiz, 'data', 'conceptos.csv'), 'utf8');
  assert.equal(texto, 'id,etiqueta,archivo,numero,notas,seccion,proceso\npiedra,Piedra,101_piedra_t0_g.mp4,101,la de la entrada\notra,Otra,105_Otra_T0_G.mp4,105,,T0,G\n',
    'el que ya estaba en la hoja con otras mayúsculas no se repite, y cada celda nueva va bajo su columna');
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

// Guille, el 22-10-2026: el mismo concepto visto desde varias pantallas va en
// varios vídeos con la misma palabra. Hasta entonces la palabra salía repetida
// en el mapa, una vez por fila, y una relación por etiqueta pedía el id.
test('las filas con la misma etiqueta son una sola palabra con varios vídeos, cada uno con su número', () => {
  const raiz = hoja({
    conceptos: 'id,etiqueta,numero,seccion,nivel,x,y\npiedra,Piedra,1,T0,,,\nbosque_azul,bosque,,T2,2,300,400\n',
    relaciones: 'origen,destino\nBosque,Piedra\nbosque_201,Gota\n',
    media: { '200_Bosque_T0.mp4': 'x', '201_Bosque_T0.mp4': 'x', '202_bosque_T1_G.mp4': 'x', '300_Gota_T1.mp4': 'x' },
  });
  const r = layout(raiz);
  assert.equal(r.status, 0, r.stderr);
  const m = leer(raiz, 'map.json');
  const c = leer(raiz, 'contents.json');
  assert.deepEqual(m.nodes.map((n) => n.label).sort(), ['Gota', 'Piedra', 'bosque'], 'una palabra por etiqueta, sin mirar mayúsculas');
  const bosque = m.nodes.find((n) => n.label === 'bosque');
  assert.equal(bosque.id, 'bosque_azul', 'la palabra lleva el id de su primera fila');
  assert.deepEqual(bosque.videos, ['bosque_azul', 'bosque', 'bosque_201', 'bosque_202']);
  assert.ok(!('videos' in m.nodes.find((n) => n.label === 'Gota')), 'con un solo vídeo no hace falta la lista');
  assert.deepEqual([bosque.x, bosque.y, bosque.lv], [300, 400, 2], 'la posición y el nivel, de la fila que los tiene');
  assert.deepEqual(['bosque', 'bosque_201', 'bosque_202'].map((id) => c[id].num), [200, 201, 202], 'cada vídeo con su número para Max');
  assert.equal(c.bosque_202.archivo, '202_bosque_T1_G.mp4');
  // Las relaciones, por etiqueta o por el id de cualquiera de sus filas, y
  // las de sección con la de cualquiera (Piedra en T0, Gota en T1), van a la palabra.
  const unidas = new Set(m.links.map(([a, b]) => [a, b].sort().join('|')));
  assert.ok(unidas.has('bosque_azul|piedra'));
  assert.ok(unidas.has('bosque_azul|gota'));
  assert.ok(m.links.every(([a, b]) => [a, b].every((id) => m.nodes.some((n) => n.id === id))), 'ninguna línea va a una fila que no es palabra');
  assert.match(r.stdout, /«bosque», 4 vídeos \(bosque_azul, sin número, 200, 201, 202\)/);
  assert.doesNotMatch(r.stdout, /ya la tiene/);

  const mal = layout(hoja({ conceptos: 'id,etiqueta\na,Ruido\nb,Ruido\n', relaciones: 'origen,destino\na,b\n' }));
  assert.equal(mal.status, 1);
  assert.match(mal.stderr, /«a» y «b» son la misma palabra «Ruido»/);
});

// Juanlu, el 26-10-2026: las partituras de los músicos las pide Max por
// número, pero no tienen que salir en los móviles del público.
test('desde el 900 van en contents.json con su número para Max, pero no salen en el mapa', () => {
  const raiz = hoja({
    conceptos: 'id,etiqueta,numero,seccion\npiedra,Piedra,1,T0\nmar,Mar,899,T0\nbosque,Bosque,201,T0\nparti_1,Partitura 1,900,T0\nbosque_p,Bosque,950,T0\n',
    relaciones: 'origen,destino\npiedra,mar\npiedra,Partitura 1\nparti_1,mar\n',
    media: { '902_Partitura 2_P.mp4': 'x' },
  });
  const r = layout(raiz);
  assert.equal(r.status, 0, r.stderr);
  const m = leer(raiz, 'map.json');
  const c = leer(raiz, 'contents.json');
  assert.deepEqual(m.nodes.map((n) => n.label).sort(), ['Bosque', 'Mar', 'Piedra'], 'el 899 sale y del 900 en adelante no');
  assert.ok(!('videos' in m.nodes.find((n) => n.id === 'bosque')), 'el 950 no se junta con la palabra de su misma etiqueta');
  assert.deepEqual(['parti_1', 'bosque_p', 'partitura_2'].map((id) => c[id]?.num), [900, 950, 902], 'Max las sigue pidiendo por número');
  assert.equal(c.partitura_2.archivo, '902_Partitura 2_P.mp4', 'la que llega solo por el nombre del vídeo se añade a la hoja igual');
  assert.ok(m.links.every(([a, b]) => [a, b].every((id) => m.nodes.some((n) => n.id === id))), 'ninguna línea va a una partitura');
  assert.ok(m.links.some(([a, b]) => [a, b].sort().join('|') === 'mar|piedra'), 'la relación entre dos palabras sigue');
  assert.match(r.stdout, /línea 3, «Partitura 1» lleva el 900, y desde el 900 no sale en el mapa/);
  assert.match(r.stdout, /línea 4, «Partitura 1» lleva el 900/, 'también si la relación la nombra por su id');
  assert.match(r.stdout, /De ellos, 3 son del 900 en adelante/);
  assert.doesNotMatch(r.stdout, /el único con la sección «P»/, 'su sección no cuenta para los enlaces');
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

// TouchDesigner, con «Unique Suffix», deja «.mov.0» detrás del nombre
// (22-10-2026). La sección salía «T0.mov.0», y el archivo tiene que seguir
// siendo el de verdad, que es el que busca el servidor.
test('el «.mov.0» que pone TouchDesigner no se cuela en la sección, y el archivo queda con su nombre', () => {
  const raiz = hoja({
    conceptos: 'id,etiqueta,archivo,numero\n',
    media: { 'movil/200_Bosque_T0.mov.0.mp4': 'x', 'movil/201_Gota_T1_G.0.mp4': 'x' },
  });
  const r = layout(raiz);
  assert.equal(r.status, 0, r.stderr);
  const texto = readFileSync(join(raiz, 'data', 'conceptos.csv'), 'utf8');
  assert.equal(texto, 'id,etiqueta,archivo,numero,seccion,proceso\n'
    + 'bosque,Bosque,200_Bosque_T0.mov.0.mp4,200,T0,\ngota,Gota,201_Gota_T1_G.0.mp4,201,T1,G\n');
  assert.equal(leer(raiz, 'contents.json').bosque.archivo, '200_Bosque_T0.mov.0.mp4');
});

// Lo que antes pasaba en silencio con los nombres de los vídeos.
test('un nombre que empieza por número y no se puede leer se avisa, y también una sección rara', () => {
  const raiz = hoja({
    conceptos: 'id,etiqueta,archivo,numero\nlluvia,Lluvia,,300\npiedra,Piedra,piedra.mp4,101\n',
    media: {
      '213_Gran_Bosque_T2_G.mp4': 'x',
      '214_Gran_Bosque_T2.mp4': 'x',
      '300_Lluvia_T0_A.mp4': 'x',
      '101_Otra_T0_G.mp4': 'x',
    },
  });
  const r = layout(raiz);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /213_Gran_Bosque_T2_G\.mp4 no lo añado a la hoja, porque no lo leo como número_Etiqueta_Sección_Proceso\. La etiqueta no puede llevar «_»/);
  assert.match(r.stdout, /214_Gran_Bosque_T2\.mp4 lo añado con la sección «Bosque», que no es como T0 o T1/);
  assert.match(r.stdout, /300_Lluvia_T0_A\.mp4 no lo añado a la hoja, porque el 300 ya lo tiene «lluvia», pero esa fila no tiene archivo\. Si es este vídeo, escribe 300_Lluvia_T0_A\.mp4 en su columna archivo/);
  assert.match(r.stdout, /101_Otra_T0_G\.mp4 no lo añado a la hoja, porque el 101 ya lo tiene «piedra»/);
  assert.doesNotMatch(r.stdout, /101_Otra_T0_G\.mp4[^\n]*no tiene archivo/, 'la fila del 101 sí tiene archivo');
  const texto = readFileSync(join(raiz, 'data', 'conceptos.csv'), 'utf8');
  assert.match(texto, /\ngran,Gran,214_Gran_Bosque_T2\.mp4,214,Bosque,T2\n$/, 'la sección rara se escribe igual que antes');
  assert.doesNotMatch(texto, /213_/);
});

// El servidor solo pone .mp4 de media/. Un .mov suelto contaba aquí como
// vídeo y en la sala no salía.
test('un .mov suelto en media/ no cuenta como vídeo, y se dice qué hacer', () => {
  const raiz = hoja({
    conceptos: 'id,etiqueta,archivo\nsilencio,Silencio,Silencio.mov\nruido,Ruido,Ruido.mov\n',
    media: { 'Silencio.mov': 'x', 'Ruido.mov': 'x', 'Ruido.mp4': 'x' },
  });
  const r = layout(raiz);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /«silencio» lleva Silencio\.mov, que está en media\/, pero el servidor solo pone \.mp4\. Mételo en masters\/ y pasa npm run versiones/);
  const c = leer(raiz, 'contents.json');
  assert.equal(c.silencio.file, null);
  assert.match(c.ruido.file, /^\/media\/Ruido\.mp4\?v=/, 'con el .mp4 al lado, el servidor pone ese');
  assert.match(r.stdout, /1 con vídeo/);
});
