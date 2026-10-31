// Endpoint server-side para el Consultor de Radar de Mercado y Tendencias — multi-tenant.
// Mismo patron que api/jefe-conversion.js: la ANTHROPIC_API_KEY vive solo aqui.
//
// FLUJO HIBRIDO (Chrome extension + web): Instagram/TikTok bloquean la
// navegacion directa por busqueda, asi que ya no se intenta web_search en
// vivo sobre las cuentas guardadas. En vez de eso:
//   1. El cliente arma (sin IA) un prompt para pegar en Claude en Chrome.
//   2. El usuario pega el resultado -> 'diagnostico-general' (sin web_search).
//   3. Analisis por cuenta bajo demanda, extraido de ese mismo texto pegado
//      -> 'analisis-cuenta-guardada' (cacheado en el propio historial).
//   4. Analisis general siempre fresco, combinando el diagnostico + web_search
//      de tendencias de industria (no de las cuentas) -> 'analisis-general'.
//   5. Insights/ideas para Sección 5 vienen en el mismo response de 'analisis-general'.
//
// INVESTIGACIÓN EXTERNA DENTRO DEL HUB (todas terminan en el mismo texto que el paso 2, así que el
// resto del flujo no cambia). Ningún Jefe puede entrar a Instagram/TikTok con una sesión: estas son
// las vías reales, de la más abierta a la más limitada:
//   - 'investigar-web':        Claude busca y lee páginas PÚBLICAS (sitios, YouTube, prensa) con web_search/web_fetch.
//   - 'analisis-capturas':     Claude lee capturas de pantalla que sube la persona (funciona con cualquier red).
//   - 'lectura-automatica':    YouTube es gratis (RSS); Instagram/TikTok/Facebook solo si el servidor tiene
//                              SCRAPECREATORS_API_KEY (proveedor externo de pago, con tope mensual por hub).
//   - 'estado-lectura':        dice qué redes se pueden leer solas en este servidor y cuánto queda del mes.
//   - 'brief-estilo':          convierte el diagnóstico en un brief que Contenido y Anuncios pueden usar.
//   - 'mis-numeros':           ordena las estadísticas de las cuentas PROPIAS (CSV/capturas) para compararlas con los referentes.
//   - 'chat':                  conversación libre del Faro sobre lo que ya hay en el radar.

const fs = require('fs');
const path = require('path');
const { sql } = require('@vercel/postgres');
const { sumarAlMes } = require('./_lib/uso-mensual');
const { revisar: revisarSaldo, cobrar: cobrarSaldo } = require('./_lib/saldo');

const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-radar.md');
const DEFAULT_CLIENTE = 'jefeshub';
const SEPARADOR_INSIGHTS = '---INSIGHTS-Y-IDEAS---';

// Prompt fijo, generico, compartido por todas las marcas -- mismo patron que
// api/jefe-conversion.js. Lo unico que cambia por cliente es el CONTEXTO
// DEL NEGOCIO (construirContexto, mas abajo), cargado en tiempo real desde
// su propio Brand Book en storage. No hay datos de negocio hardcoded aqui,
// y no hace falta un archivo .md por marca para soportar una marca nueva.
let fixedPromptCache = null;
function cargarPromptFijo() {
  if (fixedPromptCache) return fixedPromptCache;
  fixedPromptCache = fs.readFileSync(PROMPT_PATH, 'utf-8');
  return fixedPromptCache;
}

// Rate limit basico en memoria (por IP, best-effort entre invocaciones warm de la misma instancia).
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

// ---------- kv_store helpers (mismo shape que api/storage/[key].js) ----------

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

// window.storage.set(key, JSON.stringify(datos)) hace que api/storage/[key].js
// guarde JSON.stringify(body.value) — es decir, un doble-encode del string ya
// serializado. Replicamos ese mismo shape aqui para que lo que este endpoint
// escribe se pueda seguir leyendo con window.storage.get() desde el cliente.
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
    // Resumen mensual permanente (el registro de arriba solo guarda los últimos 500 usos).
    const keyMes = `${clienteId}:uso-tokens-mensual`;
    await escribirJSON(keyMes, sumarAlMes(await leerJSON(keyMes).catch(() => null), items[items.length - 1]));
    // Descuenta el costo real de esta llamada del tope del hub (api/_lib/saldo.js).
    await cobrarSaldo(clienteId, items[items.length - 1], leerJSON, escribirJSON);
  } catch (err) {
    // No bloquear la respuesta al usuario si falla el registro de uso.
  }
}

function fechaHoy() {
  return new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isoWeekKey(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (err) {
    return null;
  }
}

function extractJsonArray(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    return null;
  }
}

// ---------- historial ({cliente}:radar-historial) ----------
// Entradas mezcladas por 'tipo': 'diagnostico-general' (Sección 2, con cache
// por cuenta en porCuenta) y 'analisis-general' (Sección 4, siempre fresco).

async function leerHistorial(cliente) {
  const items = await leerJSON(`${cliente}:radar-historial`);
  return Array.isArray(items) ? items : [];
}

async function guardarHistorialEntry(cliente, datos, foco) {
  const key = `${cliente}:radar-historial`;
  const items = await leerHistorial(cliente);
  const entry = Object.assign(
    { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), date: fechaHoy(), foco: { id: (foco && foco.id) || 'all', nombre: (foco && foco.nombre) || '' } },
    datos
  );
  items.push(entry);
  // Evita crecimiento sin limite: solo se necesitan las corridas recientes
  // para el historial visible.
  const recortado = items.slice(-30);
  await escribirJSON(key, recortado);
  return entry;
}

// ---------- foco (pastilla de producto/servicio/grupo de arriba, js/jefes-foco.js) ----------
// El navegador manda { id, nombre, esGrupo }. 'all' = ecosistema completo (todo el hub, sin filtrar).
function normalizarFoco(f) {
  const nombre = f && typeof f === 'object' ? String(f.nombre || '').trim().slice(0, 120) : '';
  const id = f && typeof f === 'object' && f.id ? String(f.id).slice(0, 80) : 'all';
  if (!nombre || id === 'all') return { id: 'all', nombre: '', esGrupo: false };
  return { id, nombre, esGrupo: !!f.esGrupo };
}

function lineaFoco(foco) {
  if (!foco || foco.id === 'all') return '';
  const que = foco.esGrupo ? 'el GRUPO' : 'el PRODUCTO O SERVICIO';
  return `FOCO ELEGIDO ARRIBA: la persona eligió ${que} "${foco.nombre}". Todo lo que respondas (patrones, insights, ideas, estilo) debe servir para VENDER ${foco.esGrupo ? 'ese grupo' : 'ese producto o servicio'}, no el negocio en general; no le preguntes cuál es.`;
}

// Un registro del historial pertenece al foco si se hizo con ese foco; con "ecosistema completo" cuenta todo.
// Los registros viejos (sin foco guardado) se consideran del ecosistema completo.
function coincideFoco(entry, focoId) {
  if (!focoId || focoId === 'all') return true;
  return !!(entry && entry.foco && entry.foco.id === focoId);
}

function ultimaEntradaPorTipo(items, tipo, focoId) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].tipo === tipo && coincideFoco(items[i], focoId)) return items[i];
  }
  return null;
}

// ---------- contexto dinamico (Brand Book, lista maestra, historial) ----------

const CONTEXT_CHAR_LIMIT = 6000;

function truncar(str, limite) {
  if (!str) return str;
  return str.length > limite ? str.slice(0, limite) + '\n[...recortado...]' : str;
}

function formatearListaMaestra(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const lineas = items.slice(-40).map((it) => `- [${it.tipo || 'general'}] ${it.text || ''}`);
  return 'Lista maestra del cliente ideal:\n' + lineas.join('\n');
}

function formatearBrandBookCampo(nombre, valor) {
  if (valor == null) return null;
  if (typeof valor === 'object' && Object.keys(valor).length === 0) return null;
  const texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
  if (!texto.trim()) return null;
  return `${nombre}:\n${texto}`;
}

const CAMPOS_LABEL = {
  'brand-book.identidad': 'Identidad de marca',
  'brand-book.tono': 'Tono de comunicación',
  'brand-book.audiencia': 'Audiencia',
  'brand-book.contenido_actual': 'Contenido actual',
};

async function construirContexto(cliente, campos) {
  const valores = await Promise.all(campos.map((campo) => leerJSON(`${cliente}:${campo}`).catch(() => null)));

  const bloques = [];
  campos.forEach((campo, i) => {
    const valor = valores[i];
    if (valor == null) return;
    let bloque = null;
    if (campo === 'lista-maestra-cliente-ideal') bloque = formatearListaMaestra(valor);
    else bloque = formatearBrandBookCampo(CAMPOS_LABEL[campo] || campo, valor);
    if (bloque) bloques.push(bloque);
  });

  if (bloques.length === 0) return '';
  return 'CONTEXTO DEL NEGOCIO (Brand Book y datos guardados):\n' + truncar(bloques.join('\n\n'), CONTEXT_CHAR_LIMIT);
}

// Contexto del negocio + producto en foco + línea de foco, listo para pegar en el prompt.
async function armarContexto(cliente, campos, foco, opciones) {
  const [base, producto, numeros] = await Promise.all([
    construirContexto(cliente, campos).catch(() => ''),
    contextoProductoFoco(cliente, foco).catch(() => ''),
    opciones && opciones.misNumeros ? leerJSON(`${cliente}:radar-mis-numeros`).then((it) => bloqueMisNumeros(it, foco)).catch(() => '') : '',
  ]);
  return [base, producto, numeros, lineaFoco(foco)].filter(Boolean).join('\n\n');
}

// Producto del catálogo del ADN que corresponde al foco (solo nombre, tipo y notas: no se inventan precios).
async function contextoProductoFoco(cliente, foco) {
  if (!foco || foco.id === 'all' || foco.esGrupo) return '';
  const catalogo = await leerJSON(`${cliente}:catalogo-productos`).catch(() => null);
  const p = Array.isArray(catalogo) ? catalogo.find((it) => it && it.id === foco.id) : null;
  if (!p) return '';
  const partes = [p.nombre];
  if (p.tipo) partes.push(p.tipo);
  if (p.notas) partes.push(`notas: ${p.notas}`);
  return 'DATOS DEL PRODUCTO EN FOCO (del ADN):\n- ' + truncar(partes.join(' · '), 600);
}

// ---------- llamada a Claude ----------

async function llamarClaude({ promptCompleto, system, messages, webSearch, webFetch, maxTokens }) {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens || 3000,
    messages: messages || [{ role: 'user', content: promptCompleto }],
  };
  if (system) body.system = system;
  const tools = [];
  if (webSearch) tools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 5 });
  // web_fetch (igual que api/consultor-cierre.js) solo puede abrir URLs que ya vienen escritas en el mensaje.
  if (webFetch) tools.push({ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 4, max_content_tokens: 8000 });
  if (tools.length) body.tools = tools;

  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, status: 500, error: 'Error de conexión con el Agente.' };
  }

  const data = await anthropicRes.json();
  if (!anthropicRes.ok) {
    return { ok: false, status: anthropicRes.status, error: data?.error?.message || 'Error al llamar a la API.' };
  }

  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  if (!text) return { ok: false, status: 502, error: 'Respuesta vacía del modelo.' };
  return { ok: true, text, usage: data.usage };
}

// identificadores: { label, handle, link } — un label genérico como
// "Instagram" (fallback cuando no se llenó "Nombre de cuenta") NO alcanza
// para aislar una cuenta si hay varias de la misma plataforma en el texto
// pegado; el @handle y el link son las señales confiables, porque son
// literalmente lo que el prompt de la Sección 1 le pide a Claude en Chrome
// que use como encabezado de cada bloque ("CUENTA: @usuario").
function instruccionAnalisisCuentaJSON(identificadores, fuenteTexto) {
  const { label, handle, link } = identificadores;
  const senales = [];
  if (handle) senales.push(`el handle ${handle}`);
  if (link) senales.push(`el link ${link}`);
  if (label && label !== handle) senales.push(`el nombre "${label}"`);
  const senalesTexto = senales.length ? senales.join(', ') : `la cuenta "${label}"`;

  return (
    `El siguiente texto pegado fue capturado manualmente de VARIAS cuentas y normalmente trae varios bloques, cada uno empezando con "CUENTA: @algo" (uno por cada cuenta visitada). Tu tarea es encontrar el bloque que corresponde a UNA sola cuenta específica — la que coincide con ${senalesTexto} — y analizar ÚNICAMENTE ese bloque, ignorando todos los demás por completo.\n\n` +
    `Si ningún bloque coincide claramente con esta cuenta específica, NO tomes otro bloque al azar ni inventes datos — responde con accesible:false.\n\n` +
    `TEXTO PEGADO:\n"""\n${fuenteTexto}\n"""\n\n` +
    `Detecta patrones (sin copiar) y responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional antes ni después, con este formato exacto:\n` +
    `{"accesible": true, "tipo_de_contenido": "...", "frecuencia": "...", "temas": ["..."], "hooks": ["..."], "formatos": ["..."], "que_funciona": "...", "que_aprender": "...", "que_no_copiar": "...", "que_adaptar": "...", "objecion_o_deseo": "..."}\n` +
    `El campo "objecion_o_deseo" debe decir qué objeción o deseo del cliente ideal conecta con esta cuenta — usa la lista maestra del contexto de abajo si está disponible (di cuál objeción/deseo ya registrado coincide); si no hay coincidencia clara, describe la objeción o deseo que sí detectes, o deja "" si no aplica.\n` +
    `Si la cuenta no aparece en el texto o no hay suficiente información, responde exactamente:\n` +
    `{"accesible": false, "tipo_de_contenido": "", "frecuencia": "", "temas": [], "hooks": [], "formatos": [], "que_funciona": "", "que_aprender": "", "que_no_copiar": "", "que_adaptar": "", "objecion_o_deseo": ""}`
  );
}

// "Análisis de contenido específico" (Otros modos, Modo 2) — pieza puntual,
// no una cuenta completa. Exige explícitamente cómo se adapta a la marca.
function instruccionAnalisisContenidoJSON(link, contenidoPegado) {
  return (
    `Analiza esta pieza de contenido específica (link: ${link}), a partir del siguiente texto pegado manualmente ` +
    `(capturado por el usuario desde Chrome, sin web_search).\n\nCONTENIDO PEGADO:\n"""\n${contenidoPegado}\n"""\n\n` +
    'Detecta el patrón (sin copiar) y responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional antes ni después, con este formato exacto:\n' +
    '{"accesible": true, "hook": "...", "estructura": "...", "tema": "...", "formato": "...", "emocion_o_deseo": "...", "que_funciona": "...", "que_no_copiar": "...", "como_adaptarlo_a_la_marca": "..."}\n' +
    'El campo "como_adaptarlo_a_la_marca" debe conectar explícitamente el patrón detectado con la marca del negocio, usando el contexto del Brand Book de abajo si está disponible.\n' +
    'Si no hay suficiente información en el texto pegado, responde exactamente:\n' +
    '{"accesible": false, "hook": "", "estructura": "", "tema": "", "formato": "", "emocion_o_deseo": "", "que_funciona": "", "que_no_copiar": "", "como_adaptarlo_a_la_marca": ""}'
  );
}

// ---------- handlers de flujo hibrido ----------

async function handleDiagnosticoGeneral(req, res, clienteId, systemPrompt) {
  const textoPegado = ((req.body && req.body.extra) || '').toString().trim();
  if (!textoPegado) return res.status(400).json({ error: 'Falta el texto pegado.' });
  const foco = normalizarFoco(req.body && req.body.foco);

  const contexto = await armarContexto(clienteId, [
    'brand-book.identidad',
    'brand-book.tono',
    'brand-book.audiencia',
    'brand-book.contenido_actual',
    'lista-maestra-cliente-ideal',
  ], foco, { misNumeros: true });

  const instruccion =
    'Analiza el siguiente texto, que contiene datos extraídos manualmente de varias cuentas de referencia ' +
    '(capturado por el usuario desde Instagram/TikTok con su propia sesión). Da un DIAGNÓSTICO GENERAL sobre ' +
    'el conjunto completo — NO lo desgloses cuenta por cuenta todavía: temas que se repiten, hooks que funcionan, ' +
    'formatos usados, qué aprender, qué NO copiar (señala explícitamente cualquier práctica de presión falsa, ' +
    'manipulación o promesa exagerada que no se debe imitar), y qué adaptar a nuestro negocio.\n\n' +
    'Si detectas objeciones o deseos del cliente que se repiten entre las cuentas, señálalos explícitamente y ' +
    'cruza cada uno contra la lista maestra del cliente ideal (abajo, si está disponible) — di si confirman una ' +
    'objeción/deseo ya registrado o si es una señal nueva.\n\n' +
    'Si el texto marca alguna cuenta como "🔒 no accesible", no la analices — solo continúa con las que sí ' +
    `tienen datos.\n\nTEXTO PEGADO:\n"""\n${textoPegado}\n"""`;

  const promptCompleto = [systemPrompt, contexto, instruccion].filter(Boolean).join('\n\n');
  const r = await llamarClaude({ promptCompleto, webSearch: false });
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
  await registrarUsoTokens(clienteId, 'consultor-radar-diagnostico-general', r.usage);

  try {
    await guardarHistorialEntry(clienteId, {
      tipo: 'diagnostico-general',
      textoPegado,
      diagnostico: r.text,
      porCuenta: {},
    }, foco);
  } catch (err) {
    // No bloquear la respuesta al usuario si falla el guardado del historial.
  }

  return res.status(200).json({ text: r.text });
}

async function handleAnalisisCuentaGuardada(req, res, clienteId, systemPrompt) {
  const accountId = ((req.body && req.body.accountId) || '').toString();
  const accountLabel = ((req.body && req.body.accountLabel) || accountId).toString();
  const accountHandle = ((req.body && req.body.accountHandle) || '').toString().trim();
  const accountLink = ((req.body && req.body.accountLink) || '').toString().trim();
  if (!accountId) return res.status(400).json({ error: 'Falta accountId.' });

  const foco = normalizarFoco(req.body && req.body.foco);
  const key = `${clienteId}:radar-historial`;
  const items = await leerHistorial(clienteId);
  const entry = ultimaEntradaPorTipo(items, 'diagnostico-general', foco.id);
  if (!entry) {
    return res.status(400).json({ error: 'Genera el diagnóstico general primero (pasos 2 y 3).' });
  }

  const contexto = await armarContexto(clienteId, ['brand-book.identidad', 'brand-book.tono', 'brand-book.audiencia', 'lista-maestra-cliente-ideal'], foco);
  const instruccion = instruccionAnalisisCuentaJSON({ label: accountLabel, handle: accountHandle, link: accountLink }, entry.textoPegado);
  const promptCompleto = [systemPrompt, contexto, instruccion].filter(Boolean).join('\n\n');

  const r = await llamarClaude({ promptCompleto, webSearch: false });
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
  await registrarUsoTokens(clienteId, 'consultor-radar-analisis-cuenta', r.usage);

  const parsed = extractJson(r.text);
  const resultado = { data: parsed, raw: r.text, date: fechaHoy() };

  try {
    entry.porCuenta = entry.porCuenta || {};
    entry.porCuenta[accountId] = resultado;
    await escribirJSON(key, items);
  } catch (err) {
    // No bloquear la respuesta al usuario si falla el guardado del cache.
  }

  return res.status(200).json(resultado);
}

// "Análisis de contenido específico" (Otros modos, Modo 2) — link a una
// pieza puntual + texto pegado desde Chrome (mismo patrón que Secciones 1/2,
// a escala de una sola pieza).
async function handleAnalisisContenido(req, res, clienteId, systemPrompt) {
  const link = ((req.body && req.body.link) || '').toString().trim();
  const contenidoPegado = ((req.body && req.body.contenidoPegado) || '').toString().trim();
  if (!link || !contenidoPegado) {
    return res.status(400).json({ error: 'Falta el link o el contenido pegado.' });
  }

  const foco = normalizarFoco(req.body && req.body.foco);
  const contexto = await armarContexto(clienteId, ['brand-book.identidad', 'brand-book.tono', 'brand-book.audiencia'], foco);
  const instruccion = instruccionAnalisisContenidoJSON(link, contenidoPegado);
  const promptCompleto = [systemPrompt, contexto, instruccion].filter(Boolean).join('\n\n');

  const r = await llamarClaude({ promptCompleto, webSearch: false });
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
  await registrarUsoTokens(clienteId, 'consultor-radar-analisis-contenido', r.usage);

  const parsed = extractJson(r.text);
  return res.status(200).json({ data: parsed, raw: r.text });
}

async function handleAnalisisGeneral(req, res, clienteId, systemPrompt) {
  const foco = normalizarFoco(req.body && req.body.foco);
  const items = await leerHistorial(clienteId);
  const diagEntry = ultimaEntradaPorTipo(items, 'diagnostico-general', foco.id);
  if (!diagEntry) {
    return res.status(400).json({ error: 'Genera el diagnóstico general primero (pasos 2 y 3).' });
  }

  const contexto = await armarContexto(clienteId, [
    'brand-book.identidad',
    'brand-book.tono',
    'brand-book.audiencia',
    'brand-book.contenido_actual',
    'lista-maestra-cliente-ideal',
  ], foco, { misNumeros: true });

  // Las 10 ideas accionables ya NO se piden aquí — se generan aparte, bajo
  // demanda, en 'ideas-accionables' (botón de la Sección 5) para no gastar
  // tokens si el usuario solo quería ver los insights.
  const instruccion =
    'Genera el ANÁLISIS GENERAL de la semana. Combina:\n' +
    '1) El diagnóstico general ya calculado sobre las cuentas de referencia (abajo, en DIAGNÓSTICO PREVIO).\n' +
    '2) Una búsqueda fresca con web_search sobre tendencias ACTUALES de la industria/tema de este negocio — ' +
    'no busques en las cuentas de referencia, busca tendencias generales del nicho.\n' +
    '3) El contexto del Brand Book (abajo, si está disponible).\n\n' +
    `Entrega tu respuesta en DOS bloques, separados exactamente por esta línea sola (nada más en esa línea): ${SEPARADOR_INSIGHTS}\n\n` +
    'BLOQUE 1 — responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional antes ni después, con este formato exacto. ' +
    'TODOS los campos son arreglos de puntos clave CORTOS (máximo ~12 palabras cada uno) — nunca un párrafo largo de prosa, ni siquiera en "que_funciona":\n' +
    '{"que_funciona": ["...", "..."], "hooks_que_se_repiten": ["...", "..."], "formatos_que_usan": ["...", "..."], "temas_que_ganan_atencion": ["...", "..."], "ideas_adaptar_semana": ["...", "..."]}\n\n' +
    'BLOQUE 2 — responde ÚNICAMENTE con un arreglo JSON de exactamente 5 objetos (sin texto adicional antes ni después), ' +
    'cada uno un insight principal breve y accionable, en orden de prioridad, con este formato exacto: ' +
    '{"insight": "insight breve y accionable", "uso": "orgánico | ads | ambos", "prioridad": "alta | media | baja"}. ' +
    'Arreglo completo: [{"insight": "...", "uso": "...", "prioridad": "..."}, ...] — exactamente 5 elementos.\n\n' +
    `DIAGNÓSTICO PREVIO:\n"""\n${diagEntry.diagnostico}\n"""`;

  const promptCompleto = [systemPrompt, contexto, instruccion].filter(Boolean).join('\n\n');
  const r = await llamarClaude({ promptCompleto, webSearch: true, maxTokens: 2600 });
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
  await registrarUsoTokens(clienteId, 'consultor-radar-analisis-general', r.usage);

  const partes = r.text.split(SEPARADOR_INSIGHTS);
  const analisisRaw = (partes[0] || '').trim();
  const insightsRaw = (partes[1] || '').trim();
  const analisisData = extractJson(analisisRaw);
  const insights = extractJsonArray(insightsRaw);
  const isoWeek = isoWeekKey(new Date());

  let entryGuardada = null;
  try {
    entryGuardada = await guardarHistorialEntry(clienteId, {
      tipo: 'analisis-general',
      isoWeek,
      analisisData,
      analisisRaw,
      insights,
      insightsRaw,
      ideas: null,
    }, foco);
  } catch (err) {
    // No bloquear la respuesta al usuario si falla el guardado del historial.
  }

  return res.status(200).json({ analisisData, analisisRaw, insights, insightsRaw, isoWeek, date: entryGuardada && entryGuardada.date });
}

async function handleIdeasAccionables(req, res, clienteId, systemPrompt) {
  const foco = normalizarFoco(req.body && req.body.foco);
  const key = `${clienteId}:radar-historial`;
  const items = await leerHistorial(clienteId);
  let idx = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].tipo === 'analisis-general' && coincideFoco(items[i], foco.id)) { idx = i; break; }
  }
  if (idx === -1) {
    return res.status(400).json({ error: 'Genera el análisis general primero (paso 4).' });
  }
  const entry = items[idx];
  // Array.isArray(entry.ideas) && length===0 significa que un intento anterior
  // no logro parsear el JSON del modelo (ver mas abajo) — un arreglo vacio es
  // "truthy" en JS, asi que sin este chequeo explicito nunca se reintentaria.
  const yaCalculado = Array.isArray(entry.ideas) ? entry.ideas.length > 0 : !!entry.ideas;
  if (yaCalculado) {
    return res.status(200).json({ ideas: entry.ideas, ideasRaw: entry.ideasRaw });
  }

  const contexto = await armarContexto(clienteId, ['brand-book.identidad', 'brand-book.tono', 'brand-book.audiencia', 'lista-maestra-cliente-ideal'], foco);
  const instruccion =
    'A partir del análisis general y los insights ya generados (abajo), da EXACTAMENTE 10 ideas de contenido accionables. ' +
    'Responde ÚNICAMENTE con un arreglo JSON de exactamente 10 objetos, sin texto adicional antes ni después, con este formato exacto:\n' +
    '{"idea": "idea principal", "angulo": "ángulo", "hook": "hook posible", "formato": "formato recomendado", "uso": "orgánico | ads | ambos", "porque": "por qué funciona para el cliente ideal"}\n' +
    'Arreglo completo: [{"idea": "...", "angulo": "...", "hook": "...", "formato": "...", "uso": "...", "porque": "..."}, ...] — exactamente 10 elementos.\n\n' +
    `ANÁLISIS GENERAL:\n"""\n${entry.analisisRaw || ''}\n"""\n\nINSIGHTS:\n"""\n${JSON.stringify(entry.insights || [])}\n"""`;
  const promptCompleto = [systemPrompt, contexto, instruccion].filter(Boolean).join('\n\n');
  const r = await llamarClaude({ promptCompleto, webSearch: false, maxTokens: 2200 });
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
  await registrarUsoTokens(clienteId, 'consultor-radar-ideas-accionables', r.usage);

  const ideas = extractJsonArray(r.text) || [];

  try {
    entry.ideas = ideas;
    entry.ideasRaw = r.text;
    await escribirJSON(key, items);
  } catch (err) {
    // No bloquear la respuesta al usuario si falla el guardado del cache.
  }

  return res.status(200).json({ ideas, ideasRaw: r.text });
}

// ---------- lectura automática de cuentas (YouTube gratis; Instagram/TikTok/Facebook con proveedor externo) ----------
// Instagram y TikTok no dejan leer un perfil sin iniciar sesión (verificado: muro de login / captcha), así que
// leerlos solos solo es posible con un proveedor externo de pago (ScrapeCreators). Va APAGADO por defecto:
// se activa con la variable SCRAPECREATORS_API_KEY del servidor y tiene un tope mensual por hub
// (RADAR_LECTURA_MAX_MES, 60 lecturas por defecto) para que un hub no se gaste los créditos de todos.
// El resultado sale en el mismo texto que le pedimos a Claude en Chrome ("CUENTA: @usuario ..."), así que
// entra al mismo diagnóstico sin cambiar nada más.

const LECTURA_MAX_MES_DEFAULT = 60;
const MAX_POSTS_LECTURA = 8;
const REDES_CON_PROVEEDOR = ['instagram', 'tiktok', 'facebook'];
const NOMBRE_RED = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', youtube: 'YouTube' };

function lecturaLimiteMes() {
  const n = Number(process.env.RADAR_LECTURA_MAX_MES);
  return Number.isFinite(n) && n > 0 ? n : LECTURA_MAX_MES_DEFAULT;
}

function proveedorActivo() {
  return !!process.env.SCRAPECREATORS_API_KEY;
}

function mesActual() {
  return new Date().toISOString().slice(0, 7);
}

async function leerUsoLectura(cliente) {
  const doc = await leerJSON(`${cliente}:radar-lectura-uso`).catch(() => null);
  return doc && doc.mes === mesActual() ? Number(doc.usadas) || 0 : 0;
}

// De un link de perfil saca la red y el usuario. null = no es un perfil que se pueda leer.
function analizarLinkRed(link) {
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(link) ? link : 'https://' + link);
  } catch (err) {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const segs = u.pathname.split('/').filter(Boolean);
  if (host.endsWith('instagram.com')) {
    const h = (segs[0] || '').replace(/^@/, '');
    if (!h || ['p', 'reel', 'reels', 'explore', 'stories', 'tv'].includes(h.toLowerCase())) return null;
    return { red: 'instagram', handle: h };
  }
  if (host.endsWith('tiktok.com')) {
    const h = segs.find((x) => x.startsWith('@'));
    return h && h.length > 1 ? { red: 'tiktok', handle: h.slice(1) } : null;
  }
  if (host.endsWith('facebook.com') || host === 'fb.com') {
    if (!segs.length) return null;
    if (segs[0] === 'profile.php') {
      const id = u.searchParams.get('id');
      return id ? { red: 'facebook', handle: id, url: `https://www.facebook.com/profile.php?id=${id}` } : null;
    }
    return { red: 'facebook', handle: segs[0], url: `https://www.facebook.com/${segs[0]}` };
  }
  if (host.endsWith('youtube.com')) {
    const primero = segs[0] || '';
    if (primero.startsWith('@')) return { red: 'youtube', handle: primero.slice(1) };
    if (primero === 'channel' && segs[1]) return { red: 'youtube', handle: segs[1], channelId: segs[1] };
    if ((primero === 'c' || primero === 'user') && segs[1]) return { red: 'youtube', handle: segs[1], ruta: `${primero}/${segs[1]}` };
    return null;
  }
  return null;
}

function numeroMx(n) {
  return n != null && Number.isFinite(Number(n)) ? Number(n).toLocaleString('es-MX') : null;
}

function fechaISO(seg) {
  const n = Number(seg);
  return n > 0 ? new Date(n * 1000).toISOString().slice(0, 10) : '';
}

function promedioEntero(valores) {
  const v = valores.map(Number).filter((n) => Number.isFinite(n));
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

function frecuenciaPosts(posts) {
  const f = posts.map((p) => Number(p.fecha)).filter((n) => n > 0).sort((a, b) => a - b);
  if (f.length < 2) return '';
  const dias = (f[f.length - 1] - f[0]) / 86400;
  if (dias < 1) return `${f.length} publicaciones en menos de un día`;
  const porSemana = ((f.length - 1) / dias) * 7;
  return `aprox. ${porSemana.toFixed(1)} publicaciones por semana (${f.length} revisadas, del ${fechaISO(f[0])} al ${fechaISO(f[f.length - 1])})`;
}

function primeraLinea(texto, max) {
  const l = String(texto || '').split(/\n/).map((x) => x.trim()).find(Boolean) || '';
  return l.length > max ? l.slice(0, max).trim() + '…' : l;
}

// Un bloque con los mismos encabezados que el prompt de la Sección 1 (lo que ya sabe leer el diagnóstico).
function bloqueDeCuenta({ handle, red, posts, comentarios }) {
  const lineas = [`CUENTA: @${handle}`, `FUENTE: lectura automática de ${NOMBRE_RED[red]} (datos públicos del perfil; ningún usuario inició sesión)`];
  const freq = frecuenciaPosts(posts);
  if (freq) lineas.push(`CADA CUÁNTO PUBLICAN: ${freq}`);

  const tipos = {};
  posts.forEach((p) => { if (p.tipo) tipos[p.tipo] = (tipos[p.tipo] || 0) + 1; });
  const formatos = Object.keys(tipos).map((t) => `${t} x${tipos[t]}`).join(', ');
  if (formatos) lineas.push(`FORMATOS USADOS: ${formatos}`);

  const prom = [
    ['me gusta', promedioEntero(posts.map((p) => p.likes))],
    ['comentarios', promedioEntero(posts.map((p) => p.comentarios))],
    ['vistas', promedioEntero(posts.map((p) => p.vistas))],
  ].filter(([, v]) => v != null).map(([k, v]) => `${numeroMx(v)} ${k}`);
  lineas.push(`ENGAGEMENT VISIBLE: ${prom.length ? 'promedio por publicación: ' + prom.join(', ') : 'no disponible'}`);

  const hooks = posts.map((p) => primeraLinea(p.texto, 140)).filter(Boolean);
  lineas.push('HOOKS USADOS (uno por post):');
  lineas.push(...(hooks.length ? hooks.map((h) => `- ${h}`) : ['- (los posts no traen texto)']));

  lineas.push('CAPTIONS COMPLETOS de los posts revisados:');
  posts.forEach((p, i) => {
    const datos = [fechaISO(p.fecha), p.tipo, numeroMx(p.likes) != null ? `${numeroMx(p.likes)} me gusta` : '', numeroMx(p.comentarios) != null ? `${numeroMx(p.comentarios)} comentarios` : '', numeroMx(p.vistas) != null ? `${numeroMx(p.vistas)} vistas` : ''].filter(Boolean).join(' · ');
    const texto = String(p.texto || '').replace(/\s+/g, ' ').trim().slice(0, 800);
    lineas.push(`${i + 1}) [${datos}] ${texto || '(sin texto)'}`);
  });

  lineas.push(`COMENTARIOS DESTACADOS del público: ${comentarios && comentarios.length ? comentarios.map((c) => `"${String(c).replace(/\s+/g, ' ').slice(0, 200)}"`).join(' | ') : 'no disponible en la lectura automática'}`);
  return lineas.join('\n');
}

function normalizarPostsInstagram(data) {
  const items = (data && (data.items || (data.data && data.data.items))) || [];
  return items.slice(0, MAX_POSTS_LECTURA).map((it) => ({
    fecha: it.taken_at || (it.created_at ? Date.parse(it.created_at) / 1000 : 0),
    texto: (it.caption && it.caption.text) || '',
    likes: it.like_count,
    comentarios: it.comment_count,
    vistas: it.play_count != null ? it.play_count : it.ig_play_count,
    tipo: it.product_type === 'clips' ? 'reel' : it.media_type === 8 ? 'carrusel' : it.media_type === 2 ? 'video' : 'imagen',
  }));
}

function normalizarPostsTikTok(data) {
  const items = (data && data.aweme_list) || [];
  return items.slice(0, MAX_POSTS_LECTURA).map((it) => {
    const st = it.statistics || {};
    return { fecha: it.create_time, texto: it.desc || '', likes: st.digg_count, comentarios: st.comment_count, vistas: st.play_count, tipo: 'video' };
  });
}

function normalizarPostsFacebook(data) {
  const items = (data && data.posts) || [];
  return items.slice(0, MAX_POSTS_LECTURA).map((it) => ({
    fecha: it.publishTime,
    texto: it.text || '',
    likes: it.reactionCount,
    comentarios: it.commentCount,
    vistas: it.videoViewCount,
    tipo: it.videoDetails ? 'video' : 'publicación',
    top: (Array.isArray(it.topComments) ? it.topComments : []).slice(0, 2).map((c) => (c && (c.text || c.body || c.message)) || '').filter(Boolean),
  }));
}

async function fetchConTiempo(url, opciones, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 20000);
  try {
    return await fetch(url, Object.assign({}, opciones, { signal: ctrl.signal }));
  } finally {
    clearTimeout(t);
  }
}

// Llamada al proveedor. Devuelve { ok, data } o { ok:false, error } con un motivo corto en español.
async function pedirAlProveedor(ruta, params) {
  try {
    const r = await fetchConTiempo(`https://api.scrapecreators.com${ruta}?${new URLSearchParams(params).toString()}`, { headers: { 'x-api-key': process.env.SCRAPECREATORS_API_KEY } }, 25000);
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      const motivo = r.status === 401 || r.status === 403 ? 'el servicio de lectura rechazó la llave (revisa SCRAPECREATORS_API_KEY)' : r.status === 402 ? 'se acabaron los créditos del servicio de lectura' : r.status === 404 ? 'la cuenta no existe o es privada' : `el servicio de lectura respondió ${r.status}`;
      return { ok: false, error: motivo };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err && err.name === 'AbortError' ? 'el servicio de lectura tardó demasiado' : 'no hubo conexión con el servicio de lectura' };
  }
}

function decodificarXml(t) {
  return String(t || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function leerRssYouTube(xml) {
  const entradas = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entradas.slice(0, MAX_POSTS_LECTURA).map((e) => {
    const tag = (n) => {
      const m = e.match(new RegExp('<' + n + '[^>]*>([\\s\\S]*?)</' + n + '>'));
      return m ? decodificarXml(m[1]).trim() : '';
    };
    const vistas = e.match(/<media:statistics views="(\d+)"/);
    const likes = e.match(/<media:starRating count="(\d+)"/);
    const titulo = tag('title');
    const descripcion = tag('media:description').replace(/\s+/g, ' ').slice(0, 400);
    return {
      fecha: Date.parse(tag('published')) / 1000,
      texto: descripcion ? `${titulo} — ${descripcion}` : titulo,
      likes: likes ? Number(likes[1]) : null,
      vistas: vistas ? Number(vistas[1]) : null,
      tipo: 'video',
    };
  });
}

// YouTube no necesita proveedor: cada canal publica su RSS abierto.
async function leerYouTube(info) {
  const cab = { 'User-Agent': 'Mozilla/5.0 (compatible; JefesHubFaro/1.0)', 'Accept-Language': 'es-MX,es;q=0.9' };
  try {
    let id = info.channelId;
    if (!id) {
      const pag = await fetchConTiempo(`https://www.youtube.com/${info.ruta || '@' + info.handle}`, { headers: cab }, 15000);
      if (!pag.ok) return { ok: false, error: 'no se pudo abrir el canal de YouTube' };
      const html = await pag.text();
      // "externalId" y el link canónico son el canal de la página; "channelId" suelto puede ser de un canal relacionado.
      const m = html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/);
      if (!m) return { ok: false, error: 'no se encontró el canal de YouTube' };
      id = m[1];
    }
    const rss = await fetchConTiempo(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, { headers: cab }, 15000);
    if (!rss.ok) return { ok: false, error: 'el canal de YouTube no tiene lista pública de videos' };
    const posts = leerRssYouTube(await rss.text());
    return posts.length ? { ok: true, posts } : { ok: false, error: 'el canal no tiene videos recientes' };
  } catch (err) {
    return { ok: false, error: 'no se pudo leer YouTube' };
  }
}

// Lee UNA cuenta. { ok, texto } | { ok:false, motivo, cobrada }
async function leerCuentaAutomatica(info) {
  if (info.red === 'youtube') {
    const r = await leerYouTube(info);
    return r.ok ? { ok: true, texto: bloqueDeCuenta({ handle: info.handle, red: 'youtube', posts: r.posts }) } : { ok: false, motivo: r.error };
  }
  let r;
  let posts;
  let comentarios = [];
  if (info.red === 'instagram') {
    r = await pedirAlProveedor('/v2/instagram/user/posts', { handle: info.handle });
    if (r.ok) posts = normalizarPostsInstagram(r.data);
  } else if (info.red === 'tiktok') {
    r = await pedirAlProveedor('/v3/tiktok/profile/videos', { handle: info.handle, sort_by: 'latest' });
    if (r.ok) posts = normalizarPostsTikTok(r.data);
  } else {
    r = await pedirAlProveedor('/v1/facebook/profile/posts', { url: info.url });
    if (r.ok) {
      posts = normalizarPostsFacebook(r.data);
      comentarios = posts.flatMap((p) => p.top || []).slice(0, 4);
    }
  }
  if (!r.ok) return { ok: false, motivo: r.error };
  if (!posts.length) return { ok: false, motivo: 'la cuenta no tiene publicaciones visibles', cobrada: true };
  return { ok: true, cobrada: true, texto: bloqueDeCuenta({ handle: info.handle, red: info.red, posts, comentarios }) };
}

async function handleEstadoLectura(req, res, clienteId) {
  const usadas = await leerUsoLectura(clienteId);
  const prov = proveedorActivo();
  return res.status(200).json({
    redes: { youtube: true, instagram: prov, tiktok: prov, facebook: prov },
    usadas,
    limite: lecturaLimiteMes(),
  });
}

async function handleLecturaAutomatica(req, res, clienteId) {
  const entrada = Array.isArray(req.body && req.body.cuentas) ? req.body.cuentas.slice(0, 10) : [];
  const links = entrada.map((c) => (c && typeof c === 'object' ? c.link : c)).map((l) => String(l || '').trim()).filter(Boolean);
  if (!links.length) return res.status(400).json({ error: 'Agrega al menos una cuenta en "Tus referentes" para leerla.' });

  const prov = proveedorActivo();
  const plan = links.map((link) => {
    const info = analizarLinkRed(link);
    if (!info) return { link, motivo: 'ese link no es de un perfil que se pueda leer (usa el link del perfil, no de una publicación)' };
    if (REDES_CON_PROVEEDOR.includes(info.red) && !prov) return { link, info, motivo: `la lectura automática de ${NOMBRE_RED[info.red]} no está activada en tu plataforma` };
    return { link, info };
  });

  const usadas = await leerUsoLectura(clienteId);
  const limite = lecturaLimiteMes();
  const aCobrar = plan.filter((p) => p.info && REDES_CON_PROVEEDOR.includes(p.info.red)).length;
  if (aCobrar && usadas + aCobrar > limite) {
    return res.status(429).json({ error: `Este mes ya usaste ${usadas} de ${limite} lecturas automáticas y esta lectura necesita ${aCobrar} más. Mientras tanto puedes subir capturas o pegar el texto.`, usadas, limite });
  }

  const resultados = await Promise.all(plan.map(async (p) => {
    if (!p.info || p.motivo) return { link: p.link, handle: p.info ? p.info.handle : '', red: p.info ? p.info.red : '', ok: false, motivo: p.motivo };
    const r = await leerCuentaAutomatica(p.info);
    return Object.assign({ link: p.link, handle: p.info.handle, red: p.info.red }, r);
  }));

  const cobradas = resultados.filter((r) => r.cobrada).length;
  let usadasFinal = usadas;
  if (cobradas) {
    usadasFinal = usadas + cobradas;
    try {
      await escribirJSON(`${clienteId}:radar-lectura-uso`, { mes: mesActual(), usadas: usadasFinal });
    } catch (err) {
      // No bloquear la lectura si falla el contador.
    }
  }

  const bloques = resultados.map((r) => (r.ok ? r.texto : `🔒 ${r.handle ? '@' + r.handle : r.link} — no accesible (${r.motivo})`));
  return res.status(200).json({
    texto: bloques.join('\n---\n'),
    resultados: resultados.map((r) => ({ link: r.link, handle: r.handle || '', red: r.red || '', ok: !!r.ok, motivo: r.motivo || '' })),
    leidas: resultados.filter((r) => r.ok).length,
    usadas: usadasFinal,
    limite,
  });
}

// ---------- investigación externa con Claude (web pública y capturas) ----------

const FORMATO_BLOQUE_CUENTA =
  '---\n' +
  'CUENTA: @usuario (o nombre de la marca/persona)\n' +
  'FUENTE: qué páginas o capturas viste de verdad\n' +
  'TIPO DE CUENTA/NICHO:\n' +
  'CADA CUÁNTO PUBLICAN (frecuencia estimada):\n' +
  'TIPO DE CONTENIDO QUE PUBLICA:\n' +
  'TEMAS QUE REPITE:\n' +
  'HOOKS USADOS (uno por post):\n' +
  'FORMATOS USADOS:\n' +
  'ENGAGEMENT VISIBLE:\n' +
  'CAPTIONS COMPLETOS de los posts revisados:\n' +
  'COMENTARIOS DESTACADOS del público:\n' +
  '---';

function listaLinks(links) {
  return (Array.isArray(links) ? links : []).map((l) => String(l || '').trim()).filter(Boolean).slice(0, 10);
}

// Investiga en la web PÚBLICA (sitios, YouTube, prensa). No entra a Instagram/TikTok: ahí pide login.
async function handleInvestigarWeb(req, res, clienteId, systemPrompt) {
  const consulta = ((req.body && req.body.consulta) || '').toString().trim().slice(0, 1500);
  const links = listaLinks(req.body && req.body.links);
  if (!consulta && !links.length) return res.status(400).json({ error: 'Escribe a quién quieres investigar o agrega cuentas en "Tus referentes".' });
  const foco = normalizarFoco(req.body && req.body.foco);

  const contexto = await armarContexto(clienteId, ['brand-book.identidad', 'brand-book.tono', 'brand-book.audiencia', 'lista-maestra-cliente-ideal'], foco);
  const instruccion =
    'INVESTIGACIÓN EXTERNA EN LA WEB PÚBLICA. Usa web_search y web_fetch para investigar a estas personas, marcas o cuentas de referencia (competencia, o gente en la que la persona quiere inspirarse):\n' +
    (links.length ? links.map((l) => `- ${l}`).join('\n') + '\n' : '') +
    (consulta ? `Además, esto es lo que pidió la persona: """${consulta}"""\n` : '') +
    '\nReglas:\n' +
    '1. Reporta SOLO lo que viste de verdad en una página que abriste o en los resultados de búsqueda. Nada inventado ni "lo que seguramente publican".\n' +
    '2. Instagram, TikTok y Facebook casi siempre piden iniciar sesión y no se pueden leer así: no insistas en abrirlos. Busca en cambio su sitio web, su canal de YouTube, entrevistas, prensa, blogs y resultados de búsqueda que citen o describan sus publicaciones. Si de una cuenta no encontraste nada útil, escribe solo "🔒 @cuenta — no accesible" y sigue con la siguiente.\n' +
    '3. Para cada uno que SÍ tenga datos, entrega un bloque con este formato exacto (en FUENTE pon las páginas reales que viste; si un campo no lo pudiste ver, escribe "no se vio"):\n' + FORMATO_BLOQUE_CUENTA + '\n' +
    '4. No copies frases ni guiones completos: describe patrones.\n' +
    '5. Al final agrega una línea "FUENTES:" con las direcciones web que usaste.\n' +
    'Entrega todo en un solo bloque de texto que se pueda copiar y pegar tal cual, sin saludos ni explicaciones técnicas.';

  const promptCompleto = [systemPrompt, contexto, instruccion].filter(Boolean).join('\n\n');
  const r = await llamarClaude({ promptCompleto, webSearch: true, webFetch: true, maxTokens: 3800 });
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
  await registrarUsoTokens(clienteId, 'consultor-radar-investigar-web', r.usage);
  return res.status(200).json({ texto: r.text });
}

const TIPOS_IMAGEN = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGENES = 6;
// Vercel acepta cuerpos de hasta ~4.5 MB; el navegador reduce cada captura antes de mandarla.
const MAX_BASE64_TOTAL = 4000000;

// Lee capturas de pantalla (perfil, publicaciones, comentarios) y las pasa al mismo texto del paso 2.
async function handleAnalisisCapturas(req, res, clienteId, systemPrompt) {
  const bruto = Array.isArray(req.body && req.body.imagenes) ? req.body.imagenes : [];
  const imagenes = bruto
    .filter((i) => i && TIPOS_IMAGEN.has(i.media_type) && typeof i.data === 'string' && i.data.length > 100)
    .slice(0, MAX_IMAGENES);
  if (!imagenes.length) return res.status(400).json({ error: 'Sube al menos una captura (JPG, PNG o WEBP).' });
  if (imagenes.reduce((a, i) => a + i.data.length, 0) > MAX_BASE64_TOTAL) {
    return res.status(413).json({ error: 'Las capturas pesan demasiado juntas. Sube menos capturas a la vez.' });
  }
  const nota = ((req.body && req.body.nota) || '').toString().trim().slice(0, 500);

  const instruccion =
    'Estas son capturas de pantalla de perfiles, publicaciones o comentarios de redes sociales que subió la persona para su investigación de referentes' +
    (nota ? ` (nota de la persona: "${nota}")` : '') + '. ' +
    'Transcribe SOLO lo que se ve en las capturas, con este formato exacto, un bloque por cuenta (junta las capturas de una misma cuenta en un solo bloque):\n' + FORMATO_BLOQUE_CUENTA + '\n' +
    'Reglas: en FUENTE escribe "captura de pantalla subida por la persona". Si un dato no se ve en las capturas, escribe "no se ve en la captura" — nunca lo deduzcas ni lo inventes. Si no se alcanza a ver de qué cuenta es, usa "CUENTA: (no se ve el nombre)". En CAPTIONS y COMENTARIOS copia el texto tal como aparece. ' +
    'Entrega todo en un solo bloque de texto, sin saludos ni explicaciones.';

  const content = imagenes.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.media_type, data: i.data } }));
  content.push({ type: 'text', text: instruccion });
  const r = await llamarClaude({ system: systemPrompt, messages: [{ role: 'user', content }], maxTokens: 3500 });
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
  await registrarUsoTokens(clienteId, 'consultor-radar-analisis-capturas', r.usage);
  return res.status(200).json({ texto: r.text });
}

// ---------- Mis números (estadísticas de las cuentas PROPIAS) ----------
// La persona exporta sus estadísticas (Meta Business Suite, TikTok Analytics) o sube capturas, y Claude las deja
// en un bloque ordenado que se guarda en <hub>:radar-mis-numeros. El diagnóstico, el análisis, el brief y el chat
// los comparan contra los referentes. No hay conexión por API: nada de aprobaciones de Meta o TikTok.

const MAX_TEXTO_NUMEROS = 30000;
const MAX_ENTRADAS_NUMEROS = 6;

const FORMATO_MIS_NUMEROS =
  '---\n' +
  'CUENTA: @usuario (Instagram, TikTok o Facebook)\n' +
  'PERIODO:\n' +
  'SEGUIDORES (total y cuánto cambió en el periodo):\n' +
  'ALCANCE O VISTAS:\n' +
  'INTERACCIONES (me gusta, comentarios, guardados, compartidos):\n' +
  'VISITAS AL PERFIL O CLICS:\n' +
  'PUBLICACIONES EN EL PERIODO (y cada cuánto publica):\n' +
  'MEJORES PUBLICACIONES (las 3 con más resultado, con su dato):\n' +
  'PEORES PUBLICACIONES (las 3 con menos resultado, con su dato):\n' +
  'MEJORES DÍAS Y HORARIOS:\n' +
  'AUDIENCIA (edad, género, ciudades):\n' +
  'OTROS DATOS:\n' +
  '---';

// Lo más reciente primero no importa: se juntan las últimas lecturas del foco, de la más vieja a la más nueva.
function bloqueMisNumeros(items, foco) {
  const lista = (Array.isArray(items) ? items : []).filter((e) => e && e.texto && coincideFoco(e, foco ? foco.id : 'all')).slice(-3);
  if (lista.length === 0) return '';
  const cuerpo = lista.map((e) => `[${e.date}]\n${e.texto}`).join('\n\n');
  return 'MIS NÚMEROS (estadísticas de las cuentas PROPIAS de la persona). Compáralos con los referentes: qué hacen distinto, en qué van mejor y en qué van peor los referentes. Usa SOLO estos datos; si algo no viene aquí, di que no lo tienes en vez de suponerlo:\n' + truncar(cuerpo, 5000);
}

async function handleMisNumeros(req, res, clienteId, systemPrompt) {
  const texto = ((req.body && req.body.texto) || '').toString().trim().slice(0, MAX_TEXTO_NUMEROS);
  const bruto = Array.isArray(req.body && req.body.imagenes) ? req.body.imagenes : [];
  const imagenes = bruto
    .filter((i) => i && TIPOS_IMAGEN.has(i.media_type) && typeof i.data === 'string' && i.data.length > 100)
    .slice(0, MAX_IMAGENES);
  if (!texto && !imagenes.length) return res.status(400).json({ error: 'Sube tu reporte (CSV o capturas) o pega aquí tus números.' });
  if (imagenes.reduce((a, i) => a + i.data.length, 0) > MAX_BASE64_TOTAL) {
    return res.status(413).json({ error: 'Las capturas pesan demasiado juntas. Sube menos capturas a la vez.' });
  }
  const nota = ((req.body && req.body.nota) || '').toString().trim().slice(0, 500);
  const foco = normalizarFoco(req.body && req.body.foco);

  const instruccion =
    'Estas son las ESTADÍSTICAS DE LAS CUENTAS PROPIAS de la persona (no de la competencia), exportadas de Meta Business Suite, de TikTok Analytics u otra herramienta, ' +
    'o capturadas de pantalla' + (nota ? ` (nota de la persona: "${nota}")` : '') + '. Ordénalas con este formato exacto, un bloque por cuenta o red:\n' + FORMATO_MIS_NUMEROS + '\n' +
    'Reglas: copia las cifras tal como vienen, sin redondear ni inventar. Si un dato no viene en lo que se te dio, escribe "no viene en los datos" — nunca lo calcules por tu cuenta ni lo supongas. ' +
    'Si hay una tabla con muchas publicaciones, quédate con el total del periodo y con las mejores y peores. Entrega todo en un solo bloque de texto, sin saludos ni explicaciones.' +
    (texto ? `\n\nDATOS:\n"""\n${texto}\n"""` : '');

  const content = imagenes.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.media_type, data: i.data } }));
  content.push({ type: 'text', text: instruccion });
  const r = await llamarClaude({ system: systemPrompt, messages: [{ role: 'user', content }], maxTokens: 2500 });
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
  await registrarUsoTokens(clienteId, 'consultor-radar-mis-numeros', r.usage);

  let entry = null;
  try {
    const key = `${clienteId}:radar-mis-numeros`;
    const previos = await leerJSON(key).catch(() => null);
    entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), date: fechaHoy(), foco: { id: foco.id, nombre: foco.nombre }, texto: r.text };
    await escribirJSON(key, (Array.isArray(previos) ? previos : []).concat([entry]).slice(-MAX_ENTRADAS_NUMEROS));
  } catch (err) {
    entry = null;
  }
  return res.status(200).json({ texto: r.text, date: entry ? entry.date : fechaHoy(), id: entry ? entry.id : null, guardado: !!entry });
}

// ---------- brief de estilo para Jefe de Contenido y Jefe de Anuncios ----------
// Se guarda en <hub>:radar-estilo (lista, lo más reciente al final). Va en una llave aparte y NO dentro de
// radar-historial: Contenido y Anuncios leen la última entrada del historial buscando "insights", y una
// entrada sin ellos haría desaparecer el radar de sus prompts.

async function handleBriefEstilo(req, res, clienteId, systemPrompt) {
  const foco = normalizarFoco(req.body && req.body.foco);
  const items = await leerHistorial(clienteId);
  const diag = ultimaEntradaPorTipo(items, 'diagnostico-general', foco.id);
  if (!diag) return res.status(400).json({ error: 'Genera el diagnóstico general primero (paso 3).' });
  const analisis = ultimaEntradaPorTipo(items, 'analisis-general', foco.id);

  const contexto = await armarContexto(clienteId, ['brand-book.identidad', 'brand-book.tono', 'brand-book.audiencia', 'brand-book.contenido_actual', 'lista-maestra-cliente-ideal'], foco, { misNumeros: true });
  const instruccion =
    'Arma el BRIEF DE ESTILO DE REFERENTES: un resumen corto que el Jefe de Contenido y el Jefe de Anuncios van a leer ANTES de escribir, para darle estilo a los guiones y a las campañas ' +
    'mezclando lo que se aprendió de los referentes con la marca de este negocio (su voz y su tono vienen en el contexto de arriba). Es inspiración para adaptar, nunca para copiar: ' +
    'no incluyas frases exactas, guiones, claims ni identidad visual de nadie. Si algún referente usa presión falsa o promesas exageradas, ponlo en "que_no_copiar".\n\n' +
    'Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional antes ni después, con este formato exacto (cada arreglo con 3 a 5 puntos cortos, en lenguaje cotidiano):\n' +
    '{"resumen": "2 o 3 frases", "voz_y_tono_a_tomar": ["..."], "hooks_que_funcionan": ["..."], "formatos": ["..."], "temas": ["..."], "que_no_copiar": ["..."], "como_mezclarlo_con_la_marca": "2 o 3 frases", "para_contenido": ["instrucción concreta para guiones y publicaciones orgánicas"], "para_anuncios": ["instrucción concreta para anuncios y campañas"]}\n\n' +
    `DIAGNÓSTICO DE LOS REFERENTES:\n"""\n${truncar(diag.diagnostico || '', 7000)}\n"""` +
    (analisis ? `\n\nINSIGHTS DEL ANÁLISIS GENERAL:\n"""\n${truncar(JSON.stringify(analisis.insights || []), 3000)}\n"""` : '');

  const promptCompleto = [systemPrompt, contexto, instruccion].filter(Boolean).join('\n\n');
  const r = await llamarClaude({ promptCompleto, webSearch: false, maxTokens: 2000 });
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
  await registrarUsoTokens(clienteId, 'consultor-radar-brief-estilo', r.usage);

  const brief = extractJson(r.text);
  let entry = null;
  if (brief) {
    try {
      const key = `${clienteId}:radar-estilo`;
      const previos = await leerJSON(key).catch(() => null);
      entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), date: fechaHoy(), foco: { id: foco.id, nombre: foco.nombre }, brief };
      await escribirJSON(key, (Array.isArray(previos) ? previos : []).concat([entry]).slice(-10));
    } catch (err) {
      // No bloquear la respuesta si falla el guardado.
    }
  }
  return res.status(200).json({ brief, raw: r.text, date: entry ? entry.date : fechaHoy(), guardado: !!entry });
}

// ---------- chat libre del Faro ----------

const INSTRUCCION_CHAT =
  'ESTÁS EN EL CHAT DEL JEFE DEL FARO. La persona te hace preguntas sueltas sobre su investigación de referentes y tendencias. Responde corto (unas 150 palabras como máximo, salvo que pida más), ' +
  'en lenguaje cotidiano y usando SOLO el contexto del negocio y los datos del radar que aparecen abajo. Si todavía no hay diagnóstico, dile cuál es el siguiente paso en la página ' +
  '(1 agregar referentes, 2 investigar, 3 diagnóstico, 4 análisis y tendencias, 5 ideas, 6 pasar el estilo a Contenido y Anuncios). ' +
  'No puedes entrar a Instagram ni a TikTok en vivo: nunca digas qué publicó una cuenta si no está en los datos de abajo. ' +
  'Si pide investigar a alguien nuevo o tendencias frescas, dile que use el paso 2 "Investiga" de esta página. Termina con un siguiente paso corto o una pregunta.';

function lineasReferentes(items) {
  if (!Array.isArray(items) || !items.length) return '';
  const lineas = items.slice(0, 10).map((it) => {
    const p = (it.plataformas && it.plataformas[0]) || {};
    const partes = [it.nombre_cuenta || p.link || 'Sin nombre', p.plataforma, it.tipo].filter(Boolean);
    return '- ' + partes.join(' · ');
  });
  return 'REFERENTES GUARDADOS:\n' + lineas.join('\n');
}

async function handleChat(req, res, clienteId, systemPrompt) {
  const bruto = Array.isArray(req.body && req.body.mensajes) ? req.body.mensajes : [];
  let mensajes = bruto
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 4000) }))
    .slice(-14);
  while (mensajes.length && mensajes[0].role !== 'user') mensajes.shift();
  if (!mensajes.length || mensajes[mensajes.length - 1].role !== 'user') return res.status(400).json({ error: 'Escribe tu pregunta.' });

  const foco = normalizarFoco(req.body && req.body.foco);
  const [contexto, referentes, items, estilos] = await Promise.all([
    armarContexto(clienteId, ['brand-book.identidad', 'brand-book.tono', 'brand-book.audiencia', 'brand-book.contenido_actual', 'lista-maestra-cliente-ideal'], foco, { misNumeros: true }),
    leerJSON(`${clienteId}:radar-referentes`).catch(() => null),
    leerHistorial(clienteId),
    leerJSON(`${clienteId}:radar-estilo`).catch(() => null),
  ]);
  const diag = ultimaEntradaPorTipo(items, 'diagnostico-general', foco.id);
  const analisis = ultimaEntradaPorTipo(items, 'analisis-general', foco.id);
  const estilo = (Array.isArray(estilos) ? estilos : []).filter((e) => coincideFoco(e, foco.id)).pop();

  const bloques = [
    lineasReferentes(referentes),
    diag ? `ÚLTIMO DIAGNÓSTICO (${diag.date}):\n${truncar(diag.diagnostico || '', 3500)}` : 'TODAVÍA NO HAY DIAGNÓSTICO.',
    analisis && Array.isArray(analisis.insights) && analisis.insights.length ? `ÚLTIMOS INSIGHTS (${analisis.date}):\n${truncar(JSON.stringify(analisis.insights), 2000)}` : '',
    estilo ? `ÚLTIMO BRIEF DE ESTILO (${estilo.date}):\n${truncar(JSON.stringify(estilo.brief), 2500)}` : '',
  ].filter(Boolean);

  const system = [systemPrompt, INSTRUCCION_CHAT, contexto, bloques.join('\n\n')].filter(Boolean).join('\n\n');
  const r = await llamarClaude({ system, messages: mensajes, maxTokens: 1400 });
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
  await registrarUsoTokens(clienteId, 'consultor-radar-chat', r.usage);
  return res.status(200).json({ respuesta: r.text });
}

// Modos que no llaman a Claude: no cuentan contra el tope de tokens del hub (api/_lib/saldo.js).
const MODOS_SIN_IA = new Set(['estado-lectura', 'lectura-automatica']);

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { modo, cliente } = req.body || {};
  const clienteId = (cliente || DEFAULT_CLIENTE).toString();

  try {
    if (modo === 'estado-lectura') return await handleEstadoLectura(req, res, clienteId);
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo revisar la lectura automática.' });
  }

  // Tope de uso de IA del hub (api/_lib/saldo.js): al llegar al tope los Jefes no usan la IA hasta
  // que se renueva el ciclo o se compra un paquete. La interfaz sigue funcionando. Responde 402 con
  // { error, tope: true }: la página muestra ese texto tal cual.
  if (!MODOS_SIN_IA.has(modo)) {
    const bloqueoSaldo = await revisarSaldo(clienteId, leerJSON);
    if (bloqueoSaldo) return res.status(bloqueoSaldo.status).json(bloqueoSaldo.cuerpo);
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .toString()
    .split(',')[0]
    .trim();
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Demasiadas solicitudes, espera unos minutos.' });
  }

  try {
    if (modo === 'lectura-automatica') return await handleLecturaAutomatica(req, res, clienteId);
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo hacer la lectura automática.' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY en el servidor.' });
  }

  const systemPrompt = cargarPromptFijo();

  try {
    if (modo === 'diagnostico-general') return await handleDiagnosticoGeneral(req, res, clienteId, systemPrompt);
    if (modo === 'analisis-cuenta-guardada') return await handleAnalisisCuentaGuardada(req, res, clienteId, systemPrompt);
    if (modo === 'analisis-contenido') return await handleAnalisisContenido(req, res, clienteId, systemPrompt);
    if (modo === 'analisis-general') return await handleAnalisisGeneral(req, res, clienteId, systemPrompt);
    if (modo === 'ideas-accionables') return await handleIdeasAccionables(req, res, clienteId, systemPrompt);
    if (modo === 'investigar-web') return await handleInvestigarWeb(req, res, clienteId, systemPrompt);
    if (modo === 'analisis-capturas') return await handleAnalisisCapturas(req, res, clienteId, systemPrompt);
    if (modo === 'brief-estilo') return await handleBriefEstilo(req, res, clienteId, systemPrompt);
    if (modo === 'mis-numeros') return await handleMisNumeros(req, res, clienteId, systemPrompt);
    if (modo === 'chat') return await handleChat(req, res, clienteId, systemPrompt);
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }

  return res.status(400).json({ error: `Modo desconocido: ${modo}` });
};

// Solo para las pruebas (tests/radar-investigacion.test.js): funciones puras, sin red.
module.exports._probar = { analizarLinkRed, bloqueDeCuenta, normalizarPostsInstagram, normalizarPostsTikTok, normalizarPostsFacebook, leerRssYouTube, normalizarFoco, lineaFoco, coincideFoco, ultimaEntradaPorTipo, frecuenciaPosts, bloqueMisNumeros };
