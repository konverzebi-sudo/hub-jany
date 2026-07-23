// Endpoint server-side para el "agente vivo" del Jefe Evergreen — pregunta suelta, sin memoria.
// Multi-tenant: lee `cliente` del body (default 'rancho-seco' para no romper la ruta actual que
// no lo manda) y carga el CONTEXTO DEL NEGOCIO de esa marca en tiempo real, igual que
// api/consultor-evergreen-builder.js.

const fs = require('fs');
const path = require('path');
const { sql } = require('@vercel/postgres');

const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-evergreen-preguntas.md');
const CONTEXT_CHAR_LIMIT = 6000;

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

// ---------- formateo del CONTEXTO DEL NEGOCIO a partir del ADN (mismo formato que el builder) ----------

function formatearIdentidad(d) {
  if (!d) return null;
  const lineas = [];
  if (d.nombre) lineas.push(`Nombre: ${d.nombre}`);
  if (d.giro_categoria || d.giro_texto) lineas.push(`Giro: ${d.giro_texto || d.giro_categoria}`);
  if (d.producto_estrella) lineas.push(`Producto estrella: ${d.producto_estrella}`);
  if (lineas.length === 0) return null;
  return 'IDENTIDAD DEL NEGOCIO:\n' + lineas.join('\n');
}

function formatearTono(d) {
  if (!d) return null;
  const lineas = [];
  if (Array.isArray(d.tonos) && d.tonos.length) lineas.push(`Tonos: ${d.tonos.join(', ')}`);
  if (d.persona) lineas.push(`Persona de marca: ${d.persona}`);
  if (lineas.length === 0) return null;
  return 'TONO DE MARCA:\n' + lineas.join('\n');
}

function formatearAudiencias(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const bloques = items
    .filter((a) => a && (a.nombre || a.ocupacion))
    .map((a, i) => `Audiencia ${i + 1}: ${a.nombre || '(sin nombre)'}${a.miedo_deseo ? ' — ' + a.miedo_deseo : ''}`);
  if (bloques.length === 0) return null;
  return 'CLIENTE IDEAL:\n' + bloques.join('\n');
}

function formatearCatalogo(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const lineas = items.filter((p) => p && p.nombre).map((p) => `- ${p.nombre}${p.precio != null && p.precio !== '' ? ` (precio $${p.precio})` : ''}`);
  if (lineas.length === 0) return null;
  return 'CATÁLOGO DE PRODUCTOS:\n' + lineas.join('\n');
}

async function construirContextoNegocio(clienteId) {
  const [identidad, tono, audiencia, catalogo] = await Promise.all([
    leerJSON(`${clienteId}:brand-book.identidad`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.tono`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.audiencia`).catch(() => null),
    leerJSON(`${clienteId}:catalogo-productos`).catch(() => null),
  ]);

  const bloques = [formatearIdentidad(identidad), formatearTono(tono), formatearAudiencias(audiencia), formatearCatalogo(catalogo)].filter(Boolean);

  if (bloques.length === 0) {
    return 'CONTEXTO DEL NEGOCIO: todavía no hay datos guardados en el ADN de esta marca. Dilo con claridad en tu respuesta en vez de inventar.';
  }
  return 'CONTEXTO DEL NEGOCIO (ya cargado del ADN):\n\n' + truncar(bloques.join('\n\n'), CONTEXT_CHAR_LIMIT);
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

  const { mensaje, cliente } = req.body || {};
  if (!mensaje || !mensaje.toString().trim()) {
    return res.status(400).json({ error: 'Falta mensaje.' });
  }

  const clienteId = (cliente || 'rancho-seco').toString();
  const promptFijo = cargarPromptFijo();

  try {
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
        max_tokens: 800,
        system,
        messages: [{ role: 'user', content: mensaje }],
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
