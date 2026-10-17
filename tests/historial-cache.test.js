// P1: cada chat cachea su historial solo cuando el siguiente turno lo va a reutilizar.
// Verifica también que el recorte de mensajes y el texto mandado no cambian. Sin red ni costos.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./helpers/simulador');

const USO = { input_tokens: 100, output_tokens: 40, cache_creation_input_tokens: 200, cache_read_input_tokens: 5000 };
const ADN = {
  'demo:brand-book.identidad': { nombre: 'Negocio Demo', giro: 'Cafetería' },
  'demo:catalogo-productos': [{ id: 'p1', nombre: 'Café de olla', precio: 45 }],
};

// Quita las marcas de caché para comparar contra lo que se mandaba antes del cambio.
function sinCache(messages) {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    const bloques = m.content.map(({ cache_control, ...b }) => b);
    return bloques.length === 1 && bloques[0].type === 'text' ? { role: m.role, content: bloques[0].text } : { role: m.role, content: bloques };
  });
}

function revisar(cuerpo, { cachea, ultimos }) {
  assert.ok(S.puntosDeCache(cuerpo) <= 4, 'máximo 4 puntos de caché');
  assert.ok(Array.isArray(cuerpo.system) && cuerpo.system[0].cache_control, 'las instrucciones siempre van con caché');
  assert.equal(S.historialCacheado(cuerpo), cachea, cachea ? 'el historial debe ir con caché' : 'el historial NO debe ir con caché');
  if (ultimos) assert.deepEqual(sinCache(cuerpo.messages), ultimos, 'los mensajes mandados son los mismos de antes (solo el recorte de siempre)');
}

// Cada caso: servicio, cuerpo de la petición y límite de su historial.
const CASOS = [
  { nombre: 'Jefe 366', archivo: 'api/consultor-366.js', extra: {}, max: 40 },
  { nombre: 'Temporada', archivo: 'api/consultor-366.js', extra: { agente: 'temporada' }, max: 40 },
  { nombre: 'Cierre (chat)', archivo: 'api/consultor-cierre.js', extra: { modo: 'manual-tienda' }, max: 40 },
  { nombre: 'Finanzas', archivo: 'api/consultor-financiero.js', extra: {}, max: 40 },
  { nombre: 'Productor IA', archivo: 'api/consultor-financiero.js', extra: { agente: 'diseno' }, max: 40 },
  { nombre: 'Meta Ads', archivo: 'api/consultor-financiero.js', extra: { agente: 'metaads' }, max: 12 },
  { nombre: 'Anuncios (chat)', archivo: 'api/generar-anuncios.js', extra: { modo: 'chat' }, max: 40 },
  { nombre: 'Guion orgánico (pregunta)', archivo: 'api/generar-guion-organico.js', extra: { modo: 'pregunta' }, max: 40 },
];

for (const c of CASOS) {
  test(`${c.nombre}: conversación corta -> historial con caché y mensajes sin cambios`, async () => {
    S.reiniciar({ datos: ADN, respuesta: S.respuestaJSON('respuesta simulada', USO) });
    const msgs = S.conversacion(5);
    const r = await S.llamar(c.archivo, { cliente: 'demo', messages: msgs, ...c.extra });
    assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
    assert.equal(S.enviados.length, 1);
    revisar(S.enviados[0], { cachea: true, ultimos: msgs });
  });

  test(`${c.nombre}: justo antes del límite (${c.max - 2} mensajes) -> sí cachea`, async () => {
    S.reiniciar({ datos: ADN, respuesta: S.respuestaJSON('ok', USO) });
    const msgs = S.conversacion(c.max - 3); // impar para que termine en mensaje del usuario
    const r = await S.llamar(c.archivo, { cliente: 'demo', messages: msgs, ...c.extra });
    assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
    revisar(S.enviados[0], { cachea: true, ultimos: msgs });
  });

  test(`${c.nombre}: en el límite (${c.max - 1} mensajes, el siguiente turno recorta) -> no cachea el historial`, async () => {
    S.reiniciar({ datos: ADN, respuesta: S.respuestaJSON('ok', USO) });
    const msgs = S.conversacion(c.max - 1);
    const r = await S.llamar(c.archivo, { cliente: 'demo', messages: msgs, ...c.extra });
    assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
    revisar(S.enviados[0], { cachea: false, ultimos: msgs });
  });

  test(`${c.nombre}: conversación más larga que el límite -> mismo recorte de siempre y sin caché de historial`, async () => {
    S.reiniciar({ datos: ADN, respuesta: S.respuestaJSON('ok', USO) });
    const msgs = S.conversacion(c.max + 11);
    const r = await S.llamar(c.archivo, { cliente: 'demo', messages: msgs, ...c.extra });
    assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
    let esperados = msgs.slice(-c.max);
    // Jefe 366 y Temporada ya descartaban mensajes iniciales del asistente (la API exige empezar con el usuario).
    if (c.archivo === 'api/consultor-366.js' && !c.extra.agente) while (esperados[0].role === 'assistant') esperados = esperados.slice(1);
    revisar(S.enviados[0], { cachea: false, ultimos: esperados });
    assert.equal(S.enviados[0].messages.length, esperados.length);
  });
}

test('Jefe 366: el turno 2 repite exactamente instrucciones, contexto e historial del turno 1 (la caché puede leerse)', async () => {
  S.reiniciar({ datos: ADN, respuesta: S.respuestaJSON('respuesta simulada', USO) });
  const t1 = [{ role: 'user', content: 'hola' }];
  await S.llamar('api/consultor-366.js', { cliente: 'demo', messages: t1 });
  const t2 = [...t1, { role: 'assistant', content: 'respuesta simulada' }, { role: 'user', content: 'seguimos' }];
  await S.llamar('api/consultor-366.js', { cliente: 'demo', messages: t2 });
  const [a, b] = S.enviados;
  assert.deepEqual(b.system.slice(0, 2), a.system.slice(0, 2), 'instrucciones y contexto idénticos');
  assert.deepEqual(sinCache(b.messages.slice(0, a.messages.length)), sinCache(a.messages), 'el historial anterior se repite tal cual');
});

test('Jefe 366: con conversación adjunta no se cachea el historial y el adjunto se manda igual que antes', async () => {
  S.reiniciar({ datos: ADN, respuesta: S.respuestaJSON('ok', USO) });
  const r = await S.llamar('api/consultor-366.js', { cliente: 'demo', messages: S.conversacion(3), txtConversacion: 'Cliente: hola\nYo: buen día' });
  assert.equal(r.codigo, 200);
  const cuerpo = S.enviados[0];
  assert.equal(S.historialCacheado(cuerpo), false);
  assert.match(JSON.stringify(cuerpo.messages.at(-1).content), /Cliente: hola/);
});

test('Guion orgánico: con imágenes en el mensaje actual no se cachea el historial', async () => {
  S.reiniciar({ datos: ADN, respuesta: S.respuestaJSON('ok', USO) });
  const r = await S.llamar('api/generar-guion-organico.js', {
    cliente: 'demo', modo: 'pregunta', messages: S.conversacion(3),
    imagenes: [{ mediaType: 'image/jpeg', data: 'AAAA' }],
  });
  assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
  const ult = S.enviados[0].messages.at(-1);
  assert.equal(ult.content[0].type, 'image', 'la imagen se sigue mandando');
  assert.equal(S.historialCacheado(S.enviados[0]), false);
});

test('Ningún dato de otro cliente entra en la petición', async () => {
  S.reiniciar({
    datos: { ...ADN, 'otro:brand-book.identidad': { nombre: 'NEGOCIO-AJENO-XYZ' } },
    respuesta: S.respuestaJSON('ok', USO),
  });
  await S.llamar('api/consultor-366.js', { cliente: 'demo', messages: S.conversacion(3) });
  const texto = JSON.stringify(S.enviados[0]);
  assert.match(texto, /Negocio Demo/);
  assert.doesNotMatch(texto, /NEGOCIO-AJENO-XYZ/);
});
