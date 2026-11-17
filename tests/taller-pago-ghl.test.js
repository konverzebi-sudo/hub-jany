// Pago en la landing de GoHighLevel → acceso automático al taller (Supabase). Sin red.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./helpers/simulador');
const T = require('../api/_lib/taller-pago');

const STORAGE = 'api/storage/[key].js';
const SECRETO = 'secreto-de-prueba-ghl';
process.env.GHL_WEBHOOK_SECRET = SECRETO;
process.env.TALLER_SUPABASE_URL = 'https://proyecto-prueba.supabase.co/';
process.env.TALLER_SUPABASE_SERVICE_KEY = 'clave-servidor-de-prueba';

// Supabase falso: guarda lo que se le pidió.
function supabaseFalso({ talleres = [{ id: 'uuid-taller' }], fallaAlta = false } = {}) {
  const llamadas = [];
  const fn = async (url, op) => {
    llamadas.push({ url: String(url), op: op || {} });
    if (String(url).includes('/rest/v1/talleres')) return { ok: true, json: async () => talleres };
    if (String(url).includes('/rest/v1/invitados')) return { ok: !fallaAlta, json: async () => null };
    throw new Error('fetch inesperado ' + url);
  };
  fn.llamadas = llamadas;
  return fn;
}

function respuesta() {
  const res = { codigo: 200, cuerpo: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.codigo = c; return res; };
  res.json = (b) => { res.cuerpo = b; return res; };
  return res;
}

const AVISO = { contact_id: 'abc', first_name: 'Ana', last_name: 'Pérez', email: 'Ana@Correo.com', customData: { secreto: SECRETO } };

test('pago con la clave correcta → agrega el correo como alumno y devuelve el link', async () => {
  const sb = supabaseFalso();
  const res = respuesta();
  await T.manejarPagoGhl({ method: 'POST', headers: {}, body: AVISO }, res, sb);
  assert.equal(res.codigo, 200);
  assert.equal(res.cuerpo.link, 'https://jefeshub.com/taller-app/');
  assert.match(sb.llamadas[0].url, /^https:\/\/proyecto-prueba\.supabase\.co\/rest\/v1\/talleres\?select=id&slug=eq\.primer-agente$/);
  const alta = sb.llamadas[1];
  assert.equal(alta.op.method, 'POST');
  assert.match(alta.op.headers.Prefer, /ignore-duplicates/); // nunca le cambia el rol a alguien que ya estaba
  assert.deepEqual(JSON.parse(alta.op.body), { taller_id: 'uuid-taller', email: 'ana@correo.com', nombre: 'Ana Pérez', rol: 'alumno' });
});

test('la clave también puede venir en el encabezado x-ghl-secreto', async () => {
  const res = respuesta();
  await T.manejarPagoGhl({ method: 'POST', headers: { 'x-ghl-secreto': SECRETO }, body: { email: 'b@c.mx' } }, res, supabaseFalso());
  assert.equal(res.codigo, 200);
});

test('sin clave o con clave equivocada → 401 y no toca Supabase', async () => {
  for (const body of [{ email: 'a@b.mx' }, { email: 'a@b.mx', customData: { secreto: 'otra' } }]) {
    const sb = supabaseFalso();
    const res = respuesta();
    await T.manejarPagoGhl({ method: 'POST', headers: {}, body }, res, sb);
    assert.equal(res.codigo, 401);
    assert.equal(sb.llamadas.length, 0);
  }
});

test('sin correo válido → 400', async () => {
  const res = respuesta();
  await T.manejarPagoGhl({ method: 'POST', headers: {}, body: { email: 'no-es-correo', customData: { secreto: SECRETO } } }, res, supabaseFalso());
  assert.equal(res.codigo, 400);
});

test('taller que no existe → 400; Supabase caído → 502 (GHL reintenta)', async () => {
  let res = respuesta();
  await T.manejarPagoGhl({ method: 'POST', headers: {}, body: AVISO }, res, supabaseFalso({ talleres: [] }));
  assert.equal(res.codigo, 400);
  res = respuesta();
  await T.manejarPagoGhl({ method: 'POST', headers: {}, body: AVISO }, res, supabaseFalso({ fallaAlta: true }));
  assert.equal(res.codigo, 502);
});

test('lee los datos aunque GHL los mande dentro de contact o en Custom Data', () => {
  assert.deepEqual(T.datosDelAviso({ contact: { email: 'X@Y.com', firstName: 'Luz', lastName: 'Gil' } }), { email: 'x@y.com', nombre: 'Luz Gil', taller: 'primer-agente' });
  assert.deepEqual(T.datosDelAviso({ email: 'a@b.mx', customData: { email: 'otro@b.mx', nombre: 'Eva', taller: 'Otro-Taller' } }), { email: 'otro@b.mx', nombre: 'Eva', taller: 'otro-taller' });
});

test('el servidor de storage manda ghl-pago a este manejo (sin clave → 401, solo POST)', async () => {
  S.reiniciar();
  let r = await S.llamar(STORAGE, { email: 'a@b.mx' }, { query: { key: 'ghl-pago' } });
  assert.equal(r.codigo, 401);
  r = await S.llamar(STORAGE, null, { method: 'GET', query: { key: 'ghl-pago' } });
  assert.equal(r.codigo, 405);
});
