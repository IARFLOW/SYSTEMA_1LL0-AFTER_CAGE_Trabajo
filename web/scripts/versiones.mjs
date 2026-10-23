// Saca de cada master las versiones que necesita cada aparato de la sala, con
// el perfil que elegí. H.264 High hasta el nivel 4.1, yuv420p,
// AAC estéreo a 128 kbps, un fotograma clave cada 2 s y el índice al principio
// (+faststart), para que un móvil empiece a verlo sin bajárselo entero.
//
//   npm run versiones                        masters/ → media/movil, media/tablet y media/monitor
//   npm run versiones -- --masters <carpeta> los masters en otra carpeta
//   npm run versiones -- --solo movil        solo esa versión (movil, tablet o monitor, o varias con comas)
//   npm run versiones -- --forzar            rehace todo, aunque ya esté hecho
//   npm run versiones -- --normalizar        iguala el volumen de todos a −16 LUFS
//   npm run versiones -- --paralelo 2        cuántos ffmpeg a la vez
//
// Las versiones van así (el tope lo pone la Wi-Fi, no la potencia del aparato).
//   movil    hasta 1280 × 720 (720 × 1280 si es vertical), unos 2,2 Mbps
//   tablet   hasta 1920 × 1080, unos 5 Mbps (iPads y tablets fijas, por Wi-Fi)
//   monitor  hasta 1920 × 1080, unos 7,8 Mbps (teles con Raspberry, por cable)
// Esas tasas son las de la imagen más difícil (ruido, mucho movimiento), y un
// plano quieto pesa mucho menos. Medido con 20 s de ruido a 60 fps, la media
// sale un 3-4 % por encima (el colchón del principio del codificador), y algún
// segundo suelto llega a 1,5-1,8 veces la tasa, que el móvil absorbe con lo que
// lleva ya descargado. Nunca se agranda la imagen, así que un master pequeño se
// queda de su tamaño.
//
// Los fotogramas por segundo se respetan. Por encima de 30 se dividen entre el
// entero más pequeño que los deja en 30 o menos (60 → 30, 50 → 25), porque el
// nivel 4.1 de H.264 no admite 1080 a más de 30, y una Raspberry tampoco los
// pondría finos. Dividir entre un entero no da tirones. Pasar de 30 a 25, sí.
//
// Un master que solo es audio (wav, aif, mp3, m4a, flac…) sale como MP4 con la
// imagen en negro, que no pesa casi nada. Lo que venga con la imagen girada
// (un vídeo vertical de móvil), con píxeles no cuadrados o entrelazado sale
// derecho, cuadrado y progresivo. Se quitan los metadatos, que en un vídeo de
// móvil llevan dónde se grabó.
//
// El volumen es cosa de la obra, así que por defecto no se toca. El informe
// del final dice el de cada master (en LUFS) y avisa de los que se apartan
// mucho del resto, por si alguno se exportó muy bajo o muy alto sin querer.
//
// Hace falta ffmpeg (brew install ffmpeg). Lo hecho se apunta en
// media/versiones.json, y si se lanza otra vez, solo rehace lo que ha cambiado.
// Cada fichero se escribe aparte y se cambia de nombre al acabar, así que el
// servidor nunca sirve un vídeo a medio escribir.
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
  openSync, readSync, closeSync,
} from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Si cambia algo de aquí, súbelo. Todo lo hecho con el perfil anterior se rehace.
const PERFIL = 1;
const PERFILES = {
  movil: { caja: [1280, 720], kbps: 2200, crf: 22 },
  tablet: { caja: [1920, 1080], kbps: 5000, crf: 21 },
  monitor: { caja: [1920, 1080], kbps: 7800, crf: 19 },
};
const AUDIO = ['.wav', '.aif', '.aiff', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wma'];
const VIDEO = ['.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm', '.mxf', '.mpg', '.mpeg', '.mts', '.m2ts', '.wmv', '.dv'];

// ---------------------------------------------------------------------------
// Opciones
// ---------------------------------------------------------------------------
function opciones(argv) {
  const o = {
    masters: join(root, 'masters'),
    media: join(root, 'media'),
    solo: Object.keys(PERFILES),
    forzar: false,
    normalizar: false,
    paralelo: Math.max(1, Math.floor(availableParallelism() / 4)),
  };
  const valor = (i, nombre) => {
    if (i + 1 >= argv.length) fallar(`falta el valor de ${nombre}`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--masters') { o.masters = resolve(valor(i, a)); i += 1; }
    else if (a === '--media') { o.media = resolve(valor(i, a)); i += 1; }
    else if (a === '--solo') {
      o.solo = valor(i, a).split(',').map((s) => s.trim()).filter(Boolean);
      const raras = o.solo.filter((s) => !PERFILES[s]);
      if (raras.length) fallar(`no hay versión ${raras.join(', ')}, las que hay son ${Object.keys(PERFILES).join(', ')}`);
      i += 1;
    } else if (a === '--paralelo') {
      o.paralelo = Number(valor(i, a));
      if (!Number.isInteger(o.paralelo) || o.paralelo < 1) fallar('--paralelo quiere un número entero desde 1');
      i += 1;
    } else if (a === '--forzar') o.forzar = true;
    else if (a === '--normalizar') o.normalizar = true;
    else fallar(`no conozco la opción ${a}`);
  }
  return o;
}

function fallar(texto) {
  console.error(`no puedo hacer las versiones, ${texto}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Lo que hay en cada master
// ---------------------------------------------------------------------------
function fraccion(s) {
  const [n, d] = String(s ?? '').split('/').map(Number);
  if (!n || !d) return null;
  return { n, d, v: n / d };
}

// Lo que dice ffprobe cuando no puede se guarda en el error (e.stderr) y no
// sale crudo por la terminal.
function sondear(ruta) {
  const salida = execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', ruta],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const info = JSON.parse(salida);
  const streams = info.streams ?? [];
  // Una carátula de disco dentro de un mp3 o un m4a sale como «vídeo», y no lo es.
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const a = streams.find((s) => s.codec_type === 'audio');
  const duracion = Number(info.format?.duration) || Number(a?.duration) || Number(v?.duration) || 0;
  if (!v) return { video: null, audio: a ?? null, duracion };
  const giro = Number((v.side_data_list ?? []).find((d) => d.rotation !== undefined)?.rotation ?? 0);
  const sar = fraccion(String(v.sample_aspect_ratio ?? '1:1').replace(':', '/'));
  // r_frame_rate es la cadencia de la rejilla, y avg_frame_rate, la media de
  // verdad. En un vídeo de móvil (cadencia variable) la buena es la media.
  const r = fraccion(v.r_frame_rate);
  const avg = fraccion(v.avg_frame_rate);
  const fps = avg && avg.v > 0 && avg.v <= 240 ? avg : r;
  return {
    duracion,
    audio: a ?? null,
    indiceVideo: v.index,
    video: {
      ancho: v.width,
      alto: v.height,
      sar: sar && sar.v > 0 ? sar : { n: 1, d: 1, v: 1 },
      giro: ((giro % 360) + 360) % 360,
      fps,
      variable: Boolean(avg && r && Math.abs(avg.v - r.v) > 0.01),
      campos: v.field_order ?? 'unknown',
      matriz: v.color_space ?? 'unknown',
      transferencia: v.color_transfer ?? 'unknown',
      primarios: v.color_primaries ?? 'unknown',
      rango: v.color_range ?? 'unknown',
      pixeles: v.pix_fmt ?? '',
      codec: v.codec_name,
    },
  };
}

// Volumen integrado (EBU R128) y pico verdadero, para el informe.
function volumen(ruta) {
  return new Promise((ok) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostats', '-i', ruta, '-map', '0:a:0', '-af', 'ebur128=framelog=quiet:peak=true', '-f', 'null', '-']);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', () => {
      const resumen = err.slice(err.lastIndexOf('Summary:'));
      const i = /I:\s+(-?[\d.]+|-inf) LUFS/.exec(resumen);
      const pico = /Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(resumen);
      ok({ lufs: i && i[1] !== '-inf' ? Number(i[1]) : null, pico: pico && pico[1] !== '-inf' ? Number(pico[1]) : null });
    });
  });
}

// Medida de la primera pasada de loudnorm, para la segunda (la que lo aplica
// sin bombear, con linear=true).
function medirLoudnorm(ruta) {
  return new Promise((ok) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostats', '-i', ruta, '-map', '0:a:0',
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', () => {
      const m = /\{[^{}]*"input_i"[^{}]*\}/s.exec(err);
      try { ok(m ? JSON.parse(m[0]) : null); } catch { ok(null); }
    });
  });
}

// ---------------------------------------------------------------------------
// Cómo se hace cada versión
// ---------------------------------------------------------------------------
const par = (x) => Math.max(2, Math.round(x / 2) * 2);

// La imagen tal como se ve (girada y con píxeles cuadrados) metida en la caja
// de la versión, sin agrandar nunca.
function medidas(video, caja) {
  let ancho = video.ancho * video.sar.v;
  let alto = video.alto;
  if (video.giro === 90 || video.giro === 270) [ancho, alto] = [alto, ancho];
  const [cw, ch] = ancho >= alto ? caja : [caja[1], caja[0]];
  const k = Math.min(1, cw / ancho, ch / alto);
  return { ancho: par(ancho * k), alto: par(alto * k) };
}

// Por encima de 30 fps, entre el entero más pequeño que los deja en 30 o menos.
function cadencia(fps) {
  if (!fps || !(fps.v > 0)) return { n: 25, d: 1, v: 25 };
  const k = Math.max(1, Math.ceil(fps.v / 30 - 1e-9));
  return { n: fps.n, d: fps.d * k, v: fps.v / k };
}

const SEISCIENTOS = ['smpte170m', 'bt470bg', 'bt601'];

function avisosDe(m) {
  const avisos = [];
  const v = m.video;
  if (!v) {
    if (!m.audio) avisos.push('no tiene ni imagen ni sonido');
    return avisos;
  }
  // HDR o gama ancha. Un ProRes de 10 bits en Rec.709 es lo normal y no cuenta.
  // Tampoco la matriz Rec.2020 sola, con la curva y los colores de siempre.
  // TouchDesigner la pone en lo que pasa de 1080 de alto, y leída con una
  // matriz o con la otra cambia 6 o 7 niveles de 255 (medido el 21-10-2026).
  if (['smpte2084', 'arib-std-b67'].includes(v.transferencia) || v.primarios.startsWith('bt2020')) {
    avisos.push('parece HDR o de gama ancha (Rec.2020, HLG o PQ). Aquí no se convierte bien y los colores pueden salir lavados. Mejor pedir el master exportado en SDR Rec.709');
  }
  if (v.fps && v.fps.v > 30.01) avisos.push(`viene a ${v.fps.v.toFixed(2).replace(/\.?0+$/, '')} fps y sale a ${cadencia(v.fps).v.toFixed(2).replace(/\.?0+$/, '')}`);
  if (v.variable) avisos.push(`tiene cadencia variable (media ${v.fps.v.toFixed(2)} fps), la típica de un móvil, y sale a cadencia fija`);
  if (!['progressive', 'unknown'].includes(v.campos)) avisos.push('viene entrelazado y sale desentrelazado');
  if (Math.abs(v.sar.v - 1) > 0.01) avisos.push(`tiene píxeles no cuadrados (${v.sar.n}:${v.sar.d}) y sale con píxeles cuadrados`);
  if (v.giro) avisos.push(`viene girado ${v.giro}° y sale derecho`);
  if (m.duracion > 0 && m.duracion < 1) avisos.push(`dura ${m.duracion.toFixed(2)} s`);
  return avisos;
}

function filtrosVideo(m, perfil) {
  const v = m.video;
  const { ancho, alto } = medidas(v, perfil.caja);
  const f = [];
  if (!['progressive', 'unknown'].includes(v.campos)) f.push('bwdif=mode=send_frame:parity=auto:deint=all');
  // Matriz de color. Si el master es SD (Rec.601) o no lo dice y es pequeño,
  // se pasa a Rec.709, que es la que se etiqueta a la salida. Si ya es 709 o
  // no lo dice y es HD, se deja tal cual, que convertir de más tiñe los colores.
  let entrada = null;
  if (SEISCIENTOS.includes(v.matriz) || (v.matriz === 'unknown' && v.alto < 720)) entrada = 'bt601';
  else if (v.matriz.startsWith('bt2020')) entrada = 'bt2020';
  const rangoEntrada = ['pc', 'jpeg'].includes(v.rango) ? 'pc' : 'tv';
  const escala = [`${ancho}:${alto}`, 'flags=lanczos'];
  if (entrada) escala.push(`in_color_matrix=${entrada}`, 'out_color_matrix=bt709');
  if (rangoEntrada === 'pc') escala.push('in_range=pc', 'out_range=tv');
  f.push(`scale=${escala.join(':')}`, 'setsar=1');
  const c = cadencia(v.fps);
  f.push(`fps=${c.n}/${c.d}`, 'format=yuv420p');
  return { filtros: f.join(','), ancho, alto, fps: c };
}

function argumentosX264(perfil, fps, quieto = false) {
  const gop = Math.max(1, Math.round(fps.v * 2));
  return [
    '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-level:v', '4.1',
    '-crf', String(quieto ? 30 : perfil.crf),
    '-maxrate', `${perfil.kbps}k`, '-bufsize', `${perfil.kbps * 2}k`,
    '-g', String(gop), '-keyint_min', String(Math.max(1, Math.round(fps.v))),
    ...(quieto ? ['-tune', 'stillimage'] : []),
    '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
  ];
}

function argumentosAudio(loud) {
  const filtro = loud
    ? `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${loud.input_i}:measured_TP=${loud.input_tp}:measured_LRA=${loud.input_lra}:measured_thresh=${loud.input_thresh}:offset=${loud.target_offset}:linear=true,aresample=48000`
    : 'aresample=48000';
  return ['-af', filtro, '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000'];
}

function orden(m, perfil, entrada, salida, loud) {
  const comun = ['-hide_banner', '-nostdin', '-y', '-v', 'error'];
  const final = ['-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', '-f', 'mp4', salida];
  if (!m.video) {
    // Solo audio, con imagen negra de 1280 × 720 a 25 fps. El tamaño da igual
    // (es negro) y así decodificarla no le cuesta nada a nadie. El negro dura
    // lo que el audio. Sin fin y cortado con -shortest, el codificador se
    // pasaba unos 3 s en un audio largo (los de Juanlu, 21-10-2026).
    const fps = { n: 25, d: 1, v: 25 };
    const dura = m.duracion > 0 ? `:d=${m.duracion.toFixed(3)}` : '';
    return {
      args: [...comun, '-f', 'lavfi', '-i', `color=c=black:s=1280x720:r=25${dura}`, '-i', entrada,
        '-map', '0:v:0', '-map', '1:a:0', '-shortest',
        ...argumentosX264(perfil, fps, true), ...argumentosAudio(loud), ...final],
      ancho: 1280, alto: 720, fps,
    };
  }
  const { filtros, ancho, alto, fps } = filtrosVideo(m, perfil);
  return {
    args: [...comun, '-i', entrada, '-map', `0:${m.indiceVideo}`, ...(m.audio ? ['-map', `0:${m.audio.index}`] : []),
      '-vf', filtros, '-fps_mode', 'cfr', ...argumentosX264(perfil, fps),
      ...(m.audio ? argumentosAudio(loud) : ['-an']), ...final],
    ancho, alto, fps,
  };
}

// ---------------------------------------------------------------------------
// Comprobar lo que sale
// ---------------------------------------------------------------------------
function indiceAlPrincipio(ruta) {
  const fd = openSync(ruta, 'r');
  try {
    const caja = Buffer.alloc(16);
    const tam = statSync(ruta).size;
    let pos = 0;
    while (pos + 8 <= tam) {
      readSync(fd, caja, 0, 16, pos);
      let largo = caja.readUInt32BE(0);
      const tipo = caja.toString('latin1', 4, 8);
      if (tipo === 'moov') return true;
      if (tipo === 'mdat') return false;
      if (largo === 1) largo = Number(caja.readBigUInt64BE(8));
      if (largo < 8) return false;
      pos += largo;
    }
    return false;
  } finally { closeSync(fd); }
}

function comprobar(ruta, esperado, m) {
  const fallos = [];
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', ruta], { encoding: 'utf8' }));
  const v = info.streams.find((s) => s.codec_type === 'video');
  const a = info.streams.find((s) => s.codec_type === 'audio');
  if (!v) fallos.push('no tiene imagen');
  else {
    if (v.codec_name !== 'h264') fallos.push(`vídeo ${v.codec_name}`);
    if (v.profile !== 'High') fallos.push(`perfil ${v.profile}`);
    if (!(v.level <= 41)) fallos.push(`nivel ${v.level}`);
    if (v.pix_fmt !== 'yuv420p') fallos.push(`píxeles ${v.pix_fmt}`);
    if (v.width !== esperado.ancho || v.height !== esperado.alto) fallos.push(`${v.width}×${v.height} en vez de ${esperado.ancho}×${esperado.alto}`);
    const fps = fraccion(v.avg_frame_rate);
    if (fps && Math.abs(fps.v - esperado.fps.v) > 0.01) fallos.push(`${fps.v.toFixed(3)} fps en vez de ${esperado.fps.v.toFixed(3)}`);
    if ((v.side_data_list ?? []).some((d) => d.rotation)) fallos.push('sigue llevando giro');
  }
  if (m.audio || !m.video) {
    if (!a) fallos.push('se ha perdido el sonido');
    else if (a.codec_name !== 'aac' || a.channels !== 2) fallos.push(`audio ${a.codec_name} de ${a.channels} canales`);
  }
  const d = Number(info.format?.duration) || 0;
  if (m.duracion > 0 && Math.abs(d - m.duracion) > Math.max(0.25, 2 / (esperado.fps.v || 25))) {
    fallos.push(`dura ${d.toFixed(2)} s y el master ${m.duracion.toFixed(2)} s`);
  }
  if (!indiceAlPrincipio(ruta)) fallos.push('el índice no está al principio (+faststart)');
  const tags = info.format?.tags ?? {};
  if (Object.keys(tags).some((k) => /location|gps|xyz/i.test(k))) fallos.push('lleva la ubicación en los metadatos');
  const bytes = statSync(ruta).size;
  return { fallos, bytes, kbps: d > 0 ? Math.round((bytes * 8) / d / 1000) : 0, duracion: d };
}

// ---------------------------------------------------------------------------
// Trabajo
// ---------------------------------------------------------------------------
const hijos = new Set();
const aMedias = new Set();

function correr(args) {
  return new Promise((ok, mal) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    hijos.add(p);
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    p.on('error', (e) => { hijos.delete(p); mal(e); });
    p.on('close', (code) => {
      hijos.delete(p);
      if (code === 0) ok();
      else mal(new Error(err.trim().split('\n').slice(-3).join(' · ') || `ffmpeg salió con ${code}`));
    });
  });
}

// Con Ctrl+C se paran los ffmpeg y no se dejan ficheros a medias.
for (const s of ['SIGINT', 'SIGTERM']) {
  process.on(s, () => {
    for (const p of hijos) p.kill('SIGKILL');
    for (const f of aMedias) rmSync(f, { force: true });
    console.error('\nhe parado las versiones y he borrado lo que estaba a medias');
    process.exit(130);
  });
}

async function enCola(tareas, n) {
  const resultados = new Array(tareas.length);
  let siguiente = 0;
  const obrero = async () => {
    while (siguiente < tareas.length) {
      const i = siguiente;
      siguiente += 1;
      resultados[i] = await tareas[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, tareas.length) }, obrero));
  return resultados;
}

const mb = (b) => `${(b / 1e6).toFixed(1).replace('.', ',')} MB`;
const mbps = (k) => `${(k / 1000).toFixed(1).replace('.', ',')} Mbps`;
const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

async function main() {
  const o = opciones(process.argv.slice(2));
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { fallar('hace falta ffmpeg (brew install ffmpeg)'); }
  if (!existsSync(o.masters)) fallar(`no encuentro la carpeta de masters ${o.masters}`);

  const entradas = readdirSync(o.masters).filter((f) => !f.startsWith('.'));
  const nombres = entradas.filter((f) => statSync(join(o.masters, f)).isFile()).sort();
  // Las subcarpetas no se miran, pero se dice, que si no parecía que faltaban masters.
  const carpetas = entradas.filter((f) => statSync(join(o.masters, f)).isDirectory()).sort();
  const masters = [];
  const raros = [];
  const porBase = new Map();
  for (const f of nombres) {
    const ext = extname(f).toLowerCase();
    if (!AUDIO.includes(ext) && !VIDEO.includes(ext)) { raros.push(f); continue; }
    const base = basename(f, extname(f));
    if (porBase.has(base)) fallar(`«${porBase.get(base)}» y «${f}» darían el mismo nombre (${base}.mp4). Cambia uno de los dos`);
    porBase.set(base, f);
    masters.push({ fichero: f, base, ruta: join(o.masters, f) });
  }
  for (const c of carpetas) console.log(`  · la carpeta ${c} no la miro, pon los masters sueltos en ${basename(o.masters)}/`);
  if (!masters.length) fallar(`no hay masters en ${o.masters}`);
  for (const f of raros) console.log(`  · ${f} no es ni vídeo ni audio, lo salto`);
  for (const m of masters) {
    if (/[#?%]/.test(m.base)) console.log(`  · ${m.fichero} lleva # ? o % en el nombre, y esos signos dan guerra en una dirección web. Mejor quitarlos`);
    // Con «Unique Suffix», el Movie File Out de TouchDesigner deja el nombre
    // como «200_Bosque_T0.mov.0.mov» (llegó así el 22-10-2026). npm run layout
    // lo lee bien, pero el vídeo se queda con ese nombre en media/.
    const sufijo = /(?:\.(?:mov|mp4|m4v))*\.\d+$/i.exec(m.base);
    if (sufijo) {
      console.log(`  · ${m.fichero} lleva «${sufijo[0]}» detrás del nombre, que lo pone TouchDesigner. `
        + `Mejor renombrarlo a ${m.base.slice(0, sufijo.index)}${extname(m.fichero)} antes de pasarlo`);
    }
  }

  const manifiestoRuta = join(o.media, 'versiones.json');
  let manifiesto = { perfil: PERFIL, masters: {} };
  try {
    const leido = JSON.parse(readFileSync(manifiestoRuta, 'utf8'));
    if (leido?.masters) manifiesto = leido;
  } catch { /* primera vez */ }
  if (manifiesto.perfil !== PERFIL) manifiesto = { perfil: PERFIL, masters: {} };
  for (const v of o.solo) mkdirSync(join(o.media, v), { recursive: true });

  // Sondear todos primero. Así un master roto se sabe antes de ponerse a codificar.
  const estudiados = [];
  for (const m of masters) {
    try {
      const info = sondear(m.ruta);
      const st = statSync(m.ruta);
      const huella = `${PERFIL}:${st.size}:${Math.round(st.mtimeMs)}:${o.normalizar ? 'n' : '-'}`;
      estudiados.push({ ...m, ...info, huella, avisos: avisosDe(info) });
    } catch (e) {
      // Un master a medio copiar (o una exportación cortada) no tiene el
      // índice, que en un .mov va al final.
      const dice = String(e.stderr ?? '').trim();
      const roto = /moov atom not found|Invalid data/i.test(dice)
        ? 'no se puede leer, le falta el final. Igual está a medio copiar o la exportación se cortó. Vuelve a copiarlo'
        : `ffprobe no lo puede leer (${(dice || e.message).split('\n')[0]})`;
      estudiados.push({ ...m, roto });
    }
  }

  // Qué masters son solo audio, para que el móvil del público ponga el
  // altavoz encima del negro. En los que ya estaban hechos también se apunta,
  // sin volver a codificar nada.
  const marcarAudio = (e, m) => { if (m.video) delete e.soloAudio; else e.soloAudio = true; };
  for (const m of estudiados) {
    const e = manifiesto.masters[m.fichero];
    if (!m.roto && e?.huella === m.huella) marcarAudio(e, m);
  }

  const tareas = [];
  for (const m of estudiados) {
    if (m.roto) continue;
    const previo = manifiesto.masters[m.fichero];
    for (const v of o.solo) {
      const salida = join(o.media, v, `${m.base}.mp4`);
      const hecho = previo?.huella === m.huella && previo?.salidas?.[v] && existsSync(salida);
      if (hecho && !o.forzar) continue;
      tareas.push({ m, v, salida });
    }
  }

  // El volumen se mide una vez por master (y la medida de loudnorm, si hace falta).
  const necesitan = [...new Set(tareas.map((t) => t.m))];
  await enCola(necesitan.filter((m) => m.audio).map((m) => async () => {
    Object.assign(m, await volumen(m.ruta));
    if (o.normalizar) m.loud = await medirLoudnorm(m.ruta);
  }), o.paralelo * 2);

  const rotos = estudiados.filter((m) => m.roto).length;
  const cuantosRotos = rotos === 1 ? 'uno no se puede leer' : `${rotos} no se pueden leer`;
  console.log(`hay ${estudiados.length} masters en ${relative(process.cwd(), o.masters) || '.'}${rotos ? ` (${cuantosRotos})` : ''} y `
    + `${tareas.length ? `${tareas.length} versiones por hacer` : (rotos ? 'lo demás está hecho' : 'todo está hecho')} (${o.paralelo} a la vez)`);

  const errores = [];
  let hechas = 0;
  await enCola(tareas.map((t) => async () => {
    const parte = join(dirname(t.salida), `.${t.m.base}.parte.mp4`);
    aMedias.add(parte);
    try {
      const plan = orden(t.m, PERFILES[t.v], t.m.ruta, parte, o.normalizar ? t.m.loud : null);
      await correr(plan.args);
      const r = comprobar(parte, plan, t.m);
      if (r.fallos.length) throw new Error(r.fallos.join(', '));
      renameSync(parte, t.salida);
      aMedias.delete(parte);
      const entrada = manifiesto.masters[t.m.fichero];
      const nueva = entrada?.huella === t.m.huella ? entrada : { huella: t.m.huella, salidas: {} };
      nueva.duracion = Math.round(t.m.duracion * 100) / 100;
      if (t.m.lufs !== undefined) { nueva.lufs = t.m.lufs; nueva.pico = t.m.pico; }
      nueva.avisos = t.m.avisos;
      marcarAudio(nueva, t.m);
      nueva.salidas[t.v] = {
        fichero: `${t.v}/${t.m.base}.mp4`, ancho: plan.ancho, alto: plan.alto,
        fps: Math.round(plan.fps.v * 1000) / 1000, kbps: r.kbps, bytes: r.bytes,
      };
      manifiesto.masters[t.m.fichero] = nueva;
      writeFileSync(manifiestoRuta, `${JSON.stringify(manifiesto, null, 2)}\n`);
      hechas += 1;
      console.log(`  ${String(hechas).padStart(3)}/${tareas.length}  ${t.v.padEnd(7)} ${t.m.base}  ${plan.ancho}×${plan.alto}  ${mbps(r.kbps)}  ${mb(r.bytes)}`);
    } catch (e) {
      rmSync(parte, { force: true });
      aMedias.delete(parte);
      errores.push(`${t.m.fichero} → ${t.v} · ${e.message}`);
      console.log(`  ✗ ${t.v.padEnd(7)} ${t.m.base} · ${e.message}`);
    }
  }), o.paralelo);

  // Lo que ya no tiene master en esta carpeta se quita del manifiesto solo si
  // tampoco le queda ningún vídeo en media/ (los vídeos se quedan, que borrar
  // lo decide quien sabe si sigue haciendo falta). Los masters de Guille y los
  // audios de Juanlu pueden pasarse desde carpetas distintas al mismo media/,
  // y borrar la entrada de los otros les quitaba el «soloAudio», y con él el
  // altavoz del móvil. Si un master de esta pasada da el mismo nombre de
  // salida, el de antes sobra, porque sus vídeos son ya los del nuevo.
  for (const [f, e] of Object.entries(manifiesto.masters)) {
    if (nombres.includes(f)) continue;
    const pisado = porBase.has(basename(f, extname(f)));
    const quedan = Object.values(e?.salidas ?? {}).some((s) => typeof s?.fichero === 'string' && existsSync(join(o.media, s.fichero)));
    if (pisado || !quedan) delete manifiesto.masters[f];
  }
  writeFileSync(manifiestoRuta, `${JSON.stringify(manifiesto, null, 2)}\n`);

  // ---------- Informe ----------
  console.log('');
  const lufs = Object.values(manifiesto.masters).map((e) => e.lufs).filter((x) => typeof x === 'number');
  const med = mediana(lufs);
  for (const m of estudiados) {
    if (m.roto) { console.log(`✗ ${m.fichero} · ${m.roto}`); continue; }
    const e = manifiesto.masters[m.fichero];
    const que = m.video
      ? `${m.video.ancho}×${m.video.alto} a ${m.video.fps ? m.video.fps.v.toFixed(2).replace(/\.?0+$/, '') : '?'} fps`
      : 'solo audio';
    const vol = typeof e?.lufs === 'number' ? `${String(e.lufs).replace('.', ',')} LUFS` : (m.audio ? 'volumen sin medir' : 'sin sonido');
    console.log(`${m.fichero}  ${que}, ${(m.duracion || 0).toFixed(1).replace('.', ',')} s, ${vol}`);
    for (const a of m.avisos ?? []) console.log(`    · ${a}`);
    if (med !== null && typeof e?.lufs === 'number' && Math.abs(e.lufs - med) >= 6 && !o.normalizar) {
      console.log(`    · suena ${e.lufs > med ? 'mucho más fuerte' : 'mucho más bajo'} que el resto (${Math.abs(e.lufs - med).toFixed(0)} LU de la mediana), mira si es a propósito`);
    }
    if (typeof e?.pico === 'number' && e.pico > -0.5) console.log(`    · el pico llega a ${String(e.pico).replace('.', ',')} dBFS y puede saturar en algunos altavoces`);
  }
  const totales = Object.fromEntries(Object.keys(PERFILES).map((v) => [v, 0]));
  for (const e of Object.values(manifiesto.masters)) for (const [v, s] of Object.entries(e.salidas ?? {})) totales[v] += s.bytes;
  console.log(`\nen disco ocupan ${Object.entries(totales).map(([v, b]) => `${v} ${mb(b)}`).join(' · ')}`);
  if (errores.length) {
    console.log(`\n${errores.length === 1 ? 'Ha fallado una versión' : `Han fallado ${errores.length} versiones`}.`);
    for (const e of errores) console.log(`  · ${e}`);
    process.exitCode = 1;
  }
  if (rotos) {
    console.log(`\n${rotos === 1 ? 'Hay un master que no se puede leer, el del ✗ de arriba' : `Hay ${rotos} masters que no se pueden leer, los del ✗ de arriba`}.`);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
