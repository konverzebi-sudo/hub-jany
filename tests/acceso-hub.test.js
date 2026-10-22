// Acceso de clientes sin clave (llave por hub) y respaldo local cuando un guardado falla.
// Sin red ni costos.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const S = require('./helpers/simulador');

const STORAGE = 'api/storage/[key].js';
process.env.STORAGE_WRITE_TOKEN = 'token-compartido-de-prueba';
const llaveDe = (slug) => crypto.createHmac('sha256', process.env.STORAGE_WRITE_TOKEN).update('acceso-hub:' + slug).digest('hex').slice(0, 24);
const REGISTRO = { 'hubs:registro': { hubs: [{ slug: 'arq-ivan', creado: '2026-10-03T00:00:00Z' }] } };

// ---------- servidor ----------

test('la llave del hub deja guardar las llaves de SU hub sin token', async () => {
  S.reiniciar({ datos: REGISTRO });
  const r = await S.llamar(STORAGE, { value: JSON.stringify({ nombre: 'Ivan' }) }, { query: { key: 'arq-ivan:brand-book.identidad' }, headers: { 'x-hub-codigo': llaveDe('arq-ivan') } });
  assert.equal(r.codigo, 200);
  assert.deepEqual(S.leerDato('arq-ivan:brand-book.identidad'), { nombre: 'Ivan' });
});

test('la llave de un hub NO sirve para otro hub ni para el registro de hubs', async () => {
  S.reiniciar({ datos: REGISTRO });
  for (const key of ['rancho-seco:brand-book.identidad', 'jefeshub:catalogo-productos', 'hubs:registro']) {
    const r = await S.llamar(STORAGE, { value: '"x"' }, { query: { key }, headers: { 'x-hub-codigo': llaveDe('arq-ivan') } });
    assert.equal(r.codigo, 401, key);
  }
});

test('llave falsa o vacía -> 401', async () => {
  S.reiniciar({ datos: REGISTRO });
  for (const codigo of ['', '0'.repeat(24), llaveDe('arq-ivan').slice(0, 23) + 'x']) {
    const r = await S.llamar(STORAGE, { value: '"x"' }, { query: { key: 'arq-ivan:a' }, headers: { 'x-hub-codigo': codigo } });
    assert.equal(r.codigo, 401, JSON.stringify(codigo));
  }
});

test('con la llave del hub tampoco se puede tocar su saldo ni su registro de uso', async () => {
  S.reiniciar({ datos: REGISTRO });
  const r = await S.llamar(STORAGE, { value: '{}' }, { query: { key: 'arq-ivan:saldo' }, headers: { 'x-hub-codigo': llaveDe('arq-ivan') } });
  assert.equal(r.codigo, 403);
});

test('el token maestro sigue funcionando igual', async () => {
  S.reiniciar();
  const r = await S.llamar(STORAGE, { value: '"x"' }, { query: { key: 'rancho-seco:a' }, headers: { 'x-storage-token': 'token-compartido-de-prueba' } });
  assert.equal(r.codigo, 200);
});

test('GET acceso-hub: solo con el token maestro y solo para hubs que existen', async () => {
  S.reiniciar({ datos: REGISTRO });
  let r = await S.llamar(STORAGE, null, { method: 'GET', query: { key: 'acceso-hub', cliente: 'arq-ivan' } });
  assert.equal(r.codigo, 401);
  r = await S.llamar(STORAGE, null, { method: 'GET', query: { key: 'acceso-hub', cliente: 'arq-ivan' }, headers: { 'x-storage-token': 'token-compartido-de-prueba' } });
  assert.equal(r.codigo, 200);
  assert.equal(r.cuerpo.codigo, llaveDe('arq-ivan'));
  r = await S.llamar(STORAGE, null, { method: 'GET', query: { key: 'acceso-hub', cliente: 'no-existe' }, headers: { 'x-storage-token': 'token-compartido-de-prueba' } });
  assert.equal(r.codigo, 400);
});

// ---------- navegador (js/storage-client.js en un entorno simulado) ----------

function navegador({ url, respuestas, prompt }) {
  const almacen = new Map();
  const localStorage = {
    getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
    setItem: (k, v) => almacen.set(k, String(v)),
    removeItem: (k) => almacen.delete(k),
    key: (i) => Array.from(almacen.keys())[i] ?? null,
    get length() { return almacen.size; },
  };
  const llamadas = [];
  const cola = respuestas.slice();
  const loc = new URL(url);
  const ctx = {
    URL, JSON, Date, Error, Promise, console,
    localStorage,
    location: { get href() { return loc.href; }, get pathname() { return loc.pathname; } },
    history: { state: null, replaceState: (_s, _t, u) => { const n = new URL(u, loc.origin); loc.pathname = n.pathname; loc.search = n.search; } },
    document: { body: { appendChild() {} }, createElement: () => ({ setAttribute() {}, style: {}, remove() {} }) },
    window: { prompt: prompt || (() => ''), addEventListener() {} },
    setTimeout: () => 0,
    fetch: async (u, o) => {
      llamadas.push({ url: u, metodo: (o && o.method) || 'GET', headers: (o && o.headers) || {}, body: o && o.body });
      const r = cola.length > 1 ? cola.shift() : cola[0];
      if (r === 'red') throw new Error('sin conexión');
      return { ok: r.status < 300, status: r.status, json: async () => r.json || {} };
    },
  };
  ctx.window.storage = undefined;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'storage-client.js'), 'utf8'), ctx);
  return { storage: ctx.window.storage, almacen, llamadas, loc };
}

test('el link con ?k= guarda la llave del hub, la quita de la dirección y guarda sin pedir clave', async () => {
  let preguntado = false;
  const b = navegador({ url: 'https://agentes.jefeshub.com/arq-ivan?k=' + llaveDe('arq-ivan'), respuestas: [{ status: 200 }], prompt: () => { preguntado = true; return ''; } });
  assert.equal(b.almacen.get('jefeshub_acceso_arq-ivan'), llaveDe('arq-ivan'));
  assert.equal(b.loc.search, '', 'la llave ya no se ve en la barra');
  await b.storage.set('arq-ivan:brand-book.366-producto', '{"a":1}');
  assert.equal(preguntado, false, 'no se pidió clave');
  assert.equal(b.llamadas[0].headers['X-Hub-Codigo'], llaveDe('arq-ivan'));
  assert.equal(b.llamadas[0].headers['X-Storage-Token'], undefined);
});

test('en una página de Jefe del hub principal (/jefe-366?k=) la llave se guarda para jefeshub', () => {
  const b = navegador({ url: 'https://agentes.jefeshub.com/jefe-366?k=' + llaveDe('jefeshub'), respuestas: [{ status: 200 }] });
  assert.equal(b.almacen.get('jefeshub_acceso_jefeshub'), llaveDe('jefeshub'));
  assert.equal(b.almacen.get('jefeshub_acceso_jefe-366'), undefined);
});

test('si el guardado falla, lo escrito NO se pierde: queda respaldado y get() lo devuelve', async () => {
  const b = navegador({ url: 'https://agentes.jefeshub.com/arq-ivan/jefe-366', respuestas: [{ status: 401 }] });
  await assert.rejects(b.storage.set('arq-ivan:366-builder-conversacion', '["respuestas importantes"]'));
  const r = await b.storage.get('arq-ivan:366-builder-conversacion');
  assert.equal(r.value, '["respuestas importantes"]');
  assert.equal(r.pendiente, true);
});

test('sin conexión también se respalda; al guardar bien se borra el respaldo', async () => {
  const b = navegador({ url: 'https://agentes.jefeshub.com/arq-ivan', respuestas: ['red', { status: 200 }] });
  b.almacen.set('jefeshub_acceso_arq-ivan', llaveDe('arq-ivan'));
  await assert.rejects(b.storage.set('arq-ivan:x', '"v1"'));
  assert.ok(b.almacen.has('jefeshub_pendiente:arq-ivan:x'));
  await b.storage.set('arq-ivan:x', '"v2"');
  assert.equal(b.almacen.has('jefeshub_pendiente:arq-ivan:x'), false);
});

test('una llave de hub que ya no sirve (401) se olvida para no seguir mandándola', async () => {
  const b = navegador({ url: 'https://agentes.jefeshub.com/arq-ivan', respuestas: [{ status: 401 }] });
  b.almacen.set('jefeshub_acceso_arq-ivan', 'f'.repeat(24));
  await assert.rejects(b.storage.set('arq-ivan:x', '"v"'));
  assert.equal(b.almacen.has('jefeshub_acceso_arq-ivan'), false);
});

test('la dueña sin llave de hub sigue usando el token maestro como siempre', async () => {
  const b = navegador({ url: 'https://agentes.jefeshub.com/', respuestas: [{ status: 200 }], prompt: () => 'token-compartido-de-prueba' });
  await b.storage.set('jefeshub:catalogo-productos', '[]');
  assert.equal(b.llamadas[0].headers['X-Storage-Token'], 'token-compartido-de-prueba');
});
