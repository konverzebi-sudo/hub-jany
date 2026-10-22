// Resumen mensual permanente del uso (<hub>:uso-tokens-mensual). Sin red ni costos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sumarAlMes, mesDe } = require('../api/_lib/uso-mensual');
const S = require('./helpers/simulador');

test('mesDe: usa la hora de México (no UTC)', () => {
  assert.equal(mesDe('2026-11-01T03:00:00Z'), '2026-10'); // 31 oct 21:00 en México
  assert.equal(mesDe('2026-11-01T07:00:00Z'), '2026-11');
  assert.equal(mesDe('fecha inválida'), null);
});

test('sumarAlMes: acumula por mes, guarda "desde" una sola vez y no pierde campos', () => {
  let r = sumarAlMes(null, { date: '2026-10-17T17:28:19Z', inputTokens: 31947, outputTokens: 88, cacheWriteTokens: 25639 });
  r = sumarAlMes(r, { date: '2026-10-17T17:30:08Z', inputTokens: 32080, outputTokens: 461, cacheReadTokens: 25639 });
  r = sumarAlMes(r, { date: '2026-11-02T18:00:00Z', inputTokens: 100, outputTokens: 10 });
  assert.equal(r.desde, '2026-10-17T17:28:19Z');
  assert.deepEqual(r.meses['2026-10'], { llamadas: 2, inputTokens: 64027, outputTokens: 549, cacheReadTokens: 25639, cacheWriteTokens: 25639 });
  assert.deepEqual(r.meses['2026-11'], { llamadas: 1, inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 });
});

test('sumarAlMes: registro sin campos de caché (como Faro) suma 0 en caché', () => {
  const r = sumarAlMes({}, { date: '2026-10-17T12:00:00Z', inputTokens: 500, outputTokens: 50 });
  assert.deepEqual(r.meses['2026-10'], { llamadas: 1, inputTokens: 500, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 });
});

test('Cada llamada a la IA suma una vez al resumen mensual de SU hub', async () => {
  const USO = { input_tokens: 100, output_tokens: 40, cache_creation_input_tokens: 200, cache_read_input_tokens: 5000 };
  S.reiniciar({ datos: { 'demo:brand-book.identidad': { nombre: 'Demo' } }, respuesta: S.respuestaJSON('ok', USO) });
  await S.llamar('api/consultor-366.js', { cliente: 'demo', messages: [{ role: 'user', content: 'hola' }] });
  await S.llamar('api/jefe-conversion.js', { cliente: 'demo', mensaje: 'hola' });
  await S.llamar('api/consultor-financiero.js', { cliente: 'otro', messages: [{ role: 'user', content: 'hola' }] });
  const demo = S.resumenMensual('demo');
  const mes = mesDe(new Date().toISOString());
  assert.deepEqual(demo.meses[mes], { llamadas: 2, inputTokens: 10600, outputTokens: 80, cacheReadTokens: 10000, cacheWriteTokens: 400 });
  assert.equal(S.registroUso('demo').length, 2, 'el registro detallado sigue igual');
  assert.equal(S.resumenMensual('otro').meses[mes].llamadas, 1, 'cada hub lleva su propio resumen');
});

test('El resumen mensual no se recorta aunque el registro detallado pase de 500', async () => {
  const viejo = Array.from({ length: 500 }, (_, i) => ({ date: '2026-09-01T12:00:00Z', endpoint: 'x', inputTokens: 1, outputTokens: 1 }));
  S.reiniciar({ datos: { 'demo:uso-tokens-log': viejo }, respuesta: S.respuestaJSON('ok', { input_tokens: 10, output_tokens: 1 }) });
  for (let i = 0; i < 3; i++) await S.llamar('api/consultor-366.js', { cliente: 'demo', messages: [{ role: 'user', content: 'hola' }] });
  assert.equal(S.registroUso('demo').length, 500, 'el detallado sigue con tope de 500');
  assert.equal(S.resumenMensual('demo').meses[mesDe(new Date().toISOString())].llamadas, 3);
});

test('Si la IA falla no se suma nada al resumen mensual', async () => {
  S.reiniciar({ respuesta: () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'x' } }) }) });
  await S.llamar('api/consultor-366.js', { cliente: 'demo', messages: [{ role: 'user', content: 'hola' }] });
  assert.equal(S.resumenMensual('demo'), null);
});
