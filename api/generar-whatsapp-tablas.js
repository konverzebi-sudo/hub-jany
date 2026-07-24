// Endpoint server-side para Jefe WhatsApp y Ventas -- genera Banco de Objeciones y
// Seguimiento/Reactivacion leyendo el CONTEXTO DEL NEGOCIO (ADN), el CONTEXTO EVERGREEN
// (Notas de Comunicacion Evergreen) y, si existen, los hallazgos de la ultima Auditoria de
// Conversaciones guardada. Multi-tenant, sin datos hardcoded de ninguna marca.

const fs = require('fs');
const path = require('path');
const { sql } = require('@vercel/postgres');

const DEFAULT_CLIENTE = 'jefeshub';
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt-whatsapp-tablas.md');
const CONTEXT_CHAR_LIMIT = 6000;

let promptCache = null;
function cargarPromptFijo() {
  if (promptCache) return promptCache;
  promptCache = fs.readFileSync(PROMPT_PATH, 'utf-8');
  return promptCache;
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
    if (p.precio != null && p.precio !== '') partes.push(`precio $${p.precio}`);
    return '- ' + partes.join(' · ');
  });
  return 'CATÁLOGO DE PRODUCTOS:\n' + lineas.join('\n');
}

function formatearTabla(filas, columnas, titulo) {
  if (!Array.isArray(filas) || filas.length === 0) return null;
  const utiles = filas.filter((f) => f && Object.values(f).some((v) => (v || '').toString().trim()));
  if (utiles.length === 0) return null;
  const lineas = utiles.map((f) => columnas.map((c) => f[c.key] ? `${c.label}: ${f[c.key]}` : null).filter(Boolean).join(' | '));
  return titulo + ':\n' + lineas.map((l) => '- ' + l).join('\n');
}

function formatearComunicacionEvergreen(d) {
  if (!d) return null;
  const bloques = [];
  const textoLineas = [];
  if (d.posicionamiento) textoLineas.push(`Posicionamiento: ${d.posicionamiento}`);
  if (d.tono_si) textoLineas.push(`Tono que sí: ${d.tono_si}`);
  if (d.tono_no) textoLineas.push(`Tono que no: ${d.tono_no}`);
  if (textoLineas.length) bloques.push('ESTRATEGIA DE COMUNICACIÓN EVERGREEN:\n' + textoLineas.join('\n'));
  bloques.push(formatearTabla(
    d.angulos_evergreen,
    [{ key: 'angulo', label: 'Ángulo' }, { key: 'ejemplo', label: 'Ejemplo de mensaje' }],
    'ÁNGULOS EVERGREEN'
  ));
  bloques.push(formatearTabla(
    d.frases_maestras,
    [{ key: 'frase', label: 'Frase' }, { key: 'donde', label: 'Dónde usarla' }],
    'FRASES MAESTRAS'
  ));
  const finales = bloques.filter(Boolean);
  if (finales.length === 0) return null;
  return finales.join('\n\n');
}

function formatearHallazgosAuditoria(auditorias, grupoKey) {
  const lista = auditorias && auditorias[grupoKey];
  if (!Array.isArray(lista) || lista.length === 0) return null;
  const ultima = lista[lista.length - 1];
  if (!ultima || !ultima.resumen) return null;
  const r = ultima.resumen;
  const lineas = [];
  if (r.que_funciona) lineas.push(`Qué funciona hoy: ${r.que_funciona}`);
  if (r.donde_se_pierden_ventas) lineas.push(`Dónde se pierden ventas: ${r.donde_se_pierden_ventas}`);
  if (r.error_mas_repetido) lineas.push(`Error más repetido: ${r.error_mas_repetido}`);
  if (r.que_mejorar_primero) lineas.push(`Qué mejorar primero: ${r.que_mejorar_primero}`);
  if (lineas.length === 0) return null;
  return 'HALLAZGOS DE AUDITORÍA (de conversaciones reales ya auditadas -- dales prioridad):\n' + lineas.join('\n');
}

async function construirContexto(clienteId, grupoId, grupoKey) {
  const [identidad, tono, audiencia, catalogo, grupos, comunicacion, auditorias] = await Promise.all([
    leerJSON(`${clienteId}:brand-book.identidad`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.tono`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.audiencia`).catch(() => null),
    leerJSON(`${clienteId}:catalogo-productos`).catch(() => null),
    leerJSON(`${clienteId}:grupos-negocio`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.evergreen-comunicacion`).catch(() => null),
    leerJSON(`${clienteId}:whatsapp-auditorias`).catch(() => null),
  ]);

  const bloquesNegocio = [
    formatearIdentidad(identidad),
    formatearTono(tono),
    formatearAudiencias(audiencia),
    formatearCatalogo(catalogo, grupos, grupoId),
  ].filter(Boolean);

  const bloqueEvergreen = formatearComunicacionEvergreen(comunicacion);
  const bloqueAuditoria = formatearHallazgosAuditoria(auditorias, grupoKey);

  const partes = [];
  partes.push(bloquesNegocio.length
    ? 'CONTEXTO DEL NEGOCIO:\n\n' + bloquesNegocio.join('\n\n')
    : 'CONTEXTO DEL NEGOCIO: todavía no hay datos guardados en el ADN de esta marca.');
  partes.push(bloqueEvergreen
    ? 'CONTEXTO EVERGREEN:\n\n' + bloqueEvergreen
    : 'CONTEXTO EVERGREEN: todavía no hay ángulos ni frases maestras guardadas en el Jefe Evergreen.');
  if (bloqueAuditoria) partes.push(bloqueAuditoria);

  return truncar(partes.join('\n\n---\n\n'), CONTEXT_CHAR_LIMIT);
}

function extractJson(text) {
  if (!text) return null;
  const limpio = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(limpio);
  } catch (err) {}
  const match = limpio.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (err) {
    return null;
  }
}

const MODOS = {
  objeciones: { clave: 'objeciones', filas: 5, etiqueta: 'Banco de Objeciones' },
  seguimiento: { clave: 'seguimiento', filas: 5, etiqueta: 'Seguimiento y Reactivación' },
};

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
  const grupoKey = grupoId || 'general';
  const modo = MODOS[body.modo] ? body.modo : 'objeciones';
  const config = MODOS[modo];

  try {
    const promptFijo = cargarPromptFijo();
    const contexto = await construirContexto(clienteId, grupoId, grupoKey);
    const instruccion = `INSTRUCCIÓN DE ESTA GENERACIÓN:\nGenera SOLO la tabla "${config.clave}" (${config.etiqueta}), ${config.filas} filas.`;
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
        max_tokens: 3000,
        system,
        messages: [{ role: 'user', content: `Genera la tabla ${config.etiqueta} pedida, en el formato JSON indicado. Sé breve por campo.` }],
      }),
    });

    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      return res.status(anthropicRes.status).json({ error: data?.error?.message || 'Error al llamar a la API.' });
    }

    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const parsed = extractJson(text);
    if (!parsed) {
      return res.status(502).json({ error: data.stop_reason === 'max_tokens' ? 'La respuesta quedó incompleta (muy larga). Intenta de nuevo.' : 'No se pudo interpretar la respuesta del modelo.' });
    }

    const filas = Array.isArray(parsed[config.clave]) ? parsed[config.clave] : [];
    return res.status(200).json({ modo, filas, usage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 } });
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
};
