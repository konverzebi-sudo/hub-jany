// Endpoint server-side para el Jefe de Anuncios y Campañas de Paga -- consolida en UN solo
// archivo (por el límite de 12 Serverless Functions del plan Hobby de Vercel) los 2 modos que
// antes vivían en api/generar-ideas-anuncios.js y api/generar-detalle-anuncio.js. Cada modo
// conserva exactamente su lógica y forma de respuesta original -- esto es solo reempaquetado,
// no cambia comportamiento.
//
// body.modo === 'ideas'   -> genera 9 ideas LIGERAS (titulo+hook+porque) por etapa.
// body.modo === 'detalle' -> desarrolla el detalle completo de un lote de ideas ya aprobadas.
//
// Multi-tenant, sin datos hardcoded de ninguna marca -- ver prompts/system-prompt-ideas-anuncios.md
// y prompts/system-prompt-detalle-anuncio.md.

const fs = require('fs');
const path = require('path');
const { sql } = require('@vercel/postgres');

const DEFAULT_CLIENTE = 'jefeshub';
const PROMPT_PATH_IDEAS = path.join(__dirname, '..', 'prompts', 'system-prompt-ideas-anuncios.md');
const PROMPT_PATH_DETALLE = path.join(__dirname, '..', 'prompts', 'system-prompt-detalle-anuncio.md');
const CONTEXT_CHAR_LIMIT = 6000;
const MAX_IDEAS_POR_LOTE = 9;
const FORMATOS_VALIDOS = ['reel', 'imagen estática', 'carrusel'];
const ETAPAS = ['adquisicion', 'consideracion', 'conversion'];

const promptCache = {};
function cargarPrompt(rutaAbsoluta) {
  if (promptCache[rutaAbsoluta]) return promptCache[rutaAbsoluta];
  promptCache[rutaAbsoluta] = fs.readFileSync(rutaAbsoluta, 'utf-8');
  return promptCache[rutaAbsoluta];
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

// ---------- formateo del CONTEXTO DEL NEGOCIO (compartido por ambos modos) ----------

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

function formatearProducto(items, productoId, etiqueta) {
  if (!productoId || !Array.isArray(items)) return null;
  const p = items.find((it) => it && it.id === productoId);
  if (!p) return null;
  const partes = [p.nombre];
  if (p.tipo) partes.push(p.tipo);
  if (p.notas) partes.push(`notas: ${p.notas}`);
  return `PRODUCTO ESPECÍFICO A ENFOCAR (${etiqueta}):\n- ` + partes.join(' · ');
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

function extractJson(text) {
  if (!text) return null;
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

function extractJsonArray(text) {
  if (!text) return null;
  const limpio = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const parsed = JSON.parse(limpio);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    // Fallback: busca el primer '[' al primer ']' que cierre balanceado.
  }
  const match = limpio.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    return null;
  }
}

async function llamarClaude(system, userMessage, maxTokens) {
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
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  const data = await anthropicRes.json();
  return { ok: anthropicRes.ok, status: anthropicRes.status, data };
}

// ---------- modo: ideas (ligero, 9 ideas) ----------

async function manejarModoIdeas(body, res) {
  const clienteId = (body.cliente || DEFAULT_CLIENTE).toString();
  const grupoId = body.grupo_id ? body.grupo_id.toString() : '';
  const productoId = body.producto_id ? body.producto_id.toString() : '';

  const promptFijo = cargarPrompt(PROMPT_PATH_IDEAS);
  const { contexto, catalogo } = await construirContexto(clienteId, grupoId);
  const bloqueProducto = formatearProducto(catalogo, productoId, 'las 9 ideas deben girar en torno a este producto puntual, no al grupo completo');

  const instruccion = 'INSTRUCCIÓN DE ESTA GENERACIÓN:\n' +
    'Genera las 9 ideas (3 por etapa: adquisicion, consideracion, conversion) en el formato JSON indicado.' +
    (bloqueProducto ? '\n\n' + bloqueProducto : '');

  const system = [promptFijo, contexto, instruccion].join('\n\n');
  const { ok, status, data } = await llamarClaude(
    system,
    'Genera las 9 ideas de anuncios pedidas, en el formato JSON indicado. Sé breve por campo -- son ideas de referencia para elegir, no el anuncio terminado.',
    2500
  );
  if (!ok) {
    return res.status(status).json({ error: data?.error?.message || 'Error al llamar a la API.' });
  }

  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const parsed = extractJson(text);
  if (!parsed) {
    return res.status(502).json({ error: data.stop_reason === 'max_tokens' ? 'La respuesta quedó incompleta (muy larga). Intenta de nuevo.' : 'No se pudo interpretar la respuesta del modelo.' });
  }

  const ideas = {};
  ETAPAS.forEach((etapa) => {
    ideas[etapa] = Array.isArray(parsed[etapa]) ? parsed[etapa] : [];
  });

  return res.status(200).json({ ideas, usage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 } });
}

// ---------- modo: detalle (guion + copy + prompts de un lote aprobado) ----------

async function manejarModoDetalle(body, res) {
  const clienteId = (body.cliente || DEFAULT_CLIENTE).toString();
  const grupoId = body.grupo_id ? body.grupo_id.toString() : '';
  const productoId = body.producto_id ? body.producto_id.toString() : '';
  const formato = FORMATOS_VALIDOS.includes(body.formato) ? body.formato : 'reel';
  const ideasEntrada = Array.isArray(body.ideas) ? body.ideas : [];

  if (ideasEntrada.length === 0) {
    return res.status(400).json({ error: 'Falta el lote de ideas aprobadas.' });
  }
  if (ideasEntrada.length > MAX_IDEAS_POR_LOTE) {
    return res.status(400).json({ error: `Máximo ${MAX_IDEAS_POR_LOTE} ideas por lote.` });
  }

  const ideas = ideasEntrada.map((it, i) => ({
    id: (it && it.id) ? it.id.toString() : `idea${i + 1}`,
    titulo: (it && it.titulo) ? it.titulo.toString() : '',
    hook: (it && it.hook) ? it.hook.toString() : '',
    etapa: (it && it.etapa) ? it.etapa.toString() : '',
  }));

  const promptFijo = cargarPrompt(PROMPT_PATH_DETALLE);
  const { contexto, catalogo } = await construirContexto(clienteId, grupoId);
  const bloqueProducto = formatearProducto(catalogo, productoId, 'el detalle debe girar en torno a este producto puntual');

  const listaIdeas = ideas.map((idea, i) =>
    `${i + 1}. id="${idea.id}" (etapa: ${idea.etapa || 'sin especificar'})\n   Título: ${idea.titulo}\n   Hook: ${idea.hook}`
  ).join('\n');

  const instruccion = 'INSTRUCCIÓN DE ESTA GENERACIÓN:\n' +
    `FORMATO ELEGIDO PARA TODO EL LOTE: ${formato}\n\n` +
    `IDEAS YA APROBADAS A DESARROLLAR (${ideas.length}):\n${listaIdeas}` +
    (bloqueProducto ? '\n\n' + bloqueProducto : '');

  const system = [promptFijo, contexto, instruccion].join('\n\n');
  const { ok, status, data } = await llamarClaude(
    system,
    'Desarrolla el detalle completo de cada idea del lote, en el formato JSON (array) indicado, en el mismo orden y con el mismo "id" que recibiste.',
    Math.min(8000, 800 + ideas.length * 1200)
  );
  if (!ok) {
    return res.status(status).json({ error: data?.error?.message || 'Error al llamar a la API.' });
  }

  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const parsed = extractJsonArray(text);
  if (!parsed || parsed.length === 0) {
    return res.status(502).json({ error: data.stop_reason === 'max_tokens' ? 'La respuesta quedó incompleta (muy larga). Intenta con menos ideas por lote.' : 'No se pudo interpretar la respuesta del modelo.' });
  }

  const detalles = parsed.map((d, i) => ({
    id: (d && d.id) ? d.id.toString() : (ideas[i] ? ideas[i].id : `idea${i + 1}`),
    guion: (d && d.guion && typeof d.guion === 'object') ? {
      hook: d.guion.hook || '',
      problema: d.guion.problema || '',
      solucion: d.guion.solucion || '',
      prueba: d.guion.prueba || '',
      costo_inaccion: d.guion.costo_inaccion || '',
      cta: d.guion.cta || '',
    } : { hook: '', problema: '', solucion: '', prueba: '', costo_inaccion: '', cta: '' },
    copy_publicacion: (d && d.copy_publicacion) || '',
    prompt_imagen: (d && d.prompt_imagen) || '',
    prompt_video: (d && d.prompt_video) || '',
    caption_whatsapp: (d && d.caption_whatsapp) || '',
  }));

  return res.status(200).json({ detalles, formato, usage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 } });
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
  const modo = (body.modo || '').toString();

  try {
    if (modo === 'ideas') return await manejarModoIdeas(body, res);
    if (modo === 'detalle') return await manejarModoDetalle(body, res);
    return res.status(400).json({ error: 'Falta o es inválido el campo "modo" (usa "ideas" o "detalle").' });
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
};
