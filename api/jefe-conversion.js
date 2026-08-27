// Endpoint server-side para el "Jefe vivo" de Conversión y Ventas — multi-tenant.
// La ANTHROPIC_API_KEY vive solo aquí (variable de entorno de Vercel), nunca en el cliente.
// El prompt fijo es una plantilla generica compartida por las 3 marcas -- lo unico que cambia
// por cliente es el CONTEXTO DEL NEGOCIO, cargado en tiempo real desde su propio ADN (mismo
// patron que api/consultor-366.js). No hay datos de negocio hardcoded aqui.

const fs = require('fs');
const path = require('path');
const { sql } = require('@vercel/postgres');

const DEFAULT_CLIENTE = 'jefeshub';
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt-jefe-conversion.md');
const CONTEXT_CHAR_LIMIT = 12000;

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

async function registrarUsoTokens(clienteId, endpoint, usage) {
  try {
    const key = `${clienteId}:uso-tokens-log`;
    const items = (await leerJSON(key)) || [];
    items.push({ date: new Date().toISOString(), endpoint, inputTokens: usage?.input_tokens || 0, outputTokens: usage?.output_tokens || 0 });
    await escribirJSON(key, items.slice(-500));
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
  if (lineas.length === 0) return null;
  return 'IDENTIDAD DEL NEGOCIO:\n' + lineas.join('\n');
}

function formatearTono(d) {
  if (!d) return null;
  const lineas = [];
  if (Array.isArray(d.tonos) && d.tonos.length) lineas.push(`Tonos: ${d.tonos.join(', ')}`);
  if (Array.isArray(d.palabras_si) && d.palabras_si.length) lineas.push(`Palabras que sí usa: ${d.palabras_si.join(', ')}`);
  if (Array.isArray(d.palabras_no) && d.palabras_no.length) lineas.push(`Palabras que NO usa: ${d.palabras_no.join(', ')}`);
  if (lineas.length === 0) return null;
  return 'TONO DE MARCA:\n' + lineas.join('\n');
}

function formatearAudiencias(items) {
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

function formatearCatalogo(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const lineas = items
    .filter((p) => p && p.nombre)
    .map((p) => {
      const partes = [p.nombre];
      if (p.tipo) partes.push(p.tipo);
      if (p.precio != null && p.precio !== '') partes.push(`precio $${p.precio}`);
      if (p.notas) partes.push(`notas: ${p.notas}`);
      return '- ' + partes.join(' · ');
    });
  if (lineas.length === 0) return null;
  return 'CATÁLOGO DE PRODUCTOS (precios reales — úsalos siempre que pregunten precio):\n' + lineas.join('\n');
}

function formatearGuionesGuardados(d) {
  if (!d) return null;
  const etiquetas = {
    apertura: 'Apertura (1–2 Frío)',
    calificacion: 'Calificación (3–4 Tibio)',
    oferta_precio: 'Oferta + precio (5–6 Interés)',
    anti_objecion: 'Anti-objeción (7–8 Objeciones)',
    cierre: 'Cierre (9–10)',
  };
  const lineas = Object.keys(etiquetas)
    .filter((k) => d[k] && d[k].trim())
    .map((k) => `${etiquetas[k]}:\n${d[k].trim()}`);
  if (lineas.length === 0) return null;
  return 'GUIONES DE WHATSAPP YA GUARDADOS POR EL USUARIO (úsalos como base, no los repitas tal cual si no aplican al mensaje):\n\n' + lineas.join('\n\n');
}

async function construirContextoNegocio(clienteId) {
  const [identidad, tono, audiencia, catalogo, guiones] = await Promise.all([
    leerJSON(`${clienteId}:brand-book.identidad`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.tono`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.audiencia`).catch(() => null),
    leerJSON(`${clienteId}:catalogo-productos`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.whatsapp-guiones`).catch(() => null),
  ]);

  const bloques = [
    formatearIdentidad(identidad),
    formatearTono(tono),
    formatearAudiencias(audiencia),
    formatearCatalogo(catalogo),
    formatearGuionesGuardados(guiones),
  ].filter(Boolean);

  if (bloques.length === 0) {
    return 'CONTEXTO DEL NEGOCIO: todavía no hay datos guardados en el ADN de esta marca. Avísale al usuario que conviene llenar el ADN antes de confiar en las respuestas de precio.';
  }
  return 'CONTEXTO DEL NEGOCIO (ya cargado del ADN — no le pidas al usuario que lo repita):\n\n' + truncar(bloques.join('\n\n'), CONTEXT_CHAR_LIMIT);
}

// ---------- CONTEXTO 366 (dolores, deseos, miedos, objeciones, ángulos, frases, sistema) ----------

function formatearValorNota(valor) {
  if (valor == null) return '';
  if (Array.isArray(valor)) {
    const filas = valor.filter((f) => f && Object.values(f).some((v) => (v || '').toString().trim()));
    if (filas.length === 0) return '';
    return filas
      .map((f) => Object.entries(f).filter(([k, v]) => k !== '_marcada' && (v || '').toString().trim()).map(([k, v]) => `${k}: ${v}`).join(' | '))
      .map((l) => '  - ' + l)
      .join('\n');
  }
  if (typeof valor === 'object') {
    const partes = Object.entries(valor).filter(([, v]) => (v || '').toString().trim()).map(([k, v]) => `  - ${k}: ${v}`);
    return partes.join('\n');
  }
  return valor.toString().trim() ? '  ' + valor.toString().trim() : '';
}

const GRUPOS_366 = [
  { suffix: '366-producto', suffixViejo: 'evergreen-producto', titulo: 'PRODUCTO 366' },
  { suffix: '366-perfil-cliente', suffixViejo: 'evergreen-perfil-cliente', titulo: 'PERFIL DE CLIENTE 366 (dolores, deseos, miedos, objeciones)' },
  { suffix: '366-comunicacion', suffixViejo: 'evergreen-comunicacion', titulo: 'COMUNICACIÓN 366 (incluye ángulos y frases maestras)' },
  { suffix: '366-sistema', suffixViejo: 'evergreen-sistema', titulo: 'SISTEMA 366' },
];

// Migración de storage: estas llaves vivían bajo el nombre "evergreen-*" -- si la nueva viene
// vacía, se cae a la vieja (solo lectura, el cliente es quien migra escribiendo hacia adelante).
async function leerJSONConMigracion(clienteId, sufijoNuevo, sufijoViejo) {
  const nuevo = await leerJSON(`${clienteId}:brand-book.${sufijoNuevo}`).catch(() => null);
  if (nuevo) return nuevo;
  return await leerJSON(`${clienteId}:brand-book.${sufijoViejo}`).catch(() => null);
}

async function formatearConversacion366NoGuardada(clienteId) {
  const mensajes = (await leerJSON(`${clienteId}:366-builder-conversacion`).catch(() => null))
    || (await leerJSON(`${clienteId}:evergreen-builder-conversacion`).catch(() => null));
  if (!Array.isArray(mensajes) || mensajes.length === 0) return null;
  const texto = mensajes
    .filter((m) => m && m.role === 'assistant' && typeof m.content === 'string' && m.content.trim())
    .map((m) => m.content.trim())
    .join('\n\n');
  if (!texto) return null;
  const limite = 4000;
  const recortado = texto.length > limite ? '[...conversación anterior omitida...]\n' + texto.slice(-limite) : texto;
  return 'CONVERSACIÓN RECIENTE CON JEFE 366 (puede no estar copiada aún a Notas, pero es información real y reciente del negocio -- tómala en cuenta si aplica):\n\n' + recortado;
}

// Banco de Conversaciones reales de WhatsApp -- se guarda desde Jefe WhatsApp y Ventas
// ({cliente}:whatsapp-convos) y se lee aquí como contexto extra, misma memoria compartida.
async function formatearBancoConversacionesWhatsApp(clienteId) {
  const items = await leerJSON(`${clienteId}:whatsapp-convos`).catch(() => null);
  if (!Array.isArray(items) || items.length === 0) return null;
  const texto = items
    .slice(-10)
    .map((c) => (c && c.text ? c.text.toString().trim() : ''))
    .filter(Boolean)
    .join('\n\n---\n\n');
  if (!texto) return null;
  const limite = 4000;
  const recortado = texto.length > limite ? '[...conversaciones más antiguas omitidas...]\n' + texto.slice(-limite) : texto;
  return 'BANCO DE CONVERSACIONES REALES DE WHATSAPP (guardadas por el usuario en Jefe WhatsApp y Ventas -- son transcripciones reales de clientes, úsalas para frases reales, objeciones y tono; no las inventes ni las repitas tal cual):\n\n' + recortado;
}

async function construirContexto366(clienteId) {
  const datos = await Promise.all(
    GRUPOS_366.map((g) => leerJSONConMigracion(clienteId, g.suffix, g.suffixViejo))
  );
  const bloques = GRUPOS_366.map((g, i) => {
    const d = datos[i];
    if (!d) return null;
    const campos = Object.entries(d)
      .filter(([campo]) => !campo.startsWith('_'))
      .map(([campo, valor]) => {
        const formateado = formatearValorNota(valor);
        return formateado ? `${campo}:\n${formateado}` : null;
      })
      .filter(Boolean);
    if (campos.length === 0) return null;
    return g.titulo + ':\n' + campos.join('\n');
  }).filter(Boolean);

  const conversacionReciente = await formatearConversacion366NoGuardada(clienteId).catch(() => null);
  if (conversacionReciente) bloques.push(conversacionReciente);

  const bancoConversaciones = await formatearBancoConversacionesWhatsApp(clienteId).catch(() => null);
  if (bancoConversaciones) bloques.push(bancoConversaciones);

  if (bloques.length === 0) {
    return 'CONTEXTO 366: todavía no hay nada guardado en el Jefe 366 para esta marca -- usa lo que sí haya del ADN.';
  }
  return 'CONTEXTO 366 (Jefe 366 ya guardado — dolores, deseos, miedos y objeciones reales del cliente, úsalos para responder mejor):\n\n' + truncar(bloques.join('\n\n'), CONTEXT_CHAR_LIMIT);
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

  const { mensaje, imagen, cliente } = req.body || {};
  if (!mensaje && !imagen) {
    return res.status(400).json({ error: 'Falta mensaje o imagen.' });
  }

  const clienteId = (cliente || DEFAULT_CLIENTE).toString();

  try {
    const promptFijo = cargarPromptFijo();
    const [contexto, contexto366] = await Promise.all([
      construirContextoNegocio(clienteId),
      construirContexto366(clienteId),
    ]);
    const system = [promptFijo, contexto, contexto366].join('\n\n');

    const content = [];
    if (imagen && imagen.mediaType && imagen.data) {
      content.push({ type: 'image', source: { type: 'base64', media_type: imagen.mediaType, data: imagen.data } });
    }
    content.push({
      type: 'text',
      text: 'Mensaje del cliente / captura a analizar:\n' + (mensaje || '(ver captura adjunta)'),
    });

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system,
        messages: [{ role: 'user', content }],
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
    await registrarUsoTokens(clienteId, 'jefe-conversion', data.usage);
    return res.status(200).json({ text });
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
};
