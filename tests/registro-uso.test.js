// P4 y registro de uso: inputTokens es el total (normal + escrito + leído de caché), más
// cacheReadTokens y cacheWriteTokens, sin duplicar. Sin red ni costos.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./helpers/simulador');

const USO = { input_tokens: 150, output_tokens: 60, cache_creation_input_tokens: 2500, cache_read_input_tokens: 18000 };
const ESPERADO = { inputTokens: 20650, outputTokens: 60, cacheReadTokens: 18000, cacheWriteTokens: 2500 };
const ADN = { 'demo:brand-book.identidad': { nombre: 'Negocio Demo', giro: 'Cafetería' } };

function ultimoRegistro(cliente, endpoint) {
  const items = S.registroUso(cliente).filter((x) => x.endpoint === endpoint);
  assert.ok(items.length > 0, 'debe existir un registro de ' + endpoint);
  return items.at(-1);
}

test('jefe-conversion: registra cacheWriteTokens y el total sin duplicar', async () => {
  S.reiniciar({ datos: ADN, respuesta: S.respuestaJSON('respuesta simulada', USO) });
  const r = await S.llamar('api/jefe-conversion.js', { cliente: 'demo', mensaje: '¿Tienen envío?' });
  assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
  const reg = ultimoRegistro('demo', 'jefe-conversion');
  assert.deepEqual({ inputTokens: reg.inputTokens, outputTokens: reg.outputTokens, cacheReadTokens: reg.cacheReadTokens, cacheWriteTokens: reg.cacheWriteTokens }, ESPERADO);
  assert.equal(S.registroUso('demo').length, 1, 'un solo registro por petición');
});

test('jefe-estrategia-whatsapp: suma las llamadas en paralelo una sola vez y registra cacheWriteTokens', async () => {
  S.reiniciar({ datos: ADN, respuesta: S.respuestaStream('{"tarjetas":{}}', USO) });
  const r = await S.llamar('api/jefe-estrategia-whatsapp.js', { cliente: 'demo', txtConversacion: 'Cliente: hola' });
  assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
  const n = S.enviados.length;
  assert.ok(n >= 1, 'hubo llamadas simuladas');
  const total = { inputTokens: ESPERADO.inputTokens * n, outputTokens: ESPERADO.outputTokens * n, cacheReadTokens: ESPERADO.cacheReadTokens * n, cacheWriteTokens: ESPERADO.cacheWriteTokens * n };
  const reg = ultimoRegistro('demo', 'jefe-estrategia-whatsapp');
  assert.deepEqual({ inputTokens: reg.inputTokens, outputTokens: reg.outputTokens, cacheReadTokens: reg.cacheReadTokens, cacheWriteTokens: reg.cacheWriteTokens }, total);
  assert.deepEqual(r.cuerpo.usage, total, 'lo que ve la pantalla coincide con el registro');
  assert.equal(S.registroUso('demo').length, 1, 'un solo registro por generación');
});

test('Jefe 366: el registro y la respuesta llevan el total y el desglose de caché', async () => {
  S.reiniciar({ datos: ADN, respuesta: S.respuestaJSON('ok', USO) });
  const r = await S.llamar('api/consultor-366.js', { cliente: 'demo', messages: [{ role: 'user', content: 'hola' }] });
  assert.equal(r.codigo, 200);
  const reg = ultimoRegistro('demo', 'consultor-366-builder');
  assert.equal(reg.inputTokens, ESPERADO.inputTokens);
  assert.equal(reg.cacheWriteTokens, ESPERADO.cacheWriteTokens);
  assert.equal(reg.cacheReadTokens, ESPERADO.cacheReadTokens);
  assert.deepEqual(r.cuerpo.usage, ESPERADO);
});

test('Respuesta sin caché (como antes): inputTokens igual a input_tokens y desglose en 0', async () => {
  S.reiniciar({ datos: ADN, respuesta: S.respuestaJSON('ok', { input_tokens: 9000, output_tokens: 700 }) });
  await S.llamar('api/consultor-financiero.js', { cliente: 'demo', messages: [{ role: 'user', content: 'hola' }] });
  const reg = ultimoRegistro('demo', 'consultor-financiero');
  assert.equal(reg.inputTokens, 9000);
  assert.equal(reg.cacheReadTokens, 0);
  assert.equal(reg.cacheWriteTokens, 0);
});

test('Si la IA responde con error no se registra uso', async () => {
  S.reiniciar({ datos: ADN, respuesta: () => ({ ok: false, status: 529, json: async () => ({ error: { message: 'saturado' } }) }) });
  const r = await S.llamar('api/consultor-366.js', { cliente: 'demo', messages: [{ role: 'user', content: 'hola' }] });
  assert.equal(r.codigo, 529);
  assert.equal(S.registroUso('demo').length, 0);
});
