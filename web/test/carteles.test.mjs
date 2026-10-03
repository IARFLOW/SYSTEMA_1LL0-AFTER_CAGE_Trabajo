// Pruebas de los carteles (npm run carteles). Miran qué lleva cada QR, que el
// SVG sea un QR de verdad y que la orden se queje cuando falta algo.
// Que el QR impreso se lee con una cámara se comprobó el 1-oct-2026 con el
// detector de QR de macOS (CoreImage) sobre el PDF pintado por Vista Previa.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { qrDeRed, svgDeQr, TEXTOS } from '../scripts/carteles.mjs';

const script = fileURLToPath(new URL('../scripts/carteles.mjs', import.meta.url));
const correr = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
// Los carteles de prueba, dentro de una carpeta que se borra al acabar.
const todas = mkdtempSync(join(tmpdir(), 'systema-carteles-'));
after(() => rmSync(todas, { recursive: true, force: true }));

test('el QR de la red sigue el formato que leen las cámaras de iPhone y Android', () => {
  assert.equal(qrDeRed('SYSTEMA', 'unaclave'), 'WIFI:T:WPA;S:SYSTEMA;P:unaclave;;');
  assert.equal(qrDeRed('SYSTEMA', null), 'WIFI:T:nopass;S:SYSTEMA;;', 'red abierta');
  // `\ ; , : "` van escapados con barra, en el nombre y en la clave
  assert.equal(qrDeRed('Mi;red', 'a:b\\c"d,e'), 'WIFI:T:WPA;S:Mi\\;red;P:a\\:b\\\\c\\"d\\,e;;');
});

test('el SVG es un QR con su margen blanco de 4 módulos', () => {
  const svg = svgDeQr('http://systema.internal/');
  const lado = Number(/viewBox="0 0 (\d+) \1"/.exec(svg)?.[1]);
  // Versión 2 con corrección M. Son 25 módulos más 4 de margen por cada lado
  assert.equal(lado, 25 + 8);
  assert.match(svg, /<path d="M4 4h1v1h-1z/, 'el primer módulo, el del patrón de esquina, empieza tras el margen');
  assert.match(svg, /shape-rendering="crispEdges"/);
});

test('genera los dos carteles con la red, la clave y la dirección', () => {
  const dir = mkdtempSync(join(todas, 'carteles-'));
  const r = correr('--red', 'SYSTEMA', '--clave', 'cage4m33s', '--ip', '192.168.8.10', '--salida', dir);
  assert.equal(r.status, 0, r.stderr);
  for (const f of ['cartel-1-red.html', 'cartel-2-mapa.html', 'qr-red.svg', 'qr-mapa.svg', 'qr-ip.svg']) assert.ok(existsSync(join(dir, f)), f);
  const red = readFileSync(join(dir, 'cartel-1-red.html'), 'utf8');
  assert.match(red, /SYSTEMA/);
  assert.match(red, /cage4m33s/);
  for (const l of TEXTOS.red.pie) assert.ok(red.includes(l), l);
  const mapa = readFileSync(join(dir, 'cartel-2-mapa.html'), 'utf8');
  // Con `http://` delante, porque escrita sin él, Chrome prueba antes https o la
  // toma por una búsqueda (hasta el 1-oct-2026 iba sin él).
  assert.match(mapa, />http:\/\/systema\.internal</, 'la dirección entera, con http:// y sin la barra');
  assert.match(mapa, />http:\/\/192\.168\.8\.10</, 'la IP de respaldo, también con http://');
  assert.equal((mapa.match(/<svg xmlns/g) ?? []).length, 2, 'el QR grande y el pequeño de la IP');
  assert.ok(mapa.includes(readFileSync(join(dir, 'qr-ip.svg'), 'utf8')), 'el QR pequeño es el de la IP');
  for (const l of TEXTOS.mapa.pie) assert.ok(mapa.includes(l), l);
  assert.match(mapa, /font\/woff2;base64,/, 'la letra va dentro y se imprime igual en cualquier ordenador');
  // Nada que cargar de internet (el xmlns del SVG es un nombre, no una descarga)
  assert.doesNotMatch(mapa, /(?:src|href)=["']https?:|url\(\s*["']?https?:/, 'nada que cargar de internet');
});

test('si el QR grande ya va a la IP, no lleva el pequeño', () => {
  const dir = mkdtempSync(join(todas, 'carteles-'));
  const r = correr('--red', 'SYSTEMA', '--web', 'http://192.168.8.10/', '--ip', '192.168.8.10', '--salida', dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(dir, 'qr-ip.svg')));
  const mapa = readFileSync(join(dir, 'cartel-2-mapa.html'), 'utf8');
  assert.match(mapa, />http:\/\/192\.168\.8\.10</);
  assert.equal((mapa.match(/<svg xmlns/g) ?? []).length, 1);
});

test('se queja si falta la red, si la clave no vale o si la dirección está mal', () => {
  assert.match(correr().stderr, /falta el nombre de la red/);
  assert.match(correr('--red', 'X', '--clave', 'corta').stderr, /entre 8 y 63/);
  assert.match(correr('--red', 'X', '--web', 'systema').stderr, /la dirección no vale/);
  assert.match(correr('--red', 'X', '--ip', '192.168.8').stderr, /la IP no vale/);
  assert.match(correr('--red', 'X', '--ip', '192.168.8.300').stderr, /la IP no vale/);
  assert.match(correr('--red', 'X', '--ip', '192.168.8.010').stderr, /la IP no vale/, 'con un cero delante se leería en octal');
  assert.match(correr('--red', 'X', '--tamano', 'A3').stderr, /A4 o A5/);
});
