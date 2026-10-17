// Simulador para probar los servicios de api/ SIN llamar a Anthropic ni a la base real.
// - @vercel/postgres se reemplaza por un kv_store en memoria.
// - fetch a api.anthropic.com devuelve respuestas falsas y guarda lo que se habría mandado.
// - Cualquier otro fetch falla: ninguna prueba puede salir a internet ni generar costos.
const Module = require('module');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');

const db = new Map();
const enviados = [];
let respuestas = [];
// Sesiones de pago simuladas de Stripe: id -> objeto de sesión (lo que devolvería GET /v1/checkout/sessions/:id).
const stripe = new Map();
const consultasStripe = [];

async function sql(strings, ...vals) {
  const q = strings.join('?');
  if (/SELECT value FROM kv_store/i.test(q)) {
    return { rows: db.has(vals[0]) ? [{ value: db.get(vals[0]) }] : [] };
  }
  if (/INSERT INTO kv_store/i.test(q)) {
    // escribirJSON manda JSON.stringify(JSON.stringify(valor)); el JSONB guarda el texto interno.
    db.set(vals[0], JSON.parse(vals[1]));
    return { rows: [] };
  }
  return { rows: [] };
}

const resolverOriginal = Module._resolveFilename;
Module._resolveFilename = function (pedido, ...resto) {
  if (pedido === '@vercel/postgres') return '@vercel/postgres';
  return resolverOriginal.call(this, pedido, ...resto);
};
require.cache['@vercel/postgres'] = { id: '@vercel/postgres', filename: '@vercel/postgres', loaded: true, exports: { sql } };

process.env.ANTHROPIC_API_KEY = 'prueba-local-sin-uso';

global.fetch = async (url, opciones) => {
  if (String(url).startsWith('https://api.stripe.com/v1/checkout/sessions/')) {
    const id = decodeURIComponent(String(url).split('/').pop());
    consultasStripe.push({ id, auth: (opciones && opciones.headers && opciones.headers.Authorization) || '' });
    return stripe.has(id)
      ? { ok: true, status: 200, json: async () => stripe.get(id) }
      : { ok: false, status: 404, json: async () => ({ error: { message: 'No such checkout.session' } }) };
  }
  if (!String(url).startsWith('https://api.anthropic.com/')) {
    throw new Error('Prueba intentó salir a la red: ' + url);
  }
  const cuerpo = JSON.parse(opciones.body);
  enviados.push(cuerpo);
  const siguiente = respuestas.length > 1 ? respuestas.shift() : respuestas[0];
  if (!siguiente) throw new Error('No hay respuesta simulada configurada.');
  return siguiente(cuerpo);
};

// Respuesta JSON normal de /v1/messages.
function respuestaJSON(texto, usage) {
  return () => ({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text: texto }], stop_reason: 'end_turn', usage }),
  });
}

// Respuesta en streaming (SSE), como la que lee jefe-estrategia-whatsapp.
function respuestaStream(texto, usage) {
  return () => {
    const eventos = [
      { type: 'message_start', message: { usage: { ...usage, output_tokens: 1 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: texto } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: usage.output_tokens } },
    ];
    const sse = eventos.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
    return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
}

function reiniciar({ datos = {}, respuesta } = {}) {
  db.clear();
  Object.entries(datos).forEach(([k, v]) => db.set(k, JSON.stringify(v)));
  enviados.length = 0;
  respuestas = respuesta ? [respuesta] : [];
  stripe.clear();
  consultasStripe.length = 0;
}

function cargar(rel) {
  return require(path.join(RAIZ, rel));
}

async function llamar(rel, body, extra) {
  const handler = cargar(rel);
  const x = extra || {};
  const res = { codigo: 200, cuerpo: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.codigo = c; return res; };
  res.json = (b) => { res.cuerpo = b; return res; };
  res.end = () => res;
  // IP distinta por llamada para no chocar con el límite de peticiones de cada servicio.
  const ip = '10.0.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250);
  await handler({ method: x.method || 'POST', query: x.query || {}, headers: { 'x-forwarded-for': ip, ...(x.headers || {}) }, socket: {}, body }, res);
  return res;
}

function registroUso(cliente) {
  const v = db.get(`${cliente}:uso-tokens-log`);
  return v ? JSON.parse(v) : [];
}

function leerDato(key) {
  const v = db.get(key);
  return v ? JSON.parse(v) : null;
}

function resumenMensual(cliente) {
  const v = db.get(`${cliente}:uso-tokens-mensual`);
  return v ? JSON.parse(v) : null;
}

// Cuántos puntos de caché lleva una petición (máximo permitido por la API: 4).
function puntosDeCache(cuerpo) {
  let n = 0;
  (Array.isArray(cuerpo.system) ? cuerpo.system : []).forEach((b) => { if (b.cache_control) n++; });
  (cuerpo.messages || []).forEach((m) => {
    if (Array.isArray(m.content)) m.content.forEach((b) => { if (b.cache_control) n++; });
  });
  (cuerpo.tools || []).forEach((t) => { if (t.cache_control) n++; });
  return n;
}

function historialCacheado(cuerpo) {
  const ult = cuerpo.messages[cuerpo.messages.length - 1];
  return Array.isArray(ult.content) && ult.content.some((b) => b.cache_control);
}

// Conversación alternada usuario/asistente de n mensajes, terminando en usuario.
function conversacion(n) {
  const msgs = [];
  for (let i = 0; i < n; i++) {
    const usuario = (n - 1 - i) % 2 === 0;
    msgs.push({ role: usuario ? 'user' : 'assistant', content: (usuario ? 'pregunta ' : 'respuesta ') + i });
  }
  return msgs;
}

module.exports = { stripe, consultasStripe, leerDato, reiniciar, llamar, cargar, enviados, registroUso, resumenMensual, puntosDeCache, historialCacheado, conversacion, respuestaJSON, respuestaStream };
