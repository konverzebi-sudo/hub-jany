// Endpoint server-side para el Jefe Contenido -- genera las 5 tablas de Ideas de Contenido
// Evergreen (Viral / Educativo / Venta / Entretenimiento / Testimonio) a partir del mismo
// CONTEXTO DEL NEGOCIO que usa Jefe 366 + lo ya guardado en sus Notas de Comunicación
// Evergreen (angulos, frases maestras, tono). Multi-tenant, sin datos hardcoded de ninguna marca.

const fs = require('fs');
const path = require('path');
const { sql } = require('@vercel/postgres');

const DEFAULT_CLIENTE = 'jefeshub';
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt-ideas-contenido-evergreen.md');
const CONTEXT_CHAR_LIMIT = 10000;

let fixedPromptCache = null;
function cargarPromptFijo() {
  if (fixedPromptCache) return fixedPromptCache;
  fixedPromptCache = fs.readFileSync(PROMPT_PATH, 'utf-8');
  return fixedPromptCache;
}

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 15;
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

// ---------- formateo del CONTEXTO DEL NEGOCIO (mismo patron que api/consultor-evergreen.js) ----------

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
      if (a.que_busca) l.push(`  Qué busca: ${a.que_busca}`);
      return l.join('\n');
    });
  if (bloques.length === 0) return null;
  return 'CLIENTE IDEAL (audiencias del ADN):\n' + bloques.join('\n\n');
}

function formatearCatalogo(items, grupos, grupoId) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const nombrePorGrupo = {};
  (grupos || []).forEach((g) => { nombrePorGrupo[g.id] = g.nombre; });
  let filtrados = items.filter((p) => p && p.nombre);
  if (grupoId) filtrados = filtrados.filter((p) => p.grupo_id === grupoId);
  if (filtrados.length === 0) return null;
  const lineas = filtrados.map((p) => {
    const partes = [p.nombre];
    if (p.tipo) partes.push(p.tipo);
    if (p.grupo_id && nombrePorGrupo[p.grupo_id]) partes.push(`grupo: ${nombrePorGrupo[p.grupo_id]}`);
    if (p.notas) partes.push(`notas: ${p.notas}`);
    return '- ' + partes.join(' · ');
  });
  return 'CATÁLOGO DE PRODUCTOS' + (grupoId && nombrePorGrupo[grupoId] ? ` (grupo: ${nombrePorGrupo[grupoId]})` : '') + ':\n' + lineas.join('\n');
}

function formatearTabla(filas, columnas, titulo) {
  if (!Array.isArray(filas) || filas.length === 0) return null;
  const utiles = filas.filter((f) => f && Object.values(f).some((v) => (v || '').toString().trim()));
  if (utiles.length === 0) return null;
  const lineas = utiles.map((f) => columnas.map((c) => f[c.key] ? `${c.label}: ${f[c.key]}` : null).filter(Boolean).join(' | '));
  return titulo + ':\n' + lineas.map((l) => '- ' + l).join('\n');
}

function formatearComunicacion366(d) {
  if (!d) return null;
  const bloques = [];
  const textoLineas = [];
  if (d.posicionamiento) textoLineas.push(`Posicionamiento: ${d.posicionamiento}`);
  if (d.diferenciador) textoLineas.push(`Diferenciador: ${d.diferenciador}`);
  if (textoLineas.length) bloques.push('ESTRATEGIA DE COMUNICACIÓN 366:\n' + textoLineas.join('\n'));

  bloques.push(formatearTabla(
    d.angulos_evergreen,
    [{ key: 'angulo', label: 'Ángulo' }, { key: 'accion', label: 'Acción' }, { key: 'emocion', label: 'Emoción' }, { key: 'ejemplo', label: 'Ejemplo de mensaje' }],
    'ÁNGULOS EVERGREEN YA DEFINIDOS'
  ));
  bloques.push(formatearTabla(
    d.frases_maestras,
    [{ key: 'frase', label: 'Frase' }, { key: 'activa', label: 'Qué activa' }, { key: 'donde', label: 'Dónde usarla' }],
    'FRASES MAESTRAS YA DEFINIDAS'
  ));

  const finales = bloques.filter(Boolean);
  if (finales.length === 0) return null;
  return finales.join('\n\n');
}

async function formatearConversacion366NoGuardada(clienteId) {
  const mensajes = await leerJSON(`${clienteId}:evergreen-builder-conversacion`).catch(() => null);
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

async function construirContexto(clienteId, grupoId) {
  const [identidad, tono, audiencia, catalogo, grupos, comunicacion, conversacionReciente, bancoConversaciones] = await Promise.all([
    leerJSON(`${clienteId}:brand-book.identidad`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.tono`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.audiencia`).catch(() => null),
    leerJSON(`${clienteId}:catalogo-productos`).catch(() => null),
    leerJSON(`${clienteId}:grupos-negocio`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.evergreen-comunicacion`).catch(() => null),
    formatearConversacion366NoGuardada(clienteId).catch(() => null),
    formatearBancoConversacionesWhatsApp(clienteId).catch(() => null),
  ]);

  const bloquesNegocio = [
    formatearIdentidad(identidad),
    formatearTono(tono),
    formatearAudiencias(audiencia),
    formatearCatalogo(catalogo, grupos, grupoId),
  ].filter(Boolean);

  const bloque366 = formatearComunicacion366(comunicacion);

  const partes = [];
  partes.push(bloquesNegocio.length
    ? 'CONTEXTO DEL NEGOCIO:\n\n' + bloquesNegocio.join('\n\n')
    : 'CONTEXTO DEL NEGOCIO: todavía no hay datos guardados en el ADN de esta marca.');
  partes.push(bloque366
    ? 'CONTEXTO 366 (Notas de Comunicación Evergreen ya guardadas):\n\n' + bloque366
    : 'CONTEXTO 366: todavía no hay ángulos ni frases maestras guardadas en el Jefe 366 -- genera con lo que sí haya del ADN.');
  if (conversacionReciente) partes.push(conversacionReciente);
  if (bancoConversaciones) partes.push(bancoConversaciones);

  return truncar(partes.join('\n\n---\n\n'), CONTEXT_CHAR_LIMIT);
}

function extractJson(text) {
  if (!text) return null;
  // Quita bloques de código markdown si el modelo los agrego pese a la instruccion.
  const limpio = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(limpio);
  } catch (err) {
    // Fallback: busca el primer '{' al primer '}' que cierre balanceado.
  }
  const match = limpio.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (err) {
    return null;
  }
}

const CATEGORIAS_INFO = {
  viral: 'Contenido Viral',
  educativo: 'Contenido Educativo',
  venta: 'Contenido De Venta',
  entretenimiento: 'Contenido De Entretenimiento',
  testimonio: 'Contenido De Testimonio',
};
const CATEGORIAS = Object.keys(CATEGORIAS_INFO);
const ITEMS_POR_CATEGORIA = 3;

function formatearProducto(items, productoId) {
  if (!productoId || !Array.isArray(items)) return null;
  const p = items.find((it) => it && it.id === productoId);
  if (!p) return null;
  const partes = [p.nombre];
  if (p.tipo) partes.push(p.tipo);
  if (p.notas) partes.push(`notas: ${p.notas}`);
  return 'PRODUCTO ESPECÍFICO A ENFOCAR (todas las ideas deben girar en torno a este producto puntual, no al grupo completo):\n- ' + partes.join(' · ');
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
  const clienteId = (body.cliente || DEFAULT_CLIENTE).toString();
  const grupoId = body.grupo_id ? body.grupo_id.toString() : '';
  const tipo = CATEGORIAS.includes(body.tipo) ? body.tipo : 'todos';
  const productoId = body.producto_id ? body.producto_id.toString() : '';
  const categoriasPedidas = tipo === 'todos' ? CATEGORIAS : [tipo];

  try {
    const promptFijo = cargarPromptFijo();
    const contexto = await construirContexto(clienteId, grupoId);
    const catalogo = await leerJSON(`${clienteId}:catalogo-productos`).catch(() => null);
    const bloqueProducto = formatearProducto(catalogo, productoId);

    const instruccion = 'INSTRUCCIÓN DE ESTA GENERACIÓN:\n' +
      `Genera SOLO estas categorías, ${ITEMS_POR_CATEGORIA} ideas cada una: ` +
      categoriasPedidas.map((c) => `"${c}" (${CATEGORIAS_INFO[c]})`).join(', ') + '.' +
      (bloqueProducto ? '\n\n' + bloqueProducto : '');

    const system = [promptFijo, contexto, instruccion].join('\n\n');

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: tipo === 'todos' ? 8000 : 2500,
        system,
        messages: [{ role: 'user', content: 'Genera las ideas de contenido evergreen pedidas, en el formato JSON indicado. Sé breve por campo -- son ideas de referencia, no el guion final.' }],
      }),
    });

    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      return res.status(anthropicRes.status).json({ error: data?.error?.message || 'Error al llamar a la API.' });
    }

    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const parsed = extractJson(text);
    if (!parsed) {
      return res.status(502).json({ error: data.stop_reason === 'max_tokens' ? 'La respuesta quedó incompleta (muy larga). Intenta de nuevo o genera una sola categoría a la vez.' : 'No se pudo interpretar la respuesta del modelo.' });
    }

    const resultado = {};
    categoriasPedidas.forEach((cat) => {
      resultado[cat] = Array.isArray(parsed[cat]) ? parsed[cat] : [];
    });

    await registrarUsoTokens(clienteId, 'generar-ideas-evergreen', data.usage);
    return res.status(200).json({ ideas: resultado, usage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 } });
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
};
