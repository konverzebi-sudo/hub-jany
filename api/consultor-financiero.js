// Endpoint server-side para el "agente vivo" del Jefe Finanzas — pregunta suelta, sin memoria.
// Mismo patron que api/consultor-evergreen.js, con un bloque de contexto extra: los datos que
// el usuario ya tiene llenados en las 5 calculadoras de consultor-financiero.html (el frontend
// los manda en `datosCalculadora` en cada pregunta, junto con el ADN).
//
// Prompt fijo, generico, compartido por todas las marcas -- mismo patron que
// api/agente-conversion.js y api/consultor-radar.js. El prompt original ya no tenia
// ningun dato de negocio de JefesHub hardcodeado (solo formulas y tono), asi que se
// reuso tal cual como plantilla generica. Lo unico que cambia por cliente es el
// CONTEXTO DEL NEGOCIO (construirContextoNegocio, mas abajo), cargado en tiempo real
// desde el ADN de cada marca -- no hace falta un archivo .md por marca.

const fs = require('fs');
const path = require('path');
const { sql } = require('@vercel/postgres');

const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-financiero.md');
const DEFAULT_CLIENTE = 'jefeshub';

const CONTEXT_CHAR_LIMIT = 6000;
const CALC_CHAR_LIMIT = 3000;

let fixedPromptCache = null;
function cargarPromptFijo() {
  if (fixedPromptCache) return fixedPromptCache;
  fixedPromptCache = fs.readFileSync(PROMPT_PATH, 'utf-8');
  return fixedPromptCache;
}

// Rate limit básico en memoria (por IP, best-effort entre invocaciones warm de la misma instancia).
const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 12;
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

  const { mensaje, cliente, datosCalculadora } = req.body || {};
  if (!mensaje || !mensaje.toString().trim()) {
    return res.status(400).json({ error: 'Falta mensaje.' });
  }

  const clienteId = (cliente || DEFAULT_CLIENTE).toString();
  const systemPrompt = cargarPromptFijo();

  try {
    const contexto = await construirContextoNegocio(clienteId);
    const contextoCalculadora = formatearDatosCalculadora(datosCalculadora);
    const system = [systemPrompt, contexto, contextoCalculadora].join('\n\n');

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system,
        messages: [{ role: 'user', content: mensaje.toString() }],
      }),
    });

    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      return res.status(anthropicRes.status).json({ error: data?.error?.message || 'Error al llamar a la API.' });
    }

    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (!text) {
      return res.status(502).json({ error: 'Respuesta vacía del modelo.' });
    }
    return res.status(200).json({ text });
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
};
