// Systema 1LL0~ After Cage · pantalla fija de la sala
// Una página por pantalla (/screen/tele1, /screen/tele2…) con el mismo nombre
// que usa Max en sus mensajes (/tele1/video 3). Pone a pantalla completa lo
// que le manda el servidor y se queda en negro cuando no pone nada.
//
// En un iPad, una tablet o un móvil hay que tocarla una vez al encenderla (el
// «toque diario»). Sin un toque, ningún navegador deja sonar un vídeo. Hasta
// entonces pone los vídeos sin sonido y lo pide abajo a la izquierda. En una
// Raspberry con Chromium en modo quiosco no hace falta, porque se arranca con
// --autoplay-policy=no-user-gesture-required.
//
// Cuenta su estado al servidor (si suena, qué pone, si algo ha fallado) para
// el panel de la sala, que desde ahí la puede identificar o recargar.

const $ = (id) => document.getElementById(id);
const video = $('video');
const clip = $('clip');
const clipLabel = $('clip-label');
const clipTime = $('clip-time');
const tag = $('tag');
const ident = $('ident');

const name = decodeURIComponent(location.pathname.split('/')[2] ?? '').toLowerCase();
document.title = `Systema · ${name || 'pantalla'}`;

// De cada vídeo pone la versión «tablet» (npm run versiones) en lo táctil
// (iPad, tablet, móvil fijo, por Wi-Fi) y la «monitor» en el resto (Raspberry,
// ventanas del Mac, por cable). ?version=… lo cambia a mano.
const TOUCH = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
const VERSION = new URLSearchParams(location.search).get('version') || (TOUCH ? 'tablet' : 'monitor');
const fileOf = (v) => v.files?.[VERSION] ?? v.file;

let current = null;   // lo que pone ahora, tal como lo mandó el servidor, o null
let online = null;    // null mientras conecta la primera vez
let clipTimer = null;
let devMode = false;  // con --dev, lo que no tiene vídeo sale como «clip simulado»
let sock = null;

// Para saber si puede sonar sin un toque, se prueba con una décima de segundo
// de silencio en un <audio>, que sigue la misma norma que el <video>. Así se
// sabe desde el primer segundo si hay que pedir el toque, sin gastar un vídeo
// en probar. Lo del AudioContext no vale, porque Chrome lo deja arrancar
// aunque luego bloquee el vídeo (lo medí el 28-sep-2026).
function silence() {
  const n = 800;                                   // 0,1 s a 8 kHz, 8 bits, mono
  const v = new DataView(new ArrayBuffer(44 + n));
  const text = (at, s) => { for (let i = 0; i < s.length; i += 1) v.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + n, true); text(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  text(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i += 1) v.setUint8(44 + i, 128);  // el cero de 8 bits
  return URL.createObjectURL(new Blob([v.buffer], { type: 'audio/wav' }));
}
async function canSoundWithoutTouch() {
  if (navigator.getAutoplayPolicy) return navigator.getAutoplayPolicy('mediaelement') === 'allowed';
  const a = new Audio(silence());
  try { await a.play(); a.pause(); return true; } catch { return false; }
}
let sound = false;

// ---------------------------------------------------------------------------
// Estado, abajo a la izquierda, y lo mismo para el panel de la sala
// ---------------------------------------------------------------------------
let tagTimer = null;
function say(text, { call = false, fade = 0 } = {}) {
  clearTimeout(tagTimer);
  tag.textContent = text;
  if (call) tag.append(Object.assign(document.createElement('i'), { className: 'caret' }));
  tag.classList.toggle('call', call);
  tag.classList.remove('gone');
  if (fade) tagTimer = setTimeout(() => tag.classList.add('gone'), fade);
}

function status() {
  if (!name) return say('a esta dirección le falta el nombre de la pantalla, por ejemplo /screen/tele1', { call: true });
  if (online === null) return say(`${name} · conectando`);
  if (!online) return say(`${name} · sin conexión con la sala · reintentando`);
  if (!sound) return say(`${name} · toca la pantalla para activar el sonido`, { call: true });
  return say(`${name} · conectada`, { fade: 4000 });
}

let lastError = null;
let waiting = false;   // el vídeo espera datos, porque se ha atascado o la red va lenta
// Lo que pase en 300 ms va en un solo mensaje, y lo que ya se ha contado no se
// repite. Cada disparo daba dos o tres, y con el Max disparando deprisa el
// servidor cortaba a la pantalla por pesada (lo arreglé el 2-oct-2026).
let reportTimer = null;
let lastReport = '';
function report() {
  if (reportTimer) return;
  reportTimer = setTimeout(() => {
    reportTimer = null;
    if (!sock || sock.readyState !== WebSocket.OPEN) return;
    const msg = JSON.stringify({
      type: 'screen:status',
      sound,
      playing: current?.id ?? null,
      paused: Boolean(current?.file) && video.paused,
      waiting: Boolean(current?.file) && waiting,
      error: lastError,
      version: VERSION,
      size: `${screen.width}×${screen.height}`,
      hidden: document.hidden,
    });
    if (msg === lastReport) return;
    lastReport = msg;
    sock.send(msg);
  }, 300);
}

// Notación del propio Cage, como en el móvil (0'18")
function fmt(s) {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}"`;
}

// ---------------------------------------------------------------------------
// Reproducción
// ---------------------------------------------------------------------------
function stopVideo() {
  video.pause();
  if (video.getAttribute('src')) {
    video.removeAttribute('src');
    video.load();
  }
  video.hidden = true;
}

function blank() {
  clearInterval(clipTimer);
  clearTimeout(stallTimer);
  clearTimeout(retryTimer);
  waiting = false;
  clip.hidden = true;
  stopVideo();
}

function start() {
  video.muted = !sound;
  video.play().catch((err) => {
    // Si es un AbortError, lo ha cortado otro vídeo o un negro. No es un fallo.
    if (err.name !== 'NotAllowedError' || video.muted) return;
    // Se creía que podía sonar y no, así que sigue sin sonido y se pide el toque.
    sound = false;
    status();
    report();
    video.muted = true;
    video.play().catch(() => {});
  });
}

// Por dónde va el disparo actual, en segundos.
const elapsed = () => (current ? (performance.now() - current.t0) / 1000 : 0);

// Carga (o recarga) el vídeo actual entrando por donde va.
function load(join) {
  current.join = join;
  clip.hidden = true;
  video.hidden = false;
  video.src = fileOf(current);   // el mismo otra vez también vuelve a empezar
  start();
  armStall();
}

function show(v) {
  if (!v || (v.duration > 0 && v.at >= v.duration)) {
    current = null;
    blank();
    report();
    return;
  }
  // Tras una reconexión llega el mismo disparo, y se sigue sin cortar. `shot`
  // es único para cada disparo. `since` era la marca de antes, y dos
  // disparos en el mismo milisegundo la compartían.
  const id = v.shot ?? v.since;
  if (current && current.shotId === id) {
    // …salvo que el vídeo se haya quedado parado o con error mientras tanto
    // (la Wi-Fi se fue a mitad de la descarga), y entonces se recarga por donde va.
    if (current.file && (video.error || (video.paused && !video.ended) || video.readyState < 2)) load(true);
    return;
  }
  const t0 = performance.now() - v.at * 1000;
  // `join` marca que la página llega a un vídeo ya empezado (se acaba de abrir,
  // o vuelve de un corte). Un disparo nuevo llega con at ≈ 0.
  current = { ...v, t0, shotId: id };
  lastError = null;
  clearInterval(clipTimer);
  if (v.file) {
    load(v.at >= 1);
  } else if (devMode) {
    stopVideo();
    clipLabel.textContent = v.label;
    clip.hidden = false;
    const tick = () => {
      const left = v.duration - (performance.now() - t0) / 1000;
      if (left <= 0) { current = null; blank(); return; }
      clipTime.textContent = fmt(left);
    };
    tick();
    clipTimer = setInterval(tick, 250);
  } else {
    // En la sala, un concepto sin vídeo deja la pantalla en negro, y el
    // panel dice cuál falta. Al público no se le enseña un «clip simulado».
    stopVideo();
    lastError = `«${v.label}» no tiene vídeo en media/`;
  }
  report();
}

// Una página que se conecta a mitad de un vídeo entra por donde va. Un
// disparo nuevo empieza desde el principio aunque tarde en cargar.
video.addEventListener('loadedmetadata', () => {
  if (!current?.join) return;
  const at = elapsed();
  if (at < video.duration) video.currentTime = at;
});
video.addEventListener('ended', () => { current = null; blank(); report(); });
video.addEventListener('playing', () => { lastError = null; waiting = false; report(); });
video.addEventListener('waiting', () => { waiting = true; report(); });
video.addEventListener('pause', report);
let retryTimer = null;
video.addEventListener('error', () => {
  if (!video.getAttribute('src') || !current) return;
  const code = video.error?.code;
  // El 4 sale también cuando la red falla antes de tener los metadatos (así lo
  // manda la especificación de HTML), así que no distingue un tirón de la Wi-Fi
  // de un fichero roto.
  const what = { 1: 'cortado', 2: 'de red', 3: 'al decodificar', 4: 'de red o de fichero' }[code] ?? '';
  lastError = `no puedo poner «${current.label}» (error ${what || code})`;
  // Al público no se le enseña la ruta ni el error. La pantalla se queda en
  // negro y el panel de la sala lo cuenta. Solo en desarrollo sale aquí.
  if (devMode) say(`${name} · ${lastError} (${video.getAttribute('src')})`, { fade: 10000 });
  report();
  // Con error de red o de fichero y el disparo aún vigente, se reintenta por
  // donde va cada 3 s mientras dure. Antes solo se reintentaba el 2, y una vez,
  // así que un tirón de la Wi-Fi justo al empezar (que da un 4) dejaba la tele
  // en negro hasta el siguiente número del Max (lo arreglé el 2-oct-2026).
  if (code === 2 || code === 4) {
    const shot = current.shotId;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (current?.shotId === shot && elapsed() < current.duration - 1) load(true);
    }, 3000);
    return;
  }
  current = null;
  blank();
  // Que el aviso de error no se quede con el sitio del estado de siempre (el
  // del toque, sobre todo).
  setTimeout(status, devMode ? 10500 : 0);
});

// Un vídeo que deja de avanzar 8 s sin haber acabado (atascado sin error) se
// recarga por donde va.
let stallTimer = null;
let lastTime = -1;
function armStall() {
  clearTimeout(stallTimer);
  stallTimer = setTimeout(() => {
    if (!current?.file || video.ended) return;
    if (elapsed() >= current.duration - 1) return;
    load(true);
  }, 8000);
}
video.addEventListener('timeupdate', () => {
  if (video.currentTime !== lastTime) { lastTime = video.currentTime; armStall(); }
});

// ---------------------------------------------------------------------------
// El toque de encendido da sonido, pantalla completa y que no se apague
// ---------------------------------------------------------------------------
let lock = null;
async function keepAwake() {
  if (lock || !('wakeLock' in navigator)) return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch { /* sin HTTPS no existe. En el iPad, Bloqueo automático en «Nunca» */ }
}

function fullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  const el = document.documentElement;
  try {
    (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el, { navigationUI: 'hide' })?.catch?.(() => {});
  } catch { /* en iPhone una web no tiene pantalla completa */ }
}

function touch() {
  if (!sound) {
    sound = true;
    video.muted = false;
    // Va dentro del toque, y desde aquí Safari deja sonar ESTE <video> sin más
    // toques, también los que lleguen después. Si no hay nada puesto, load()
    // hace de llave igual.
    if (current?.file) video.play().catch(() => {});
    else video.load();
    report();
  }
  keepAwake();
  // La pantalla completa va la última, porque pedirla gasta la activación del
  // toque, y un play() que viniera detrás ya no contaría como nacido de él.
  fullscreen();
  status();
}
// touchend además de click, porque en iPhone y iPad un toque sobre algo que no
// es un botón no siempre llega como click al documento.
document.addEventListener('touchend', touch);
document.addEventListener('click', touch);

document.addEventListener('visibilitychange', () => {
  report();
  if (document.hidden) return;
  keepAwake();
  // Al desbloquear el iPad, si lo que tocaba ya ha acabado, negro. Si no,
  // sigue por donde va la sala, no por donde se quedó.
  if (!current?.file) return;
  if (elapsed() >= current.duration) { current = null; blank(); report(); return; }
  if (video.paused && !video.ended) {
    if (Number.isFinite(video.duration) && elapsed() < video.duration) video.currentTime = elapsed();
    start();
  }
});

// ---------------------------------------------------------------------------
// El panel de la sala le pide identificarse (su nombre en grande, para
// saber en el montaje qué tele es cuál) y recargarse.
// ---------------------------------------------------------------------------
let identTimer = null;
function identify(seconds = 8) {
  ident.textContent = name;
  ident.hidden = false;
  clearTimeout(identTimer);
  identTimer = setTimeout(() => { ident.hidden = true; }, seconds * 1000);
}

// ---------------------------------------------------------------------------
// La conexión con la sala es como la del móvil (latido, reconexión con espera
// creciente), salvo en que un tirón de la Wi-Fi no para el vídeo. En una
// pantalla de la sala, mejor que siga a que se quede en negro.
// ---------------------------------------------------------------------------
let retry = 1000;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const s = new WebSocket(`${proto}://${location.host}/ws`);
  sock = s;
  let gone = false;
  let beatMs = 0;
  const lost = () => {
    if (gone) return;
    gone = true;
    clearTimeout(watchdog);
    try { s.close(); } catch { /* ya estaba cerrado */ }
    online = false;
    status();
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, 10000); // 1 → 2 → 4 → 8 → 10 s
  };
  // Vigía desde el primer momento. Una conexión que se queda en «conectando»
  // (la Wi-Fi se fue sin que el sistema lo note) no espera al plazo del
  // sistema, que puede ser de más de un minuto.
  let watchdog = setTimeout(lost, 8000);
  s.addEventListener('open', () => {
    retry = 1000;
    // Con un socket nuevo, el servidor no sabe nada de esta pantalla todavía.
    lastReport = '';
    s.send(JSON.stringify({ type: 'hello', role: 'screen', name }));
  });
  s.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.beat > 0) beatMs = msg.beat * 1000;
    clearTimeout(watchdog);
    watchdog = setTimeout(lost, beatMs ? beatMs * 2.5 : 25000);
    if (msg.type === 'snapshot') {
      devMode = Boolean(msg.dev);
      // «conectada» cuando ya ha llegado lo que tiene que poner, no al abrir.
      online = true;
      status();
    }
    if (msg.type === 'snapshot' || msg.type === 'video') show(msg.video);
    if (msg.type === 'identify') identify(msg.seconds);
    if (msg.type === 'reload') location.reload();
    if (msg.type === 'snapshot') report();
  });
  s.addEventListener('close', lost);
  s.addEventListener('error', lost);
}

status();
keepAwake();
if (name) connect();
canSoundWithoutTouch().then((ok) => {
  if (!ok || sound) return;
  sound = true;
  video.muted = false;   // si ya había empezado algo, en silencio, ahora suena
  status();
  report();
});
