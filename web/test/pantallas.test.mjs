// Pruebas de los arrancadores de pantallas, el del Mac (sala/pantallas/mac.sh)
// y el de Windows (windows.ps1), con pantallas y Chrome de mentira para no
// ocupar las de verdad. Las pantallas salen de un fichero que la prueba cambia
// (SYSTEMA_PANTALLAS_FALSAS), y el Chrome es un script que apunta con qué lo
// han abierto y espera a que lo cierren. El servidor es uno mínimo que contesta
// a /health, que la prueba puede tirar y que dice qué páginas tiene conectadas
// si la prueba se lo pide. Cada prueba va con los dos scripts.
// La de Windows corre con PowerShell 7 en el Mac (pwsh, o el que diga PWSH),
// y sin él se salta. Lo que solo pasa en Windows (sus pantallas de verdad, la
// escala, el acceso de inicio) no lo cubren.
//
//   npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const web = fileURLToPath(new URL('..', import.meta.url));
const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

let pwsh = process.env.PWSH || 'pwsh';
try { execFileSync(pwsh, ['-NoProfile', '-Command', '1'], { stdio: 'ignore' }); } catch { pwsh = null; }

// Cómo se lanza cada uno y dónde pone la ventana. El del Mac, encima de la
// pantalla y de su tamaño. El de Windows, pequeña y en el centro, porque Chrome
// allí mide con la escala de Windows.
const SCRIPTS = [
  {
    nombre: 'mac.sh',
    skip: process.platform !== 'darwin' ? 'solo en un Mac' : false,
    orden: (...a) => ['sh', [join(web, 'sala/pantallas/mac.sh'), ...a]],
    sitio: ([, x, y, w, h]) => [`${x},${y}`, `${w},${h}`],
    // El Mac la abre otra vez en la suya.
    fuera: async (m, v) => {
      assert.match(v.salida(), /tele1 no estaba en su pantalla, la abro otra vez en la suya/);
      await hasta(() => m.lanzamientos().filter((n) => n === 'tele1').length === 2 && m.abierta('tele1'), 10000, 'que se abra otra vez');
      assert.equal(opcion(m.args('tele1'), '--window-position'), '0,0');
    },
  },
  {
    nombre: 'windows.ps1',
    skip: process.platform === 'win32' ? 'en Windows abriría pantallas de verdad' : !pwsh ? 'sin PowerShell 7 (pwsh)' : false,
    orden: (...a) => [pwsh, ['-NoProfile', '-File', join(web, 'sala/pantallas/windows.ps1'), ...a]],
    sitio: ([, x, y, w, h]) => [`${x + w / 2 - 200},${y + h / 2 - 150}`, '400,300'],
    // Windows la lleva a su sitio dos veces (reabrirla la dejaría donde la puso
    // Chrome), y a la tercera la abre otra vez. Aquí no se puede mover de verdad.
    fuera: async (m, v) => {
      assert.match(v.salida(), /tele1 no estaba en su pantalla, la llevo a la suya/);
      await hasta(() => m.lanzamientos().filter((n) => n === 'tele1').length === 2 && m.abierta('tele1'), 15000, 'que a la tercera se abra otra vez');
      assert.match(v.salida(), /tele1 no estaba en su pantalla, la abro otra vez en la suya/);
    },
  },
];

let raiz;
let servidor;
let base;
let caido = false;
let conectadas = null;   // las páginas que el servidor dice tener abiertas, o null si no lo dice

// Pantallas como las da el sistema. Integrada (1) o no, x, y, ancho, alto, id,
// nombre. en() la pone en otro sitio, que es lo que hace el sistema al quitar
// otra (la principal siempre empieza en 0,0 y no deja huecos).
const SAMSUNG = [0, 0, 0, 1920, 1080, '19501-3734-0', 'SAMSUNG'];
const PIONEER = [0, 1920, 0, 1920, 1080, '1234-777-0', 'Pioneer'];
const PORTATIL = [1, 3840, 200, 1512, 982, '1552-41038-42', 'Pantalla Retina integrada'];
const PROYECTOR = [0, -1280, 100, 1280, 800, '5678-99-0', 'Epson'];
const en = (p, x, y) => [p[0], x, y, ...p.slice(3)];

before(async () => {
  if (SCRIPTS.every((s) => s.skip)) return;
  raiz = mkdtempSync(join(tmpdir(), 'systema-pantallas-'));
  servidor = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/health' || caido) { res.writeHead(503).end(); return; }
    const lista = conectadas && url.searchParams.has('pantallas') ? `displays ${conectadas.join(' ') || '-'}\n` : '';
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`ok\n${lista}`);
  });
  await new Promise((r) => { servidor.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (!servidor) return;
  await new Promise((r) => { servidor.close(r); });
  rmSync(raiz, { recursive: true, force: true });
});

// Un ordenador de mentira para cada prueba, con su carpeta, sus pantallas y su
// Chrome, que apunta en salida/<nombre>.args con qué lo abrieron.
function equipo(guion, pantallas) {
  const dir = mkdtempSync(join(raiz, 'equipo-'));
  const salida = join(dir, 'salida');
  mkdirSync(salida);
  const chrome = join(dir, 'chrome-falso');
  // Su salida, a ningún sitio, que si no la de PowerShell, que la hereda, se
  // quedaría abierta y la prueba no acabaría nunca. Y espera de segundo en
  // segundo, para que al matarlo a la fuerza no quede nada suelto más de 1 s.
  writeFileSync(chrome, `#!/bin/sh
exec </dev/null >/dev/null 2>&1
for a in "$@"; do case "$a" in --user-data-dir=*) n=$(basename "\${a#--user-data-dir=}") ;; esac; done
printf '%s\\n' "$@" > "$SALIDA/$n.args"
echo "$n" >> "$SALIDA/lanzamientos"
trap 'exit 0' TERM INT HUP
while :; do sleep 1; done
`);
  chmodSync(chrome, 0o755);
  const fichero = join(dir, 'pantallas.txt');
  const poner = (lista) => writeFileSync(fichero, lista.map((p) => p.join('\t')).join('\n') + '\n');
  poner(pantallas);
  // Dónde está cada ventana, por el número de su proceso, como lo diría el sistema.
  const ventanas = join(dir, 'ventanas.txt');
  writeFileSync(ventanas, '');
  // Sin pantalla, la ventana no se ve (un Cmd+W, un Cmd+H).
  const ventana = (pid, p) => writeFileSync(ventanas, p ? `${pid}\t${p[1]}\t${p[2]}\t${p[3]}\t${p[4]}\n` : `${pid}\t-\n`);
  const env = {
    ...process.env, HOME: dir, CHROME: chrome, SALIDA: salida,
    SYSTEMA_PANTALLAS: join(dir, 'pantallas'), SYSTEMA_PANTALLAS_FALSAS: fichero, SYSTEMA_VENTANAS_FALSAS: ventanas,
    SYSTEMA_ESPERA: '0.2', SYSTEMA_REABRIR: '1', SYSTEMA_GRACIA: '1', SYSTEMA_PAGINA: '1',
  };
  const lanzamientos = () => (existsSync(join(salida, 'lanzamientos'))
    ? readFileSync(join(salida, 'lanzamientos'), 'utf8').split('\n').filter(Boolean) : []);
  const args = (n) => readFileSync(join(salida, `${n}.args`), 'utf8').split('\n').filter(Boolean);
  // El número del proceso del Chrome de esa pantalla, o null si no está abierta
  // (o si aún no ha apuntado con qué la abrieron).
  const abierta = (n) => {
    if (!existsSync(join(salida, `${n}.args`))) return null;
    try {
      return execFileSync('pgrep', ['-f', `${join(dir, 'pantallas/perfiles', n)}( |$)`], { encoding: 'utf8' }).trim() || null;
    } catch { return null; }
  };
  const lanzar = (...a) => {
    const [cmd, argv] = guion.orden(...a);
    return run(cmd, argv, { env });
  };
  const vigilantes = new Set();
  const vigilar = (...a) => {
    const [cmd, argv] = guion.orden(...a);
    const p = spawn(cmd, argv, { env });
    const out = [];
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
    p.stdout.on('data', (d) => out.push(d)); p.stderr.on('data', (d) => out.push(d));
    p.salida = () => out.join('');
    p.fin = new Promise((r) => { p.once('exit', (code) => r(code)); });
    vigilantes.add(p);
    return p;
  };
  // Como Ctrl+C en la terminal.
  const parar = async () => {
    for (const p of vigilantes) if (p.exitCode === null) p.kill('SIGINT');
    await Promise.all([...vigilantes].map((p) => p.fin));
  };
  const colocacion = () => (existsSync(join(dir, 'pantallas/estado/colocacion'))
    ? readFileSync(join(dir, 'pantallas/estado/colocacion'), 'utf8') : null);
  return { dir, poner, ventana, lanzamientos, args, abierta, lanzar, vigilar, parar, colocacion };
}

async function hasta(cond, ms = 10000, que = 'la condición') {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await cond()) return;
    await sleep(100);
  }
  assert.fail(`no se cumple ${que} en ${ms} ms`);
}

const opcion = (args, nombre) => args.find((a) => a.startsWith(`${nombre}=`))?.slice(nombre.length + 1);

for (const guion of SCRIPTS) {
  const { skip } = guion;
  const prueba = (titulo, fn) => test(`${guion.nombre} · ${titulo}`, { skip, timeout: 60000 }, fn);
  const sitio = (p) => guion.sitio(p);

  prueba('--ver ordena de izquierda a derecha, deja libre la del portátil y dice qué va en cada una', async () => {
    const m = equipo(guion, [PORTATIL, PIONEER, SAMSUNG, PROYECTOR]);
    const { stdout } = await m.lanzar('--ver', 'Tele1,TELE2', 'tele3');
    const filas = stdout.split('\n').filter((l) => /^ {2}\d/.test(l));
    assert.match(filas[0], /Epson .* → tele1$/);
    assert.match(filas[1], /SAMSUNG .* → tele2$/);
    assert.match(filas[2], /Pioneer .* → tele3$/);
    assert.match(filas[3], /integrada .* la dejo libre/);
    const con = await m.lanzar('--ver', '--con-integrada', 'a', 'b', 'c', 'd');
    assert.match(con.stdout, /integrada .* → d$/m);
  });

  prueba('un nombre que no vale o repetido se dice antes de abrir nada', async () => {
    const m = equipo(guion, [SAMSUNG]);
    await assert.rejects(m.lanzar('--ver', 'tele1', 'TELE1'), /sale dos veces/);
    await assert.rejects(m.lanzar('--ver', 'teleñ'), /no vale como nombre/);
    await assert.rejects(m.lanzar('--servidor', base, '--nada', 'tele1'), /no conozco la opción --nada/);
    assert.equal(m.lanzamientos().length, 0);
  });

  prueba('abre cada pantalla en la suya, a pantalla completa y sonando, y al pararlo las cierra', async () => {
    const m = equipo(guion, [PIONEER, SAMSUNG, PORTATIL]);
    const v = m.vigilar('--servidor', base.replace('http://', ''), 'tele1', 'tele2');
    try {
      await hasta(() => m.abierta('tele1') && m.abierta('tele2'), 10000, 'que se abran las dos');
      const [a1, a2] = [m.args('tele1'), m.args('tele2')];
      assert.deepEqual([opcion(a1, '--window-position'), opcion(a1, '--window-size')], sitio(SAMSUNG));
      assert.deepEqual([opcion(a2, '--window-position'), opcion(a2, '--window-size')], sitio(PIONEER));
      for (const a of [a1, a2]) {
        assert.ok(a.includes('--kiosk'));
        assert.ok(a.includes('--autoplay-policy=no-user-gesture-required'));
        assert.ok(a.includes('--no-first-run'));
      }
      assert.equal(a1.at(-1), `${base}/screen/tele1`);
      assert.equal(a2.at(-1), `${base}/screen/tele2`);
      // Cada una con su perfil, para que sean dos Chrome y no dos pestañas de uno.
      assert.notEqual(opcion(a1, '--user-data-dir'), opcion(a2, '--user-data-dir'));
      assert.match(v.salida(), /las abro con el servidor de http:\/\/127\.0\.0\.1:\d+ /);
    } finally {
      await m.parar();
    }
    assert.equal(m.abierta('tele1'), null);
    assert.equal(m.abierta('tele2'), null);
    assert.deepEqual(m.lanzamientos().sort(), ['tele1', 'tele2']);
  });

  prueba('si una pantalla se apaga, su ventana se cierra sin correr las demás, y vuelve a su sitio', async () => {
    const m = equipo(guion, [SAMSUNG, PIONEER]);
    m.vigilar('--servidor', base, 'tele1', 'tele2');
    try {
      await hasta(() => m.abierta('tele1') && m.abierta('tele2'));
      const pid2 = m.abierta('tele2');
      // Se apaga la de la izquierda, la principal, y el sistema pasa la otra a
      // 0,0. tele1 se cierra, y tele2 sigue en su tele sin reabrirse.
      m.poner([en(PIONEER, 0, 0)]);
      await hasta(() => !m.abierta('tele1'), 10000, 'que se cierre tele1');
      await sleep(1500);
      assert.equal(m.abierta('tele2'), pid2);
      assert.equal(m.lanzamientos().length, 2);
      // Vuelve, y tele1 se abre en la suya.
      m.poner([SAMSUNG, PIONEER]);
      await hasta(() => m.abierta('tele1'), 10000, 'que vuelva tele1');
      assert.equal(opcion(m.args('tele1'), '--window-position'), sitio(SAMSUNG)[0]);
      assert.equal(m.abierta('tele2'), pid2);
    } finally {
      await m.parar();
    }
  });


  prueba('si arranca con una tele apagada, cada nombre espera a la suya y no se corren', async () => {
    const m = equipo(guion, [SAMSUNG, PIONEER]);
    // Una primera vez con las dos, como al instalarlo, para que apunte cuál es cuál.
    m.vigilar('--vigilar', '--servidor', base, 'tele1', 'tele2');
    await hasta(() => m.abierta('tele1') && m.abierta('tele2'));
    await m.parar();
    // Al día siguiente arranca con la SAMSUNG apagada, y la Pioneer en 0,0.
    m.poner([en(PIONEER, 0, 0)]);
    const v = m.vigilar('--vigilar', '--servidor', base, 'tele1', 'tele2');
    try {
      await hasta(() => m.abierta('tele2'), 10000, 'que se abra tele2');
      assert.equal(opcion(m.args('tele2'), '--window-position'), sitio(en(PIONEER, 0, 0))[0]);
      await hasta(() => /tele1 se queda sin abrir hasta que aparezca su pantalla/.test(v.salida()), 5000, 'que tele1 espere');
      assert.equal(m.abierta('tele1'), null);
      // Se enciende la SAMSUNG y la Pioneer vuelve a su sitio. tele1 va a la suya.
      const pid2 = m.abierta('tele2');
      m.poner([SAMSUNG, PIONEER]);
      await hasta(() => m.abierta('tele1'), 10000, 'que se abra tele1');
      assert.equal(opcion(m.args('tele1'), '--window-position'), sitio(SAMSUNG)[0]);
      assert.equal(m.abierta('tele2'), pid2);
    } finally {
      await m.parar();
    }
  });

  prueba('un número de proceso viejo en el estado no hace matar a otro programa', async () => {
    const m = equipo(guion, [SAMSUNG]);
    // Como tras un apagón, el número que tenía tele1 ya es de otro programa.
    const ajeno = spawn('sleep', ['30']);
    try {
      const estado = join(m.dir, 'pantallas/estado');
      mkdirSync(estado, { recursive: true });
      writeFileSync(join(estado, 'tele1.pid'), `${ajeno.pid}\n`);
      writeFileSync(join(estado, 'tele1.donde'), 'otra\n');
      m.vigilar('--servidor', base, 'tele1');
      await hasta(() => m.abierta('tele1'), 10000, 'que se abra tele1');
      await sleep(500);
      assert.equal(ajeno.exitCode, null);
      assert.equal(ajeno.signalCode, null);
    } finally {
      await m.parar();
      ajeno.kill();
    }
  });

  prueba('una ventana que acaba en otra pantalla vuelve a la suya', async () => {
    const m = equipo(guion, [SAMSUNG, PIONEER]);
    const v = m.vigilar('--servidor', base, 'tele1', 'tele2');
    try {
      await hasta(() => m.abierta('tele1') && m.abierta('tele2'));
      // El sistema dice que la ventana de tele1 está en la Pioneer.
      m.ventana(m.abierta('tele1'), PIONEER);
      await hasta(() => /tele1 no estaba en su pantalla/.test(v.salida()), 10000, 'que la vea fuera de su sitio');
      assert.doesNotMatch(v.salida(), /tele2 no estaba/);
      await guion.fuera(m, v);
    } finally {
      await m.parar();
    }
  });


  prueba('si cambian una tele por otra, su nombre se queda con la nueva', async () => {
    const m = equipo(guion, [SAMSUNG, PIONEER]);
    const v = m.vigilar('--servidor', base, 'tele1', 'tele2');
    try {
      await hasta(() => m.abierta('tele1') && m.abierta('tele2'));
      await hasta(() => /1234-777-0/.test(m.colocacion() ?? ''), 5000, 'que apunte la Pioneer');
      const pid1 = m.abierta('tele1');
      // En el sitio de la Pioneer, otra tele de otro modelo (o el cable en otro conector).
      const OTRA = [0, 1920, 0, 1920, 1080, '4321-555-9', 'Otra'];
      m.poner([SAMSUNG, OTRA]);
      await hasta(() => /tele2 no encuentra su pantalla y sobra otra/.test(v.salida()), 10000, 'que la reparta');
      await hasta(() => m.abierta('tele2') && m.lanzamientos().filter((n) => n === 'tele2').length === 2, 10000, 'que se abra tele2 en la nueva');
      assert.equal(opcion(m.args('tele2'), '--window-position'), sitio(OTRA)[0]);
      await hasta(() => /4321-555-9/.test(m.colocacion() ?? ''), 5000, 'que apunte la nueva');
      assert.equal(m.abierta('tele1'), pid1);
    } finally {
      await m.parar();
    }
  });

  prueba('una página que deja de estar conectada al servidor se abre otra vez', async () => {
    const m = equipo(guion, [SAMSUNG, PIONEER]);
    const v = m.vigilar('--servidor', base, 'tele1', 'tele2');
    try {
      await hasta(() => m.abierta('tele1') && m.abierta('tele2'));
      const pid2 = m.abierta('tele2');
      // La pestaña de tele1 se cae («Aw, Snap»). Chrome sigue vivo, pero el
      // servidor ya no la tiene.
      conectadas = ['tele2'];
      await hasta(() => /la página de tele1 lleva más de 1 s sin conectar con el servidor, la abro otra vez/.test(v.salida()), 15000, 'que la vea desconectada');
      conectadas = ['tele1', 'tele2'];
      await hasta(() => m.lanzamientos().filter((n) => n === 'tele1').length >= 2 && m.abierta('tele1'), 10000, 'que se abra otra vez');
      assert.equal(m.abierta('tele2'), pid2);
    } finally {
      conectadas = null;
      await m.parar();
    }
  });

  prueba('un Chrome vivo que se queda sin ventana se abre otra vez', async () => {
    const m = equipo(guion, [SAMSUNG]);
    const v = m.vigilar('--servidor', base, 'tele1');
    try {
      await hasta(() => m.abierta('tele1'));
      // Un Cmd+W o un Cmd+H, la ventana ya no se ve, y Chrome sigue en marcha.
      m.ventana(m.abierta('tele1'), null);
      await hasta(() => /tele1 no tenía ventana/.test(v.salida()), 10000, 'que la vea sin ventana');
      await hasta(() => m.lanzamientos().length === 2 && m.abierta('tele1'), 10000, 'que se abra otra vez');
    } finally {
      await m.parar();
    }
  });

  prueba('si no consigue dejarla en su sitio, a la cuarta la cierra y lo dice', async () => {
    const m = equipo(guion, [SAMSUNG, PIONEER]);
    const v = m.vigilar('--servidor', base, 'tele1', 'tele2');
    try {
      await hasta(() => m.abierta('tele1') && m.abierta('tele2'));
      // Cada Chrome nuevo de tele1 acaba también en la Pioneer.
      const fin = Date.now() + 30000;
      let visto = null;
      while (!/no consigo dejar tele1 bien en su pantalla/.test(v.salida()) && Date.now() < fin) {
        const pid = m.abierta('tele1');
        if (pid && pid !== visto) { m.ventana(pid, PIONEER); visto = pid; }
        await sleep(100);
      }
      assert.match(v.salida(), /no consigo dejar tele1 bien en su pantalla, así que la cierro/);
      await hasta(() => !m.abierta('tele1'), 5000, 'que la cierre');
      // Y no la vuelve a abrir mientras las pantallas sigan igual.
      const veces = m.lanzamientos().filter((n) => n === 'tele1').length;
      await sleep(2500);
      assert.equal(m.abierta('tele1'), null);
      assert.equal(m.lanzamientos().filter((n) => n === 'tele1').length, veces);
      assert.ok(m.abierta('tele2'));
    } finally {
      await m.parar();
    }
  });

  prueba('con el servidor caído, la ventana de una pantalla que se va se cierra igual', async () => {
    const m = equipo(guion, [SAMSUNG, PIONEER]);
    m.vigilar('--servidor', base, 'tele1', 'tele2');
    try {
      await hasta(() => m.abierta('tele1') && m.abierta('tele2'));
      caido = true;
      m.poner([en(PIONEER, 0, 0)]);
      await hasta(() => !m.abierta('tele1'), 10000, 'que se cierre tele1 sin servidor');
      assert.ok(m.abierta('tele2'));
    } finally {
      caido = false;
      await m.parar();
    }
  });


  prueba('dos teles iguales sin número de serie se distinguen por su orden', async () => {
    const IZQ = [0, 0, 0, 1920, 1080, '7777-1-0', 'Igual'];
    const DER = [0, 1920, 0, 1920, 1080, '7777-1-0', 'Igual'];
    const m = equipo(guion, [IZQ, DER]);
    m.vigilar('--servidor', base, 'tele1', 'tele2');
    try {
      await hasta(() => m.abierta('tele1') && m.abierta('tele2'));
      assert.equal(opcion(m.args('tele1'), '--window-position'), sitio(IZQ)[0]);
      assert.equal(opcion(m.args('tele2'), '--window-position'), sitio(DER)[0]);
      await hasta(() => /7777-1-0#1/.test(m.colocacion() ?? '') && /7777-1-0#2/.test(m.colocacion() ?? ''), 5000, 'que apunte las dos');
      // Se apaga una de las dos. No hay manera de saber cuál, así que la que
      // queda sigue con tele1 y tele2 espera.
      const pid1 = m.abierta('tele1');
      m.poner([en(DER, 0, 0)]);
      await hasta(() => !m.abierta('tele2'), 10000, 'que se cierre tele2');
      assert.equal(m.abierta('tele1'), pid1);
    } finally {
      await m.parar();
    }
  });

  prueba('un nombre nuevo, con lo demás apuntado, va a la pantalla que sobra', async () => {
    const m = equipo(guion, [SAMSUNG, PIONEER]);
    m.vigilar('--vigilar', '--servidor', base, 'tele1');
    await hasta(() => m.abierta('tele1') && m.colocacion(), 10000, 'que apunte tele1');
    await m.parar();
    const v = m.vigilar('--vigilar', '--servidor', base, 'tele1', 'tele2');
    try {
      await hasta(() => m.abierta('tele1') && m.abierta('tele2'), 10000, 'que se abran las dos');
      assert.equal(opcion(m.args('tele1'), '--window-position'), sitio(SAMSUNG)[0]);
      assert.equal(opcion(m.args('tele2'), '--window-position'), sitio(PIONEER)[0]);
      assert.doesNotMatch(v.salida(), /no encuentra su pantalla/);
    } finally {
      await m.parar();
    }
  });

  prueba('una ventana que se cierra se vuelve a abrir en su pantalla', async () => {
    const m = equipo(guion, [SAMSUNG, PIONEER]);
    const v = m.vigilar('--servidor', base, 'tele1', 'tele2');
    try {
      await hasta(() => m.abierta('tele1') && m.abierta('tele2'));
      const antes = m.abierta('tele2');
      process.kill(Number(antes), 'SIGKILL');
      await hasta(() => m.abierta('tele2') && m.abierta('tele2') !== antes, 10000, 'que se reabra tele2');
      assert.equal(opcion(m.args('tele2'), '--window-position'), sitio(PIONEER)[0]);
      assert.match(v.salida(), /tele2 se había cerrado, la vuelvo a abrir/);
    } finally {
      await m.parar();
    }
  });

  prueba('sin servidor no abre nada, y abre en cuanto contesta', async () => {
    const m = equipo(guion, [SAMSUNG]);
    caido = true;
    try {
      const v = m.vigilar('--servidor', base, 'tele1');
      await hasta(() => /el servidor no contesta/.test(v.salida()), 10000, 'que diga que el servidor no contesta');
      await sleep(1000);
      assert.equal(m.abierta('tele1'), null);
      caido = false;
      await hasta(() => m.abierta('tele1'), 10000, 'que se abra al volver el servidor');
    } finally {
      caido = false;
      await m.parar();
    }
  });

  prueba('con menos pantallas desde el principio, van en orden y lo dice', async () => {
    const m = equipo(guion, [PIONEER]);
    const v = m.vigilar('--servidor', base, 'tele1', 'tele2');
    try {
      await hasta(() => m.abierta('tele1'));
      await hasta(() => /tele2 se queda sin abrir/.test(v.salida()), 5000, 'que diga que tele2 se queda sin abrir');
      assert.equal(m.abierta('tele2'), null);
      assert.match(v.salida(), /no sé cuál falta, así que las pongo en orden/);
    } finally {
      await m.parar();
    }
  });

  prueba('dos a la vez no, que se pelearían por las ventanas', async () => {
    const m = equipo(guion, [SAMSUNG]);
    m.vigilar('--servidor', base, 'tele1');
    try {
      await hasta(() => m.abierta('tele1'));
      await hasta(() => m.colocacion(), 5000, 'que apunte la colocación');
      const antes = m.colocacion();
      const otro = m.vigilar('--servidor', base, 'tele1');
      assert.equal(await otro.fin, 1);
      assert.match(otro.salida(), /ya hay otro vigilando/);
      assert.equal(m.lanzamientos().length, 1);
      // Y no ha borrado lo que tenía apuntado el que vigila.
      assert.equal(m.colocacion(), antes);
    } finally {
      await m.parar();
    }
  });
}
