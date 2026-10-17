// Pruebas del helper compartido de caché (api/_lib/cache-claude.js). Sin red ni costos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { systemConCache, historialConCache, entradaTotal, camposUso } = require('../api/_lib/cache-claude');

test('systemConCache: instrucciones y contexto con caché, lo variable al final sin caché', () => {
  const s = systemConCache('INSTRUCCIONES', 'CONTEXTO', 'variable 1', '', null, 'variable 2');
  assert.equal(s.length, 3);
  assert.deepEqual(s[0], { type: 'text', text: 'INSTRUCCIONES', cache_control: { type: 'ephemeral' } });
  assert.deepEqual(s[1], { type: 'text', text: 'CONTEXTO', cache_control: { type: 'ephemeral' } });
  assert.deepEqual(s[2], { type: 'text', text: 'variable 1\n\nvariable 2' });
});

test('systemConCache: omite bloques vacíos (la API no acepta bloques de texto vacíos)', () => {
  assert.deepEqual(systemConCache('A', ''), [{ type: 'text', text: 'A', cache_control: { type: 'ephemeral' } }]);
  assert.deepEqual(systemConCache('A', null, ''), [{ type: 'text', text: 'A', cache_control: { type: 'ephemeral' } }]);
});

test('historialConCache: marca solo el último mensaje y no modifica el arreglo original', () => {
  const original = [
    { role: 'user', content: 'hola' },
    { role: 'assistant', content: 'qué tal' },
    { role: 'user', content: 'seguimos' },
  ];
  const copia = JSON.parse(JSON.stringify(original));
  const r = historialConCache(original);
  assert.deepEqual(original, copia, 'el original no cambia');
  assert.equal(r[0], original[0]);
  assert.equal(r[1], original[1]);
  assert.deepEqual(r[2], { role: 'user', content: [{ type: 'text', text: 'seguimos', cache_control: { type: 'ephemeral' } }] });
});

test('historialConCache: con contenido en bloques (imágenes) marca el último bloque sin tocar los demás', () => {
  const img = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'x' } };
  const r = historialConCache([{ role: 'user', content: [img, { type: 'text', text: 't' }] }]);
  assert.deepEqual(r[0].content[0], img);
  assert.deepEqual(r[0].content[1], { type: 'text', text: 't', cache_control: { type: 'ephemeral' } });
});

test('historialConCache P1: no marca cuando el siguiente turno ya recortaría el historial', () => {
  const msgs = [{ role: 'user', content: 'x' }];
  const marcado = (o) => Array.isArray(historialConCache(msgs, o)[0].content);
  // Límite 40: con 38 válidos el siguiente turno tiene 40 (sin recorte) -> sí se cachea.
  assert.equal(marcado({ total: 38, max: 40 }), true);
  // Con 39 o 40 el siguiente turno pasa de 40 y se recortan los primeros -> no se cachea.
  assert.equal(marcado({ total: 39, max: 40 }), false);
  assert.equal(marcado({ total: 40, max: 40 }), false);
  // Ya recortado (más de 40 válidos) -> no se cachea.
  assert.equal(marcado({ total: 75, max: 40 }), false);
  // Meta Ads (límite 12).
  assert.equal(marcado({ total: 10, max: 12 }), true);
  assert.equal(marcado({ total: 11, max: 12 }), false);
  assert.equal(marcado({ total: 30, max: 12 }), false);
  // Sin opciones se comporta como antes.
  assert.equal(marcado(undefined), true);
});

test('historialConCache P1: no marca cuando el mensaje trae adjuntos que no se reenvían', () => {
  const msgs = [{ role: 'user', content: 'x' }];
  assert.equal(historialConCache(msgs, { noReutilizable: true }), msgs);
});

test('entradaTotal y camposUso: total = normal + escrita + leída, sin duplicar', () => {
  const usage = { input_tokens: 120, output_tokens: 50, cache_creation_input_tokens: 300, cache_read_input_tokens: 21000 };
  assert.equal(entradaTotal(usage), 21420);
  assert.deepEqual(camposUso(usage), { inputTokens: 21420, outputTokens: 50, cacheReadTokens: 21000, cacheWriteTokens: 300 });
});

test('camposUso: respuesta sin caché o sin usage', () => {
  assert.deepEqual(camposUso({ input_tokens: 9000, output_tokens: 700 }), { inputTokens: 9000, outputTokens: 700, cacheReadTokens: 0, cacheWriteTokens: 0 });
  assert.deepEqual(camposUso(undefined), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
});
