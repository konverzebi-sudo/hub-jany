// Endpoint server-side para el "agente vivo" del Jefe Finanzas — chat CON memoria (recibe el
// historial completo en `messages`, mismo patron que api/consultor-evergreen-builder.js, porque
// la Messages API no guarda estado en servidor). Ademas del ADN, cada llamada manda un bloque de
// contexto extra: los datos que el usuario ya tiene llenados en las 5 calculadoras de
// consultor-financiero.html (`datosCalculadora`), recalculado en vivo en cada turno.
//
// Prompt fijo, generico, compartido por todas las marcas -- mismo patron que
// api/agente-conversion.js y api/consultor-radar.js. El prompt original ya no tenia
// ningun dato de negocio de JefesHub hardcodeado (solo formulas y tono), asi que se
// reuso tal cual como plantilla generica. Lo unico que cambia por cliente es el
// CONTEXTO DEL NEGOCIO (construirContextoNegocio, mas abajo), cargado en tiempo real
// desde el ADN de cada marca -- no hace falta un archivo .md por marca.
//
// FUSION con el Jefe de Producción de Video (por el límite de 12 Serverless Functions del
// plan Hobby de Vercel, ya estábamos en 12/12 -- ver commit "Consolida endpoints..."). A
// diferencia de la fusión de api/consultor-evergreen.js (que se distingue por la FORMA del
// body), aquí ambos agentes reciben `messages`, así que se distinguen por un campo explícito
// `agente` en el body: ausente o 'financiero' => Jefe Finanzas (rama original, sin tocar);
// 'diseno' => Jefe de Producción de Video (rama nueva, prompt y contexto propios, ver
// PROMPT_PATH_DISENO / construirContextoDiseno más abajo). Cada rama es independiente.

const fs = require('fs');
const path = require('path');
const { sql } = require('@vercel/postgres');

const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-financiero.md');
const DEFAULT_CLIENTE = 'jefeshub';

const PROMPT_PATH_DISENO = path.join(__dirname, '..', 'prompts', 'system-prompt-jefe-diseno.md');
const DEFAULT_CLIENTE_DISENO = 'rancho-seco'; // unica marca donde se activa por ahora
const MAX_MESSAGES_DISENO = 40;

const CONTEXT_CHAR_LIMIT = 6000;
const CALC_CHAR_LIMIT = 3000;
const MAX_MESSAGES = 40;

let fixedPromptCache = null;
function cargarPromptFijo() {
  if (fixedPromptCache) return fixedPromptCache;
  fixedPromptCache = fs.readFileSync(PROMPT_PATH, 'utf-8');
  return fixedPromptCache;
}

let fixedPromptDisenoCache = null;
function cargarPromptDiseno() {
  if (fixedPromptDisenoCache) return fixedPromptDisenoCache;
  fixedPromptDisenoCache = fs.readFileSync(PROMPT_PATH_DISENO, 'utf-8');
  return fixedPromptDisenoCache;
}

// Rate limit en memoria (por IP). Mas permisivo que una pregunta suelta porque un diagnostico
// guiado completo (Situacion Actual -> Simulador) toma varios turnos de conversacion.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 40;
const hits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_REQUESTS;
}

// ---------- lectura de storage (mismo shape que api/storage/[key].js / window.storage) ----------

let tableEnsured = false;
async function ensureTable() {
  if (tableEnsured) return;
  await sql`CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  tableEnsured = true;
}

async function leerJSON(key) {
  await ensureTable();
  const { rows } = await sql`SELECT value FROM kv_store WHERE key = ${key}`;
  if (!rows[0] || rows[0].value == null) return null;
  try {
    return JSON.parse(rows[0].value);
  } catch (err) {
    return null;
  }
}

function truncar(str, limite) {
  if (!str) return str;
  return str.length > limite ? str.slice(0, limite) + '\n[...recortado...]' : str;
}

// ---------- formateo del CONTEXTO DEL NEGOCIO a partir del ADN ----------

function formatearIdentidad(d) {
  if (!d) return null;
  const lineas = [];
  if (d.nombre) lineas.push(`Nombre: ${d.nombre}`);
  if (d.giro_categoria || d.giro_texto) lineas.push(`Giro: ${d.giro_texto || d.giro_categoria}`);
  if (d.producto_estrella) lineas.push(`Producto estrella: ${d.producto_estrella}`);
  if (lineas.length === 0) return null;
  return 'IDENTIDAD DEL NEGOCIO:\n' + lineas.join('\n');
}

function formatearGrupos(grupos) {
  if (!Array.isArray(grupos) || grupos.length === 0) return null;
  return 'GRUPOS DE NEGOCIO YA DEFINIDOS:\n' + grupos.map((g) => `- ${g.nombre}`).join('\n');
}

function formatearCatalogo(items, grupos) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const nombrePorGrupo = {};
  (grupos || []).forEach((g) => { nombrePorGrupo[g.id] = g.nombre; });
  const lineas = items
    .filter((p) => p && p.nombre)
    .map((p) => {
      const partes = [p.nombre];
      if (p.tipo) partes.push(p.tipo);
      if (p.grupo_id && nombrePorGrupo[p.grupo_id]) partes.push(`grupo: ${nombrePorGrupo[p.grupo_id]}`);
      if (p.precio != null && p.precio !== '') partes.push(`precio $${p.precio}`);
      if (p.costo != null && p.costo !== '') partes.push(`costo $${p.costo}`);
      return '- ' + partes.join(' · ');
    });
  if (lineas.length === 0) return null;
  return 'CATÁLOGO DE PRODUCTOS:\n' + lineas.join('\n');
}

function formatearMetricasFinancieros(m, f) {
  const lineas = [];
  if (m) {
    if (m.ticket_promedio) lineas.push(`Ticket promedio: $${m.ticket_promedio}`);
    if (m.num_ventas_mes) lineas.push(`Ventas al mes: ${m.num_ventas_mes}`);
    if (m.tasa_conversion_pct) lineas.push(`Tasa de conversión: ${m.tasa_conversion_pct}%`);
  }
  if (f) {
    if (f.margen_bruto_pct) lineas.push(`Margen bruto: ${f.margen_bruto_pct}%`);
    if (f.costo_variable_pct) lineas.push(`Costo variable: ${f.costo_variable_pct}%`);
  }
  if (lineas.length === 0) return null;
  return 'MÉTRICAS Y FINANCIEROS YA CARGADOS:\n' + lineas.join('\n');
}

async function construirContextoNegocio(clienteId) {
  const [identidad, catalogo, grupos, metricas, financieros] = await Promise.all([
    leerJSON(`${clienteId}:brand-book.identidad`).catch(() => null),
    leerJSON(`${clienteId}:catalogo-productos`).catch(() => null),
    leerJSON(`${clienteId}:grupos-negocio`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.metricas`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.financieros`).catch(() => null),
  ]);

  const bloques = [
    formatearIdentidad(identidad),
    formatearGrupos(grupos),
    formatearCatalogo(catalogo, grupos),
    formatearMetricasFinancieros(metricas, financieros),
  ].filter(Boolean);

  if (bloques.length === 0) {
    return 'CONTEXTO DEL NEGOCIO: el ADN de esta marca todavía no tiene datos financieros guardados.';
  }
  return 'CONTEXTO DEL NEGOCIO (ya cargado del ADN):\n\n' + truncar(bloques.join('\n\n'), CONTEXT_CHAR_LIMIT);
}

// ---------- formateo del CONTEXTO DE LA CALCULADORA (lo que manda el frontend) ----------

function formatearDatosCalculadora(datos) {
  if (!datos || typeof datos !== 'object') {
    return 'CONTEXTO DE LA CALCULADORA: el usuario todavía no ha llenado ninguna de las 5 calculadoras de esta página.';
  }
  let json;
  try {
    json = JSON.stringify(datos, null, 0);
  } catch (err) {
    return 'CONTEXTO DE LA CALCULADORA: no se pudo leer el estado actual.';
  }
  return 'CONTEXTO DE LA CALCULADORA (datos y resultados que el usuario ya tiene llenados ahora mismo en las 5 calculadoras -- úsalos, no los vuelvas a preguntar):\n\n' + truncar(json, CALC_CHAR_LIMIT);
}

// ---------- formateo del CONTEXTO DEL NEGOCIO para el Jefe de Producción de Video ----------
// Campos propios (no reutiliza los formatters de arriba, que están atados a la forma de
// datos financieros) -- mismo patron de lectura del ADN que api/agente-conversion.js.

function formatearTonoDiseno(d) {
  if (!d) return null;
  const lineas = [];
  if (Array.isArray(d.tonos) && d.tonos.length) lineas.push(`Tonos: ${d.tonos.join(', ')}`);
  if (Array.isArray(d.palabras_si) && d.palabras_si.length) lineas.push(`Palabras que sí usa: ${d.palabras_si.join(', ')}`);
  if (Array.isArray(d.palabras_no) && d.palabras_no.length) lineas.push(`Palabras que NO usa: ${d.palabras_no.join(', ')}`);
  if (lineas.length === 0) return null;
  return 'TONO DE MARCA:\n' + lineas.join('\n');
}

function formatearAudienciasDiseno(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const bloques = items
    .filter((a) => a && (a.nombre || a.ocupacion))
    .map((a, i) => {
      const l = [`Audiencia ${i + 1}: ${a.nombre || '(sin nombre)'}`];
      if (a.miedo_deseo) l.push(`  Miedo/deseo: ${a.miedo_deseo}`);
      if (a.objecion_comun) l.push(`  Objeción más común: ${a.objecion_comun}`);
      return l.join('\n');
    });
  if (bloques.length === 0) return null;
  return 'CLIENTE IDEAL (audiencias del ADN):\n' + bloques.join('\n\n');
}

function formatearCatalogoDiseno(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const lineas = items
    .filter((p) => p && p.nombre)
    .map((p) => {
      const partes = [p.nombre];
      if (p.tipo) partes.push(p.tipo);
      if (p.notas) partes.push(`notas: ${p.notas}`);
      return '- ' + partes.join(' · ');
    });
  if (lineas.length === 0) return null;
  return 'CATÁLOGO DE PRODUCTOS:\n' + lineas.join('\n');
}

async function construirContextoDiseno(clienteId) {
  const [identidad, tono, audiencia, catalogo] = await Promise.all([
    leerJSON(`${clienteId}:brand-book.identidad`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.tono`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.audiencia`).catch(() => null),
    leerJSON(`${clienteId}:catalogo-productos`).catch(() => null),
  ]);

  const bloques = [
    formatearIdentidad(identidad),
    formatearTonoDiseno(tono),
    formatearAudienciasDiseno(audiencia),
    formatearCatalogoDiseno(catalogo),
  ].filter(Boolean);

  if (bloques.length === 0) {
    return 'CONTEXTO DEL NEGOCIO: el ADN de esta marca todavía no tiene datos guardados.';
  }
  return 'CONTEXTO DEL NEGOCIO (ya cargado del ADN):\n\n' + truncar(bloques.join('\n\n'), CONTEXT_CHAR_LIMIT);
}

async function llamarClaudeChat({ system, messages, maxTokens }) {
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });

  const data = await anthropicRes.json();
  if (!anthropicRes.ok) {
    return { ok: false, status: anthropicRes.status, error: data?.error?.message || 'Error al llamar a la API.' };
  }
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  if (!text) return { ok: false, status: 502, error: 'Respuesta vacía del modelo.' };
  return { ok: true, text };
}

function limpiarMessages(messages, max) {
  const limpio = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-max)
    .map((m) => ({ role: m.role, content: m.content }));
  return limpio;
}

// ---------- rama Jefe Finanzas (comportamiento original, sin cambios) ----------

async function handleFinanciero(req, res, body) {
  const clienteId = (body.cliente || DEFAULT_CLIENTE).toString();

  const limpio = limpiarMessages(body.messages, MAX_MESSAGES);
  if (limpio.length === 0 || limpio[limpio.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'El último mensaje debe ser del usuario.' });
  }

  const systemPrompt = cargarPromptFijo();
  const contexto = await construirContextoNegocio(clienteId);
  const contextoCalculadora = formatearDatosCalculadora(body.datosCalculadora);
  const system = [systemPrompt, contexto, contextoCalculadora].join('\n\n');

  const r = await llamarClaudeChat({ system, messages: limpio, maxTokens: 1300 });
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
  return res.status(200).json({ text: r.text });
}

// ---------- rama Jefe de Producción de Video ----------

async function handleDiseno(req, res, body) {
  const clienteId = (body.cliente || DEFAULT_CLIENTE_DISENO).toString();

  const limpio = limpiarMessages(body.messages, MAX_MESSAGES_DISENO);
  if (limpio.length === 0 || limpio[limpio.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'El último mensaje debe ser del usuario.' });
  }

  const systemPrompt = cargarPromptDiseno();
  const contexto = await construirContextoDiseno(clienteId);
  const system = [systemPrompt, contexto].join('\n\n');

  const r = await llamarClaudeChat({ system, messages: limpio, maxTokens: 900 });
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
  return res.status(200).json({ text: r.text });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .toString()
    .split(',')[0]
    .trim();
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Demasiadas solicitudes, espera unos minutos.' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY en el servidor.' });
  }

  const body = req.body || {};
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return res.status(400).json({ error: 'Falta el historial de la conversación (messages).' });
  }

  const agente = (body.agente || 'financiero').toString();

  try {
    if (agente === 'diseno') return await handleDiseno(req, res, body);
    return await handleFinanciero(req, res, body);
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
};
