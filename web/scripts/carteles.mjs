// Los dos carteles del recorrido, con su QR. El de la entrada, para unirse a
// la Wi-Fi de la sala de un toque, y el de más adelante, para abrir el mapa.
// Fue idea de Juanlu en la reunión del 23-09-2026 que fueran parte del
// acceso a la instalación, «aquí párate y haz esto».
//
//   npm run carteles -- --red SYSTEMA --clave unaclave
//   npm run carteles -- --red SYSTEMA                      red abierta, sin clave
//   npm run carteles -- --red SYSTEMA --clave x --ip 192.168.8.10
//                       con la IP del Mac debajo, en letra y en un QR pequeño,
//                       por si systema.internal no abre en algún móvil
//   npm run carteles -- … --web http://192.168.8.10/     si el router no deja dar
//                       nombres, el QR grande va directo a la IP (por defecto,
//                       http://systema.internal/)
//   npm run carteles -- … --tamano A5                     A4 por defecto
//
// Deja en carteles/ cada cartel en HTML (se abre e imprime desde cualquier
// navegador, con la letra dentro) y, si encuentra Chrome, también en PDF.
// Además, cada QR suelto en SVG, por si se quiere maquetar en otro sitio.
//
// Lo que dicen los carteles está en TEXTOS, aquí abajo, para cambiarlo sin
// tocar nada más. Hay cosas que no son de estilo y conviene que se queden.
// Que la red no tiene internet (sin aviso, más de uno se sale de ella cuando
// el móvil lo dice). Que en Android, con los datos móviles encendidos, la web
// no abre hasta que se acepta el aviso de «esta red no tiene internet» o se
// apagan los datos (mientras tanto el móvil sigue saliendo por los datos, lo
// dice el código de Android). Y que el cartel tiene que estar iluminado,
// porque en una sala a oscuras la cámara no lee el QR.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const TEXTOS = {
  red: {
    paso: '1',
    titulo: 'la red',
    pie: [
      'apunta la cámara del móvil al cuadrado',
      'la red no tiene internet, es solo de la obra',
      'si el móvil avisa de que no hay internet, toca el aviso y dile que sí',
    ],
  },
  mapa: {
    paso: '2',
    titulo: 'el mapa',
    escribe: 'o escribe en el navegador',
    tambien: 'o también',
    respaldo: 'o este',
    pie: [
      'toca una palabra para verla, y sube el volumen',
      'si no abre, apaga un momento los datos móviles',
      'y vuelve a probar',
    ],
  },
};

// ---------------------------------------------------------------------------
// Opciones
// ---------------------------------------------------------------------------
function opciones(argv) {
  const o = { red: null, clave: null, web: 'http://systema.internal/', ip: null, salida: join(root, 'carteles'), tamano: 'A4' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = argv[i + 1];
    const toma = () => { if (v === undefined) fallar(`falta el valor de ${a}`); i += 1; return v; };
    if (a === '--red') o.red = toma();
    else if (a === '--clave') o.clave = toma();
    else if (a === '--web') o.web = toma();
    else if (a === '--ip') o.ip = toma();
    else if (a === '--salida') o.salida = resolve(toma());
    else if (a === '--tamano') o.tamano = toma().toUpperCase();
    else fallar(`no conozco la opción ${a}`);
  }
  if (!o.red) fallar('falta el nombre de la red, por ejemplo --red SYSTEMA');
  if (o.clave !== null && (o.clave.length < 8 || o.clave.length > 63)) {
    fallar('una clave WPA tiene entre 8 y 63 caracteres');
  }
  if (!['A4', 'A5'].includes(o.tamano)) fallar('--tamano es A4 o A5');
  try { new URL(o.web); } catch { fallar(`la dirección no vale (${o.web})`); }
  // La IP del Mac, tal cual (192.168.8.10) o con el puerto si no es el 80.
  if (o.ip !== null) {
    // Sin ceros delante. 192.168.8.010 se leía en octal y el QR iba a la .8.
    const m = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})(?::(\d{1,5}))?$/.exec(o.ip);
    if (!m || m.slice(1, 5).some((n) => Number(n) > 255)) fallar(`la IP no vale (${o.ip}), tiene que ser algo como 192.168.8.10`);
  }
  return o;
}

function fallar(texto) {
  console.error(`no puedo hacer los carteles, ${texto}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Lo que lleva cada QR
// ---------------------------------------------------------------------------
// La cámara de iPhone (desde iOS 11) y la de Android (desde Android 10)
// entienden `WIFI:T:WPA;S:<red>;P:<clave>;;` o, sin clave,
// `WIFI:T:nopass;S:<red>;;`. Los caracteres `\ ; , : "` van escapados.
export function qrDeRed(red, clave) {
  const esc = (s) => s.replace(/([\\;,:"])/g, '\\$1');
  return clave ? `WIFI:T:WPA;S:${esc(red)};P:${esc(clave)};;` : `WIFI:T:nopass;S:${esc(red)};;`;
}

// Un QR en SVG, con un cuadrado por módulo, juntos en un solo trazado, y el
// margen blanco de 4 módulos que pide la norma (sin él, cuesta leerlo).
export function svgDeQr(texto) {
  const qr = QRCode.create(texto, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const m = 4;
  let d = '';
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (qr.modules.get(y, x)) d += `M${x + m} ${y + m}h1v1h-1z`;
    }
  }
  const lado = n + 2 * m;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges"><rect width="${lado}" height="${lado}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// ---------------------------------------------------------------------------
// Los carteles van en papel blanco y tinta negra, en el registro de la web
// (Space Mono, regla punteada, marcas de esquina) y no en otro.
// ---------------------------------------------------------------------------
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function fuentes() {
  const f = (peso) => readFileSync(join(root, 'public', 'fonts', `space-mono-${peso}.woff2`)).toString('base64');
  return `@font-face{font-family:'Space Mono';font-weight:400;src:url(data:font/woff2;base64,${f(400)}) format('woff2')}
@font-face{font-family:'Space Mono';font-weight:700;src:url(data:font/woff2;base64,${f(700)}) format('woff2')}`;
}

export const TILDE = '<svg class="tilde" viewBox="0 0 22 10" aria-hidden="true"><path d="M1 6.5c2.5-5 5.5-5 8 0s5.5 5 8 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

// `apilado` pone cada dato debajo de su etiqueta, para que una dirección larga
// quepa entera en una línea. `respaldo` es un QR pequeño abajo a la derecha.
function cartel({ tamano, paso, titulo, qr, datos, pie, apilado = false, respaldo = null }) {
  const a5 = tamano === 'A5';
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Systema 1LL0~ · ${esc(titulo)}</title>
<style>
${fuentes()}
@page { size: ${tamano}; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; color: #000; font-family: 'Space Mono', monospace; }
.hoja { position: relative; width: ${a5 ? '148mm' : '210mm'}; height: ${a5 ? '210mm' : '297mm'}; padding: ${a5 ? '13mm' : '18mm'}; display: flex; flex-direction: column; }
.marca { position: absolute; width: 6mm; height: 6mm; border: 0 solid #000; }
.marca.si { top: 8mm; left: 8mm; border-top-width: .3mm; border-left-width: .3mm; }
.marca.sd { top: 8mm; right: 8mm; border-top-width: .3mm; border-right-width: .3mm; }
.marca.ii { bottom: 8mm; left: 8mm; border-bottom-width: .3mm; border-left-width: .3mm; }
.marca.id { bottom: 8mm; right: 8mm; border-bottom-width: .3mm; border-right-width: .3mm; }
.marca-obra { margin: 0; font-weight: 700; font-size: ${a5 ? '11pt' : '14pt'}; letter-spacing: .02em; display: flex; align-items: baseline; gap: .5em; }
.marca-obra .sub { font-weight: 400; font-size: .75em; letter-spacing: .08em; }
.tilde { width: 1.1em; height: .5em; vertical-align: baseline; }
.regla { border: 0; border-top: .35mm dotted #000; margin: ${a5 ? '5mm' : '7mm'} 0; }
.paso { margin: 0; font-size: ${a5 ? '30pt' : '42pt'}; line-height: 1; font-weight: 700; }
.paso .n { font-weight: 400; }
.qr { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 0; }
/* Grande, porque en una sala a oscuras se escanea desde más lejos de lo que parece. */
.qr svg { width: ${a5 ? '104mm' : '150mm'}; height: auto; display: block; }
.bajo { display: flex; align-items: flex-end; justify-content: space-between; gap: 6mm; }
.datos { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 1.5mm 6mm; font-size: ${a5 ? '13pt' : '17pt'}; }
.datos.apilado { grid-template-columns: 1fr; gap: 0; }
.datos.apilado dd + dt { margin-top: 2.5mm; }
.datos dt { font-weight: 400; }
.datos dd { margin: 0; font-weight: 700; word-break: break-all; }
/* El de respaldo, pequeño y a un lado, porque el que se escanea es el grande. */
.respaldo { margin: 0; flex: none; text-align: center; font-size: ${a5 ? '8pt' : '10pt'}; }
.respaldo svg { width: ${a5 ? '24mm' : '32mm'}; height: auto; display: block; }
.respaldo figcaption { margin-top: 1mm; }
.pie { margin: ${a5 ? '5mm' : '7mm'} 0 0; padding: 0; list-style: none; font-size: ${a5 ? '9pt' : '11pt'}; line-height: 1.45; }
</style>
</head>
<body>
<div class="hoja">
<i class="marca si"></i><i class="marca sd"></i><i class="marca ii"></i><i class="marca id"></i>
<p class="marca-obra"><span>SYSTEMA 1LL0${TILDE}</span><span class="sub">after cage</span></p>
<hr class="regla">
<p class="paso"><span class="n">${esc(paso)} ·</span> ${esc(titulo)}</p>
<div class="qr">${qr}</div>
<div class="bajo">
<dl class="datos${apilado ? ' apilado' : ''}">${datos.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
${respaldo ? `<figure class="respaldo">${respaldo.qr}<figcaption>${esc(respaldo.texto)}</figcaption></figure>` : ''}
</div>
<hr class="regla">
<ul class="pie">${pie.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
</div>
</body>
</html>
`;
}

export function chrome() {
  const candidatos = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  ];
  return candidatos.find((c) => existsSync(c)) ?? null;
}

// Un PDF con Chrome sin ventana. Con un perfil temporal, para no tocar el
// del navegador de quien lo lanza (con el de siempre, dos impresiones
// seguidas chocaban por su bloqueo). Y sin esperar a que se cierre solo. Con
// un perfil nuevo escribe el PDF y se queda abierto (medido el 1-oct-2026 en
// macOS 26), así que se cierra en cuanto dice que ha escrito el fichero.
export function imprimir(c, html, pdf) {
  const perfil = mkdtempSync(join(tmpdir(), 'carteles-chrome-'));
  return new Promise((ok, mal) => {
    const p = spawn(c, ['--headless=new', `--user-data-dir=${perfil}`, '--use-mock-keychain', '--no-first-run',
      '--no-default-browser-check', '--no-pdf-header-footer', '--disable-gpu', `--print-to-pdf=${pdf}`, `file://${html}`],
    { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    let hecho = false;
    let cerrado = false;
    p.once('close', () => { cerrado = true; });
    const fin = (e) => {
      if (hecho) return;
      hecho = true;
      clearTimeout(reloj);
      p.kill('SIGKILL');
      // El perfil se borra cuando Chrome ya no escribe en él. Con el
      // ordenador cargado, sus procesos de ayuda seguían escribiendo y el
      // borrado chocaba. Si aun así no se puede, se queda en la carpeta
      // temporal del sistema, que no es un fallo del cartel.
      const limpia = () => {
        try { rmSync(perfil, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* temporal del sistema */ }
        if (e) mal(e); else ok();
      };
      if (cerrado) limpia(); else { p.once('close', limpia); setTimeout(limpia, 3000).unref(); }
    };
    const reloj = setTimeout(() => fin(new Error(`Chrome no ha escrito ${pdf} en 60 s`)), 60_000);
    p.stderr.on('data', (d) => {
      err += d;
      if (/bytes written to file/.test(err)) fin();
    });
    p.on('error', fin);
    // 'close' y no 'exit', que llega cuando ya se ha leído todo lo que ha dicho.
    p.on('close', (code) => { if (!/bytes written to file/.test(err)) fin(new Error(`Chrome ha salido con ${code} sin escribir ${pdf}`)); });
  });
}

async function main() {
  const o = opciones(process.argv.slice(2));
  mkdirSync(o.salida, { recursive: true });
  const url = new URL(o.web);
  const qrRed = svgDeQr(qrDeRed(o.red, o.clave));
  const qrMapa = svgDeQr(url.href);
  writeFileSync(join(o.salida, 'qr-red.svg'), qrRed);
  writeFileSync(join(o.salida, 'qr-mapa.svg'), qrMapa);

  const red = cartel({
    tamano: o.tamano, paso: TEXTOS.red.paso, titulo: TEXTOS.red.titulo, qr: qrRed,
    datos: [['red', o.red], ...(o.clave ? [['clave', o.clave]] : [['clave', 'sin clave']])],
    pie: TEXTOS.red.pie,
  });
  // Con «http://» delante y sin la barra del final. Escrito sin él, Chrome
  // prueba antes https o lo toma por una búsqueda (.internal no es un dominio
  // de internet), y sin internet eso no lleva a ninguna parte.
  const larga = (u) => `${u.protocol}//${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  // La IP de respaldo, en letra y en un QR pequeño. No pasa por el DNS, así
  // que abre aunque el nombre falle (por ejemplo, con el DNS privado de
  // Android en modo estricto). Si el QR grande ya va a la IP, sobra.
  const ipUrl = o.ip && o.ip.split(':')[0] !== url.hostname ? new URL(`http://${o.ip}/`) : null;
  const qrIp = ipUrl ? svgDeQr(ipUrl.href) : null;
  if (qrIp) writeFileSync(join(o.salida, 'qr-ip.svg'), qrIp);
  const mapa = cartel({
    tamano: o.tamano, paso: TEXTOS.mapa.paso, titulo: TEXTOS.mapa.titulo, qr: qrMapa,
    datos: [[TEXTOS.mapa.escribe, larga(url)], ...(ipUrl ? [[TEXTOS.mapa.tambien, larga(ipUrl)]] : [])],
    apilado: true,
    respaldo: qrIp ? { qr: qrIp, texto: TEXTOS.mapa.respaldo } : null,
    pie: TEXTOS.mapa.pie,
  });
  const html = [['cartel-1-red', red], ['cartel-2-mapa', mapa]];
  for (const [nombre, contenido] of html) writeFileSync(join(o.salida, `${nombre}.html`), contenido);

  const c = chrome();
  for (const [nombre] of html) {
    if (!c) break;
    await imprimir(c, join(o.salida, `${nombre}.html`), join(o.salida, `${nombre}.pdf`));
  }
  console.log(`los carteles están en ${o.salida}`);
  console.log(`  cartel-1-red     red «${o.red}»${o.clave ? ' con clave' : ' abierta'}`);
  console.log(`  cartel-2-mapa    ${url.href}${ipUrl ? ` (y ${ipUrl.href} en el QR pequeño)` : ''}`);
  console.log(c ? '  en HTML y en PDF, y cada QR suelto en SVG' : '  en HTML (sin Chrome no salen los PDF, se imprimen desde el navegador), y cada QR suelto en SVG');
  if (!o.ip && !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) {
    console.log('  ojo, sin --ip no lleva la IP del Mac de respaldo, por si el nombre no abre en algún móvil');
  }
  console.log('  ojo, el cartel tiene que estar iluminado, porque en una sala a oscuras la cámara no lee el QR');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => fallar(e.message));
}
