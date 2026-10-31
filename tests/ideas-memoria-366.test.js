// Generador de ideas de contenido: usa la memoria del Jefe 366 (una ficha por producto) y recuerda lo ya generado.
// Sin red ni costos: Anthropic va simulado y se revisa lo que se le habría mandado.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./helpers/simulador');

const USO = { input_tokens: 100, output_tokens: 40 };
const RESPUESTA = JSON.stringify({ viral: [{ idea: 'Idea nueva uno', video: 'v', stories: 's' }] });
const ARCHIVO = 'api/generar-ideas-366.js';

const CATALOGO = [
  { id: 'p1', uid: 'u1', nombre: 'Taller de Ventas', grupo_id: 'g1', tipo: 'servicio', notas: 'Dos sesiones en vivo' },
  { id: 'p2', uid: 'u2', nombre: 'Mentoría Premium', grupo_id: 'g1', tipo: 'servicio', notas: 'Acompañamiento mensual' },
];
const COMUNICACION = {
  lista: [
    {
      uid: 'c1', producto_uid: 'u1', nombre: 'Taller de Ventas', posicionamiento: 'El taller que te enseña a cerrar sin presionar',
      angulos_evergreen: [
        { angulo: 'El error de regalar descuentos', accion: 'Mostrar el costo real', emocion: 'Alivio', ejemplo: 'Dejé de regalar descuentos' },
        { angulo: 'Vender sin sentirte vendedor', accion: 'Conversación 1 a 1', emocion: 'Confianza', ejemplo: 'Platicar no es presionar' },
      ],
      frases_maestras: [{ frase: 'Cerrar es acompañar la decisión', activa: 'Calma', donde: 'Reels' }],
    },
    { uid: 'c2', producto_uid: 'u2', nombre: 'Mentoría Premium', posicionamiento: 'Tu equipo de ventas por un año', angulos_evergreen: [{ angulo: 'Ángulo exclusivo de la mentoría' }] },
  ],
};
const PRODUCTO_366 = { lista: [{ uid: 'o1', producto_uid: 'u1', nombre: 'Taller de Ventas', que_vendemos: 'Un taller práctico de dos sesiones', oferta_irresistible: 'Garantía de reembolso' }] };

const BASE = {
  'demo:catalogo-productos': CATALOGO,
  'demo:brand-book.366-comunicacion': COMUNICACION,
  'demo:brand-book.366-producto': PRODUCTO_366,
};

async function pedir(datos, body) {
  S.reiniciar({ datos, respuesta: S.respuestaJSON(RESPUESTA, USO) });
  const r = await S.llamar(ARCHIVO, { cliente: 'demo', tipo: 'viral', items_por_categoria: 1, ...body });
  assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
  return { r, enviado: JSON.stringify(S.enviados[0]) };
}

test('Ideas: con un producto elegido recibe SU comunicación y SU producto 366 (formato {lista})', async () => {
  const { enviado } = await pedir(BASE, { producto_id: 'p1' });
  assert.ok(enviado.includes('El error de regalar descuentos'), 'ángulos del producto');
  assert.ok(enviado.includes('Cerrar es acompañar la decisión'), 'frases maestras del producto');
  assert.ok(enviado.includes('Garantía de reembolso'), 'oferta del Producto 366');
  assert.ok(!enviado.includes('Ángulo exclusivo de la mentoría'), 'no se mezcla con otro producto');
});

test('Ideas: sin producto elegido recibe un resumen de la comunicación de cada producto', async () => {
  const { enviado } = await pedir(BASE, {});
  assert.ok(enviado.includes('ESTRATEGIA DE COMUNICACIÓN 366 POR PRODUCTO'));
  assert.ok(enviado.includes('El error de regalar descuentos'));
  assert.ok(enviado.includes('Ángulo exclusivo de la mentoría'));
  assert.ok(!enviado.includes('Cerrar es acompañar la decisión'), 'el resumen no vuelca todas las fichas completas');
});

test('Ideas: el formato viejo (una sola ficha) sigue funcionando', async () => {
  const viejo = { posicionamiento: 'Posición vieja', angulos_evergreen: [{ angulo: 'Ángulo del formato viejo', accion: 'a', emocion: 'e', ejemplo: 'x' }] };
  const { enviado } = await pedir({ 'demo:brand-book.366-comunicacion': viejo }, {});
  assert.ok(enviado.includes('Ángulo del formato viejo'));
});

test('Ideas: un ADN larguísimo ya no deja fuera al 366 ni a la conversación', async () => {
  const largo = Array.from({ length: 40 }, (_, i) => ({ nombre: `Perfil ${i}`, que_busca: 'x'.repeat(2000) }));
  const datos = {
    ...BASE,
    'demo:brand-book.audiencias': { lista: largo },
    'demo:366-builder-conversacion': [{ role: 'assistant', content: 'Descubrimos que el cliente compra por confianza' }],
  };
  const { enviado } = await pedir(datos, { producto_id: 'p1' });
  assert.ok(enviado.includes('El error de regalar descuentos'));
  assert.ok(enviado.includes('Descubrimos que el cliente compra por confianza'));
});

test('Ideas: recuerda lo ya generado y se lo pide al modelo como "no repetir"', async () => {
  const datos = {
    ...BASE,
    'demo:contenido-ideas-366': { general: { viral: [{ idea: 'Mito: vender es presionar' }] } },
    'demo:agente-contenido': { contenido: [{ gancho: 'El error de regalar descuentos' }], historias: [] },
  };
  const { enviado } = await pedir(datos, {});
  assert.ok(enviado.includes('NO las repitas'));
  assert.ok(enviado.includes('Mito: vender es presionar'), 'idea que se ve hoy en el Jefe de Contenido');
  assert.ok(enviado.includes('El error de regalar descuentos'), 'idea que ya está en el calendario');
});

test('Ideas: lo generado se guarda en el historial y llega en la siguiente generación', async () => {
  const primero = await pedir(BASE, {});
  assert.ok(!primero.enviado.includes('NO las repitas'), 'la primera vez no hay nada que evitar');
  const guardado = S.leerDato('demo:contenido-ideas-366-historial');
  assert.deepEqual(guardado.map((h) => h.idea), ['Idea nueva uno']);

  // Misma base de datos: no se reinicia, solo se vuelve a pedir.
  const r = await S.llamar(ARCHIVO, { cliente: 'demo', tipo: 'viral', items_por_categoria: 1 });
  assert.equal(r.codigo, 200);
  assert.ok(JSON.stringify(S.enviados[1]).includes('Idea nueva uno'));
});

test('Ideas: el historial guarda solo las últimas 60', async () => {
  const viejas = Array.from({ length: 60 }, (_, i) => ({ idea: `vieja ${i}`, cat: 'viral', fecha: '2026-01-01' }));
  await pedir({ ...BASE, 'demo:contenido-ideas-366-historial': viejas }, {});
  const guardado = S.leerDato('demo:contenido-ideas-366-historial');
  assert.equal(guardado.length, 60);
  assert.equal(guardado[59].idea, 'Idea nueva uno');
  assert.equal(guardado[0].idea, 'vieja 1');
});

test('Ideas: el contexto del negocio sigue en un bloque con caché aparte de lo que cambia en cada pedido', async () => {
  const datos = { ...BASE, 'demo:contenido-ideas-366-historial': [{ idea: 'Otra idea previa', cat: 'viral', fecha: '2026-01-01' }] };
  await pedir(datos, { producto_id: 'p1' });
  const system = S.enviados[0].system;
  const conCache = system.filter((b) => b.cache_control);
  assert.equal(conCache.length, 2, 'instrucciones fijas + contexto');
  assert.ok(conCache.some((b) => b.text.includes('El error de regalar descuentos')));
  assert.ok(!conCache.some((b) => b.text.includes('Otra idea previa')), 'las ideas previas van sin caché');
});
