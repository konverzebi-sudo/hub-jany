// Endpoint server-side para el Jefe Evergreen (chat guiado, multi-turno) — multi-tenant.
// A diferencia de api/consultor-evergreen.js (pregunta suelta, sin memoria), este endpoint recibe el
// historial completo de la conversación en cada llamada (asi funciona la Messages API: sin estado en
// servidor) y usa el parametro `system` para no repetir el guion + contexto del ADN en cada turno.
// El prompt fijo es una plantilla generica compartida por las 3 marcas -- lo unico que cambia por
// cliente es el CONTEXTO DEL NEGOCIO, cargado en tiempo real desde su propio ADN.

const fs = require('fs');
const path = require('path');
const { sql } = require('@vercel/postgres');

const DEFAULT_CLIENTE = 'rancho-seco'; // no rompe la ruta actual, que todavia no manda `cliente`
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt-constructor-oferta-evergreen.md');
const CONTEXT_CHAR_LIMIT = 6000;
const MAX_MESSAGES = 40;

let fixedPromptCache = null;
function cargarPromptFijo() {
  if (fixedPromptCache) return fixedPromptCache;
  fixedPromptCache = fs.readFileSync(PROMPT_PATH, 'utf-8');
  return fixedPromptCache;
}

// Rate limit en memoria (por IP). Mas permisivo que los otros endpoints porque una sola
// conversacion guiada completa (Paso 1 -> Modulo 4) normalmente toma varios turnos.
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

async function escribirJSON(key, valor) {
  await ensureTable();
  const value = JSON.stringify(valor);
  const json = JSON.stringify(value);
  await sql`
    INSERT INTO kv_store (key, value, updated_at)
    VALUES (${key}, ${json}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = ${json}::jsonb, updated_at = now()
  `;
}

// Log de uso de tokens por llamada — para medir costo real de una conversacion completa
// (Paso 1 -> Modulo 4) y decidir cuanto cobrar. No afecta el consumo de tokens en si: es
// solo un registro en Postgres, no se manda de vuelta al modelo en ningun momento.
async function registrarUso(clienteId, usage) {
  try {
    const key = `${clienteId}:evergreen-builder-usage-log`;
    const items = (await leerJSON(key)) || [];
    items.push({
      date: new Date().toISOString(),
      inputTokens: usage?.input_tokens || 0,
      outputTokens: usage?.output_tokens || 0,
    });
    await escribirJSON(key, items.slice(-300));
  } catch (err) {
    // No bloquear la respuesta al usuario si falla el registro de uso.
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
  if (Array.isArray(d.objetivos) && d.objetivos.length) lineas.push(`Objetivos: ${d.objetivos.join(', ')}`);
  if (d.objetivo_principal) lineas.push(`Objetivo principal: ${d.objetivo_principal}`);
  if (d.historia) lineas.push(`Historia: ${d.historia}`);
  if (d.mejora_deseada) lineas.push(`Qué quiere mejorar: ${d.mejora_deseada}`);
  if (lineas.length === 0) return null;
  return 'IDENTIDAD DEL NEGOCIO:\n' + lineas.join('\n');
}

function formatearTono(d) {
  if (!d) return null;
  const lineas = [];
  if (Array.isArray(d.tonos) && d.tonos.length) lineas.push(`Tonos: ${d.tonos.join(', ')}`);
  if (d.persona) lineas.push(`Persona de marca: ${d.persona}`);
  if (Array.isArray(d.palabras_si) && d.palabras_si.length) lineas.push(`Palabras que sí usa: ${d.palabras_si.join(', ')}`);
  if (Array.isArray(d.palabras_no) && d.palabras_no.length) lineas.push(`Palabras que NO usa: ${d.palabras_no.join(', ')}`);
  if (d.ejemplo_si) lineas.push(`Ejemplo de tono correcto: ${d.ejemplo_si}`);
  if (d.ejemplo_no) lineas.push(`Ejemplo de tono incorrecto: ${d.ejemplo_no}`);
  if (lineas.length === 0) return null;
  return 'TONO DE MARCA:\n' + lineas.join('\n');
}

function formatearAudiencias(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const bloques = items
    .filter((a) => a && (a.nombre || a.ocupacion))
    .map((a, i) => {
      const l = [];
      l.push(`Audiencia ${i + 1}: ${a.nombre || '(sin nombre)'}`);
      if (a.ocupacion) l.push(`  Ocupación: ${a.ocupacion}`);
      if (a.miedo_deseo) l.push(`  Miedo/deseo: ${a.miedo_deseo}`);
      if (a.quien_compra) l.push(`  Quién compra: ${a.quien_compra}`);
      if (a.que_busca) l.push(`  Qué busca: ${a.que_busca}`);
      if (a.objecion_comun) l.push(`  Objeción más común: ${a.objecion_comun}`);
      if (a.por_que_si) l.push(`  Por qué SÍ compran: ${a.por_que_si}`);
      if (a.por_que_no) l.push(`  Por qué NO compran: ${a.por_que_no}`);
      if (a.dudas) l.push(`  Dudas frecuentes: ${a.dudas}`);
      if (a.frases) l.push(`  Frases reales de clientes: ${a.frases}`);
      return l.join('\n');
    });
  if (bloques.length === 0) return null;
  return 'CLIENTE IDEAL (audiencias del ADN):\n' + bloques.join('\n\n');
}

function formatearCatalogo(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const lineas = items
    .filter((p) => p && p.nombre)
    .map((p) => {
      const partes = [p.nombre];
      if (p.tipo) partes.push(p.tipo);
      if (p.precio != null && p.precio !== '') partes.push(`precio $${p.precio}`);
      if (p.costo != null && p.costo !== '') partes.push(`costo $${p.costo}`);
      if (p.que_tanto_se_vende) partes.push(`se vende: ${p.que_tanto_se_vende}`);
      if (p.inventario) partes.push(`inventario: ${p.inventario}`);
      if (p.notas) partes.push(`notas: ${p.notas}`);
      return '- ' + partes.join(' · ');
    });
  if (lineas.length === 0) return null;
  return 'CATÁLOGO DE PRODUCTOS:\n' + lineas.join('\n');
}

function formatearJourney(d) {
  if (!d) return null;
  const lineas = [];
  if (Array.isArray(d.pasos) && d.pasos.length) {
    d.pasos.forEach((p, i) => {
      if (p && (p.opciones?.length || p.otro)) {
        lineas.push(`Paso ${i + 1}: ${(p.opciones || []).join(', ')}${p.otro ? ' — ' + p.otro : ''}`);
      }
    });
  }
  const diag = d.diagnostico || {};
  const diagLineas = [];
  if (diag.perdida) diagLineas.push(`Dónde se pierden ventas: ${diag.perdida}`);
  if (diag.objecion) diagLineas.push(`Objeción más común en journey: ${diag.objecion}`);
  if (diag.desorden) diagLineas.push(`Qué está desordenado: ${diag.desorden}`);
  const todo = [...lineas, ...diagLineas];
  if (todo.length === 0) return null;
  return 'CUSTOMER JOURNEY ACTUAL:\n' + todo.join('\n');
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
  return 'MÉTRICAS Y FINANCIEROS:\n' + lineas.join('\n');
}

async function construirContextoNegocio(clienteId) {
  const [identidad, tono, audiencia, catalogo, journey, metricas, financieros] = await Promise.all([
    leerJSON(`${clienteId}:brand-book.identidad`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.tono`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.audiencia`).catch(() => null),
    leerJSON(`${clienteId}:catalogo-productos`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.customer_journey`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.metricas`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.financieros`).catch(() => null),
  ]);

  const bloques = [
    formatearIdentidad(identidad),
    formatearTono(tono),
    formatearAudiencias(audiencia),
    formatearCatalogo(catalogo),
    formatearJourney(journey),
    formatearMetricasFinancieros(metricas, financieros),
  ].filter(Boolean);

  if (bloques.length === 0) {
    return 'CONTEXTO DEL NEGOCIO: el ADN de esta marca todavía no tiene datos guardados. Avísale al usuario que antes de continuar sería ideal llenar el ADN, pero si quiere seguir de todas formas, hazle tú las preguntas mínimas necesarias antes del Paso 1.';
  }
  return 'CONTEXTO DEL NEGOCIO (ya cargado del ADN — no le pidas al usuario que lo repita):\n\n' + truncar(bloques.join('\n\n'), CONTEXT_CHAR_LIMIT);
}

// ---------- handler ----------

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
  const clienteId = (body.cliente || DEFAULT_CLIENTE).toString();
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    return res.status(400).json({ error: 'Falta el historial de la conversación (messages).' });
  }
  const limpio = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content }));
  if (limpio.length === 0 || limpio[limpio.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'El último mensaje debe ser del usuario.' });
  }

  try {
    const promptFijo = cargarPromptFijo();
    const contexto = await construirContextoNegocio(clienteId);
    const system = promptFijo + '\n\n' + contexto;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system,
        messages: limpio,
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
    await registrarUso(clienteId, data.usage);
    return res.status(200).json({
      text,
      usage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
};
