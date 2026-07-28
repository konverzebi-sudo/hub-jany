// Endpoint server-side para el Jefe Contenido -- Guionista Organico. Genera un guion de
// contenido organico (reel/tiktok/historia/carrusel/post estatico) a partir de una idea puntual,
// leyendo en vivo el mismo CONTEXTO DEL NEGOCIO que usa Jefe Evergreen + sus Notas de Comunicacion
// Evergreen + el Radar de Mercado mas reciente. Multi-tenant, sin datos hardcoded de ninguna marca.

const fs = require('fs');
const path = require('path');
const { sql } = require('@vercel/postgres');

const DEFAULT_CLIENTE = 'jefeshub';
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt-guion-organico.md');
const CONTEXT_CHAR_LIMIT = 6000;

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

function formatearComunicacionEvergreen(d) {
  if (!d) return null;
  const bloques = [];
  const textoLineas = [];
  if (d.posicionamiento) textoLineas.push(`Posicionamiento: ${d.posicionamiento}`);
  if (d.diferenciador) textoLineas.push(`Diferenciador: ${d.diferenciador}`);
  if (d.tono_si) textoLineas.push(`Tono que sí: ${d.tono_si}`);
  if (d.tono_no) textoLineas.push(`Tono que no: ${d.tono_no}`);
  if (textoLineas.length) bloques.push('ESTRATEGIA DE COMUNICACIÓN EVERGREEN:\n' + textoLineas.join('\n'));

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

function formatearRadar(historial) {
  if (!Array.isArray(historial) || historial.length === 0) return null;
  const ultimo = historial[historial.length - 1];
  if (!ultimo) return null;
  const insights = Array.isArray(ultimo.insights) ? ultimo.insights : [];
  if (insights.length === 0) return null;
  const lineas = insights.slice(0, 8).map((ins) => {
    const esObjeto = ins && typeof ins === 'object';
    const texto = esObjeto ? ins.insight : ins;
    if (!texto) return null;
    const partes = [texto];
    if (esObjeto && ins.uso) partes.push(`uso: ${ins.uso}`);
    if (esObjeto && ins.prioridad) partes.push(`prioridad: ${ins.prioridad}`);
    return '- ' + partes.join(' · ');
  }).filter(Boolean);
  if (lineas.length === 0) return null;
  return `RADAR DE MERCADO (corrida más reciente${ultimo.date ? ', ' + ultimo.date : ''}):\n` + lineas.join('\n');
}

function formatearProducto(items, productoId) {
  if (!productoId || !Array.isArray(items)) return null;
  const p = items.find((it) => it && it.id === productoId);
  if (!p) return null;
  const partes = [p.nombre];
  if (p.tipo) partes.push(p.tipo);
  if (p.notas) partes.push(`notas: ${p.notas}`);
  return 'PRODUCTO ESPECÍFICO A ENFOCAR (el guion debe girar en torno a este producto puntual):\n- ' + partes.join(' · ');
}

async function construirContexto(clienteId, grupoId) {
  const [identidad, tono, audiencia, catalogo, grupos, comunicacion, radarHistorial] = await Promise.all([
    leerJSON(`${clienteId}:brand-book.identidad`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.tono`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.audiencia`).catch(() => null),
    leerJSON(`${clienteId}:catalogo-productos`).catch(() => null),
    leerJSON(`${clienteId}:grupos-negocio`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.evergreen-comunicacion`).catch(() => null),
    leerJSON(`${clienteId}:radar-historial`).catch(() => null),
  ]);

  const bloquesNegocio = [
    formatearIdentidad(identidad),
    formatearTono(tono),
    formatearAudiencias(audiencia),
    formatearCatalogo(catalogo, grupos, grupoId),
  ].filter(Boolean);

  const bloqueEvergreen = formatearComunicacionEvergreen(comunicacion);
  const bloqueRadar = formatearRadar(radarHistorial);

  const partes = [];
  partes.push(bloquesNegocio.length
    ? 'CONTEXTO DEL NEGOCIO:\n\n' + bloquesNegocio.join('\n\n')
    : 'CONTEXTO DEL NEGOCIO: todavía no hay datos guardados en el ADN de esta marca.');
  partes.push(bloqueEvergreen
    ? 'CONTEXTO EVERGREEN (Notas de Comunicación Evergreen ya guardadas):\n\n' + bloqueEvergreen
    : 'CONTEXTO EVERGREEN: todavía no hay ángulos ni frases maestras guardadas en el Jefe Evergreen -- usa lo que sí haya del ADN.');
  partes.push(bloqueRadar
    ? bloqueRadar
    : 'RADAR DE MERCADO: todavía no hay corridas guardadas -- ignora esta sección.');

  return { contexto: truncar(partes.join('\n\n---\n\n'), CONTEXT_CHAR_LIMIT), catalogo };
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
  const productoId = body.producto_id ? body.producto_id.toString() : '';
  const idea = (body.idea || '').toString().trim();
  const objetivo = (body.objetivo || 'alcance').toString();
  const formato = (body.formato || 'reel').toString();

  if (!idea) {
    return res.status(400).json({ error: 'Falta la idea o tema del contenido.' });
  }

  try {
    const promptFijo = cargarPromptFijo();
    const { contexto, catalogo } = await construirContexto(clienteId, grupoId);
    const bloqueProducto = formatearProducto(catalogo, productoId);

    const instruccion = 'INSTRUCCIÓN DE ESTA GENERACIÓN:\n' +
      `IDEA / TEMA: ${idea}\n` +
      `OBJETIVO: ${objetivo}\n` +
      `FORMATO: ${formato}` +
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
        max_tokens: 2000,
        system,
        messages: [{ role: 'user', content: 'Genera el guion de contenido orgánico pedido, siguiendo el formato de salida obligatorio al pie de la letra.' }],
      }),
    });

    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      return res.status(anthropicRes.status).json({ error: data?.error?.message || 'Error al llamar a la API.' });
    }

    const guion = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (!guion) {
      return res.status(502).json({ error: 'No se pudo interpretar la respuesta del modelo.' });
    }

    return res.status(200).json({ guion, usage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 } });
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
};
