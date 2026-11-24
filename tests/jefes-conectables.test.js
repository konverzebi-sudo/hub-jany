// "@Jefe" del Jefe de Resultados (api/_lib/enfoque.js): conectar con otro Jefe trae lo que la persona guardó ahí.
// Funciones puras, sin red ni costos.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../api/_lib/enfoque');

test('leerEnfoque acepta menciones de Jefes conocidos y descarta los que no existen', () => {
  const r = E.leerEnfoque({ menciones: [
    { tipo: 'jefe', id: 'jefe-financiero', nombre: 'Jefe de Finanzas' },
    { tipo: 'jefe', id: 'jefe-inventado', nombre: 'Nada' },
    { tipo: 'producto', id: 'p1', nombre: 'Taller' },
  ] });
  assert.deepEqual(r.menciones.map((m) => m.tipo + ':' + m.id), ['jefe:jefe-financiero', 'producto:p1']);
});

test('una mención de Jefe no cambia el producto ni la campaña elegidos', () => {
  const foco = { id: 'p3', nombre: 'Taller IA', productoId: 'p3' };
  const sel = E.resolverSeleccion({ foco, menciones: [{ tipo: 'jefe', id: 'jefe-radar', nombre: 'Jefe del Faro' }] });
  assert.equal(sel.tipo, 'producto');
  assert.equal(sel.productoId, 'p3');
  assert.equal(sel.origen, 'pastilla');
});

test('todos los Jefes conectables traen nombre, título y llaves de almacenamiento', () => {
  const ids = Object.keys(E.JEFES_CONECTABLES);
  assert.ok(ids.length >= 7);
  ids.forEach((id) => {
    const j = E.JEFES_CONECTABLES[id];
    assert.ok(j.nombre && j.titulo, id);
    assert.ok(Array.isArray(j.llaves), id);
    j.llaves.forEach((k) => assert.ok(!/\s/.test(k), id + ' llave sin espacios: ' + k));
  });
});

test('resumirValor: listas y objetos en texto corto, sin imágenes en base64 y con tope de largo', () => {
  const t = E.resumirValor([{ titulo: 'Idea A', nota: 'x'.repeat(500), foto: 'data:image/png;base64,AAAA' }, { titulo: 'Idea B' }], 400);
  assert.ok(/Idea A/.test(t) && /Idea B/.test(t));
  assert.ok(!/base64/.test(t));
  assert.ok(t.length <= 400);
  assert.equal(E.resumirValor(null), '');
  assert.equal(E.resumirValor([]), '');
  const o = E.resumirValor({ gasto_ads: 1500, ticket: 900, vacio: '' });
  assert.ok(/gasto_ads: 1500/.test(o) && /ticket: 900/.test(o) && !/vacio/.test(o));
});

test('resumirCampanas lista nombre, producto, fechas y objetivo de cada campaña', () => {
  const r = E.resumirCampanas([{ nombre: 'Campaña Taller', producto_nombre: 'Taller IA', fecha_inicio_activa: '2026-12-01', fecha_fin_activa: '2026-12-31', objetivo_principal: 'Llenar el taller' }, { producto_nombre: 'Solo producto' }, null]);
  assert.ok(/Campaña Taller/.test(r) && /producto: Taller IA/.test(r) && /2026-12-01 a 2026-12-31/.test(r) && /Llenar el taller/.test(r));
  assert.ok(/Solo producto/.test(r));
  assert.equal(E.resumirCampanas([]), '');
});

test('formatearJefe: con datos arma el bloque; sin datos avisa que no hay nada guardado; Jefe desconocido no aporta', () => {
  const con = E.formatearJefe('jefe-financiero', { 'financiero-calculadora': { presupuesto_ads: 3000 }, 'brand-book.metricas': { ticket_promedio: 950 } });
  assert.ok(/CONEXIÓN CON JEFE DE FINANZAS/.test(con) && /presupuesto_ads: 3000/.test(con) && /ticket_promedio: 950/.test(con));
  const sin = E.formatearJefe('jefe-radar', {});
  assert.ok(/todavía no tiene nada guardado/.test(sin) && /JEFE DEL FARO/.test(sin));
  assert.equal(E.formatearJefe('jefe-inventado', {}), '');
  const temp = E.formatearJefe('jefe-temporada', { 'temporada-campanas': [{ nombre: 'Camp', producto_nombre: 'Prod' }] });
  assert.ok(/JEFE DE TEMPORADA/.test(temp) && /Camp/.test(temp));
});

test('formatearJefe de 366 no pide leer llaves: solo indica traer lo completo sin acotar', () => {
  assert.equal(E.JEFES_CONECTABLES['jefe-366'].llaves.length, 0);
  assert.ok(/JEFE 366/.test(E.formatearJefe('jefe-366', {})));
});
