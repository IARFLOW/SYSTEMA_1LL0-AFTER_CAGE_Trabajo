// Pruebas del script de versiones (npm run versiones). Se hacen masters de
// mentira con los casos de verdad (ProRes horizontal, móvil vertical a 60
// fps con su GPS, 4K, uno pequeño sin sonido, PAL entrelazado con píxeles no
// cuadrados, uno girado y uno que solo es audio) y se mira con ffprobe lo que
// sale.
//
// Sin ffmpeg instalado se saltan.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const script = join(web, 'scripts', 'versiones.mjs');
let ffmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpeg = false; }
const skip = ffmpeg ? false : 'sin ffmpeg';

// Los masters y las versiones de prueba, dentro de una carpeta que se borra
// al acabar (unos 40 MB por pasada se quedaban en la carpeta temporal).
const dir = mkdtempSync(join(tmpdir(), 'systema-versiones-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const masters = join(dir, 'masters');
const media = join(dir, 'media');
let primera;

const ff = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args]);
const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', f], { encoding: 'utf8' }));
const correr = (...args) => spawnSync(process.execPath, [script, '--masters', masters, '--media', media, ...args], { encoding: 'utf8' });
const video = (info) => info.streams.find((s) => s.codec_type === 'video');
const audio = (info) => info.streams.find((s) => s.codec_type === 'audio');
const fps = (s) => { const [n, d] = s.avg_frame_rate.split('/').map(Number); return n / d; };

// El color de un píxel del primer fotograma, para saber hacia dónde se ha girado.
function color(f, x, y) {
  const s = video(probe(f));
  const rgb = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const i = (y * s.width + x) * 3;
  const [r, g, b] = rgb.subarray(i, i + 3);
  if (r > 150 && g < 100 && b < 100) return 'rojo';
  if (b > 150 && r < 100 && g < 100) return 'azul';
  if (g > 90 && r < 60 && b < 60) return 'verde';
  if (r < 40 && g < 40 && b < 40) return 'negro';
  return `${r},${g},${b}`;
}

function moovPrimero(f) {
  const fd = openSync(f, 'r');
  try {
    const b = Buffer.alloc(8);
    let pos = 0;
    const size = statSync(f).size;
    while (pos + 8 <= size) {
      readSync(fd, b, 0, 8, pos);
      const t = b.toString('latin1', 4, 8);
      if (t === 'moov') return true;
      if (t === 'mdat') return false;
      pos += b.readUInt32BE(0);
    }
    return false;
  } finally { closeSync(fd); }
}

before(() => {
  if (!ffmpeg) return;
  mkdirSync(masters);
  const tono = (s) => ['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${s}`];
  // ProRes horizontal, como sale de un editor
  ff('-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=2', ...tono(2),
    '-c:v', 'prores_ks', '-profile:v', '0', '-c:a', 'pcm_s16le', '-shortest', join(masters, 'horizontal.mov'));
  // Móvil vertical a 60 fps, con la ubicación en los metadatos
  ff('-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=60:duration=2', ...tono(2),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    '-metadata', 'location=+40.4168-003.7038/', '-movflags', 'use_metadata_tags', join(masters, 'vertical.mp4'));
  // 4K
  ff('-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=25:duration=1', ...tono(1),
    '-c:v', 'prores_ks', '-profile:v', '0', '-c:a', 'pcm_s16le', '-shortest', join(masters, 'cuatro_k.mov'));
  // Pequeño y sin sonido, que no se agranda
  ff('-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(masters, 'pequeno sin sonido.mp4'));
  // PAL entrelazado y con píxeles no cuadrados (4:3)
  ff('-f', 'lavfi', '-i', 'testsrc2=size=720x576:rate=25:duration=2', ...tono(2),
    '-vf', 'setsar=16/15,setfield=tff', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-flags', '+ilme+ildct', '-x264-params', 'tff=1', '-c:a', 'aac', '-shortest', join(masters, 'pal.mov'));
  // Grabado en horizontal con el móvil girado, que se ve vertical
  ff('-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=2', ...tono(2),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(dir, 'sin_girar.mp4'));
  ff('-display_rotation', '90', '-i', join(dir, 'sin_girar.mp4'), '-c', 'copy', join(masters, 'girado.mp4'));
  // Solo audio
  ff(...tono(3), '-ac', '2', '-c:a', 'pcm_s16le', join(masters, 'solo audio.wav'));
  // Algo que no es ni vídeo ni audio
  writeFileSync(join(masters, 'notas.txt'), 'no soy un master');
  primera = correr('--paralelo', '3');
});

test('termina bien y lo dice', { skip }, () => {
  assert.equal(primera.status, 0, primera.stdout + primera.stderr);
  assert.match(primera.stdout, /7 masters/);
  assert.match(primera.stdout, /notas\.txt no es ni vídeo ni audio/);
});

test('cada master sale en las tres versiones, con su perfil', { skip }, () => {
  for (const base of ['horizontal', 'vertical', 'cuatro_k', 'pequeno sin sonido', 'pal', 'girado', 'solo audio']) {
    for (const v of ['movil', 'tablet', 'monitor']) {
      const f = join(media, v, `${base}.mp4`);
      assert.ok(existsSync(f), `falta ${v}/${base}.mp4`);
      const s = video(probe(f));
      assert.equal(s.codec_name, 'h264', f);
      assert.equal(s.profile, 'High', f);
      assert.ok(s.level <= 41, `${f}: nivel ${s.level}`);
      assert.equal(s.pix_fmt, 'yuv420p', f);
      assert.equal(s.color_space, 'bt709', f);
      assert.ok(moovPrimero(f), `${f}: el índice no va al principio`);
    }
  }
});

test('se mete en la caja de cada versión sin agrandar y respetando la forma', { skip }, () => {
  const tam = (v, base) => { const s = video(probe(join(media, v, `${base}.mp4`))); return `${s.width}x${s.height}`; };
  assert.equal(tam('movil', 'horizontal'), '1280x720');
  assert.equal(tam('tablet', 'horizontal'), '1920x1080');
  assert.equal(tam('movil', 'vertical'), '720x1280');
  assert.equal(tam('monitor', 'vertical'), '1080x1920');
  assert.equal(tam('movil', 'cuatro_k'), '1280x720');
  assert.equal(tam('monitor', 'cuatro_k'), '1920x1080');
  assert.equal(tam('monitor', 'pequeno sin sonido'), '640x360', 'un master pequeño no se agranda');
  assert.equal(tam('movil', 'pal'), '768x576', 'píxeles 16:15 → cuadrados');
  assert.equal(tam('movil', 'girado'), '720x1280', 'el giro se aplica');
  assert.equal(tam('movil', 'solo audio'), '1280x720');
});

test('los fotogramas se respetan, y por encima de 30 se dividen entre un entero', { skip }, () => {
  const f = (v, base) => fps(video(probe(join(media, v, `${base}.mp4`))));
  assert.equal(f('movil', 'horizontal'), 30);
  assert.equal(f('monitor', 'vertical'), 30, '60 → 30');
  assert.equal(f('tablet', 'cuatro_k'), 25);
  assert.equal(f('movil', 'pal'), 25, 'el PAL desentrelazado sigue a 25');
  const pal = video(probe(join(media, 'movil', 'pal.mp4')));
  assert.ok(['progressive', undefined].includes(pal.field_order), `sale progresivo (${pal.field_order})`);
});

test('el sonido va en AAC estéreo, y sin sonido si el master no lo tiene', { skip }, () => {
  const a = audio(probe(join(media, 'movil', 'horizontal.mp4')));
  assert.equal(a.codec_name, 'aac');
  assert.equal(a.channels, 2);
  assert.equal(Number(a.sample_rate), 48000);
  assert.equal(audio(probe(join(media, 'movil', 'pequeno sin sonido.mp4'))), undefined);
  const negro = probe(join(media, 'tablet', 'solo audio.mp4'));
  assert.equal(audio(negro).codec_name, 'aac');
  assert.ok(Math.abs(Number(negro.format.duration) - 3) < 0.25, `dura ${negro.format.duration}`);
  assert.ok(statSync(join(media, 'tablet', 'solo audio.mp4')).size < 200_000, 'la imagen negra no pesa casi nada');
});

test('se quitan los metadatos, así que un vídeo de móvil no se lleva dónde se grabó', { skip }, () => {
  const tags = JSON.stringify(probe(join(masters, 'vertical.mp4')).format.tags ?? {});
  assert.match(tags, /location/i, 'el master de prueba sí lleva la ubicación');
  for (const v of ['movil', 'tablet', 'monitor']) {
    const t = JSON.stringify(probe(join(media, v, 'vertical.mp4')).format.tags ?? {});
    assert.doesNotMatch(t, /location|40\.4168/i, `${v} se lleva la ubicación (${t})`);
  }
});

test('el registro dice qué se hizo, y lo hecho no se rehace', { skip }, () => {
  const m = JSON.parse(readFileSync(join(media, 'versiones.json'), 'utf8'));
  assert.equal(Object.keys(m.masters).length, 7);
  const h = m.masters['horizontal.mov'];
  assert.equal(h.salidas.movil.fichero, 'movil/horizontal.mp4');
  assert.equal(h.salidas.movil.ancho, 1280);
  assert.ok(typeof h.lufs === 'number', 'mide el volumen');
  assert.ok(m.masters['pal.mov'].avisos.some((a) => /entrelazado/.test(a)));
  assert.ok(m.masters['pal.mov'].avisos.some((a) => /no cuadrados/.test(a)));
  assert.ok(m.masters['girado.mp4'].avisos.some((a) => /girado 90/.test(a)));

  const otra = correr();
  assert.equal(otra.status, 0, otra.stderr);
  assert.match(otra.stdout, /todo está hecho/);
  const forzada = correr('--forzar', '--solo', 'movil', '--paralelo', '3');
  assert.equal(forzada.status, 0, forzada.stderr);
  assert.match(forzada.stdout, /7 versiones por hacer/);
});

test('con dos masters que darían el mismo nombre, lo dice y no hace nada', { skip }, () => {
  const otro = join(dir, 'choque');
  mkdirSync(otro);
  ff('-f', 'lavfi', '-i', 'sine=duration=1', join(otro, 'Mismo.wav'));
  ff('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(otro, 'Mismo.mov'));
  const r = spawnSync(process.execPath, [script, '--masters', otro, '--media', join(dir, 'choque-media')], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /darían el mismo nombre/);
});

// Los audios de Juanlu (21-10-2026). El negro salía de una fuente sin fin
// cortada con -shortest, y el codificador de vídeo se pasaba unos 3 s en un
// audio largo, así que la comprobación lo rechazaba. Con 3 s no se notaba.
test('un audio largo sale con su duración, sin segundos de más en el negro', { skip }, () => {
  const otro = join(dir, 'largo');
  mkdirSync(otro);
  ff('-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=47.3', '-ac', '2', '-c:a', 'pcm_s24le', join(otro, 'largo.wav'));
  const salida = join(dir, 'largo-media');
  const r = spawnSync(process.execPath, [script, '--masters', otro, '--media', salida, '--solo', 'movil'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const info = probe(join(salida, 'movil', 'largo.mp4'));
  assert.ok(Math.abs(Number(info.format.duration) - 47.3) < 0.25, `dura ${info.format.duration}`);
  assert.ok(Math.abs(Number(video(info).duration) - 47.3) < 0.25, `el negro dura ${video(info).duration}`);
});

// El móvil del público pone el altavoz encima del negro de un audio, y lo sabe
// por el registro. En lo que ya estaba hecho se apunta sin codificar otra vez.
test('el registro apunta qué masters son solo audio, también en los ya hechos', { skip }, () => {
  const ruta = join(media, 'versiones.json');
  let m = JSON.parse(readFileSync(ruta, 'utf8'));
  assert.equal(m.masters['solo audio.wav'].soloAudio, true);
  assert.equal(m.masters['horizontal.mov'].soloAudio, undefined);
  // Como lo dejaba la versión de antes, sin la marca.
  delete m.masters['solo audio.wav'].soloAudio;
  writeFileSync(ruta, JSON.stringify(m));
  const r = correr();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /todo está hecho/);
  m = JSON.parse(readFileSync(ruta, 'utf8'));
  assert.equal(m.masters['solo audio.wav'].soloAudio, true);
});

// TouchDesigner pone la matriz Rec.2020 en lo que pasa de 1080 de alto, con la
// curva sRGB y los colores de siempre. Eso no es HDR, y avisar de que lo es
// asustaba. Con la curva PQ sí lo es.
test('solo avisa de HDR cuando lo es, no por la matriz Rec.2020 sola', { skip }, () => {
  const otro = join(dir, 'color');
  mkdirSync(otro);
  const clip = (nombre, ...color) => ff('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=1',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', ...color, join(otro, nombre));
  // Con -color_trc y -color_primaries libx264 solo guarda la matriz, así que van por x264-params.
  clip('touch.mp4', '-x264-params', 'colormatrix=bt2020nc:transfer=iec61966-2-1:colorprim=bt709');
  clip('pq.mp4', '-x264-params', 'colormatrix=bt2020nc:transfer=smpte2084:colorprim=bt2020');
  assert.equal(video(probe(join(otro, 'touch.mp4'))).color_transfer, 'iec61966-2-1');
  assert.equal(video(probe(join(otro, 'pq.mp4'))).color_transfer, 'smpte2084');
  const salida = join(dir, 'color-media');
  const r = spawnSync(process.execPath, [script, '--masters', otro, '--media', salida, '--solo', 'movil'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const m = JSON.parse(readFileSync(join(salida, 'versiones.json'), 'utf8'));
  assert.ok(!m.masters['touch.mp4'].avisos.some((a) => /HDR/.test(a)), m.masters['touch.mp4'].avisos.join(' · '));
  assert.ok(m.masters['pq.mp4'].avisos.some((a) => /HDR/.test(a)), 'el de PQ sí avisa');
});

// Guille pasa sus masters y Juanlu sus audios, cada uno desde su carpeta y al
// mismo media/. Cada pasada borraba del registro lo que no estaba en su
// carpeta, y con eso el «soloAudio» de los audios y el altavoz del móvil.
test('dos carpetas de masters al mismo media/ no se borran el registro la una a la otra', { skip }, () => {
  const audios = join(dir, 'de-juanlu');
  const videos = join(dir, 'de-guille');
  const salida = join(dir, 'dos-media');
  mkdirSync(audios);
  mkdirSync(videos);
  ff('-f', 'lavfi', '-i', 'sine=duration=1', '-ac', '2', join(audios, '300_Lluvia_T0.wav'));
  ff('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(videos, '200_Bosque_T0.mp4'));
  const pasar = (carpeta) => spawnSync(process.execPath, [script, '--masters', carpeta, '--media', salida, '--solo', 'movil'], { encoding: 'utf8' });
  const registro = () => JSON.parse(readFileSync(join(salida, 'versiones.json'), 'utf8')).masters;
  let r = pasar(audios);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  r = pasar(videos);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  let m = registro();
  assert.equal(m['300_Lluvia_T0.wav']?.soloAudio, true, 'el audio de la otra carpeta sigue siendo audio');
  assert.equal(m['200_Bosque_T0.mp4'].soloAudio, undefined);
  // Sin su vídeo en media/, la entrada ya sí sobra.
  rmSync(join(salida, 'movil', '300_Lluvia_T0.mp4'));
  r = pasar(videos);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  m = registro();
  assert.ok(!('300_Lluvia_T0.wav' in m), 'lo que no tiene ni master ni vídeo se quita');
  assert.ok('200_Bosque_T0.mp4' in m);
});

// Un master a medio copiar no tiene el índice, que en un .mov o en un MP4 sin
// +faststart va al final. Salía el error crudo de ffprobe, la cabecera decía
// «todo está hecho» y terminaba bien.
test('un master a medio copiar se explica y la pasada sale con error, y se dice lo que no se mira', { skip }, () => {
  const otro = join(dir, 'a-medias');
  mkdirSync(otro);
  mkdirSync(join(otro, 'T1'));
  ff('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(dir, 'entero.mp4'));
  const entero = readFileSync(join(dir, 'entero.mp4'));
  writeFileSync(join(otro, 'cortado.mp4'), entero.subarray(0, Math.floor(entero.length / 2)));
  // Como lo deja TouchDesigner con «Unique Suffix».
  ff('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(otro, '200_Bosque_T0.mov.0.mov'));
  const salida = join(dir, 'a-medias-media');
  const r = spawnSync(process.execPath, [script, '--masters', otro, '--media', salida, '--solo', 'movil'], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /2 masters en .*\(uno no se puede leer\)/);
  assert.match(r.stdout, /✗ cortado\.mp4 · no se puede leer, le falta el final/);
  assert.match(r.stdout, /Hay un master que no se puede leer/);
  assert.doesNotMatch(r.stdout + r.stderr, /moov atom/, 'sin el error crudo de ffprobe');
  assert.match(r.stdout, /la carpeta T1 no la miro/);
  assert.match(r.stdout, /200_Bosque_T0\.mov\.0\.mov lleva «\.mov\.0» detrás.*renombrarlo a 200_Bosque_T0\.mov/);
  assert.ok(existsSync(join(salida, 'movil', '200_Bosque_T0.mov.0.mp4')), 'el bueno sale igual, y con su nombre de siempre');
});

// Las teles y los monitores de la sala van de pie y sus vídeos llevan la
// imagen tumbada, y en los proyectores el vertical va en medio de un cuadro
// horizontal (Guille, 24-10-2026). En el móvil se giran o se recortan, y
// solo ahí.
test('la lista del móvil gira o recorta solo la versión del móvil, y al cambiarla rehace solo esa', { skip }, () => {
  const otro = join(dir, 'lista-movil');
  mkdirSync(otro);
  const clip = (grafo, nombre) => ff('-f', 'lavfi', '-i', grafo, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(otro, nombre));
  // Rojo a la izquierda y azul a la derecha
  const rojoAzul = 'color=c=red:s=160x180:d=1[a];color=c=blue:s=160x180:d=1[b];[a][b]hstack[out0]';
  clip(rojoAzul, '301_Izquierda_T0.mov');
  clip(rojoAzul, '302_Derecha_T0.mov');
  clip(rojoAzul, '303_Tal cual_T0.mov');
  // El vertical verde en medio de un cuadro negro, como en los proyectores
  const enMedio = 'color=c=black:s=320x180:d=1[f];color=c=green:s=100x180:d=1[g];[f][g]overlay=x=110:y=0[out0]';
  clip(enMedio, '304_Proyector_T0.mov.0.mov');
  // Con la tilde aparte, como puede darla macOS
  clip(enMedio, '305_Árbol_T0.mov');
  const lista = join(dir, 'movil.csv');
  writeFileSync(lista, [
    '# lo que hay que hacer con cada uno en el móvil',
    'Archivo;Móvil',
    '301_Izquierda_T0;izquierda',
    '302_Derecha_T0.mov;girar a la derecha',
    '303_Tal cual_T0;',
    '304_Proyector_T0;Recortar',
    '305_Árbol_T0;recortar',
    '399_No esta_T0;derecha',
  ].join('\r\n'));
  const salida = join(dir, 'lista-movil-media');
  const pasar = () => spawnSync(process.execPath, [script, '--masters', otro, '--media', salida, '--movil', lista, '--solo', 'movil,monitor'], { encoding: 'utf8' });
  const f = (v, base) => join(salida, v, `${base}.mp4`);
  const tam = (v, base) => { const s = video(probe(f(v, base))); return `${s.width}x${s.height}`; };

  let r = pasar();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // Girado a la izquierda, lo que estaba a la derecha queda arriba
  assert.equal(tam('movil', '301_Izquierda_T0'), '180x320');
  assert.equal(color(f('movil', '301_Izquierda_T0'), 90, 20), 'azul');
  assert.equal(color(f('movil', '301_Izquierda_T0'), 90, 300), 'rojo');
  assert.equal(tam('movil', '302_Derecha_T0'), '180x320');
  assert.equal(color(f('movil', '302_Derecha_T0'), 90, 20), 'rojo');
  assert.equal(color(f('movil', '302_Derecha_T0'), 90, 300), 'azul');
  assert.equal(tam('movil', '303_Tal cual_T0'), '320x180', 'sin nada en la columna, tal cual');
  // 9:16 de 180 de alto son 101,25, que en par son 102, y del centro
  assert.equal(tam('movil', '304_Proyector_T0.mov.0'), '102x180');
  for (const x of [5, 51, 96]) assert.equal(color(f('movil', '304_Proyector_T0.mov.0'), x, 90), 'verde', `x=${x}`);
  assert.equal(tam('movil', '305_Árbol_T0'), '102x180', 'la tilde aparte no lo despista');
  // En la sala, todos tal cual
  for (const base of ['301_Izquierda_T0', '302_Derecha_T0', '304_Proyector_T0.mov.0', '305_Árbol_T0']) assert.equal(tam('monitor', base), '320x180', base);
  assert.equal(color(f('monitor', '301_Izquierda_T0'), 20, 90), 'rojo');
  assert.equal(color(f('monitor', '304_Proyector_T0.mov.0'), 20, 90), 'negro');
  assert.match(r.stdout, /399_No esta_T0 no está ni entre estos masters ni en media\/\. Mira si está bien escrito/);
  assert.match(r.stdout, /301_Izquierda_T0\.mov .*\n\s+· en el móvil sale girado 90° a la izquierda/);
  assert.match(r.stdout, /304_Proyector_T0\.mov\.0\.mov .*\n(?:\s+· .*\n)*\s+· en el móvil sale recortado al vertical del centro/);
  const registro = () => JSON.parse(readFileSync(join(salida, 'versiones.json'), 'utf8')).masters;
  assert.equal(registro()['301_Izquierda_T0.mov'].salidas.movil.ajuste, 'izquierda');
  assert.equal(registro()['301_Izquierda_T0.mov'].salidas.monitor.ajuste, undefined);

  // Sin cambios no se rehace nada. Al cambiar la lista, solo los móviles tocados.
  r = pasar();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /todo está hecho/);
  writeFileSync(lista, 'archivo,movil\n301_Izquierda_T0,derecha\n303_Tal cual_T0,izquierda\n304_Proyector_T0,recortar\n305_Árbol_T0,recortar\n');
  r = pasar();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /3 versiones por hacer/, '301 cambia de lado, 302 sale de la lista y 303 entra');
  assert.doesNotMatch(r.stdout, /\d+\/\d+\s+monitor/, 'las de la sala no se tocan');
  assert.equal(color(f('movil', '301_Izquierda_T0'), 90, 20), 'rojo', 'ahora a la derecha');
  assert.equal(tam('movil', '302_Derecha_T0'), '320x180', 'fuera de la lista vuelve a salir tal cual');
  assert.equal(tam('movil', '303_Tal cual_T0'), '180x320');
  assert.equal(registro()['302_Derecha_T0.mov'].salidas.movil.ajuste, undefined);
});

// Un vídeo girado hacia el lado malo sale boca abajo en todos los móviles.
test('una lista del móvil que no cuadra dice cada fallo con su línea y no empieza', { skip }, () => {
  const lista = join(dir, 'movil-mal.csv');
  writeFileSync(lista, 'archivo,movil\n202_Bosque_T0,girar\n203_Bosque_T0,boca abajo\n,recortar\n204_Bosque_T0,derecha\n204_Bosque_T0.mov,izquierda\n');
  const salida = join(dir, 'movil-mal-media');
  const r = spawnSync(process.execPath, [script, '--masters', masters, '--media', salida, '--movil', lista], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /línea 2, «girar» sin decir hacia qué lado \(izquierda o derecha\)/);
  assert.match(r.stderr, /línea 3, no sé qué es «boca abajo»/);
  assert.match(r.stderr, /línea 4, falta el nombre del vídeo/);
  assert.match(r.stderr, /línea 6, 204_Bosque_T0\.mov ya salía antes con «derecha»/);
  assert.ok(!existsSync(salida), 'no se ha puesto a hacer nada');
  const sinColumna = join(dir, 'movil-sin-columna.csv');
  writeFileSync(sinColumna, 'archivo,girar\n202_Bosque_T0,derecha\n');
  const s = spawnSync(process.execPath, [script, '--masters', masters, '--media', salida, '--movil', sinColumna], { encoding: 'utf8' });
  assert.equal(s.status, 1);
  assert.match(s.stderr, /tiene que empezar con las columnas archivo y movil/);
});
