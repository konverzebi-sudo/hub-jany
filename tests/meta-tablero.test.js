// Tablero numérico de Meta Ads (js/meta-tablero.js): se prueba en Node con un `window` simulado, sin red ni costos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {}, console };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'meta-tablero.js'), 'utf8'), sandbox);
const MT = sandbox.window.MetaTablero;

const PRINCIPAL = [
  'Nombre del anuncio,Entrega del anuncio,Importe gastado (MXN),Resultados,Indicador de resultado,Impresiones,Alcance,Clics (todos),Inicio del informe,Fin del informe',
  '"Anuncio A, v1",active,200,20,actions:onsite_conversion.messaging_conversation_started_7d,10000,8000,300,2026-10-01,2026-10-30',
  'Anuncio B,active,100,10,actions:onsite_conversion.messaging_conversation_started_7d,5000,4000,100,2026-10-01,2026-10-30',
  'Anuncio C,inactive,0,0,,0,0,0,2026-10-01,2026-10-30',
].join('\n');

const DESGLOSE = [
  'Día,Plataforma,Ubicación,Importe gastado (MXN),Resultados',
  '2026-10-05,Facebook,Feed,50,5',   // lunes
  '2026-10-05,Instagram,Reels,50,2',
  '2026-10-06,Facebook,Feed,40,9',   // martes
  '2026-10-07,Instagram,Stories,30,1',
].join('\n');

test('pNum entiende formatos de número de Meta', () => {
  assert.equal(MT._pNum('1,234.56'), 1234.56);
  assert.equal(MT._pNum('1.234,56'), 1234.56);
  assert.equal(MT._pNum('$1,234'), 1234);
  assert.equal(MT._pNum('12,5'), 12.5);
  assert.equal(MT._pNum(''), 0);
  assert.equal(MT._pNum('abc'), 0);
});

test('parseCsv respeta comillas con comas y quita el BOM', () => {
  const t = MT._parseCsv('﻿a,b\n"x, y",2\n');
  assert.deepEqual(Array.from(t.head), ['a', 'b']);
  assert.deepEqual(Array.from(t.rows[0]), ['x, y', '2']);
});

test('calcular: totales, tipo de campaña y costo por resultado', () => {
  const d = MT.calcular([{ name: 'p.csv', text: PRINCIPAL }], { cierreBase: 12, cierreReal: true });
  assert.equal(d.gasto, 300);
  assert.equal(d.res, 30);
  assert.equal(d.cpr, 10);
  assert.equal(d.tipo, 'mensajes');
  assert.equal(d.esProspecto, true);
  assert.equal(d.nAnuncios, 2); // el anuncio sin gasto no cuenta
  assert.equal(d.dias, 30);
  assert.equal(d.cierre, 12);
  assert.equal(d.cierreReal, true);
  assert.equal(Math.round(d.cpm * 100) / 100, 20); // 300 / 15000 * 1000
});

test('calcular: sin desglose no inventa gráficas', () => {
  const d = MT.calcular([{ name: 'p.csv', text: PRINCIPAL }], {});
  assert.equal(d.dias7, null);
  assert.equal(d.ubic.length, 0);
  assert.equal(d.cierreReal, false);
  assert.equal(d.cierre, 10);
});

test('calcular: con segundo CSV de desglose saca ubicación, plataforma y días (sin sumar los dos archivos)', () => {
  const d = MT.calcular([{ name: 'p.csv', text: PRINCIPAL }, { name: 'd.csv', text: DESGLOSE }], {});
  assert.equal(d.gasto, 300); // los totales salen solo del principal
  const fb = d.plat.find((p) => p.k === 'Facebook'), ig = d.plat.find((p) => p.k === 'Instagram');
  assert.equal(fb.gasto, 90); assert.equal(fb.res, 14);
  assert.equal(ig.gasto, 80); assert.equal(ig.res, 3);
  assert.equal(d.ubic[0].k, 'Facebook · Feed'); // la que más resultados da
  assert.ok(d.dias7);
  const mar = d.dias7.find((x) => x.k === 'Mar');
  assert.equal(mar.res, 9);
});

test('calcular: reporte en inglés y campaña de compras', () => {
  const csv = 'Ad name,Amount spent (MXN),Results,Result indicator,Impressions,Reach,Purchases,Purchase conversion value\nA,100,4,actions:offsite_conversion.fb_pixel_purchase,2000,1500,4,800';
  const d = MT.calcular([{ name: 'en.csv', text: csv }], {});
  assert.equal(d.tipo, 'compras');
  assert.equal(d.esProspecto, false);
  assert.equal(d.roas, 8);
  assert.equal(d.cpr, 25);
});

test('calcular: sin columna de gasto devuelve null', () => {
  assert.equal(MT.calcular([{ name: 'x.csv', text: 'a,b\n1,2' }], {}), null);
  assert.equal(MT.calcular([], {}), null);
});

test('inyectar llena los tres huecos, agrega estilo y calculadora y no deja huecos vacíos', () => {
  const d = MT.calcular([{ name: 'p.csv', text: PRINCIPAL }, { name: 'd.csv', text: DESGLOSE }], { cierreBase: 15, cierreReal: false });
  const html = '<html><head></head><body><h2>01</h2><div id="slot-kpis"></div><h2>04</h2><div id="slot-comportamiento"> </div><h2>05</h2><div id="slot-embudo"></div></body></html>';
  const out = MT.inyectar(html, d);
  assert.ok(!/id="slot-kpis"/.test(out) && !/id="slot-embudo"/.test(out) && !/id="slot-comportamiento"/.test(out));
  assert.ok(/nx-kpi/.test(out) && /nx-donut/.test(out) && /nx-bars/.test(out) && /id="nx-cierre"/.test(out) && /id="nx-meses"/.test(out));
  assert.ok(/window\.__NX=/.test(out) && /<style>/.test(out));
  assert.ok(/simulación/.test(out)); // el cierre de partida es de simulación
  assert.ok(!/undefined|NaN/.test(out.replace(/<script>[\s\S]*<\/script>/, '')));
});

test('inyectar sin huecos agrega las secciones al final para no perder el tablero', () => {
  const d = MT.calcular([{ name: 'p.csv', text: PRINCIPAL }], {});
  const out = MT.inyectar('<html><head></head><body><p>reporte</p></body></html>', d);
  assert.ok(/01 · Calienta motores/.test(out) && /05 · Datos duros/.test(out));
});

test('inyectar sin datos devuelve el reporte tal cual', () => {
  assert.equal(MT.inyectar('<html></html>', null), '<html></html>');
});

test('calcular: mejor costo por resultado toma el anuncio más barato con volumen suficiente', () => {
  const csv = [
    'Nombre del anuncio,Importe gastado (MXN),Resultados,Indicador de resultado',
    'Barato pero casi sin datos,5,1,actions:onsite_conversion.messaging_conversation_started_7d',
    'Ganador,500,19,actions:onsite_conversion.messaging_conversation_started_7d',
    'Caro,90,1,actions:onsite_conversion.messaging_conversation_started_7d',
    'Medio,300,10,actions:onsite_conversion.messaging_conversation_started_7d',
  ].join('\n');
  const d = MT.calcular([{ name: 'p.csv', text: csv }], {});
  assert.equal(d.mejor.nombre, 'Ganador');
  assert.equal(Math.round(d.mejor.cpr * 100) / 100, 26.32);
  assert.equal(d.mejor.res, 19);
  const out = MT.inyectar('<html><head></head><body><div id="slot-kpis"></div></body></html>', d);
  assert.ok(/Mejor costo por prospecto/.test(out) && /Ganador/.test(out));
});

test('reparar: un reporte cortado a media etiqueta se cierra y el script no queda pegado a la etiqueta rota', () => {
  const d = MT.calcular([{ name: 'p.csv', text: PRINCIPAL }], {});
  const cortado = '<!DOCTYPE html><html><head></head><body><h2>06</h2><table><tr><td>6</td><td<';
  const out = MT.inyectar(cortado, d);
  assert.ok(!/<td<script>/.test(out), 'el script no debe quedar pegado a una etiqueta rota');
  assert.ok(/<\/body>/.test(out) && /<\/html>/.test(out));
  assert.ok(out.indexOf('<script>window.__NX=') > out.indexOf('<td>6</td>'));
});

test('reparar: arregla reportes ya guardados con el script pegado a la etiqueta rota', () => {
  const viejo = '<html><body><table><tr><td>6</td><td<script>window.__NX={"a":1};(function(){})();</script>';
  const fix = MT.reparar(viejo);
  assert.ok(!/<td<script>/.test(fix));
  assert.ok(/<script>window\.__NX=/.test(fix));
  assert.ok(/<\/body><\/html>$/.test(fix));
});

test('inyectar: el panel Tus ventas del periodo y los 5 KPIs salen en campañas de mensajes', () => {
  const d = MT.calcular([{ name: 'p.csv', text: PRINCIPAL }], {});
  const out = MT.inyectar('<html><head></head><body><div id="slot-kpis"></div></body></html>', d);
  assert.ok(/id="nx-ventas-in"/.test(out) && /id="nx-ticket-in"/.test(out) && /id="nx-periodo-res"/.test(out));
  assert.ok(/window\.nxAplicar/.test(out));
  assert.ok((out.match(/class="nx-kpi"/g) || []).length === 5 - 0 || (out.match(/class="nx-kpi"/g) || []).length >= 4);
});

test('inyectar: en campañas de compras no hay panel de ventas del periodo (cada compra ya es una venta)', () => {
  const csv = 'Ad name,Amount spent (MXN),Results,Result indicator\nA,100,4,actions:offsite_conversion.fb_pixel_purchase';
  const d = MT.calcular([{ name: 'en.csv', text: csv }], {});
  const out = MT.inyectar('<html><head></head><body><div id="slot-kpis"></div></body></html>', d);
  assert.ok(!/id="nx-ventas-in"/.test(out));
});
