// Faro: "Mis números" (estadísticas de las cuentas PROPIAS) y su comparación contra los referentes.
// Sin red ni costos: Anthropic va simulado y se revisa lo que se le habría mandado.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./helpers/simulador');

const RADAR = 'api/consultor-radar.js';
const USO = { input_tokens: 100, output_tokens: 40 };
const BLOQUE = '---\nCUENTA: @mia (Instagram)\nPERIODO: octubre\nSEGUIDORES (total y cuánto cambió en el periodo): 1,200 (+40)\n---';
const DIAG = { id: 'd1', tipo: 'diagnostico-general', date: '1 oct 2026', foco: { id: 'all', nombre: '' }, diagnostico: 'Los referentes abren con promesa', porCuenta: {} };
const FOCO = { id: 'p1', nombre: 'Taller', esGrupo: false };

test('mis-numeros: exige datos, manda CSV y capturas a Claude y guarda el resultado en radar-mis-numeros', async () => {
  S.reiniciar({ datos: {}, respuesta: S.respuestaJSON(BLOQUE, USO) });
  assert.equal((await S.llamar(RADAR, { modo: 'mis-numeros', cliente: 'demo' })).codigo, 400);
  assert.equal((await S.llamar(RADAR, { modo: 'mis-numeros', cliente: 'demo', imagenes: [{ media_type: 'application/pdf', data: 'A'.repeat(500) }] })).codigo, 400);
  assert.equal((await S.llamar(RADAR, { modo: 'mis-numeros', cliente: 'demo', imagenes: [{ media_type: 'image/png', data: 'A'.repeat(3000000) }, { media_type: 'image/png', data: 'A'.repeat(3000000) }] })).codigo, 413);
  assert.equal(S.enviados.length, 0);

  const r = await S.llamar(RADAR, { modo: 'mis-numeros', cliente: 'demo', foco: FOCO, texto: 'fecha,seguidores\n2026-10-01,1160', imagenes: [{ media_type: 'image/jpeg', data: 'A'.repeat(500) }], nota: 'cuenta de Instagram' });
  assert.equal(r.codigo, 200);
  assert.equal(r.cuerpo.guardado, true);
  assert.equal(r.cuerpo.texto, BLOQUE);
  const contenido = S.enviados[0].messages[0].content;
  assert.equal(contenido[0].type, 'image');
  const instruccion = contenido[contenido.length - 1].text;
  assert.match(instruccion, /CUENTAS PROPIAS/);
  assert.match(instruccion, /2026-10-01,1160/);
  assert.match(instruccion, /cuenta de Instagram/);
  assert.match(instruccion, /nunca lo calcules por tu cuenta ni lo supongas/);
  const guardado = S.leerDato('demo:radar-mis-numeros');
  assert.equal(guardado.length, 1);
  assert.equal(guardado[0].texto, BLOQUE);
  assert.equal(guardado[0].foco.id, 'p1');
  assert.equal(S.registroUso('demo').length, 1, 'cuenta contra el tope de tokens');
});

test('mis-numeros: guarda máximo las últimas 6 lecturas', async () => {
  const previos = Array.from({ length: 6 }, (_, i) => ({ id: 'x' + i, date: 'd', foco: { id: 'all', nombre: '' }, texto: 'viejo ' + i }));
  S.reiniciar({ datos: { 'demo:radar-mis-numeros': previos }, respuesta: S.respuestaJSON(BLOQUE, USO) });
  await S.llamar(RADAR, { modo: 'mis-numeros', cliente: 'demo', texto: 'datos' });
  const g = S.leerDato('demo:radar-mis-numeros');
  assert.equal(g.length, 6);
  assert.equal(g[0].texto, 'viejo 1');
  assert.equal(g[5].texto, BLOQUE);
});

test('diagnóstico, análisis, brief y chat comparan contra MIS NÚMEROS cuando existen (y no los inventan cuando no)', async () => {
  const numeros = [{ id: 'n1', date: '5 oct 2026', foco: { id: 'all', nombre: '' }, texto: BLOQUE }];
  const insights = '{"que_funciona":["a"]}\n---INSIGHTS-Y-IDEAS---\n[{"insight":"i","uso":"ambos","prioridad":"alta"}]';
  const casos = [
    ['diagnostico-general', { extra: 'CUENTA: @a' }, 'Diagnóstico'],
    ['analisis-general', {}, insights],
    ['brief-estilo', {}, '{"resumen":"r"}'],
    ['chat', { mensajes: [{ role: 'user', content: 'hola' }] }, 'respuesta'],
  ];
  for (const [modo, extra, respuesta] of casos) {
    S.reiniciar({ datos: { 'demo:radar-historial': [DIAG], 'demo:radar-mis-numeros': numeros }, respuesta: S.respuestaJSON(respuesta, USO) });
    const r = await S.llamar(RADAR, { modo, cliente: 'demo', ...extra });
    assert.equal(r.codigo, 200, modo + ' ' + JSON.stringify(r.cuerpo));
    const enviado = JSON.stringify(S.enviados[0]);
    assert.ok(enviado.includes('MIS NÚMEROS (estadísticas de las cuentas PROPIAS'), modo);
    assert.ok(enviado.includes('SEGUIDORES (total y cuánto cambió en el periodo): 1,200 (+40)'), modo);
    assert.ok(enviado.includes('Usa SOLO estos datos'), modo);

    S.reiniciar({ datos: { 'demo:radar-historial': [DIAG] }, respuesta: S.respuestaJSON(respuesta, USO) });
    await S.llamar(RADAR, { modo, cliente: 'demo', ...extra });
    assert.ok(!JSON.stringify(S.enviados[0]).includes('MIS NÚMEROS'), modo + ' sin números no agrega el bloque');
  }
});

test('los números respetan el foco: un producto solo compara con los suyos', async () => {
  const numeros = [
    { id: 'n1', date: '5 oct 2026', foco: { id: 'p1', nombre: 'Taller' }, texto: 'NUMEROS DEL TALLER' },
    { id: 'n2', date: '6 oct 2026', foco: { id: 'p2', nombre: 'Otro' }, texto: 'NUMEROS DE OTRO' },
  ];
  const P = S.cargar(RADAR)._probar;
  const deTaller = P.bloqueMisNumeros(numeros, { id: 'p1' });
  assert.match(deTaller, /NUMEROS DEL TALLER/);
  assert.doesNotMatch(deTaller, /NUMEROS DE OTRO/);
  const todos = P.bloqueMisNumeros(numeros, { id: 'all' });
  assert.match(todos, /NUMEROS DEL TALLER/);
  assert.match(todos, /NUMEROS DE OTRO/);
  assert.equal(P.bloqueMisNumeros(numeros, { id: 'p9' }), '');
  assert.equal(P.bloqueMisNumeros([], { id: 'all' }), '');
});

test('mis-numeros respeta el tope de tokens (402 sin llamar a la IA)', async () => {
  const LLENO = { cicloInicio: new Date().toISOString(), usadoCicloUSD: 99, paquetes: [], pagos: [] };
  S.reiniciar({ datos: { 'rim:saldo': LLENO }, respuesta: S.respuestaJSON(BLOQUE, USO) });
  const r = await S.llamar(RADAR, { modo: 'mis-numeros', cliente: 'rim', texto: 'datos' });
  assert.equal(r.codigo, 402);
  assert.equal(r.cuerpo.tope, true);
  assert.equal(S.enviados.length, 0);
});
