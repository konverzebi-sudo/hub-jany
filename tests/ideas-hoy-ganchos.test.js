// Las 3 ideas para hoy parten de ganchos del banco (no del "tono IA" del modelo).
// Sin red ni costos: Anthropic va simulado y se revisa lo que se le habría mandado.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./helpers/simulador');

const USO = { input_tokens: 100, output_tokens: 40 };
const IDEAS = JSON.stringify({ ideas: [{ idea: 'Grabas tu mesa de trabajo y dices la primera frase.', gancho: 'Este eres tú intentando publicar.', tipo: 'viral', etapa: 'descubrimiento' }] });

test('Ideas para hoy: los ganchos del banco llegan a la instrucción', async () => {
  S.reiniciar({ datos: {}, respuesta: S.respuestaJSON(IDEAS, USO) });
  const r = await S.llamar('api/generar-guion-organico.js', {
    cliente: 'demo', modo: 'ideas', objetivo: 'alcance', cantidad: 3, paraHoy: true,
    ganchosBase: ['[Virales (alcance)] Esto nadie te lo dice sobre [TEMA].', '[Identificación] Este eres tú intentando [LOGRAR RESULTADO].'],
  });
  assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
  const enviado = JSON.stringify(S.enviados[0]);
  assert.ok(enviado.includes('GANCHOS DE PARTIDA'));
  assert.ok(enviado.includes('Esto nadie te lo dice sobre [TEMA].'));
  assert.ok(enviado.includes('Este eres tú intentando [LOGRAR RESULTADO].'));
  assert.ok(enviado.includes('Prohibido sonar a publicidad o a IA'));
});

test('Ideas para hoy: sin ganchos o sin la bandera no se agrega el bloque, y se acotan entradas raras', async () => {
  S.reiniciar({ datos: {}, respuesta: S.respuestaJSON(IDEAS, USO) });
  await S.llamar('api/generar-guion-organico.js', { cliente: 'demo', modo: 'ideas', objetivo: 'alcance', cantidad: 3, paraHoy: true });
  assert.ok(!JSON.stringify(S.enviados[0]).includes('GANCHOS DE PARTIDA'));

  S.reiniciar({ datos: {}, respuesta: S.respuestaJSON(IDEAS, USO) });
  await S.llamar('api/generar-guion-organico.js', { cliente: 'demo', modo: 'ideas', objetivo: 'alcance', cantidad: 3, ganchosBase: ['Gancho suelto'] });
  assert.ok(!JSON.stringify(S.enviados[0]).includes('GANCHOS DE PARTIDA'), 'sin paraHoy no aplica');

  S.reiniciar({ datos: {}, respuesta: S.respuestaJSON(IDEAS, USO) });
  const largos = Array.from({ length: 20 }, (_, i) => 'G' + i + ' ' + 'x'.repeat(500));
  const r = await S.llamar('api/generar-guion-organico.js', { cliente: 'demo', modo: 'ideas', objetivo: 'alcance', cantidad: 3, paraHoy: true, ganchosBase: [...largos, null, 5] });
  assert.equal(r.codigo, 200);
  const enviado = JSON.stringify(S.enviados[0]);
  assert.ok(enviado.includes('G7 '), 'cuenta hasta 8');
  assert.ok(!enviado.includes('G8 '), 'ignora de más');
  assert.ok(!enviado.includes('x'.repeat(250)), 'recorta cada gancho');
});
