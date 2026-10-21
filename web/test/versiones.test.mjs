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
