// Endpoint server-side para el Jefe de Anuncios y Campañas de Paga -- consolida en UN solo
// archivo (por el límite de 12 Serverless Functions del plan Hobby de Vercel) los 2 modos que
// antes vivían en api/generar-ideas-anuncios.js y api/generar-detalle-anuncio.js. Cada modo
// conserva exactamente su lógica y forma de respuesta original -- esto es solo reempaquetado,
// no cambia comportamiento.
//
// body.modo === 'ideas'   -> genera ideas LIGERAS (titulo+hook+porque) por etapa -- cantidad por
//                            etapa configurable (1-3) y opcionalmente scoped a un solo ángulo.
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
const PROMPT_PATH_TARGETING = path.join(__dirname, '..', 'prompts', 'system-prompt-targeting-anuncios.md');
const PROMPT_PATH_CAMPOS_META = path.join(__dirname, '..', 'prompts', 'system-prompt-campos-meta.md');
const PROMPT_PATH_CHAT = path.join(__dirname, '..', 'prompts', 'system-prompt-chat-anuncios.md');
const PROMPT_PATH_DETALLE_IMAGEN = path.join(__dirname, '..', 'prompts', 'system-prompt-detalle-imagen.md');
const CHAT_MAX_MESSAGES = 40;
const CONTEXT_CHAR_LIMIT = 10000;
const MAX_IDEAS_POR_LOTE = 9;
const MAX_CAMPOS_META_POR_LOTE = 12;
const FORMATOS_VALIDOS = ['reel', 'imagen estática', 'carrusel'];
const ETAPAS = ['adquisicion', 'consideracion', 'conversion'];
// Tipos de imagen que acepta la API de Claude -- el cliente ya normaliza todo a JPEG antes de
// mandarlo, pero se valida por si acaso.
const MEDIA_TYPES_IMAGEN_VALIDOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
// Base64 crudo tal cual llega en el body -- limita el tamaño para no pegarle al límite de payload
// de la función serverless (el cliente ya comprime la imagen antes de mandarla).
const MAX_IMAGEN_BASE64_CHARS = 6 * 1024 * 1024;
// Lista fija de botones de CTA que existen de verdad en Meta Ads Manager -- nunca se le pide al
// modelo que invente uno nuevo, solo que elija de esta lista.
const CTA_OPTIONS = ['Enviar mensaje', 'Más información', 'Comprar ahora', 'Reservar', 'Solicitar hora', 'Registrarte', 'Contactarnos', 'Llamar ahora', 'Obtener oferta', 'Suscribirse'];
function validarCta(valor) {
  const encontrado = CTA_OPTIONS.find((c) => c.toLowerCase() === (valor || '').toString().trim().toLowerCase());
  return encontrado || '';
}

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

// ---------- CONTEXTO 366: las 4 Notas guardadas por el Jefe 366, no solo Comunicación ----------
// Mismo patrón genérico que api/jefe-estrategia-whatsapp.js (formatearValorNota/GRUPOS_366):
// aplana cualquier campo (texto, tabla, objeto) sin necesitar conocer su forma exacta. Antes este
// endpoint solo leía "evergreen-comunicacion" (ángulos + frases) -- se le escapaba por completo
// "evergreen-perfil-cliente" (dolores, deseos, miedos, objeciones), que es la nota con el análisis
// psicológico más profundo del cliente ideal, clave para que el copy de los anuncios suene a la
// marca y no genérico.

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
  { suffix: 'evergreen-producto', titulo: 'PRODUCTO 366' },
  { suffix: 'evergreen-perfil-cliente', titulo: 'PERFIL DE CLIENTE 366 (dolores, deseos, miedos, objeciones)' },
  { suffix: 'evergreen-comunicacion', titulo: 'COMUNICACIÓN 366 (incluye ángulos y frases maestras)' },
  { suffix: 'evergreen-sistema', titulo: 'SISTEMA 366' },
];

async function construirContexto366Notas(clienteId) {
  const datos = await Promise.all(
    GRUPOS_366.map((g) => leerJSON(`${clienteId}:brand-book.${g.suffix}`).catch(() => null))
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

  if (bloques.length === 0) return null;
  return bloques.join('\n\n');
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

// Retroalimentación que el usuario dejó escrita en tarjetas ya guardadas (campo "retroalimentacion"
// en {cliente}:agente-anuncios) -- son correcciones puntuales sobre piezas concretas (no datos de
// marca permanentes, esos van en el ADN/366), así que se inyectan como señales a corregir en
// las próximas generaciones. Se toman las más recientes primero (las tarjetas se guardan con
// unshift) y se limita la cantidad para no inflar el contexto sin control.
const MAX_RETROALIMENTACION = 12;

async function formatearRetroalimentacion(clienteId) {
  const cards = await leerJSON(`${clienteId}:agente-anuncios`).catch(() => null);
  if (!Array.isArray(cards) || cards.length === 0) return null;
  const conNota = cards
    .filter((c) => c && c.retroalimentacion && c.retroalimentacion.toString().trim())
    .slice(0, MAX_RETROALIMENTACION);
  if (conNota.length === 0) return null;
  const lineas = conNota.map((c) => `- Sobre "${c.titulo || '(sin título)'}": ${c.retroalimentacion.toString().trim()}`);
  return 'RETROALIMENTACIÓN PREVIA DEL USUARIO (correcciones puntuales sobre campañas ya generadas -- aplícalas en esta generación, no repitas el mismo error):\n' + lineas.join('\n');
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
  const [identidad, tono, audiencia, catalogo, grupos, bloque366, radarHistorial, conversacionReciente, bloqueRetroalimentacion, bancoConversaciones] = await Promise.all([
    leerJSON(`${clienteId}:brand-book.identidad`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.tono`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.audiencia`).catch(() => null),
    leerJSON(`${clienteId}:catalogo-productos`).catch(() => null),
    leerJSON(`${clienteId}:grupos-negocio`).catch(() => null),
    construirContexto366Notas(clienteId).catch(() => null),
    leerJSON(`${clienteId}:radar-historial`).catch(() => null),
    formatearConversacion366NoGuardada(clienteId).catch(() => null),
    formatearRetroalimentacion(clienteId).catch(() => null),
    formatearBancoConversacionesWhatsApp(clienteId).catch(() => null),
  ]);

  const bloquesNegocio = [
    formatearIdentidad(identidad),
    formatearTono(tono),
    formatearAudiencias(audiencia),
    formatearCatalogo(catalogo, grupos, grupoId),
  ].filter(Boolean);

  const bloqueRadar = formatearRadar(radarHistorial);

  const partes = [];
  partes.push(bloquesNegocio.length
    ? 'CONTEXTO DEL NEGOCIO:\n\n' + bloquesNegocio.join('\n\n')
    : 'CONTEXTO DEL NEGOCIO: todavía no hay datos guardados en el ADN de esta marca.');
  partes.push(bloque366
    ? 'CONTEXTO 366 (las 4 Notas ya guardadas por el Jefe 366 — Producto, Perfil de Cliente, Comunicación y Sistema; úsalas para ángulos, frases, dolores/deseos y tono, no las repitas tal cual):\n\n' + bloque366
    : 'CONTEXTO 366: todavía no hay Notas 366 guardadas para esta marca -- usa lo que sí haya del ADN.');
  partes.push(bloqueRadar
    ? bloqueRadar
    : 'RADAR DE MERCADO: todavía no hay corridas guardadas -- ignora esta sección.');
  if (conversacionReciente) partes.push(conversacionReciente);
  if (bloqueRetroalimentacion) partes.push(bloqueRetroalimentacion);
  if (bancoConversaciones) partes.push(bancoConversaciones);

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

async function llamarClaudeConHistorial(system, messages, maxTokens) {
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
  return { ok: anthropicRes.ok, status: anthropicRes.status, data };
}

// ---------- modo: ideas (ligero, 9 ideas) ----------

async function manejarModoIdeas(body, res) {
  const clienteId = (body.cliente || DEFAULT_CLIENTE).toString();
  const grupoId = body.grupo_id ? body.grupo_id.toString() : '';
  const productoId = body.producto_id ? body.producto_id.toString() : '';
  const anguloTexto = (body.angulo_texto || '').toString().trim();
  const cantidadPorEtapaCruda = parseInt(body.cantidad_por_etapa, 10);
  const cantidadPorEtapa = [1, 2, 3].includes(cantidadPorEtapaCruda) ? cantidadPorEtapaCruda : 3;

  const promptFijo = cargarPrompt(PROMPT_PATH_IDEAS);
  const { contexto, catalogo } = await construirContexto(clienteId, grupoId);
  const bloqueProducto = formatearProducto(catalogo, productoId, 'las ideas deben girar en torno a este producto puntual, no al grupo completo');

  const instruccion = 'INSTRUCCIÓN DE ESTA GENERACIÓN:\n' +
    (anguloTexto
      ? `Ángulo 366 elegido (enfócate SOLO en este, no mezcles con otros ángulos): ${anguloTexto}\n`
      : 'No se eligió un ángulo específico -- explora libremente los ángulos 366 disponibles, mezclando varios si aplica.\n') +
    `Genera ${cantidadPorEtapa} idea(s) por cada una de las 3 etapas (adquisicion, consideracion, conversion) = ${cantidadPorEtapa * 3} en total, en el formato JSON indicado.` +
    (bloqueProducto ? '\n\n' + bloqueProducto : '');

  const system = [promptFijo, contexto, instruccion].join('\n\n');
  const { ok, status, data } = await llamarClaude(
    system,
    `Genera las ${cantidadPorEtapa * 3} ideas de anuncios pedidas, en el formato JSON indicado. Sé breve por campo -- son ideas de referencia para elegir, no el anuncio terminado.`,
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
    ideas[etapa] = Array.isArray(parsed[etapa]) ? parsed[etapa].slice(0, cantidadPorEtapa) : [];
  });

  await registrarUsoTokens(clienteId, 'generar-anuncios-ideas', data.usage);
  return res.status(200).json({ ideas, usage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 } });
}

// ---------- modo: detalle (guion + copy + prompts de un lote aprobado) ----------

// Mapeo fijo etapa -> audiencia (frío/tibio/caliente), tal cual la tabla del documento maestro
// del curso -- se calcula en código, no se le pide al modelo, para que sea siempre consistente.
const AUDIENCIA_POR_ETAPA = { adquisicion: 'fría', consideracion: 'tibia', conversion: 'caliente' };

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
    Math.min(8000, 1000 + ideas.length * 1800)
  );
  if (!ok) {
    return res.status(status).json({ error: data?.error?.message || 'Error al llamar a la API.' });
  }

  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const parsed = extractJsonArray(text);
  if (!parsed || parsed.length === 0) {
    return res.status(502).json({ error: data.stop_reason === 'max_tokens' ? 'La respuesta quedó incompleta (muy larga). Intenta con menos ideas por lote.' : 'No se pudo interpretar la respuesta del modelo.' });
  }

  const detalles = parsed.map((d, i) => {
    const idea = ideas[i] || {};
    const ideaId = (d && d.id) ? d.id.toString() : (idea.id || `idea${i + 1}`);
    const etapaIdea = ideas.find((it) => it.id === ideaId)?.etapa || idea.etapa || '';
    return {
      id: ideaId,
      objetivo: (d && d.objetivo) || '',
      angulo: (d && d.angulo) || '',
      audiencia: AUDIENCIA_POR_ETAPA[etapaIdea] || '',
      guion: (d && d.guion && typeof d.guion === 'object') ? {
        hook: d.guion.hook || '',
        problema: d.guion.problema || '',
        solucion: d.guion.solucion || '',
        prueba: d.guion.prueba || '',
        costo_inaccion: d.guion.costo_inaccion || '',
        cta: d.guion.cta || '',
      } : { hook: '', problema: '', solucion: '', prueba: '', costo_inaccion: '', cta: '' },
      version_15s: (d && d.version_15s) || '',
      hooks_alternativos: Array.isArray(d && d.hooks_alternativos) ? d.hooks_alternativos.filter(Boolean).map((h) => h.toString()) : [],
      visual_sugerido: (d && d.visual_sugerido) || '',
      duracion_sugerida: (d && d.duracion_sugerida) || '',
      copy_publicacion: (d && d.copy_publicacion) || '',
      prompt_imagen: (d && d.prompt_imagen) || '',
      prompt_video: (d && d.prompt_video) || '',
      caption_whatsapp: (d && d.caption_whatsapp) || '',
      titulo_anuncio: (d && d.titulo_anuncio) || '',
      descripcion_anuncio: (d && d.descripcion_anuncio) || '',
      cta_boton: validarCta(d && d.cta_boton) || 'Más información',
    };
  });

  await registrarUsoTokens(clienteId, 'generar-anuncios-detalle', data.usage);
  return res.status(200).json({ detalles, formato, usage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 } });
}

// ---------- modo: detalle_imagen (analiza una imagen/fotograma de un anuncio ya hecho) ----------

async function manejarModoDetalleImagen(body, res) {
  const clienteId = (body.cliente || DEFAULT_CLIENTE).toString();
  const grupoId = body.grupo_id ? body.grupo_id.toString() : '';
  const productoId = body.producto_id ? body.producto_id.toString() : '';
  const notas = (body.notas || '').toString().trim().slice(0, 4000);
  const formatoForzado = FORMATOS_VALIDOS.includes(body.formato) ? body.formato : '';
  const imagenBase64 = (body.imagen_base64 || '').toString();
  const mediaType = MEDIA_TYPES_IMAGEN_VALIDOS.includes(body.imagen_media_type) ? body.imagen_media_type : 'image/jpeg';

  if (!imagenBase64) {
    return res.status(400).json({ error: 'Falta la imagen a analizar.' });
  }
  if (imagenBase64.length > MAX_IMAGEN_BASE64_CHARS) {
    return res.status(400).json({ error: 'La imagen es demasiado grande. Usa una imagen más ligera o un fotograma más pequeño.' });
  }

  const promptFijo = cargarPrompt(PROMPT_PATH_DETALLE_IMAGEN);
  const { contexto, catalogo } = await construirContexto(clienteId, grupoId);
  const bloqueProducto = formatearProducto(catalogo, productoId, 'el análisis debe conectar con este producto puntual si aplica');

  const instruccion = 'INSTRUCCIÓN DE ESTA GENERACIÓN:\n' +
    'Analiza la imagen adjunta (un anuncio ya hecho o el fotograma de un video de anuncio) y entrega su ficha completa en el formato JSON indicado.' +
    (formatoForzado ? `\nFORMATO YA CONFIRMADO POR EL USUARIO (respeta este, no lo redetectes): ${formatoForzado}\n` : '\n') +
    (notas ? `\nNOTAS DEL USUARIO (contexto extra, prioridad alta -- por ejemplo el guion o texto que se dice en el video):\n${notas}\n` : '') +
    (bloqueProducto ? '\n' + bloqueProducto : '');

  const system = [promptFijo, contexto, instruccion].join('\n\n');
  const userContent = [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: imagenBase64 } },
    { type: 'text', text: 'Analiza esta imagen y entrega su ficha completa, en el formato JSON indicado.' },
  ];
  const { ok, status, data } = await llamarClaudeConHistorial(system, [{ role: 'user', content: userContent }], 3000);
  if (!ok) {
    return res.status(status).json({ error: data?.error?.message || 'Error al llamar a la API.' });
  }

  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const d = extractJson(text);
  if (!d) {
    return res.status(502).json({ error: data.stop_reason === 'max_tokens' ? 'La respuesta quedó incompleta (muy larga). Intenta de nuevo.' : 'No se pudo interpretar la respuesta del modelo.' });
  }

  const etapaDetectada = ETAPAS.includes(d.etapa) ? d.etapa : 'consideracion';
  const detalle = {
    titulo: d.titulo || '',
    hook: d.hook || '',
    etapa: etapaDetectada,
    formato: formatoForzado || (FORMATOS_VALIDOS.includes(d.formato_detectado) ? d.formato_detectado : 'imagen estática'),
    objetivo: d.objetivo || '',
    angulo: d.angulo || '',
    audiencia: AUDIENCIA_POR_ETAPA[etapaDetectada] || '',
    guion: (d.guion && typeof d.guion === 'object') ? {
      hook: d.guion.hook || '',
      problema: d.guion.problema || '',
      solucion: d.guion.solucion || '',
      prueba: d.guion.prueba || '',
      costo_inaccion: d.guion.costo_inaccion || '',
      cta: d.guion.cta || '',
    } : { hook: '', problema: '', solucion: '', prueba: '', costo_inaccion: '', cta: '' },
    version_15s: d.version_15s || '',
    hooks_alternativos: Array.isArray(d.hooks_alternativos) ? d.hooks_alternativos.filter(Boolean).map((h) => h.toString()) : [],
    visual_sugerido: d.visual_sugerido || '',
    duracion_sugerida: d.duracion_sugerida || '',
    copy_publicacion: d.copy_publicacion || '',
    prompt_imagen: d.prompt_imagen || '',
    prompt_video: d.prompt_video || '',
    caption_whatsapp: d.caption_whatsapp || '',
    titulo_anuncio: d.titulo_anuncio || '',
    descripcion_anuncio: d.descripcion_anuncio || '',
    cta_boton: validarCta(d.cta_boton) || 'Más información',
  };

  await registrarUsoTokens(clienteId, 'generar-anuncios-detalle-imagen', data.usage);
  return res.status(200).json({ detalle, usage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 } });
}

// ---------- modo: targeting (perfil de segmentación sugerido para un Conjunto de Anuncios) ----------

async function manejarModoTargeting(body, res) {
  const clienteId = (body.cliente || DEFAULT_CLIENTE).toString();
  const grupoId = body.grupo_id ? body.grupo_id.toString() : '';
  const productoId = body.producto_id ? body.producto_id.toString() : '';

  const promptFijo = cargarPrompt(PROMPT_PATH_TARGETING);
  const { contexto, catalogo } = await construirContexto(clienteId, grupoId);
  const bloqueProducto = formatearProducto(catalogo, productoId, 'el perfil de targeting debe pensarse para este producto puntual');

  const instruccion = 'INSTRUCCIÓN DE ESTA GENERACIÓN:\n' +
    'Sugiere el perfil de targeting (ubicación, edad, género, intereses) para un Conjunto de Anuncios de Meta Ads, en el formato JSON indicado.' +
    (bloqueProducto ? '\n\n' + bloqueProducto : '');

  const system = [promptFijo, contexto, instruccion].join('\n\n');
  const { ok, status, data } = await llamarClaude(
    system,
    'Sugiere el perfil de targeting pedido, en el formato JSON indicado. Sé breve y concreto en cada campo.',
    600
  );
  if (!ok) {
    return res.status(status).json({ error: data?.error?.message || 'Error al llamar a la API.' });
  }

  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const parsed = extractJson(text);
  if (!parsed) {
    return res.status(502).json({ error: 'No se pudo interpretar la respuesta del modelo.' });
  }

  const perfil = {
    ubicacion: (parsed.ubicacion || '').toString(),
    edad: (parsed.edad || '').toString(),
    genero: (parsed.genero || '').toString(),
    intereses: (parsed.intereses || '').toString(),
  };

  await registrarUsoTokens(clienteId, 'generar-anuncios-targeting', data.usage);
  return res.status(200).json({ perfil, usage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 } });
}

// ---------- modo: completar_meta (rellena Título/Descripción/CTA de anuncios ya desarrollados) ----------
// Backfill de una sola vez para tarjetas creadas antes de que existieran estos 3 campos -- los
// anuncios nuevos ya salen con esto desde el modo "detalle", este modo es solo para ponerse al día.

async function manejarModoCompletarMeta(body, res) {
  const clienteId = (body.cliente || DEFAULT_CLIENTE).toString();
  const grupoId = body.grupo_id ? body.grupo_id.toString() : '';
  const cardsEntrada = Array.isArray(body.cards) ? body.cards : [];

  if (cardsEntrada.length === 0) {
    return res.status(400).json({ error: 'Falta el lote de anuncios a completar.' });
  }
  if (cardsEntrada.length > MAX_CAMPOS_META_POR_LOTE) {
    return res.status(400).json({ error: `Máximo ${MAX_CAMPOS_META_POR_LOTE} anuncios por lote.` });
  }

  const tarjetas = cardsEntrada.map((c, i) => ({
    id: (c && c.id) ? c.id.toString() : `card${i + 1}`,
    titulo: (c && c.titulo) ? c.titulo.toString() : '',
    hook: (c && c.hook) ? c.hook.toString() : '',
    objetivo: (c && c.objetivo) ? c.objetivo.toString() : '',
    cta: (c && c.guion && c.guion.cta) ? c.guion.cta.toString() : '',
    copy_publicacion: (c && c.copy_publicacion) ? c.copy_publicacion.toString() : '',
  }));

  const promptFijo = cargarPrompt(PROMPT_PATH_CAMPOS_META);
  const { contexto } = await construirContexto(clienteId, grupoId);

  const listaAnuncios = tarjetas.map((t, i) =>
    `${i + 1}. id="${t.id}"\n   Título: ${t.titulo}\n   Hook: ${t.hook}\n   Objetivo: ${t.objetivo || 'sin especificar'}\n   CTA del guion: ${t.cta || 'sin especificar'}\n   Copy: ${t.copy_publicacion || '(sin copy)'}`
  ).join('\n');

  const instruccion = 'INSTRUCCIÓN DE ESTA GENERACIÓN:\n' +
    `ANUNCIOS YA DESARROLLADOS A COMPLETAR (${tarjetas.length}):\n${listaAnuncios}`;

  const system = [promptFijo, contexto, instruccion].join('\n\n');
  const { ok, status, data } = await llamarClaude(
    system,
    'Completa titulo_anuncio, descripcion_anuncio y cta_boton de cada anuncio del lote, en el formato JSON (array) indicado, en el mismo orden y con el mismo "id" que recibiste.',
    Math.min(4000, 300 + tarjetas.length * 250)
  );
  if (!ok) {
    return res.status(status).json({ error: data?.error?.message || 'Error al llamar a la API.' });
  }

  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const parsed = extractJsonArray(text);
  if (!parsed || parsed.length === 0) {
    return res.status(502).json({ error: data.stop_reason === 'max_tokens' ? 'La respuesta quedó incompleta. Intenta con menos anuncios por lote.' : 'No se pudo interpretar la respuesta del modelo.' });
  }

  const campos = parsed.map((d, i) => ({
    id: (d && d.id) ? d.id.toString() : (tarjetas[i] ? tarjetas[i].id : `card${i + 1}`),
    titulo_anuncio: (d && d.titulo_anuncio) || '',
    descripcion_anuncio: (d && d.descripcion_anuncio) || '',
    cta_boton: validarCta(d && d.cta_boton) || 'Más información',
  }));

  await registrarUsoTokens(clienteId, 'generar-anuncios-completar-meta', data.usage);
  return res.status(200).json({ campos, usage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 } });
}

// ---------- modo: chat (Consulta en vivo, multi-turno -- desarrolla anuncios conversando) ----------
// Mismo patrón que el modo "pregunta" de api/generar-guion-organico.js: la Messages API no
// guarda estado, así que se manda el historial completo en cada turno. construirContexto() ya
// trae TODO (ADN, las 4 Notas 366 completas, Radar, retroalimentación previa) -- por eso el
// chat "va conociendo" el 366 desde el primer mensaje, no solo lo que se escribe en el chat.

const cargarPromptChat = () => cargarPrompt(PROMPT_PATH_CHAT);

async function manejarModoChat(body, res) {
  const clienteId = (body.cliente || DEFAULT_CLIENTE).toString();
  const grupoId = body.grupo_id ? body.grupo_id.toString() : '';
  const productoId = body.producto_id ? body.producto_id.toString() : '';
  const messagesRaw = Array.isArray(body.messages) ? body.messages : [];
  const historial = messagesRaw
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-CHAT_MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content }));

  if (!historial.length || historial[historial.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'Falta el mensaje del usuario.' });
  }

  const promptFijo = cargarPromptChat();
  const { contexto, catalogo } = await construirContexto(clienteId, grupoId);
  const bloqueProducto = formatearProducto(catalogo, productoId, 'si aplica al anuncio que se está desarrollando en esta conversación');
  const system = [promptFijo, contexto, bloqueProducto].filter(Boolean).join('\n\n');

  const { ok, status, data } = await llamarClaudeConHistorial(system, historial, 1500);
  if (!ok) {
    return res.status(status).json({ error: data?.error?.message || 'Error al llamar a la API.' });
  }

  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  if (!text) {
    return res.status(502).json({ error: 'El Agente no devolvió respuesta. Intenta de nuevo.' });
  }

  await registrarUsoTokens(clienteId, 'generar-anuncios-chat', data.usage);
  return res.status(200).json({ text, usage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 } });
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
    if (modo === 'detalle_imagen') return await manejarModoDetalleImagen(body, res);
    if (modo === 'targeting') return await manejarModoTargeting(body, res);
    if (modo === 'completar_meta') return await manejarModoCompletarMeta(body, res);
    if (modo === 'chat') return await manejarModoChat(body, res);
    return res.status(400).json({ error: 'Falta o es inválido el campo "modo" (usa "ideas", "detalle", "detalle_imagen", "targeting", "completar_meta" o "chat").' });
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
};
