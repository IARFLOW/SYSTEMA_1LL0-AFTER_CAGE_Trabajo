// Pruebas de la hoja de QR de las pantallas (npm run qr-pantallas). Miran a
// qué dirección va cada QR y que la orden se queje cuando falta algo.
// Que los 10 QR impresos se leen se comprobó el 20-oct-2026 con el detector
// de QR de macOS (CoreImage) sobre el PDF pintado por Vista Previa.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { direccion, TEXTOS } from '../scripts/qr-pantallas.mjs';
import { svgDeQr } from '../scripts/carteles.mjs';

const script = fileURLToPath(new URL('../scripts/qr-pantallas.mjs', import.meta.url));
const correr = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
// Las hojas de prueba, dentro de una carpeta que se borra al acabar.
const todas = mkdtempSync(join(tmpdir(), 'systema-qr-'));
after(() => rmSync(todas, { recursive: true, force: true }));

test('cada QR va a la página de su pantalla, con o sin barra y con el puerto', () => {
  assert.equal(direccion(new URL('http://192.168.0.10/'), 'musico1'), 'http://192.168.0.10/screen/musico1');
  assert.equal(direccion(new URL('http://192.168.0.10'), 'musico1'), 'http://192.168.0.10/screen/musico1');
  assert.equal(direccion(new URL('http://192.168.0.10:8080'), 'tele2'), 'http://192.168.0.10:8080/screen/tele2');
});

test('con --musicos 10 salen musico1 hasta musico10 en una hoja, con la letra dentro', () => {
  const dir = mkdtempSync(join(todas, 'hoja-'));
  const r = correr('--web', 'http://192.168.0.10/', '--musicos', '10', '--salida', dir);
  assert.equal(r.status, 0, r.stderr);
  const html = readFileSync(join(dir, 'qr-pantallas.html'), 'utf8');
  for (let n = 1; n <= 10; n += 1) {
    const svg = readFileSync(join(dir, `qr-musico${n}.svg`), 'utf8');
    assert.equal(svg, svgDeQr(`http://192.168.0.10/screen/musico${n}`), `el QR de musico${n}`);
    assert.ok(html.includes(svg), `musico${n} va en la hoja`);
    assert.ok(html.includes(`>/screen/musico${n}<`), `con su dirección escrita`);
  }
  assert.equal((html.match(/<section class="hoja">/g) ?? []).length, 1, 'caben en una hoja');
  for (const l of TEXTOS.pie) assert.ok(html.includes(l), l);
  assert.match(html, /font\/woff2;base64,/, 'la letra va dentro y se imprime igual en cualquier ordenador');
  assert.doesNotMatch(html, /(?:src|href)=["']https?:|url\(\s*["']?https?:/, 'nada que cargar de internet');
});

test('con más de 10 sale otra hoja, y valen nombres sueltos', () => {
  const dir = mkdtempSync(join(todas, 'hoja-'));
  const nombres = Array.from({ length: 11 }, (_, i) => `Tele${i + 1}`);
  const r = correr('--web', 'http://192.168.0.10/', ...nombres, '--salida', dir);
  assert.equal(r.status, 0, r.stderr);
  const html = readFileSync(join(dir, 'qr-pantallas.html'), 'utf8');
  assert.equal((html.match(/<section class="hoja">/g) ?? []).length, 2);
  assert.ok(existsSync(join(dir, 'qr-tele11.svg')), 'en minúsculas, como las entiende el servidor');
});

test('se queja si falta la dirección, las pantallas o un nombre no vale', () => {
  const dir = mkdtempSync(join(todas, 'hoja-'));
  const casos = [
    [['--musicos', '3'], /falta la dirección/],
    [['--web', 'http://192.168.0.10/'], /faltan las pantallas/],
    [['--web', '192.168.0.10', '--musicos', '3'], /no vale|http/],
    [['--web', 'http://192.168.0.10/', 'músico1'], /«músico1» no vale/],
    [['--web', 'http://192.168.0.10/', 'tele1', 'TELE1'], /sale dos veces/],
    [['--web', 'http://192.168.0.10/', '--musicos', '0'], /de 1 a 99/],
  ];
  for (const [args, re] of casos) {
    const r = correr(...args, '--salida', dir);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.match(r.stderr, re, args.join(' '));
  }
});
