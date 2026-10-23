// Systema 1LL0~ After Cage · web del público
// Mapa de conceptos en SVG + d3-zoom, un único reproductor de vídeo y un
// canal WebSocket para resaltar lo que está sonando en la sala.
import { select, zoom, zoomIdentity, zoomTransform } from './vendor.js';

const $ = (id) => document.getElementById(id);
const svg = select('#map');
const stage = $('stage');
const player = $('player');
const video = $('video');
const sim = $('sim');
const altavoz = $('altavoz');
const simLabel = $('sim-label');
const timerEl = $('timer');
const progress = $('progress');
const now = $('now');
const nowLabel = $('now-label');
const nowRoom = $('now-room');
const toast = $('toast');
const connDot = $('conn');
const liveList = $('live-list');
const srLive = $('sr-live');
const hint = $('hint');
const note = $('note');

// ---------------------------------------------------------------------------
// 0. Tema. Oscuro por defecto, el botón cambia a claro y cada móvil se
//    acuerda de lo que eligió. Así quedó en la reunión del 23-09-2026.
// ---------------------------------------------------------------------------
const themeMeta = document.querySelector('meta[name="theme-color"]');
const themeLabel = $('theme-label');
function applyTheme(t) {
  if (t === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  themeMeta?.setAttribute('content', t === 'light' ? '#f4f2ec' : '#0c0c0c');
  themeLabel.textContent = t === 'light' ? 'oscuro' : 'claro';  // a qué se cambia
}
try { applyTheme(localStorage.getItem('systema-theme')); } catch { /* sin almacenamiento */ }
$('theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  try { localStorage.setItem('systema-theme', next); } catch { /* sin almacenamiento */ }
});

// ---------------------------------------------------------------------------
// 1. Datos. Posiciones congeladas (map.json) y concepto ↔ archivo (contents.json)
// ---------------------------------------------------------------------------
// En el modo demo (docs/demo.html) los datos vienen incrustados y la sala se
// simula en el propio móvil, sin servidor. Sirve para enseñar la web en una
// reunión o abrirla con doble clic.
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const demo = globalThis.SYSTEMA_DEMO || null;
// Si la Wi-Fi da un tirón justo al abrir la página (o el servidor se está
// reiniciando), se avisa y se reintenta en vez de quedarse en blanco. Un JSON
// roto no se arregla reintentando, así que ese error sí sale tal cual.
async function load(path) {
  for (let wait = 1000; ; wait = Math.min(wait * 2, 10000)) {
    const r = await fetch(path, { cache: 'no-cache' }).catch(() => null);
    if (r?.ok) return r.json();
    setOffline(true);
    await new Promise((res) => { setTimeout(res, wait); });
  }
}
// Sin conexión, el aviso tapa al hint y a la nota (antes se escribían uno
// encima del otro, letra a letra), la señal de las líneas se para y la barra
// «en sala» se apaga, porque lo que dice ya no es seguro.
function setOffline(on) {
  toast.hidden = !on;
  document.body.classList.toggle('offline', on);
}
const [map, contents] = demo ? [demo.map, demo.contents]
  : await Promise.all([load('/map.json'), load('/contents.json')]);
setOffline(false);
const byId = new Map(map.nodes.map((n) => [n.id, n]));
// Una palabra puede llevar varios vídeos, el mismo concepto visto desde varias
// pantallas (sus «videos», con el id de cada uno en contents.json). Lo que
// suena en la sala o se ve en un móvil llega con el id del vídeo, y se
// enciende su palabra.
const videosDe = (id) => byId.get(id)?.videos ?? [id];
const palabraDe = new Map(map.nodes.flatMap((n) => videosDe(n.id).map((v) => [v, n.id])));
const palabra = (v) => palabraDe.get(v) ?? v;

// El grado de cada concepto desempata, con el mapa girado, qué palabra calla
// primero cuando dos se pisan.
const degree = new Map(map.nodes.map((n) => [n.id, 0]));
for (const [a, b] of map.links) {
  degree.set(a, degree.get(a) + 1);
  degree.set(b, degree.get(b) + 1);
}

// El tamaño de cada palabra va en tres niveles, con los mismos cuerpos que usó
// layout.mjs para colocarlas sin que se pisen (van en map.json). En Space Mono
// cada letra mide 0,612 em en los dos pesos (lo medí), así que la caja de cada
// palabra se sabe sin leer el DOM. Un map.json de antes de las palabras no
// trae niveles, y entonces salen de las relaciones, como allí.
const FONT = map.font ?? { 1: 44, 2: 31, 3: 24 };
const ADVANCE = map.advance ?? 0.612;
const levelOf = new Map(map.nodes.map((n) => [n.id, n.lv]));
if (map.nodes.some((n) => !n.lv)) {
  [...map.nodes].sort((a, b) => degree.get(b.id) - degree.get(a.id))
    .forEach((n, rank) => { if (!n.lv) levelOf.set(n.id, rank < 8 ? 1 : rank < 24 ? 2 : 3); });
}
const boxOf = new Map(map.nodes.map((n) => {
  const fs = FONT[levelOf.get(n.id)];
  const text = [...n.label.normalize('NFC')].length * ADVANCE * fs;
  return [n.id, { fs, text, w: text + fs * 0.6, h: fs * 1.25 }];
}));

// El dibujo, el reproductor y el tiempo real comparten este estado, que es lo
// que suena en la sala, lo que se está viendo en algún móvil y lo último que
// se ha tocado en este.
let active = new Set();
let mobile = new Set();
let lastTouched = null;
// En desarrollo (y en la demo), una palabra sin vídeo abre el «clip simulado»
// de pruebas. En la sala no. El modo lo dice el servidor al conectar.
let devMode = Boolean(demo);
// La marca del catálogo que tiene este móvil (ver la sección 5).
let catalogo = null;
let reloadPending = false;

// ---------------------------------------------------------------------------
// 2. Dibujo del mapa
// ---------------------------------------------------------------------------
const root = svg.append('g').attr('class', 'root');
// Grupo de rotación, dentro del que maneja d3-zoom. Así el mapa se puede
// orientar como un plano de papel sin que el zoom y la rotación se pisen.
const rot = root.append('g').attr('class', 'rot');

const links = rot.append('g').attr('class', 'links')
  .selectAll('line')
  .data(map.links)
  .join('line')
  // Las que salen de la sección, el proceso o el medio llevan su tipo, que
  // les pone su línea (continua, discontinua o punteada, en app.css).
  .attr('class', ([, , tipo]) => (tipo ? `link ${tipo}` : 'link'))
  .attr('x1', ([a]) => byId.get(a).x)
  .attr('y1', ([a]) => byId.get(a).y)
  .attr('x2', ([, b]) => byId.get(b).x)
  .attr('y2', ([, b]) => byId.get(b).y);

// Aristas por nodo, para encenderlas sin recorrer todas
const linkEls = new Map(map.nodes.map((n) => [n.id, []]));
links.each(function each([a, b]) { linkEls.get(a).push(this); linkEls.get(b).push(this); });

const nodes = rot.append('g').attr('class', 'nodes')
  .selectAll('g')
  .data(map.nodes, (d) => d.id)
  .join('g')
  .attr('class', (d) => `node lv${levelOf.get(d.id)}`)
  .attr('data-id', (d) => d.id)
  .attr('transform', (d) => `translate(${d.x},${d.y})`);

// Cada concepto es su palabra, centrada donde antes iba la nota. Va dentro de
// un grupo que se endereza al girar el mapa (sección 2b). Debajo de la
// palabra va una caja del color del fondo, y así las líneas pasan por detrás
// y parecen terminar en la palabra en vez de atravesarla. Encima van el anillo
// de foco (solo con teclado) y el subrayado de lo último tocado, que es como
// se subraya a máquina.
const upright = nodes.append('g').attr('class', 'upright');
upright.append('rect').attr('class', 'knock')
  .attr('x', (d) => -boxOf.get(d.id).w / 2)
  .attr('y', (d) => -boxOf.get(d.id).h / 2)
  .attr('width', (d) => boxOf.get(d.id).w)
  .attr('height', (d) => boxOf.get(d.id).h);
upright.append('rect').attr('class', 'focus')
  .attr('x', (d) => -boxOf.get(d.id).w / 2 - 6)
  .attr('y', (d) => -boxOf.get(d.id).h / 2 - 4)
  .attr('width', (d) => boxOf.get(d.id).w + 12)
  .attr('height', (d) => boxOf.get(d.id).h + 8);
upright.append('line').attr('class', 'mark')
  .attr('x1', (d) => -boxOf.get(d.id).text / 2)
  .attr('x2', (d) => boxOf.get(d.id).text / 2)
  .attr('y1', (d) => boxOf.get(d.id).fs * 0.55)
  .attr('y2', (d) => boxOf.get(d.id).fs * 0.55);
upright.append('text').attr('class', 'word')
  .attr('text-anchor', 'middle')
  .attr('dy', '0.35em')
  .attr('font-size', (d) => boxOf.get(d.id).fs)
  .text((d) => d.label);

const nodeEl = new Map();
nodes.each(function each(d) { nodeEl.set(d.id, this); });

// Entrada escalonada del centro hacia fuera, solo la primera vez. El CSS anima
// opacity y scale, y el retardo por nodo va en --d. Se quita la clase al
// acabar para que el halo y el resto de transiciones queden limpias.
{
  const cx = map.width / 2; const cy = map.height / 2;
  const far = Math.hypot(cx, cy);
  nodes.each(function each(d) {
    const t = Math.hypot(d.x - cx, d.y - cy) / far;
    this.style.setProperty('--d', `${Math.round(t * 550)}ms`);
  });
  svg.classed('map-enter', true);
  setTimeout(() => svg.classed('map-enter', false), 1400);
}

// ---------------------------------------------------------------------------
// 2b. Orientación. El mapa gira y los nombres no
// ---------------------------------------------------------------------------
// El grupo `rot` gira alrededor del centro del mapa. Cada palabra lleva la
// rotación contraria respecto a SU sitio. Como las dos rotaciones se cancelan,
// la palabra queda horizontal y en su sitio. Es una transformación por
// palabra, sin recalcular nada del grafo.
let theta = 0;                       // grados
const cx = map.width / 2;
const cy = map.height / 2;

function applyRotation() {
  rot.attr('transform', `rotate(${theta},${cx},${cy})`);
  upright.attr('transform', `rotate(${-theta})`);
  queueDeclutter();   // al girar, dos palabras pueden caer una encima de otra
}

// Repintar el giro cuesta, porque son todas las palabras reescritas, cada una
// con su caja. iOS ya agrupa los `touchmove` por fotograma, así que el móvil
// nunca tuvo este problema. Pero un trackpad de Mac manda MÁS eventos de gesto
// que fotogramas tiene la pantalla, y ese trabajo se hacía dos y tres veces
// por fotograma para tirar todo menos el último. De ahí que el mismo giro
// saliera fino en el iPhone y a tirones en el trackpad. Aquí se pide UN
// repintado por fotograma, y siempre se pinta el ángulo más reciente.
let rotQueued = false;
function queueRotation() {
  if (rotQueued) return;
  rotQueued = true;
  requestAnimationFrame(() => { rotQueued = false; applyRotation(); });
}

// Coordenadas de un nodo YA rotadas, para centrarlo con el mapa girado.
function rotated(n) {
  const a = (theta * Math.PI) / 180;
  const dx = n.x - cx; const dy = n.y - cy;
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
}

// ---------------------------------------------------------------------------
// 2c. Con el mapa girado, las palabras tampoco se pisan
// ---------------------------------------------------------------------------
// Derecho, ninguna palabra pisa a otra, porque eso lo resuelve layout.mjs al
// colocarlas. Girado, cada palabra sigue horizontal (se lee) pero su sitio gira
// con el mapa, y dos pueden caer una encima de otra. Entonces calla la que
// menos importa hasta que vuelva a haber sitio. Primero va lo que suena en la
// sala, después lo que se ve en algún móvil, lo último tocado y luego cada
// nivel, del 1 al 3. Es geometría de cajas en unidades del mapa, sin leer el
// DOM, y solo corre cuando cambia el giro, lo encendido o lo tocado.
const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function declutter() {
  const crowded = new Set();
  const tilt = ((theta % 360) + 360) % 360;
  if (tilt > 0.5 && tilt < 359.5) {
    const rank = (n) => (active.has(n.id) ? 0 : mobile.has(n.id) ? 1 : n.id === lastTouched ? 2 : 2 + levelOf.get(n.id));
    const order = [...map.nodes].sort((a, b) => rank(a) - rank(b) || degree.get(b.id) - degree.get(a.id));
    const taken = [];
    for (const n of order) {
      const p = rotated(n);
      const { w, h } = boxOf.get(n.id);
      const box = { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y - h / 2, y1: p.y + h / 2 };
      if (taken.some((o) => overlaps(box, o))) crowded.add(n.id);
      else taken.push(box);
    }
  }
  for (const [id, el] of nodeEl) {
    const hidden = crowded.has(id);
    el.classList.toggle('crowded', hidden);
    // Lo que calla tampoco se alcanza con el teclado ni lo lee un lector de
    // pantalla, porque está tapado por otra palabra.
    el.setAttribute('tabindex', hidden ? '-1' : '0');
    if (hidden) el.setAttribute('aria-hidden', 'true'); else el.removeAttribute('aria-hidden');
  }
}

let declutterQueued = false;
function queueDeclutter() {
  if (declutterQueued) return;
  declutterQueued = true;
  requestAnimationFrame(() => { declutterQueued = false; declutter(); });
}

// ---------------------------------------------------------------------------
// 3. Pan y zoom táctil (d3-zoom trae el arrastre y el pinch, y el doble toque lo quito)
// ---------------------------------------------------------------------------
// Escala a la que el mapa entero cabe en pantalla. El zoom de entrada y los
// límites se definen relativos a ella, así funcionan igual en un móvil
// pequeño y en una tablet.
function fitScale() {
  const { width, height } = stage.getBoundingClientRect();
  return Math.min(width / map.width, height / map.height);
}
let fit = fitScale();
// Las palabras tienen su tamaño sobre la página y crecen al acercarse, como un
// papel bajo la lupa, así que no hay que recolocar nada al hacer zoom. Se
// entra a distancia de lectura, 1,8 veces lo que cabe en pantalla, pero sin que
// la palabra más pequeña baje de 12 px, la letra de la interfaz. Con un mapa
// grande (100 conceptos, lienzo de 1947 × 3235, medido) 1,8 veces el encaje
// la dejaría a 8,6 px en un móvil. Entonces se ve un trozo y se recorre como
// un plano. Se puede acercar hasta 4,5 veces el encaje, y al menos hasta que
// esa palabra salga a 30 px.
const READ_PX = 12;
const readK = () => Math.max(fit * 1.8, READ_PX / FONT[3]);
const maxK = () => Math.max(fit * 4.5, 30 / FONT[3]);

const zoomBehavior = zoom()
  .scaleExtent([0.6, 8]) // relativo, se ajusta en fitTransform()
  .on('zoom', (ev) => {
    if (ev.sourceEvent) {                // si el usuario toca, manda él
      cancelFlight();
      // Quien ya mueve el mapa ha leído la frase, así que se retira al rato en
      // vez de seguir tapando palabras hasta que abra el primer vídeo.
      if (!hintTimer) hintTimer = setTimeout(() => hint.classList.add('hide'), 2500);
    }
    root.attr('transform', ev.transform);
  });
let hintTimer = null;
svg.call(zoomBehavior).on('dblclick.zoom', null);
// Mientras se mueve el mapa, la señal de las líneas se para y vuelve a correr
// al soltar. Repintaba el mapa entero en cada fotograma y, con algo sonando en
// la sala, arrastrar costaba el triple en un móvil lento (medido en Chrome
// con la CPU seis veces más lenta, 3,4 s de trabajo frente a 1,2 s). En los
// vuelos, start y end saltan en cada fotograma, y la espera de 250 ms deja la
// clase puesta durante todo el vuelo.
let quieto = null;
zoomBehavior
  .on('start.senal', () => { clearTimeout(quieto); document.body.classList.add('moviendo'); })
  .on('end.senal', () => {
    clearTimeout(quieto);
    quieto = setTimeout(() => document.body.classList.remove('moviendo'), 250);
  });

function fitTransform() {
  const { width, height } = stage.getBoundingClientRect();
  fit = fitScale();
  zoomBehavior.scaleExtent([fit * 0.8, maxK()]);
  const k = readK();
  return zoomIdentity
    .translate(width / 2, height / 2)
    .scale(k)
    .translate(-map.width / 2, -map.height / 2);
}
// Vuelo de cámara propio. d3-transition está disponible (llega como
// dependencia de d3-zoom) y `svg.transition()` habría servido. Lo hice a mano
// por dos cosas que sí importan aquí, que el gesto del usuario interrumpe el
// vuelo en el acto y que bajo prefers-reduced-motion el salto es instantáneo.
// Si lo probáis, requestAnimationFrame NO corre con la pestaña en segundo
// plano, así que un vuelo comprobado desde otra ventana parece roto sin
// estarlo.
let flight = null;
let flightEnd = null;   // adónde iba el vuelo en curso, encuadre y ángulo
function cancelFlight() { if (flight) { cancelAnimationFrame(flight); flight = null; } }
// `turnTo` es el ángulo en el que debe quedar el mapa al terminar. La
// orientación viaja DENTRO del mismo vuelo que el encuadre, en vez de saltar
// al norte antes de arrancar.
function zoomTo(t, ms = 550, turnTo = null) {
  cancelFlight();
  const a = zoomTransform(svg.node());
  // Ángulo de salida expresado como el giro MÁS CORTO hasta el de destino,
  // porque `theta` se acumula sin límite al girar varias veces seguidas, y sin
  // normalizarlo el mapa daría vueltas de más para volver al mismo sitio.
  const th1 = turnTo === null ? theta : turnTo;
  const th0 = th1 + ((((theta - th1 + 180) % 360) + 360) % 360) - 180;
  const turns = th0 !== th1;
  flightEnd = { t, theta: th1 };
  if (REDUCED.matches || ms === 0) {
    if (turns) { theta = th1; applyRotation(); }
    svg.call(zoomBehavior.transform, t);
    return;
  }
  // Retirada de cámara. A mitad de camino el vuelo se aleja un poco y vuelve a
  // acercarse al llegar, que es como se mira un plano grande sobre la mesa. La
  // amplitud sale del trayecto, así que un recorrido corto no da un respingo.
  const mx = stage.clientWidth / 2;
  const my = stage.clientHeight / 2;
  const travel = Math.hypot(t.x - a.x, t.y - a.y) / Math.max(1, stage.clientWidth);
  const arc = Math.min(0.12, travel * 0.18);
  const t0 = performance.now();
  // Cuártica de entrada y salida. Arranca y frena más despacio que la cúbica
  // que había antes, que es de donde venía la sensación de tirón.
  const ease = (u) => (u < 0.5 ? 8 * u ** 4 : 1 - ((-2 * u + 2) ** 4) / 2);
  const step = (now) => {
    const u = Math.min(1, (now - t0) / ms);
    const e = ease(u);
    if (turns) { theta = th0 + (th1 - th0) * e; applyRotation(); }
    let x = a.x + (t.x - a.x) * e;
    let y = a.y + (t.y - a.y) * e;
    let k = a.k + (t.k - a.k) * e;
    const s = 1 - arc * Math.sin(Math.PI * u);
    if (s !== 1) {
      // La retirada se hace alrededor del CENTRO DE LA PANTALLA. Escalando
      // sobre el origen del transform, el mapa se escaparía hacia una esquina.
      x = mx - (mx - x) * s; y = my - (my - y) * s; k *= s;
    }
    svg.call(zoomBehavior.transform, zoomIdentity.translate(x, y).scale(k));
    flight = u < 1 ? requestAnimationFrame(step) : null;
  };
  flight = requestAnimationFrame(step);
}

function recenter(animated = true) {
  // «Centrar» también devuelve el norte, porque es la única salida de una
  // orientación en la que alguien se haya perdido. El norte NO se pone de golpe.
  // Va como un tercer eje del vuelo, así que el plano se endereza mientras la
  // cámara se retira. Por eso se toma más tiempo que un vuelo a un concepto.
  const t = fitTransform();
  zoomTo(t, animated ? 900 : 0, 0);
}
// Vuelo hasta un concepto desde la barra «en sala». Lo centra a distancia
// de lectura, con las etiquetas de alrededor visibles.
function flyTo(id) {
  const n = byId.get(id);
  if (!n) return;
  const { width, height } = stage.getBoundingClientRect();
  const k = Math.max(fit * 2.2, readK());
  const p = rotated(n);
  const t = zoomIdentity.translate(width / 2, height / 2 - 40).scale(k).translate(-p.x, -p.y);
  markTouched(id);
  zoomTo(t, 650);
}
// El gesto de dos dedos se escucha en fase de captura y NO se cancela, así que
// d3-zoom sigue viendo el mismo pinch y hace la escala y el desplazamiento
// mientras aquí solo se lee el ángulo entre los dedos. Umbral de 8° para que
// un pinch normal no gire el mapa sin querer.
{
  let start = null;
  const angle = (t) => Math.atan2(
    t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX,
  ) * 180 / Math.PI;

  stage.addEventListener('touchstart', (ev) => {
    if (ev.touches.length === 2) start = { a: angle(ev.touches), theta, armed: false };
  }, { capture: true, passive: true });

  stage.addEventListener('touchmove', (ev) => {
    if (!start || ev.touches.length !== 2) return;
    let d = angle(ev.touches) - start.a;
    if (d > 180) d -= 360; else if (d < -180) d += 360;
    if (!start.armed) {
      if (Math.abs(d) < 8) return;   // todavía es un pinch, no una rotación
      start.armed = true;
      start.a = angle(ev.touches);   // gira desde aquí, sin salto
      return;
    }
    theta = start.theta + d;
    applyRotation();
  }, { capture: true, passive: true });

  stage.addEventListener('touchend', () => { start = null; }, { capture: true, passive: true });

  // Con ratón y trackpad no hay gesto de rotación estándar, así que se usa
  // Mayúsculas + rueda. Sirve para probarlo en el ordenador de la sala.
  stage.addEventListener('wheel', (ev) => {
    if (!ev.shiftKey) return;
    ev.preventDefault();
    // macOS, y los trackpad de precisión de Windows, convierten Mayúsculas+rueda
    // en desplazamiento HORIZONTAL. El giro llega por deltaX en el trackpad y
    // por deltaY en un ratón de rueda, así que se toma el eje de más recorrido.
    // Además hay ratones que miden en LÍNEAS (deltaMode 1) en vez de en píxeles,
    // con valores ~16 veces menores, y sin normalizarlos el mapa apenas giraría.
    const d = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
    theta += d * (ev.deltaMode === 1 ? 16 : 1) * 0.15;
    queueRotation();
  }, { passive: false });

  // En el trackpad con Safari sí existe un gesto de rotación de verdad, y da el
  // ángulo ya en grados. Es de WebKit y no es estándar, así que en Chrome y en
  // Firefox no existe y queda el Mayúsculas+rueda de arriba. Se registra SOLO
  // donde no hay pantalla táctil (maxTouchPoints a 0 descarta iPhone y iPad),
  // porque ahí el giro de dos dedos ya lo lleva el bloque táctil y los dos se
  // pisarían escribiendo `theta` en el mismo gesto. Sin preventDefault en
  // gesturestart, Safari hace zoom de la página con el mismo movimiento.
  if ('GestureEvent' in window && navigator.maxTouchPoints === 0) {
    let g = null;
    stage.addEventListener('gesturestart', (ev) => {
      ev.preventDefault();
      g = { theta, base: 0, armed: false };
    }, { passive: false });
    stage.addEventListener('gesturechange', (ev) => {
      ev.preventDefault();
      if (!g) return;
      if (!g.armed) {
        // El MISMO umbral de 8° que en el móvil. Sin él, el trackpad empieza a
        // girar desde el primer grado y el gesto sale nervioso. Al hacer zoom
        // con dos dedos, el mapa se torcía sin que se lo pidieras. Un solo
        // gesto en los dos sitios, para que no haya que aprenderlo dos veces.
        if (Math.abs(ev.rotation) < 8) return;
        g.armed = true;
        g.base = ev.rotation;   // gira desde aquí, sin salto
        return;
      }
      theta = g.theta + (ev.rotation - g.base);
      queueRotation();
    }, { passive: false });
    stage.addEventListener('gestureend', (ev) => { ev.preventDefault(); g = null; }, { passive: false });
  }
}

// Entrada. El plano se presenta entero y desde lejos, y se acerca hasta la
// distancia de lectura. Es el mismo vuelo de «Centrar», solo que más largo,
// porque es lo primero que ve quien entra en la sala. Arranca justo en el
// límite de alejamiento que el zoom ya permite, así que no hay que tocar
// `scaleExtent` ni deshacer nada si alguien interrumpe el vuelo tocando.
function intro() {
  const t = fitTransform();
  if (REDUCED.matches) { zoomTo(t, 0, 0); return; }
  const { width, height } = stage.getBoundingClientRect();
  svg.call(zoomBehavior.transform, zoomIdentity
    .translate(width / 2, height / 2)
    .scale(fit * 0.8)
    .translate(-map.width / 2, -map.height / 2));
  zoomTo(t, 1200, 0);
}
intro();
$('recenter').addEventListener('click', () => recenter());

// Girar el móvil, o que Android entre y salga de la pantalla completa del
// vídeo, cambia el tamaño del lienzo. Se conserva la escala y lo que había en
// el centro en vez de recentrar, porque volver de un vídeo no puede devolverte
// al principio del mapa. Para empezar de cero ya está «centrar». Si el cambio
// pilla un vuelo a medias (en Android la barra del navegador se esconde justo
// mientras entra el mapa), el vuelo aterriza ya en su destino. Dejarlo
// congelado a mitad de camino dejaría el plano lejos y torcido.
let stageW = stage.clientWidth;
let stageH = stage.clientHeight;
window.addEventListener('resize', () => {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (w === stageW && h === stageH) return;
  const going = flight ? flightEnd : null;
  const t = going ? going.t : zoomTransform(svg.node());
  const dx = (w - stageW) / 2;
  const dy = (h - stageH) / 2;
  stageW = w;
  stageH = h;
  cancelFlight();
  if (going && going.theta !== theta) { theta = going.theta; applyRotation(); }
  fit = fitScale();
  zoomBehavior.scaleExtent([fit * 0.8, maxK()]);
  svg.call(zoomBehavior.transform, zoomIdentity.translate(t.x + dx, t.y + dy).scale(t.k));
});

// ---------------------------------------------------------------------------
// 4. Reproductor. Un solo <video>, reutilizado para todos los contenidos
// ---------------------------------------------------------------------------
let simTimer = null;
let simEnd = 0;
let playingId = null;     // la palabra que se está viendo
let playingVideo = null;  // y cuál de sus vídeos, que es lo que se le dice al servidor
let nowTimer = null;
let returnFocus = null;
let stallTimer = null;
let backPending = false;

// Pantalla completa de verdad allí donde existe para un elemento, que es en
// Android y en iPad. En iPhone no existe (fullscreenEnabled es false) y el
// vídeo ocupa el alto útil con las barras de Safari a la vista, como hablamos.
// Solo en pantallas táctiles, porque en un portátil que un clic se quede con
// la pantalla entera no es lo que pide el documento.
const FULLSCREEN = document.fullscreenEnabled && matchMedia('(pointer: coarse)').matches;
// Lo que queda detrás del vídeo. Mientras suena, ni el teclado ni un lector de
// pantalla deben poder llegar a los conceptos que hay debajo.
const behind = [document.querySelector('.top'), stage];

// Notación del propio Cage, como 4'33\" (y 0'12\" para lo breve)
function fmt(s) {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}\"`;
}

function withTransition(fn) {
  if (!document.startViewTransition) { fn(); return; }
  // Si otra transición pisa a esta, el navegador la salta, y no es un error.
  const t = document.startViewTransition(fn);
  for (const p of [t.ready, t.updateCallbackDone, t.finished]) p.catch(() => {});
}

function markTouched(id) {
  if (lastTouched) nodeEl.get(lastTouched)?.classList.remove('touched');
  lastTouched = id;
  nodeEl.get(id)?.classList.add('touched');
  queueDeclutter();
}

function setProgress(left, total) {
  progress.style.transform = `scaleX(${Math.max(0, Math.min(1, left / total))})`;
}

// Una línea tecleada abajo, donde el hint, para lo que hay que decirle al
// visitante sin abrir nada, como una palabra sin vídeo o un vídeo que no se ha
// podido poner. Se escribe letra a letra, se queda un rato y se va. Para un
// lector de pantalla va entera, en #sr-live.
let noteTimer = null;
function say(text, ms = 4000) {
  hint.classList.add('hide');
  clearTimeout(noteTimer);
  note.hidden = false;
  note.classList.remove('hide');
  typeTo(note, text, 22);
  srLive.textContent = text;
  noteTimer = setTimeout(() => note.classList.add('hide'), ms);
}

// Si un vídeo no se puede poner (no está, no se puede decodificar, se ha
// atascado), se dice, y se avisa al servidor para que en la sala se sepa cuál.
function fail(id, why) {
  if (playingId !== id) return;
  send({ type: 'phone:error', id: playingVideo, why });
  close();
  say(`«${byId.get(id)?.label ?? ''}» no se puede ver ahora`);
}

// Mientras el vídeo carga o se atasca, el contador lleva el cursor de máquina
// (el del hint), y se ve que está trabajando. Si en 15 s no avanza nada, se
// cierra con su aviso en vez de quedarse congelado.
function loading(on) { timerEl.classList.toggle('loading', on); }
function armStall(id) {
  clearTimeout(stallTimer);
  stallTimer = setTimeout(() => {
    if (playingId !== id || video.paused) return;
    // A décimas del final sin llegar a «ended» se ha visto entero, así que se
    // cierra sin aviso.
    if (Number.isFinite(video.duration) && video.duration - video.currentTime < 1) { close(); return; }
    fail(id, 'atascado');
  }, 15000);
}

// El altavoz va encima del negro cuando lo que suena es un audio, como pidieron
// Guille y Juanlu el 21-10-2026. Solo aquí, en el móvil del público. Las
// pantallas de la sala no lo ponen nunca. Se pide la primera vez que hace
// falta, y si public/altavoz.png no está, no sale nada.
let altavozFalta = false;
altavoz.addEventListener('error', () => { altavozFalta = true; altavoz.hidden = true; });
function mostrarAltavoz(si) {
  if (si && !altavozFalta && !altavoz.getAttribute('src')) altavoz.src = '/altavoz.png';
  altavoz.hidden = !si || altavozFalta;
}

// De una palabra con varios vídeos se pone uno al azar, y si hay más de uno,
// no el que este móvil puso la última vez en esa palabra. Los que no tienen
// fichero solo cuentan si no lo tiene ninguno.
const ultimo = new Map();   // palabra → el último vídeo que se puso
function elegir(id) {
  const todos = videosDe(id).filter((v) => contents[v]);
  const conFichero = todos.filter((v) => contents[v].file);
  let lista = conFichero.length ? conFichero : todos;
  if (lista.length > 1) lista = lista.filter((v) => v !== ultimo.get(id));
  const v = lista[Math.floor(Math.random() * lista.length)] ?? null;
  if (v) ultimo.set(id, v);
  return v;
}

function open(id) {
  const n = byId.get(id);
  const vid = n ? elegir(id) : null;
  const c = vid ? contents[vid] : null;
  if (!c || !n) return;
  markTouched(id);
  if (!c.file && !devMode) {
    // En la sala, una palabra sin vídeo no abre un reproductor vacío ni se
    // enciende en el mapa de los demás. El texto es provisional. Qué pasa al
    // tocar una palabra sin vídeo lo deciden Guille y Juanlu.
    say(`«${n.label}» no tiene vídeo`);
    return;
  }
  hint.classList.add('hide');
  playingId = id;
  playingVideo = vid;
  document.body.classList.add('viendo');

  // Todo esto va aquí mismo, síncrono, dentro del toque, porque iOS solo deja
  // sonar un play() que nace de un gesto, y Android solo concede la pantalla
  // completa dentro de uno. Antes el play() iba dentro de la View Transition,
  // que corre un fotograma después, y además había un «desbloqueo» en el
  // primer toque, un play() sobre el <video> todavía sin fuente que se
  // quedaba colgado hasta que arrancaba el vídeo de verdad y entonces lo
  // pausaba. El primer concepto de cada visitante se quedaba en negro. Por eso
  // la entrada ya no usa View Transition. El reproductor entra con un fundido
  // de CSS, y el vídeo arranca en el mismo instante del toque.
  player.hidden = false;
  if (c.file) {
    sim.hidden = true;
    video.hidden = false;
    mostrarAltavoz(Boolean(c.audio));
    // La versión para móvil, si las hay (npm run versiones).
    video.src = c.files?.movil ?? c.file;
    loading(true);
    armStall(id);
    video.play().catch((err) => {
      // Si es un AbortError, lo ha interrumpido otra carga (se cerró, o se abrió
      // otro concepto). No es un fallo. Cualquier otra cosa sí, y se dice.
      if (err.name !== 'AbortError') fail(id, err.name);
    });
  } else {
    // Sin MP4 todavía, un clip simulado del mismo tiempo para probar el flujo
    mostrarAltavoz(false);
    video.hidden = true;
    sim.hidden = false;
    simLabel.textContent = n.label;
    simEnd = Date.now() + c.duration * 1000;
    clearInterval(simTimer);
    simTimer = setInterval(() => {
      const left = (simEnd - Date.now()) / 1000;
      timerEl.textContent = fmt(left);
      setProgress(left, c.duration);
      if (left <= 0) close();
    }, 250);
  }
  // Que «atrás» cierre el vídeo en vez de salir de la web. También antes de
  // la pantalla completa, porque Chrome se salta al ir atrás las entradas
  // que se crearon sin gesto del usuario.
  try { history.pushState({ playing: id }, ''); } catch { /* iframe sin historial */ }
  // La pantalla completa va la ÚLTIMA, porque pedirla gasta la activación del
  // gesto, y un play() que venga detrás ya no cuenta como nacido del toque. Lo
  // medí en Chrome con la política de autoplay estricta. En el click
  // `navigator.userActivation.isActive` vale true, tras requestFullscreen()
  // vale false, y el play() se rechaza con NotAllowedError.
  if (FULLSCREEN) player.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {});
  returnFocus = document.activeElement;
  // inert no existe en Chrome 100-101, y aria-hidden cubre al lector de pantalla.
  for (const el of behind) { el.inert = true; el.setAttribute('aria-hidden', 'true'); }
  $('back').focus({ preventScroll: true });

  timerEl.textContent = fmt(c.duration);
  progress.style.transition = 'none';
  setProgress(1, 1);
  // La barra de progreso vuelve a transicionar a partir del primer avance
  requestAnimationFrame(() => { progress.style.transition = ''; });
  // Nombre del concepto un momento, y si también suena en la sala, se dice.
  nowLabel.textContent = n.label;
  nowRoom.hidden = !active.has(id);
  clearTimeout(nowTimer);
  now.classList.add('show');
  nowTimer = setTimeout(() => now.classList.remove('show'), 2500);
  send({ type: 'phone:play', id: vid });
}

function close() {
  // history.back() dispara popstate → close() otra vez, y playingId hace de guarda.
  if (!playingId) return;
  const vid = playingVideo;
  playingId = null;
  playingVideo = null;
  document.body.classList.remove('viendo');
  clearInterval(simTimer);
  clearTimeout(nowTimer);
  clearTimeout(stallTimer);
  loading(false);
  now.classList.remove('show');
  video.pause();
  video.removeAttribute('src');
  video.load();
  for (const el of behind) { el.inert = false; el.removeAttribute('aria-hidden'); }
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  if (document.fullscreenElement) {
    // Al salir de pantalla completa el visor cambia de tamaño, y un fundido
    // entre dos tamaños distintos da un salto. Aquí se cierra en seco.
    document.exitFullscreen().catch(() => {});
    player.hidden = true;
  } else {
    // Si antes de que corra la transición ya se ha abierto otro concepto
    // (con teclado se puede), el reproductor no se oculta.
    withTransition(() => { if (!playingId) player.hidden = true; });
  }
  try {
    if (history.state?.playing) { backPending = true; history.back(); }
  } catch { /* iframe sin historial */ }
  send({ type: 'phone:stop', id: vid });
  // La hoja cambió mientras se veía el vídeo, así que recarga ahora que no hay
  // nada abierto. Solo con conexión, porque si el cierre viene de perderla,
  // recargar daba la página de error del navegador, y la de Safari no se
  // reintenta sola. Sin conexión se espera, y al volver la instantánea trae la
  // marca nueva y recarga ahí.
  if (reloadPending && ws?.readyState === WebSocket.OPEN) setTimeout(() => location.reload(), 400);
}

let lastTime = -1;
video.addEventListener('timeupdate', () => {
  if (!Number.isFinite(video.duration)) return;
  const left = video.duration - video.currentTime;
  timerEl.textContent = fmt(left);
  setProgress(left, video.duration);
  if (video.currentTime !== lastTime && playingId) {
    lastTime = video.currentTime;
    loading(false);
    armStall(playingId);
  }
});
video.addEventListener('waiting', () => { if (playingId) loading(true); });
video.addEventListener('playing', () => loading(false));
// Una pausa del sistema (quitarse un AirPod, el centro de control, una
// llamada) no es un atasco. Antes, a los 15 s se cerraba con «no se puede ver»
// y el panel apuntaba un fallo que no era (lo arreglé el 2-oct-2026).
video.addEventListener('pause', () => { clearTimeout(stallTimer); loading(false); });
// Tras esa pausa, un toque en el vídeo lo reanuda, sin poner nada a la vista.
// Antes se quedaba congelado, y la única salida era volver al mapa y abrirlo
// de nuevo, que en una palabra con varios vídeos ponía otro.
player.addEventListener('click', (ev) => {
  if (ev.target.closest('button')) return;
  if (playingId && !video.hidden && video.paused && !video.ended && video.getAttribute('src')) video.play().catch(() => {});
});
video.addEventListener('play', () => { if (playingId) armStall(playingId); });
video.addEventListener('ended', close);
video.addEventListener('error', () => {
  // Un fichero que ya no está en media/ o que este móvil no sabe decodificar.
  if (video.getAttribute('src') && playingId) fail(playingId, `error ${video.error?.code ?? '?'}`);
});
$('back').addEventListener('click', close);
// La vuelta atrás que pide close() llega después, en otro turno. Si en medio
// se ha abierto otro vídeo (con teclado se puede, Esc y Enter seguidos), esa
// vuelta no es para cerrarlo. Se le devuelve su entrada en el historial, que
// el navegador ha perdido, para que el próximo «atrás» sí lo cierre.
window.addEventListener('popstate', () => {
  if (backPending) {
    backPending = false;
    if (playingId) { try { history.pushState({ playing: playingId }, ''); } catch { /* sin historial */ } }
    return;
  }
  if (playingId) close();
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && playingId) close(); });

// En Android, el primer «atrás» con el vídeo a pantalla completa solo sale de
// la pantalla completa y no llega a la página. Si el vídeo sigue abierto, se
// cierra también, y así un solo «atrás» devuelve al mapa, como en iPhone.
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && playingId) close();
  // Y al revés. Si el vídeo falló antes de que Android entrara en pantalla
  // completa, la pantalla completa llega con el reproductor ya cerrado y se
  // quedaba en negro. Se sale.
  else if (document.fullscreenElement && !playingId) document.exitFullscreen().catch(() => {});
});

// Al bloquear el móvil o cambiar de app, se detiene y vuelve al mapa
document.addEventListener('visibilitychange', () => {
  if (document.hidden) close();
});

// Toque en un nodo. d3-zoom anula el click si hubo arrastre, así que un
// «click» aquí es siempre un toque limpio.
nodes.on('click', (ev, d) => {
  ev.stopPropagation();
  open(d.id);
});

// Un toque que se queda corto abre la palabra más cercana, si está a menos de
// 16 px en pantalla. A la distancia de entrada, una palabra pequeña mide unos
// 15 px de alto, y en una sala a oscuras, con el móvil en una mano, el dedo no
// siempre acierta. No se agranda nada de lo que se ve, y entre dos palabras
// cercanas gana la más cercana. d3-zoom ya no deja pasar el click de un arrastre.
svg.on('click.cerca', (ev) => {
  const rect = svg.node().getBoundingClientRect();
  const tx = ev.clientX - rect.left;
  const ty = ev.clientY - rect.top;
  const t = zoomTransform(svg.node());
  let best = null;
  let bestD = 16;
  for (const n of map.nodes) {
    if (nodeEl.get(n.id).classList.contains('crowded')) continue;
    const p = rotated(n);
    const { w, h } = boxOf.get(n.id);
    const dx = Math.max(0, Math.abs(tx - t.applyX(p.x)) - (w * t.k) / 2);
    const dy = Math.max(0, Math.abs(ty - t.applyY(p.y)) - (h * t.k) / 2);
    const d = Math.hypot(dx, dy);
    if (d < bestD) { bestD = d; best = n; }
  }
  if (best) open(best.id);
});

// Alcanzables con teclado o conmutador, porque el mapa es el contenido.
nodes.attr('tabindex', 0)
  .attr('role', 'button')
  .attr('aria-label', (d) => d.label)
  .on('keydown', (ev, d) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    open(d.id);
  })
  // Con el teclado, el mapa sigue al foco. Una palabra fuera de la pantalla
  // se trae al centro, sin cambiar el zoom.
  .on('focus', function onFocus(ev, d) {
    let keyboard = true;
    try { keyboard = this.matches(':focus-visible'); } catch { /* navegador viejo */ }
    if (!keyboard) return;
    const r = this.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    if (r.left >= s.left && r.right <= s.right && r.top >= s.top && r.bottom <= s.bottom - 60) return;
    const p = rotated(d);
    const k = zoomTransform(svg.node()).k;
    zoomTo(zoomIdentity.translate(s.width / 2, s.height / 2 - 40).scale(k).translate(-p.x, -p.y), 400);
  });

// ---------------------------------------------------------------------------
// 5. Tiempo real. El servidor manda la lista de ids activos. Aquí solo se
//    aplica la diferencia cambiando clases y se refresca la barra «en sala».
// ---------------------------------------------------------------------------
let ws = null;
let retry = 1000;

// Lo que suena en la sala se pinta con la palabra en verde y la señal
// recorriendo sus líneas. Lo que se ve en un móvil, con la palabra en la
// segunda tinta, sin movimiento. Si algo está en las dos, manda la sala.
function setNodeActive(id, on) {
  nodeEl.get(id).classList.toggle('active', on);
  for (const el of linkEls.get(id)) el.classList.toggle('lit', on);
}

// Los conceptos que suenan se escriben y se borran letra a letra, como en
// una máquina. Se mueve el propio texto, sin ninguna caja que aparezca.
const entries = new Map();   // id → <button>
const liveEmpty = liveList.querySelector('.live-empty');

function typeTo(el, target, speed, done) {
  clearInterval(el.typer);
  if (REDUCED.matches) { el.textContent = target; done?.(); return; }
  el.typer = setInterval(() => {
    const cur = el.textContent;
    if (cur === target) { clearInterval(el.typer); done?.(); return; }
    // Si lo escrito no es prefijo del objetivo, se borra hacia atrás.
    el.textContent = target.startsWith(cur) ? target.slice(0, cur.length + 1) : cur.slice(0, -1);
  }, speed);
}

function renderLive() {
  const started = [];
  for (const id of active) {
    if (entries.has(id)) continue;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'entry';
    // El nombre accesible es el entero desde el primer instante, aunque en
    // pantalla todavía se esté tecleando.
    el.setAttribute('aria-label', `${byId.get(id).label}, llevar el mapa hasta aquí`);
    el.addEventListener('click', () => flyTo(id));
    liveList.append(el);
    entries.set(id, el);
    typeTo(el, byId.get(id).label, 28);
    started.push(byId.get(id).label);
  }
  for (const [id, el] of entries) {
    if (active.has(id)) continue;
    entries.delete(id);
    el.setAttribute('aria-hidden', 'true');
    el.tabIndex = -1;
    typeTo(el, '', 16, () => { el.remove(); liveEmpty.hidden = entries.size > 0; });
  }
  liveEmpty.hidden = entries.size > 0;
  // Para un lector de pantalla, como mucho un anuncio cada 10 s, con todo lo
  // que haya entrado entretanto, porque la sala cambia a menudo y no puede
  // hablar sin parar.
  if (started.length) {
    pendingAnnounce.push(...started);
    if (!announceTimer) {
      announceTimer = setTimeout(() => {
        announceTimer = null;
        if (pendingAnnounce.length) srLive.textContent = `Ahora suena en la sala ${[...new Set(pendingAnnounce)].join(', ')}.`;
        pendingAnnounce = [];
        // Cuenta desde que se anuncia y no desde que se programa. Si no, dos
        // anuncios podían salir con 3 s de diferencia.
        lastAnnounce = performance.now();
      }, lastAnnounce && performance.now() - lastAnnounce < 10000 ? 10000 - (performance.now() - lastAnnounce) : 0);
    }
  }
}
let pendingAnnounce = [];
let announceTimer = null;
let lastAnnounce = 0;

function applyActive(ids, phones = []) {
  const next = new Set(ids.map(palabra).filter((id) => nodeEl.has(id)));
  const nextMobile = new Set(phones.map(palabra).filter((id) => nodeEl.has(id) && !next.has(id)));
  for (const id of active) if (!next.has(id)) setNodeActive(id, false);
  // Una línea puede unir dos activos, así que se reafirma tras apagar
  for (const id of next) setNodeActive(id, true);
  for (const id of mobile) if (!nextMobile.has(id)) nodeEl.get(id).classList.remove('mobile');
  for (const id of nextMobile) nodeEl.get(id).classList.add('mobile');
  active = next;
  mobile = nextMobile;
  queueDeclutter();
  renderLive();
  if (playingId) nowRoom.hidden = !active.has(playingId);
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  let gone = false;
  let watchdog = null;

  // Una conexión se pierde UNA vez, avise el navegador con 'error', con
  // 'close' o no avise. Si la Wi-Fi se va sin despedirse, el socket puede
  // seguir «abierto» minutos. Por eso hay perro guardián. El servidor dice en
  // la instantánea cada cuánto late (`beat`, 10 s), y dos latidos y medio sin
  // oír nada es conexión muerta. Se arma desde la instantánea y no desde el
  // primer latido, para que también se note si la conexión muere en esos
  // primeros segundos. Un servidor que no anuncie latido no lo arma, y así no
  // hay reconexiones en bucle. Al perderla no se espera al cierre educado y se
  // suelta ya.
  let beatMs = 0;
  const lost = () => {
    if (gone) return;
    gone = true;
    clearTimeout(watchdog);
    if (ws === sock) ws = null;
    try { sock.close(); } catch { /* ya estaba cerrado */ }
    connDot.classList.remove('on');
    setOffline(true);
    close(); // al perder la Wi-Fi se detiene y se avisa, que es requisito
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, 10000); // 1 → 2 → 4 → 8 → 10 s
  };
  // Vigía desde el primer momento, como en las pantallas. Una conexión que se
  // queda en «conectando» (la Wi-Fi se fue sin que el sistema lo note) no
  // espera al plazo del sistema. El primer mensaje lo quita.
  watchdog = setTimeout(lost, 8000);

  sock.addEventListener('open', () => {
    retry = 1000;
    connDot.classList.add('on');
    setOffline(false);
    send({ type: 'hello', role: 'phone' });
    // Un vídeo abierto con la conexión caída no llegó a apuntarse. Va ahora.
    if (playingVideo) send({ type: 'phone:play', id: playingVideo });
  });

  sock.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.beat > 0) beatMs = msg.beat * 1000;
    clearTimeout(watchdog);
    if (beatMs) watchdog = setTimeout(lost, beatMs * 2.5);
    if (msg.type === 'snapshot') devMode = Boolean(msg.dev) || Boolean(demo);
    // Si la hoja o los vídeos han cambiado en el servidor, este móvil recarga en
    // cuanto no esté viendo nada, para no quedarse toda la visita con la
    // lista vieja.
    if (msg.cat) {
      if (catalogo === null) catalogo = msg.cat;
      else if (msg.cat !== catalogo) {
        if (!playingId) location.reload();
        else reloadPending = true;
      }
    }
    if (msg.type === 'snapshot' || msg.type === 'active') applyActive(msg.active || [], msg.mobile || []);
  });

  sock.addEventListener('close', lost);
  sock.addEventListener('error', lost);
}

// Sala simulada para el modo demo. Cuatro pantallas ficticias lanzan
// conceptos al azar y los sueltan cuando termina su duración, y unos cuantos
// móviles ficticios ven un concepto un rato.
function simulateRoom() {
  connDot.classList.add('on');
  document.querySelector('.brand-sub').textContent = 'After Cage · demo';
  const screens = new Map();
  const phones = new Map();
  const ids = Object.keys(contents);
  const refresh = () => applyActive([...new Set(screens.values())], [...new Set(phones.values())]);
  const phoneTick = () => {
    const phone = `phone_${Math.floor(Math.random() * 3)}`;
    const id = ids[Math.floor(Math.random() * ids.length)];
    phones.set(phone, id);
    refresh();
    setTimeout(() => {
      if (phones.get(phone) === id) { phones.delete(phone); refresh(); }
    }, 6000 + Math.random() * 12000);
    setTimeout(phoneTick, 4000 + Math.random() * 6000);
  };
  setTimeout(phoneTick, 2500);
  const tick = () => {
    const screen = `screen_0${1 + Math.floor(Math.random() * 4)}`;
    const id = ids[Math.floor(Math.random() * ids.length)];
    screens.set(screen, id);
    refresh();
    setTimeout(() => {
      if (screens.get(screen) === id) { screens.delete(screen); refresh(); }
    }, Math.min(contents[id].duration, 40) * 1000);
    setTimeout(tick, 3000 + Math.random() * 5000);
  };
  tick();
}

if (demo) simulateRoom(); else connect();
