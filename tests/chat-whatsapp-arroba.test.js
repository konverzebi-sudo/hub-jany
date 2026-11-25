// En el chat del Jefe de WhatsApp, lo que se etiqueta con @ llega al modelo: los Jefes conectados traen lo que tienen guardado
// y el producto o campaña etiquetados se avisan como foco de ese mensaje. Sin red ni costos: Anthropic va simulado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('./helpers/simulador');

const USO = { input_tokens: 100, output_tokens: 40 };
const DATOS = {
  'demo:agente-anuncios': [{ nombre: 'Anuncio de prueba ZETA', objetivo: 'Mensajes' }],
  'demo:temporada-campanas': [{ id: 'c1', nombre: 'Día del Padre ZETA', producto_nombre: 'Taller', fecha_inicio_activa: '2026-06-01', fecha_fin_activa: '2026-06-20' }],
};

test('WhatsApp: un Jefe etiquetado con @ trae lo que tiene guardado', async () => {
  S.reiniciar({ datos: DATOS, respuesta: S.respuestaJSON('ok', USO) });
  const r = await S.llamar('api/jefe-conversion.js', {
    cliente: 'demo', mensaje: 'Me preguntan por @Jefe de Anuncios',
    menciones: [{ tipo: 'jefe', id: 'jefe-anuncios', nombre: 'Jefe de Anuncios' }],
  });
  assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
  const enviado = JSON.stringify(S.enviados[0]);
  assert.ok(enviado.includes('CONEXIÓN CON JEFE DE ANUNCIOS'), 'trae el bloque del Jefe conectado');
  assert.ok(enviado.includes('Anuncio de prueba ZETA'), 'trae lo guardado en ese Jefe');
});

test('WhatsApp: etiquetar el Jefe de Temporada trae el resumen de sus campañas', async () => {
  S.reiniciar({ datos: DATOS, respuesta: S.respuestaJSON('ok', USO) });
  const r = await S.llamar('api/jefe-conversion.js', {
    cliente: 'demo', mensaje: 'Pregunta de temporada',
    menciones: [{ tipo: 'jefe', id: 'jefe-temporada', nombre: 'Jefe de Temporada' }],
  });
  assert.equal(r.codigo, 200);
  assert.ok(JSON.stringify(S.enviados[0]).includes('Día del Padre ZETA'));
});

test('WhatsApp: producto etiquetado se avisa como foco de ESE mensaje', async () => {
  S.reiniciar({ datos: DATOS, respuesta: S.respuestaJSON('ok', USO) });
  const r = await S.llamar('api/jefe-conversion.js', {
    cliente: 'demo', mensaje: '@Taller ¿cuánto cuesta?', producto366: { nombre: 'Taller' },
    menciones: [{ tipo: 'producto', id: 'p1', nombre: 'Taller' }],
  });
  assert.equal(r.codigo, 200);
  const enviado = JSON.stringify(S.enviados[0]);
  assert.ok(enviado.includes('ETIQUETA @ DE ESTE MENSAJE'));
  assert.ok(enviado.includes('«Taller»'));
});

test('WhatsApp: el propio Jefe de WhatsApp y las etiquetas inválidas se ignoran sin tronar', async () => {
  S.reiniciar({ datos: DATOS, respuesta: S.respuestaJSON('ok', USO) });
  const r = await S.llamar('api/jefe-conversion.js', {
    cliente: 'demo', mensaje: 'hola',
    menciones: [{ tipo: 'jefe', id: 'jefe-whatsapp', nombre: 'WhatsApp' }, 'x', null, { tipo: 'otro', id: 'z' }, { tipo: 'jefe', id: 'no-existe' }],
  });
  assert.equal(r.codigo, 200);
  const enviado = JSON.stringify(S.enviados[0]);
  assert.ok(!enviado.includes('CONEXIÓN CON'));
  assert.ok(!enviado.includes('ETIQUETA @ DE ESTE MENSAJE'));
});

test('WhatsApp: sin etiquetas todo queda igual que antes', async () => {
  S.reiniciar({ datos: DATOS, respuesta: S.respuestaJSON('ok', USO) });
  const r = await S.llamar('api/jefe-conversion.js', { cliente: 'demo', mensaje: 'hola' });
  assert.equal(r.codigo, 200);
  const enviado = JSON.stringify(S.enviados[0]);
  assert.ok(!enviado.includes('CONEXIÓN CON'));
  assert.ok(!enviado.includes('ETIQUETA @'));
});

test('WhatsApp: las dos páginas tienen el menú @ y mandan las menciones', () => {
  for (const f of ['jefe-conversion-ventas.html', 'jefe-conversion-ventas-rancho-seco.html']) {
    const h = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(h.includes('id="menuMencion"'), f + ' menú');
    assert.ok(h.includes('menciones: mencionesActivasChat(input)'), f + ' payload');
    assert.ok(h.includes("id: 'jefe-anuncios'"), f + ' lista de Jefes');
    assert.ok(!h.includes("id: 'jefe-whatsapp'"), f + ' no se etiqueta a sí mismo');
  }
});
