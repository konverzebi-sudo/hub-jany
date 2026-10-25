// El Faro le pasa su radar y su brief de estilo a Jefe de Contenido y Jefe de Anuncios.
// Sin red ni costos: Anthropic va simulado y se revisa lo que se le habría mandado.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./helpers/simulador');

const USO = { input_tokens: 100, output_tokens: 40 };
const INSIGHTS = [{ insight: 'Abre con la promesa, no con tu nombre.', uso: 'ambos', prioridad: 'alta' }];
const CORRIDA = { id: 'a1', tipo: 'analisis-general', date: '1 oct 2026', insights: INSIGHTS };
// Un diagnóstico MÁS reciente que la corrida: no trae insights.
const DIAGNOSTICO = { id: 'd2', tipo: 'diagnostico-general', date: '2 oct 2026', diagnostico: 'otro diagnóstico', porCuenta: {} };
const BRIEF = {
  resumen: 'Tus referentes abren con una promesa clara.',
  voz_y_tono_a_tomar: ['Directo y cercano'],
  hooks_que_funcionan: ['Promesa en los primeros 3 segundos'],
  que_no_copiar: ['Urgencia falsa'],
  como_mezclarlo_con_la_marca: 'Toma la estructura con tu voz.',
  para_contenido: ['Abre cada guion con la promesa'],
  para_anuncios: ['Usa la promesa como primer renglón del anuncio'],
};
const ESTILO = [{ id: 'e1', date: '3 oct 2026', foco: { id: 'all', nombre: '' }, brief: BRIEF }];

const SERVICIOS = [
  ['Contenido', 'api/generar-guion-organico.js', { modo: 'pregunta', messages: [{ role: 'user', content: 'hola' }] }, 'Para el contenido:', 'Abre cada guion con la promesa', 'primer renglón del anuncio'],
  ['Anuncios', 'api/generar-anuncios.js', { modo: 'chat', messages: [{ role: 'user', content: 'hola' }] }, 'Para los anuncios:', 'primer renglón del anuncio', 'Abre cada guion con la promesa'],
];

for (const [nombre, archivo, cuerpo, titulo, suyo, ajeno] of SERVICIOS) {
  test(`${nombre}: recibe el brief de estilo del Faro (solo la parte que le toca)`, async () => {
    S.reiniciar({ datos: { 'demo:radar-historial': [CORRIDA], 'demo:radar-estilo': ESTILO }, respuesta: S.respuestaJSON('ok', USO) });
    const r = await S.llamar(archivo, { cliente: 'demo', ...cuerpo });
    assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
    const enviado = JSON.stringify(S.enviados[0]);
    assert.ok(enviado.includes('ESTILO DE REFERENTES (brief del Jefe del Faro, 3 oct 2026)'));
    assert.ok(enviado.includes('Tus referentes abren con una promesa clara.'));
    assert.ok(enviado.includes('Urgencia falsa'), 'también lo que NO se debe copiar');
    assert.ok(enviado.includes(titulo));
    assert.ok(enviado.includes(suyo));
    assert.ok(!enviado.includes(ajeno), 'no se mezcla lo del otro Jefe');
    assert.ok(enviado.includes('Abre con la promesa, no con tu nombre.'), 'los insights del radar siguen llegando');
  });

  test(`${nombre}: un diagnóstico más reciente ya no esconde los insights del radar`, async () => {
    S.reiniciar({ datos: { 'demo:radar-historial': [CORRIDA, DIAGNOSTICO] }, respuesta: S.respuestaJSON('ok', USO) });
    await S.llamar(archivo, { cliente: 'demo', ...cuerpo });
    const enviado = JSON.stringify(S.enviados[0]);
    assert.ok(enviado.includes('Abre con la promesa, no con tu nombre.'));
    assert.ok(!enviado.includes('ESTILO DE REFERENTES'), 'sin brief no se agrega ese bloque');
  });

  test(`${nombre}: sin radar ni brief todo queda igual que antes`, async () => {
    S.reiniciar({ datos: {}, respuesta: S.respuestaJSON('ok', USO) });
    const r = await S.llamar(archivo, { cliente: 'demo', ...cuerpo });
    assert.equal(r.codigo, 200);
    const enviado = JSON.stringify(S.enviados[0]);
    assert.ok(enviado.includes('RADAR DE MERCADO: todavía no hay corridas guardadas'));
    assert.ok(!enviado.includes('ESTILO DE REFERENTES'));
  });
}

test('Anuncios y Contenido usan el brief más reciente cuando hay varios', async () => {
  const nuevo = { id: 'e2', date: '9 oct 2026', foco: { id: 'p1', nombre: 'Taller' }, brief: { ...BRIEF, resumen: 'Resumen más nuevo.' } };
  S.reiniciar({ datos: { 'demo:radar-estilo': [...ESTILO, nuevo] }, respuesta: S.respuestaJSON('ok', USO) });
  await S.llamar('api/generar-anuncios.js', { cliente: 'demo', modo: 'chat', messages: [{ role: 'user', content: 'hola' }] });
  const enviado = JSON.stringify(S.enviados[0]);
  assert.ok(enviado.includes('Resumen más nuevo.'));
  assert.ok(enviado.includes('enfocado en Taller'));
  assert.ok(!enviado.includes('Tus referentes abren con una promesa clara.'));
});
