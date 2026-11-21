const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Carga js/tablero-hub.js en un "window" falso y saca las funciones de cálculo.
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'tablero-hub.js'), 'utf8'), ctx);
const T = ctx.window.__tableroHub._probar;

test('Temporada: solo eventos de temporada desde hoy, ordenados, con campaña y acción separadas', () => {
  const agenda = { eventos: [
    { origen: 'temporada', fecha: '2026-12-10', titulo: 'Campaña X · Remarketing' },
    { origen: 'temporada', fecha: '2026-11-01', titulo: 'Campaña X · Ya pasó' },
    { origen: 'contenido', fecha: '2026-11-25', titulo: 'Otro' },
    { origen: 'temporada', fecha: '2026-11-23', titulo: 'Sin separador' },
  ] };
  const p = T.proximosEventosTemporada(agenda, '2026-11-21');
  assert.strictEqual(p.length, 2);
  assert.strictEqual(p[0].fecha, '2026-11-23');
  assert.strictEqual(p[0].dias, 2);
  assert.strictEqual(p[0].accion, 'Sin separador');
  assert.strictEqual(p[1].campana, 'Campaña X');
  assert.strictEqual(p[1].accion, 'Remarketing');
  assert.strictEqual(T.proximosEventosTemporada(null, '2026-11-21').length, 0);
});

test('Contenido: por publicar = en proceso o programado; primero los que tienen fecha', () => {
  const data = {
    contenido: [
      { id: 'a', estado: 'idea', gancho: 'idea' },
      { id: 'b', estado: 'proceso', gancho: 'sin fecha' },
      { id: 'c', estado: 'programado', gancho: 'tarde', fecha: '2026-11-28' },
      { id: 'd', estado: 'publicado', gancho: 'ya' },
    ],
    historias: [{ id: 'h', estado: 'programado', gancho: 'pronto', fecha: '2026-11-22' }],
  };
  const l = T.porPublicar(data);
  assert.strictEqual(l.map((x) => x.id).join(','), 'h,c,b');
  assert.strictEqual(l[0].tab, 'historias');
});

test('Semana: lunes a domingo, cuenta posts por día y marca hoy', () => {
  const s = T.semana({ contenido: [{ fecha: '2026-11-17' }, { fecha: '2026-11-17' }], historias: [{ fecha: '2026-11-21' }] }, '2026-11-21');
  assert.strictEqual(s.length, 7);
  assert.strictEqual(s[0].fecha, '2026-11-16');
  assert.strictEqual(s[1].n, 2);
  assert.strictEqual(s[5].hoy, true);
  assert.strictEqual(s[5].n, 1);
});

test('ADN: porcentaje y secciones que faltan', () => {
  const a = T.avanceADN({ identidad: { nombre: 'X' }, tono: { estilo: '' }, visual: { colores: ['#000'] } });
  assert.strictEqual(a.pct, 29);
  assert.ok(a.faltan.includes('Tono de voz'));
  assert.ok(!a.faltan.includes('Identidad'));
});

test('Finanzas: meta con facturación da %, si no, ventas; sin datos, null', () => {
  assert.strictEqual(T.finanzas({ '366': { metaFacturacionMensual: 100000 }, situacion: { facturacionActual: 62000 } }).pct, 62);
  const v = T.finanzas({ situacion: { ventasActuales: 59, facturacionActual: null } });
  assert.strictEqual(v.tipo, 'ventas');
  assert.strictEqual(v.ventas, 59);
  assert.strictEqual(T.finanzas({ situacion: {} }), null);
  assert.strictEqual(T.finanzas(null), null);
});
