// Tope de tokens por hub, paquetes extra, protección del saldo y aviso de pago de Stripe.
// Sin red ni costos: la base, Anthropic y Stripe están simulados.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./helpers/simulador');
const saldo = require('../api/_lib/saldo');

const DIA = 86400000;
const HOY = '2026-10-17T18:00:00.000Z';
const mas = (iso, dias) => new Date(new Date(iso).getTime() + dias * DIA).toISOString();

// ---------- reglas (api/_lib/saldo.js) ----------

test('costoUSD: misma fórmula que /hubs (normal, escritura y lectura de caché, salida)', () => {
  const c = saldo.costoUSD({ inputTokens: 31947, outputTokens: 88, cacheReadTokens: 0, cacheWriteTokens: 25639 });
  assert.equal(Math.round(c * 1e5) / 1e5, 0.11639); // llamada 1 de la prueba real del Jefe 366
});

test('tope de $15: al llegar se bloquea; jefeshub nunca se bloquea', () => {
  const doc = saldo.docNuevo(HOY);
  saldo.descontar(doc, 14.99, HOY);
  assert.equal(saldo.estado(doc, 'rancho-seco', HOY).bloqueado, false);
  saldo.descontar(doc, 0.02, HOY);
  const e = saldo.estado(doc, 'rancho-seco', HOY);
  assert.equal(e.bloqueado, true);
  assert.equal(e.porcentaje, 100);
  assert.equal(saldo.estado(doc, 'jefeshub', HOY).bloqueado, false);
  assert.equal(saldo.estado(doc, 'jefeshub', HOY).sinTope, true);
});

test('porcentaje y tokens: $6 de $15 = 40% y 1.8 de 4.5 millones', () => {
  const doc = saldo.docNuevo(HOY);
  saldo.descontar(doc, 6, HOY);
  const e = saldo.estado(doc, 'rim', HOY);
  assert.equal(e.porcentaje, 40);
  assert.equal(e.tokensUsados, 1800000);
  assert.equal(e.tokensTotales, 4500000);
});

test('el ciclo se renueva cada 30 días desde el inicio', () => {
  const doc = saldo.docNuevo(HOY);
  saldo.descontar(doc, 15, HOY);
  assert.equal(saldo.estado(doc, 'rim', mas(HOY, 29.9)).bloqueado, true);
  const e = saldo.estado(doc, 'rim', mas(HOY, 30));
  assert.equal(e.bloqueado, false);
  assert.equal(e.porcentaje, 0);
  assert.equal(e.renueva, mas(HOY, 60));
  // Si pasan varios ciclos sin uso, salta al ciclo correcto.
  assert.equal(saldo.estado(doc, 'rim', mas(HOY, 95)).renueva, mas(HOY, 120));
});

test('paquete extra: suma $15, desbloquea, se gasta después del tope y vence a los 45 días', () => {
  const doc = saldo.docNuevo(HOY);
  saldo.descontar(doc, 15, HOY);
  assert.equal(saldo.agregarPaquete(doc, 'cs_test_1', HOY), true);
  let e = saldo.estado(doc, 'rim', HOY);
  assert.equal(e.bloqueado, false);
  assert.equal(e.porcentaje, 50);
  assert.equal(e.tokensTotales, 9000000);
  saldo.descontar(doc, 5, HOY);
  assert.equal(doc.paquetes[0].usadoUSD, 5, 'lo nuevo sale del paquete porque el tope ya estaba lleno');
  // Al renovarse el ciclo, primero se usa el tope nuevo y el paquete conserva su resto.
  saldo.descontar(doc, 3, mas(HOY, 31));
  assert.equal(doc.usadoCicloUSD, 3);
  assert.equal(doc.paquetes[0].usadoUSD, 5);
  // A los 45 días el paquete desaparece.
  e = saldo.estado(doc, 'rim', mas(HOY, 45));
  assert.equal(e.paquetes.length, 0);
  assert.equal(e.tokensTotales, 4500000);
});

test('con varios paquetes se gasta primero el que vence antes', () => {
  const doc = saldo.docNuevo(HOY);
  saldo.descontar(doc, 15, HOY);
  saldo.agregarPaquete(doc, 'cs_a', HOY);
  saldo.agregarPaquete(doc, 'cs_b', mas(HOY, 10));
  saldo.descontar(doc, 20, mas(HOY, 11));
  const a = doc.paquetes.find((p) => p.id === 'cs_a'), b = doc.paquetes.find((p) => p.id === 'cs_b');
  assert.equal(a.usadoUSD, 15);
  assert.equal(b.usadoUSD, 5);
});

test('el mismo pago no se acredita dos veces', () => {
  const doc = saldo.docNuevo(HOY);
  assert.equal(saldo.agregarPaquete(doc, 'cs_x', HOY), true);
  assert.equal(saldo.agregarPaquete(doc, 'cs_x', HOY), false);
  assert.equal(doc.paquetes.length, 1);
});

// ---------- servicios de IA ----------

const USO = { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const LLENO = { cicloInicio: HOY, usadoCicloUSD: 15, paquetes: [], pagos: [] };

// Un cuerpo mínimo para cada servicio de IA.
const SERVICIOS = [
  ['Jefe 366', 'api/consultor-366.js', { messages: [{ role: 'user', content: 'hola' }] }],
  ['Temporada', 'api/consultor-366.js', { agente: 'temporada', messages: [{ role: 'user', content: 'hola' }] }],
  ['Conversión (cierre)', 'api/consultor-cierre.js', { modo: 'manual-tienda', messages: [{ role: 'user', content: 'hola' }] }],
  ['Finanzas', 'api/consultor-financiero.js', { messages: [{ role: 'user', content: 'hola' }] }],
  ['Meta Ads', 'api/consultor-financiero.js', { agente: 'metaads', messages: [{ role: 'user', content: 'hola' }] }],
  ['Faro', 'api/consultor-radar.js', { modo: 'diagnostico-general' }],
  ['Anuncios', 'api/generar-anuncios.js', { modo: 'chat', messages: [{ role: 'user', content: 'hola' }] }],
  ['Contenido', 'api/generar-guion-organico.js', { modo: 'pregunta', messages: [{ role: 'user', content: 'hola' }] }],
  ['Ideas 366', 'api/generar-ideas-366.js', {}],
  ['WhatsApp y Ventas', 'api/jefe-conversion.js', { mensaje: 'hola' }],
  ['Estrategia WhatsApp', 'api/jefe-estrategia-whatsapp.js', { txtConversacion: 'Cliente: hola' }],
];

for (const [nombre, archivo, cuerpo] of SERVICIOS) {
  test(`${nombre}: con el tope lleno responde 402 con el aviso y NO llama a la IA`, async () => {
    S.reiniciar({ datos: { 'rim:saldo': LLENO }, respuesta: S.respuestaJSON('ok', USO) });
    const r = await S.llamar(archivo, { cliente: 'rim', ...cuerpo });
    assert.equal(r.codigo, 402, JSON.stringify(r.cuerpo));
    assert.equal(r.cuerpo.tope, true);
    assert.match(r.cuerpo.error, /\$750 MXN/);
    assert.equal(S.enviados.length, 0, 'no se gastó ni un token');
  });
}

test('jefeshub (hub interno) no se bloquea aunque su barra esté llena', async () => {
  S.reiniciar({ datos: { 'jefeshub:saldo': LLENO }, respuesta: S.respuestaJSON('ok', USO) });
  const r = await S.llamar('api/consultor-366.js', { cliente: 'jefeshub', messages: [{ role: 'user', content: 'hola' }] });
  assert.equal(r.codigo, 200);
  assert.equal(S.enviados.length, 1);
});

test('cada llamada descuenta su costo real del saldo de SU hub', async () => {
  S.reiniciar({ datos: { 'rim:saldo': saldo.docNuevo(new Date().toISOString()) }, respuesta: S.respuestaJSON('ok', USO) });
  await S.llamar('api/consultor-366.js', { cliente: 'rim', messages: [{ role: 'user', content: 'hola' }] });
  await S.llamar('api/generar-anuncios.js', { cliente: 'rim', modo: 'chat', messages: [{ role: 'user', content: 'hola' }] });
  const costo = saldo.costoUSD({ inputTokens: 1000, outputTokens: 100 });
  assert.equal(Math.round(S.leerDato('rim:saldo').usadoCicloUSD * 1e6), Math.round(2 * costo * 1e6));
  assert.equal(S.leerDato('optica-one:saldo'), null, 'otro hub no se toca');
});

test('un hub nuevo de /hubs arranca su ciclo en su fecha de alta', async () => {
  const alta = new Date(Date.now() - 5 * DIA).toISOString();
  S.reiniciar({ datos: { 'hubs:registro': { hubs: [{ slug: 'arq-ivan', creado: alta }] } }, respuesta: S.respuestaJSON('ok', USO) });
  await S.llamar('api/consultor-366.js', { cliente: 'arq-ivan', messages: [{ role: 'user', content: 'hola' }] });
  assert.equal(S.leerDato('arq-ivan:saldo').cicloInicio, alta);
});

test('si la IA falla no se descuenta nada', async () => {
  S.reiniciar({ respuesta: () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'x' } }) }) });
  await S.llamar('api/consultor-366.js', { cliente: 'rim', messages: [{ role: 'user', content: 'hola' }] });
  assert.equal(S.leerDato('rim:saldo'), null);
});

// ---------- storage: protección, estado y aviso de pago ----------

const STORAGE = 'api/storage/[key].js';
process.env.STORAGE_WRITE_TOKEN = 'token-compartido-de-prueba';
process.env.STRIPE_SECRET_KEY = 'sk_test_prueba_local';
process.env.STRIPE_LINK_PAQUETE = 'https://buy.stripe.com/test_link';

for (const llave of ['rim:saldo', 'rim:uso-tokens-log', 'rim:uso-tokens-mensual']) {
  test(`storage: nadie puede escribir ${llave}, ni con el token compartido`, async () => {
    S.reiniciar({ datos: { 'rim:saldo': LLENO } });
    const r = await S.llamar(STORAGE, { value: JSON.stringify({ usadoCicloUSD: 0 }) }, { query: { key: llave }, headers: { 'x-storage-token': 'token-compartido-de-prueba' } });
    assert.equal(r.codigo, 403);
    assert.deepEqual(S.leerDato('rim:saldo'), LLENO);
  });
}

test('storage: las demás llaves se siguen guardando igual con el token', async () => {
  S.reiniciar();
  const r = await S.llamar(STORAGE, { value: JSON.stringify({ nombre: 'RIM' }) }, { query: { key: 'rim:brand-book.identidad' }, headers: { 'x-storage-token': 'token-compartido-de-prueba' } });
  assert.equal(r.codigo, 200);
});

test('GET saldo: estado para la barra con link de compra del hub', async () => {
  S.reiniciar({ datos: { 'rim:saldo': { cicloInicio: new Date().toISOString(), usadoCicloUSD: 7.5, paquetes: [], pagos: [] } } });
  const r = await S.llamar(STORAGE, null, { method: 'GET', query: { key: 'saldo', cliente: 'rim' } });
  assert.equal(r.codigo, 200);
  assert.equal(r.cuerpo.porcentaje, 50);
  assert.equal(r.cuerpo.bloqueado, false);
  assert.equal(r.cuerpo.paquete.precioMXN, 750);
  assert.equal(r.cuerpo.paquete.precioAntesMXN, 1000);
  assert.equal(r.cuerpo.paquete.vigenciaDias, 45);
  assert.equal(r.cuerpo.linkCompra, 'https://buy.stripe.com/test_link?client_reference_id=rim');
});

function eventoStripe(tipo, id) { return { type: tipo, data: { object: { id } } }; }
function sesion(id, extra) { return { id, payment_status: 'paid', currency: 'mxn', amount_total: 75000, client_reference_id: 'rim', ...extra }; }

test('Stripe: pago aprobado -> se activa el paquete al instante (consultando a Stripe, no al aviso)', async () => {
  S.reiniciar({ datos: { 'rim:saldo': LLENO } });
  S.stripe.set('cs_test_ok', sesion('cs_test_ok'));
  const r = await S.llamar(STORAGE, eventoStripe('checkout.session.completed', 'cs_test_ok'), { query: { key: 'stripe-webhook' } });
  assert.equal(r.codigo, 200);
  assert.equal(r.cuerpo.acreditado, true);
  assert.equal(S.consultasStripe[0].auth, 'Bearer sk_test_prueba_local');
  const doc = S.leerDato('rim:saldo');
  assert.equal(doc.paquetes.length, 1);
  assert.equal(saldo.estado(doc, 'rim', new Date().toISOString()).bloqueado, false);
});

test('Stripe: el mismo aviso repetido no acredita dos paquetes', async () => {
  S.reiniciar({ datos: { 'rim:saldo': LLENO } });
  S.stripe.set('cs_test_rep', sesion('cs_test_rep'));
  await S.llamar(STORAGE, eventoStripe('checkout.session.completed', 'cs_test_rep'), { query: { key: 'stripe-webhook' } });
  const r = await S.llamar(STORAGE, eventoStripe('checkout.session.completed', 'cs_test_rep'), { query: { key: 'stripe-webhook' } });
  assert.equal(r.cuerpo.acreditado, false);
  assert.equal(S.leerDato('rim:saldo').paquetes.length, 1);
});

test('Stripe: OXXO pendiente no acredita; al confirmarse (async_payment_succeeded) sí', async () => {
  S.reiniciar({ datos: { 'rim:saldo': LLENO } });
  S.stripe.set('cs_test_oxxo', sesion('cs_test_oxxo', { payment_status: 'unpaid' }));
  let r = await S.llamar(STORAGE, eventoStripe('checkout.session.completed', 'cs_test_oxxo'), { query: { key: 'stripe-webhook' } });
  assert.equal(r.cuerpo.pendiente, true);
  assert.equal(S.leerDato('rim:saldo').paquetes.length, 0);
  S.stripe.set('cs_test_oxxo', sesion('cs_test_oxxo'));
  r = await S.llamar(STORAGE, eventoStripe('checkout.session.async_payment_succeeded', 'cs_test_oxxo'), { query: { key: 'stripe-webhook' } });
  assert.equal(r.cuerpo.acreditado, true);
});

test('Stripe: aviso falso (sesión que no existe en Stripe) no acredita nada', async () => {
  S.reiniciar({ datos: { 'rim:saldo': LLENO } });
  const r = await S.llamar(STORAGE, eventoStripe('checkout.session.completed', 'cs_inventado'), { query: { key: 'stripe-webhook' } });
  assert.equal(r.codigo, 200);
  assert.equal(r.cuerpo.ignorado, true);
  assert.deepEqual(S.leerDato('rim:saldo'), LLENO);
});

test('Stripe: monto, moneda u hub que no corresponden no acreditan', async () => {
  for (const [id, extra] of [['cs_t_monto', { amount_total: 1000 }], ['cs_t_usd', { currency: 'usd' }], ['cs_t_hub', { client_reference_id: 'hub-que-no-existe' }], ['cs_t_sinhub', { client_reference_id: null }]]) {
    S.reiniciar({ datos: { 'rim:saldo': LLENO } });
    S.stripe.set(id, sesion(id, extra));
    const r = await S.llamar(STORAGE, eventoStripe('checkout.session.completed', id), { query: { key: 'stripe-webhook' } });
    assert.equal(r.cuerpo.ignorado, true, id);
    assert.equal(S.leerDato('rim:saldo').paquetes.length, 0, id);
  }
});

test('Stripe: hub creado en /hubs sí puede recibir paquetes', async () => {
  S.reiniciar({ datos: { 'hubs:registro': { hubs: [{ slug: 'arq-ivan', creado: HOY }] } } });
  S.stripe.set('cs_t_ivan', sesion('cs_t_ivan', { client_reference_id: 'arq-ivan' }));
  const r = await S.llamar(STORAGE, eventoStripe('checkout.session.completed', 'cs_t_ivan'), { query: { key: 'stripe-webhook' } });
  assert.equal(r.cuerpo.acreditado, true);
  assert.equal(S.leerDato('arq-ivan:saldo').paquetes.length, 1);
});
