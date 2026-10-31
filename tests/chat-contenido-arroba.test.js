// En el chat de Contenido, lo que se etiqueta con @ manda sobre la pastilla de arriba y el chat ya sabe de cuál habla.
// Sin red ni costos: Anthropic va simulado y se revisa lo que se le habría mandado.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./helpers/simulador');

const USO = { input_tokens: 100, output_tokens: 40 };
const CATALOGO = [
  { id: 'p-taller', nombre: 'Taller Mamalón', tipo: 'Taller', precio: '$999', notas: 'Taller de contenido en vivo.' },
  { id: 'p-diag', nombre: 'Diagnóstico y solución de daños', tipo: 'Servicio', precio: '$950', notas: 'Revisión exprés del negocio.' },
];
const MSGS = [{ role: 'user', content: 'Quiero hacer mi calendario de contenido para @Diagnóstico y solución de daños' }];

test('Contenido: un producto etiquetado con @ reemplaza al de la pastilla y se lo dice al chat', async () => {
  S.reiniciar({ datos: { 'demo:catalogo-productos': CATALOGO }, respuesta: S.respuestaJSON('ok', USO) });
  const r = await S.llamar('api/generar-guion-organico.js', {
    cliente: 'demo', modo: 'pregunta', producto_id: 'p-taller', messages: MSGS,
    menciones: [{ tipo: 'producto', id: 'p-diag', nombre: 'Diagnóstico y solución de daños' }],
  });
  assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
  const enviado = JSON.stringify(S.enviados[0]);
  assert.ok(enviado.includes('ETIQUETAS @ DE ESTE MENSAJE'));
  assert.ok(enviado.includes('NO le preguntes de qué producto'));
  assert.ok(enviado.includes('PRODUCTO ESPECÍFICO A ENFOCAR: Diagnóstico y solución de daños'), 'trae la ficha del producto etiquetado');
  assert.ok(!enviado.includes('PRODUCTO ESPECÍFICO A ENFOCAR: Taller Mamalón'), 'ya no trae el enfoque del producto de la pastilla');
});

test('Contenido: sin etiquetas todo queda igual que antes (manda la pastilla)', async () => {
  S.reiniciar({ datos: { 'demo:catalogo-productos': CATALOGO }, respuesta: S.respuestaJSON('ok', USO) });
  const r = await S.llamar('api/generar-guion-organico.js', { cliente: 'demo', modo: 'pregunta', producto_id: 'p-taller', messages: MSGS });
  assert.equal(r.codigo, 200);
  const enviado = JSON.stringify(S.enviados[0]);
  assert.ok(!enviado.includes('ETIQUETAS @ DE ESTE MENSAJE'));
  assert.ok(enviado.includes('PRODUCTO ESPECÍFICO A ENFOCAR: Taller Mamalón'));
});

test('Contenido: etiquetas inválidas se ignoran y no truenan', async () => {
  S.reiniciar({ datos: { 'demo:catalogo-productos': CATALOGO }, respuesta: S.respuestaJSON('ok', USO) });
  const r = await S.llamar('api/generar-guion-organico.js', {
    cliente: 'demo', modo: 'pregunta', producto_id: 'p-taller', messages: MSGS,
    menciones: ['x', null, { tipo: 'otro', id: 'p-diag' }, { tipo: 'producto' }],
  });
  assert.equal(r.codigo, 200);
  const enviado = JSON.stringify(S.enviados[0]);
  assert.ok(!enviado.includes('ETIQUETAS @ DE ESTE MENSAJE'));
  assert.ok(enviado.includes('PRODUCTO ESPECÍFICO A ENFOCAR: Taller Mamalón'));
});
