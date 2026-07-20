// Endpoint server-side para el Consultor de Radar de Mercado y Tendencias — multi-tenant.
// Mismo patron que api/agente-conversion.js: la ANTHROPIC_API_KEY vive solo aqui.
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

const fs = require('fs');
const path = require('path');
const { sql } = require('@vercel/postgres');

const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');
const DEFAULT_CLIENTE = 'rancho-seco';
const SEPARADOR_INSIGHTS = '---INSIGHTS-Y-IDEAS---';

// Mismo motivo que en agente-conversion.js: mapeo explicito evita path
// traversal desde el body y le da a Vercel un literal detectable para
// incluir el archivo en el bundle.
const CLIENTES = {
  'rancho-seco': 'system-prompt-consultor-radar-rancho-seco.md',
  jefeshub: 'system-prompt-consultor-radar-jefeshub.md',
};

const promptCache = new Map();

function cargarSystemPrompt(cliente) {
  if (promptCache.has(cliente)) return promptCache.get(cliente);
  const archivo = CLIENTES[cliente];
  if (!archivo) return null;
  const contenido = fs.readFileSync(path.join(PROMPTS_DIR, archivo), 'utf-8');
  promptCache.set(cliente, contenido);
  return contenido;
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

function normalizarLink(url) {
  if (!url) return '';
  return url
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '');
}

// ---------- historial ({cliente}:radar-historial) ----------
// Entradas mezcladas por 'tipo': 'diagnostico-general' (Sección 2, con cache
// por cuenta en porCuenta) y 'analisis-general' (Sección 4, siempre fresco).

async function leerHistorial(cliente) {
  const items = await leerJSON(`${cliente}:radar-historial`);
  return Array.isArray(items) ? items : [];
}

async function guardarHistorialEntry(cliente, datos) {
  const key = `${cliente}:radar-historial`;
  const items = await leerHistorial(cliente);
  const entry = Object.assign(
    { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), date: fechaHoy() },
    datos
  );
  items.push(entry);
  // Evita crecimiento sin limite: solo se necesitan las corridas recientes
  // para el contexto de Optimizacion semanal y el historial visible.
  const recortado = items.slice(-30);
  await escribirJSON(key, recortado);
  return entry;
}

function ultimaEntradaPorTipo(items, tipo) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].tipo === tipo) return items[i];
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

function formatearHistorial(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const lineas = items.slice(-8).map((it) => {
    if (it.tipo === 'diagnostico-general') return `### ${it.date} (diagnóstico general)\n${it.diagnostico || ''}`;
    if (it.tipo === 'analisis-general') return `### ${it.date} (análisis general, ${it.isoWeek || ''})\n${it.analisisRaw || it.text || ''}`;
    return `### ${it.date} (${it.modo || 'corrida'})\n${it.text || ''}`;
  });
  return 'Historial de corridas anteriores:\n' + lineas.join('\n\n');
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
    else if (campo === 'radar-historial') bloque = formatearHistorial(valor);
    else bloque = formatearBrandBookCampo(CAMPOS_LABEL[campo] || campo, valor);
    if (bloque) bloques.push(bloque);
  });

  if (bloques.length === 0) return '';
  return 'CONTEXTO DEL NEGOCIO (Brand Book y datos guardados):\n' + truncar(bloques.join('\n\n'), CONTEXT_CHAR_LIMIT);
}

// ---------- llamada a Claude ----------

async function llamarClaude({ promptCompleto, webSearch, maxTokens }) {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens || 3000,
    messages: [{ role: 'user', content: promptCompleto }],
  };
  if (webSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
  }

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
  return { ok: true, text };
}

function instruccionAnalisisCuentaJSON(accountLabel, fuenteTexto, buscarEnTexto) {
  const contextoFuente = buscarEnTexto
    ? `Del siguiente texto pegado (capturado manualmente de varias cuentas), enfócate ÚNICAMENTE en la cuenta ${accountLabel} — busca el bloque que corresponda a esa cuenta o link. Si no encuentras esa cuenta en el texto, no inventes nada.\n\nTEXTO PEGADO:\n"""\n${fuenteTexto}\n"""`
    : `Analiza este contenido pegado manualmente de la cuenta ${accountLabel} (capturado por el usuario, sin web_search).\n\nCONTENIDO PEGADO:\n"""\n${fuenteTexto}\n"""`;
  return (
    `${contextoFuente}\n\nDetecta patrones (sin copiar) y responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional antes ni después, con este formato exacto:\n` +
    `{"accesible": true, "tipo_de_contenido": "...", "frecuencia": "...", "temas": ["..."], "hooks": ["..."], "formatos": ["..."], "que_funciona": "...", "que_aprender": "...", "que_no_copiar": "...", "que_adaptar": "..."}\n` +
    `Si la cuenta no aparece en el texto o no hay suficiente información, responde exactamente:\n` +
    `{"accesible": false, "tipo_de_contenido": "", "frecuencia": "", "temas": [], "hooks": [], "formatos": [], "que_funciona": "", "que_aprender": "", "que_no_copiar": "", "que_adaptar": ""}`
  );
}

// ---------- handlers de flujo hibrido ----------

async function handleDiagnosticoGeneral(req, res, clienteId, systemPrompt) {
  const textoPegado = ((req.body && req.body.extra) || '').toString().trim();
  if (!textoPegado) return res.status(400).json({ error: 'Falta el texto pegado.' });

  const contexto = await construirContexto(clienteId, [
    'brand-book.identidad',
    'brand-book.tono',
    'brand-book.audiencia',
    'brand-book.contenido_actual',
    'lista-maestra-cliente-ideal',
  ]).catch(() => '');

  const instruccion =
    'Analiza el siguiente texto, que contiene datos extraídos manualmente de varias cuentas de referencia ' +
    '(capturado por el usuario desde Instagram/TikTok con su propia sesión). Da un DIAGNÓSTICO GENERAL sobre ' +
    'el conjunto completo — NO lo desgloses cuenta por cuenta todavía: temas que se repiten, hooks que funcionan, ' +
    'formatos usados, qué aprender, qué NO copiar (señala explícitamente cualquier práctica de presión falsa, ' +
    'manipulación o promesa exagerada que no se debe imitar), y qué adaptar a nuestro negocio.\n\n' +
    'Si el texto marca alguna cuenta como "🔒 no accesible", no la analices — solo continúa con las que sí ' +
    `tienen datos.\n\nTEXTO PEGADO:\n"""\n${textoPegado}\n"""`;

  const promptCompleto = [systemPrompt, contexto, instruccion].filter(Boolean).join('\n\n');
  const r = await llamarClaude({ promptCompleto, webSearch: false });
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });

  try {
    await guardarHistorialEntry(clienteId, {
      tipo: 'diagnostico-general',
      textoPegado,
      diagnostico: r.text,
      porCuenta: {},
    });
  } catch (err) {
    // No bloquear la respuesta al usuario si falla el guardado del historial.
  }

  return res.status(200).json({ text: r.text });
}

async function handleAnalisisCuentaGuardada(req, res, clienteId, systemPrompt) {
  const accountId = ((req.body && req.body.accountId) || '').toString();
  const accountLabel = ((req.body && req.body.accountLabel) || accountId).toString();
  if (!accountId) return res.status(400).json({ error: 'Falta accountId.' });

  const key = `${clienteId}:radar-historial`;
  const items = await leerHistorial(clienteId);
  const entry = ultimaEntradaPorTipo(items, 'diagnostico-general');
  if (!entry) {
    return res.status(400).json({ error: 'Genera el diagnóstico general primero (Sección 2).' });
  }

  const contexto = await construirContexto(clienteId, ['brand-book.identidad', 'brand-book.tono', 'brand-book.audiencia']).catch(() => '');
  const instruccion = instruccionAnalisisCuentaJSON(accountLabel, entry.textoPegado, true);
  const promptCompleto = [systemPrompt, contexto, instruccion].filter(Boolean).join('\n\n');

  const r = await llamarClaude({ promptCompleto, webSearch: false });
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });

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

async function handleAnalisisCuentaNueva(req, res, clienteId, systemPrompt) {
  const accountLabel = ((req.body && req.body.accountLabel) || '').toString().trim();
  const contenidoPegado = ((req.body && req.body.contenidoPegado) || '').toString().trim();
  if (!accountLabel || !contenidoPegado) {
    return res.status(400).json({ error: 'Falta el link o el contenido pegado.' });
  }

  const contexto = await construirContexto(clienteId, ['brand-book.identidad', 'brand-book.tono', 'brand-book.audiencia']).catch(() => '');
  const instruccion = instruccionAnalisisCuentaJSON(accountLabel, contenidoPegado, false);
  const promptCompleto = [systemPrompt, contexto, instruccion].filter(Boolean).join('\n\n');

  const r = await llamarClaude({ promptCompleto, webSearch: false });
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });

  const parsed = extractJson(r.text);
  return res.status(200).json({ data: parsed, raw: r.text });
}

async function handleAnalisisGeneral(req, res, clienteId, systemPrompt) {
  const items = await leerHistorial(clienteId);
  const diagEntry = ultimaEntradaPorTipo(items, 'diagnostico-general');
  if (!diagEntry) {
    return res.status(400).json({ error: 'Genera el diagnóstico general primero (Sección 2).' });
  }

  const contexto = await construirContexto(clienteId, [
    'brand-book.identidad',
    'brand-book.tono',
    'brand-book.audiencia',
    'brand-book.contenido_actual',
    'lista-maestra-cliente-ideal',
  ]).catch(() => '');

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
    'BLOQUE 1 — responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional antes ni después, con este formato exacto:\n' +
    '{"que_funciona": "...", "hooks_que_se_repiten": ["...", "..."], "formatos_que_usan": ["...", "..."], "temas_que_ganan_atencion": ["...", "..."], "ideas_adaptar_semana": ["...", "..."]}\n\n' +
    'BLOQUE 2 — responde ÚNICAMENTE con un arreglo JSON de exactamente 5 strings (sin texto adicional antes ni después), ' +
    'cada uno un insight principal breve y accionable, en el orden de prioridad. Formato exacto: ' +
    '["insight 1", "insight 2", "insight 3", "insight 4", "insight 5"]\n\n' +
    `DIAGNÓSTICO PREVIO:\n"""\n${diagEntry.diagnostico}\n"""`;

  const promptCompleto = [systemPrompt, contexto, instruccion].filter(Boolean).join('\n\n');
  const r = await llamarClaude({ promptCompleto, webSearch: true, maxTokens: 2200 });
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });

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
    });
  } catch (err) {
    // No bloquear la respuesta al usuario si falla el guardado del historial.
  }

  return res.status(200).json({ analisisData, analisisRaw, insights, insightsRaw, isoWeek, date: entryGuardada && entryGuardada.date });
}

async function handleIdeasAccionables(req, res, clienteId, systemPrompt) {
  const key = `${clienteId}:radar-historial`;
  const items = await leerHistorial(clienteId);
  let idx = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].tipo === 'analisis-general') { idx = i; break; }
  }
  if (idx === -1) {
    return res.status(400).json({ error: 'Genera el análisis general primero (Sección 4).' });
  }
  const entry = items[idx];
  if (entry.ideas) {
    return res.status(200).json({ ideas: entry.ideas });
  }

  const contexto = await construirContexto(clienteId, ['brand-book.identidad', 'brand-book.tono', 'brand-book.audiencia']).catch(() => '');
  const instruccion =
    'A partir del análisis general y los insights ya generados (abajo), da EXACTAMENTE 10 ideas de contenido ' +
    'accionables, numeradas, en formato listo para copiar y pegar (sin explicaciones adicionales, sin JSON — texto plano numerado).\n\n' +
    `ANÁLISIS GENERAL:\n"""\n${entry.analisisRaw || ''}\n"""\n\nINSIGHTS:\n"""\n${entry.insightsRaw || ''}\n"""`;
  const promptCompleto = [systemPrompt, contexto, instruccion].filter(Boolean).join('\n\n');
  const r = await llamarClaude({ promptCompleto, webSearch: false, maxTokens: 1500 });
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });

  try {
    entry.ideas = r.text;
    await escribirJSON(key, items);
  } catch (err) {
    // No bloquear la respuesta al usuario si falla el guardado del cache.
  }

  return res.status(200).json({ ideas: r.text });
}

async function handleBenchmarkEstilo(req, res, clienteId, systemPrompt) {
  const referencia = ((req.body && req.body.extra) || '').toString().trim();
  if (!referencia) return res.status(400).json({ error: 'Falta el dato requerido para este modo.' });

  const contexto = await construirContexto(clienteId, ['brand-book.identidad', 'brand-book.tono', 'brand-book.audiencia']).catch(() => '');
  const referentes = (await leerJSON(`${clienteId}:radar-referentes`).catch(() => null)) || [];
  const referenciaNorm = normalizarLink(referencia);
  const match = Array.isArray(referentes)
    ? referentes.find((r) => {
        // Shape nuevo: plataformas:[{plataforma,link}]. Shape viejo (compatibilidad): link suelto.
        const links = Array.isArray(r.plataformas) ? r.plataformas.map((p) => p.link) : (r.link ? [r.link] : []);
        return links.some((l) => l && normalizarLink(l) === referenciaNorm);
      })
    : null;

  if (match) {
    const items = await leerHistorial(clienteId);
    let cache = null;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].tipo === 'diagnostico-general' && items[i].porCuenta && items[i].porCuenta[match.id]) {
        cache = items[i].porCuenta[match.id];
        break;
      }
    }
    if (!cache) {
      return res.status(200).json({
        text:
          'Esta cuenta ya está en tu radar de referentes pero todavía no tiene análisis calculado. Ve a la ' +
          'Sección 3 (Análisis por cuenta) y haz click en ella primero — luego repite el benchmark.',
      });
    }
    const instruccion =
      'Haz un benchmark de estilo entre nuestra marca y el análisis ya calculado de esta cuenta de referencia ' +
      '(abajo) — no vuelvas a buscarla, usa el análisis dado. Compara tono, estructura narrativa y formato — ' +
      `nunca recomiendes copiar diseño o identidad visual idéntica.\n\nANÁLISIS DE LA CUENTA:\n"""\n${cache.raw || JSON.stringify(cache.data)}\n"""`;
    const promptCompleto = [systemPrompt, contexto, instruccion].filter(Boolean).join('\n\n');
    const r = await llamarClaude({ promptCompleto, webSearch: false });
    if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
    return res.status(200).json({ text: r.text });
  }

  const instruccion =
    `Haz un benchmark de estilo entre nuestra marca y esta referencia externa (usa web_search si es un link): ${referencia}\n\n` +
    'Compara tono, estructura narrativa y formato — nunca recomiendes copiar diseño o identidad visual idéntica.';
  const promptCompleto = [systemPrompt, contexto, instruccion].filter(Boolean).join('\n\n');
  const r = await llamarClaude({ promptCompleto, webSearch: true });
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
  return res.status(200).json({ text: r.text });
}

async function handleOptimizacionSemanal(req, res, clienteId, systemPrompt) {
  const metricas = ((req.body && req.body.extra) || '').toString().trim();
  if (!metricas) return res.status(400).json({ error: 'Falta el dato requerido para este modo.' });

  const contexto = await construirContexto(clienteId, ['radar-historial']).catch(() => '');
  const instruccion =
    'Revisa el historial de corridas anteriores (arriba, si lo hay) y las métricas propias que pegó el usuario ' +
    '(abajo). Genera una optimización semanal: qué insights/ideas se repiten corrida tras corrida, qué se ' +
    'confirma o refuta con las métricas reales, y qué ajustar para la próxima semana.\n\n' +
    `MÉTRICAS PEGADAS POR EL USUARIO:\n"""\n${metricas}\n"""`;
  const promptCompleto = [systemPrompt, contexto, instruccion].filter(Boolean).join('\n\n');
  const r = await llamarClaude({ promptCompleto, webSearch: false });
  if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
  return res.status(200).json({ text: r.text });
}

async function handleActivacionSilenciosa(res, cliente) {
  try {
    const [identidad, referentes, historial] = await Promise.all([
      leerJSON(`${cliente}:brand-book.identidad`),
      leerJSON(`${cliente}:radar-referentes`),
      leerJSON(`${cliente}:radar-historial`),
    ]);
    const cuentas = Array.isArray(referentes) ? referentes.length : 0;
    const corridas = Array.isArray(historial) ? historial.length : 0;
    const ultima = corridas ? historial[historial.length - 1].date : null;
    const brandBookListo = !!identidad && typeof identidad === 'object' && Object.keys(identidad).length > 0;

    const lineas = [
      `Estado del Consultor Radar de Mercado — cliente "${cliente}"`,
      `Brand Book: ${brandBookListo ? 'cargado ✓' : 'sin datos todavía ✗'}`,
      `Cuentas en el radar de referentes: ${cuentas}`,
      `Corridas guardadas en el historial: ${corridas}${ultima ? ` (última: ${ultima})` : ''}`,
      'No se realizó ningún análisis — este modo solo confirma estado.',
    ];
    return res.status(200).json({ text: lineas.join('\n') });
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo leer el estado.' });
  }
}

// ---------- modos simples (sin web_search, sin persistencia) ----------

const MODOS = {
  'analisis-contenido': {
    necesitaExtra: true,
    contexto: ['brand-book.identidad', 'brand-book.tono', 'brand-book.audiencia', 'lista-maestra-cliente-ideal'],
    instruccion(extra) {
      return `Analiza este contenido pegado manualmente (NO tienes web_search en este modo, trabaja únicamente con el texto de abajo):\n\n"""\n${extra}\n"""\n\nDetecta patrones y cómo adaptarlos a nuestro negocio — sin copiar.`;
    },
  },
  'insights-a-ideas': {
    necesitaExtra: true,
    contexto: ['brand-book.identidad', 'brand-book.tono', 'brand-book.audiencia', 'lista-maestra-cliente-ideal'],
    instruccion(extra) {
      return `Convierte estos insights en ideas de contenido accionables y concretas para nuestro negocio:\n\n${extra}`;
    },
  },
  'ideas-a-creativos': {
    necesitaExtra: true,
    contexto: ['brand-book.identidad', 'brand-book.tono', 'brand-book.audiencia', 'lista-maestra-cliente-ideal'],
    instruccion(extra) {
      return `Convierte estas ideas en conceptos creativos listos para anuncios pagados (ads): describe concepto, hook visual/texto, y formato recomendado — sin copiar diseño ni claims ajenos:\n\n${extra}`;
    },
  },
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

  const { modo, cliente } = req.body || {};
  const clienteId = (cliente || DEFAULT_CLIENTE).toString();
  if (!CLIENTES[clienteId]) {
    return res.status(400).json({ error: `Cliente desconocido: ${clienteId}` });
  }

  if (modo === 'activacion-silenciosa') {
    return handleActivacionSilenciosa(res, clienteId);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY en el servidor.' });
  }

  const systemPrompt = cargarSystemPrompt(clienteId);
  if (!systemPrompt) {
    return res.status(400).json({ error: `Cliente desconocido: ${clienteId}` });
  }

  try {
    if (modo === 'diagnostico-general') return await handleDiagnosticoGeneral(req, res, clienteId, systemPrompt);
    if (modo === 'analisis-cuenta-guardada') return await handleAnalisisCuentaGuardada(req, res, clienteId, systemPrompt);
    if (modo === 'analisis-cuenta-nueva') return await handleAnalisisCuentaNueva(req, res, clienteId, systemPrompt);
    if (modo === 'analisis-general') return await handleAnalisisGeneral(req, res, clienteId, systemPrompt);
    if (modo === 'ideas-accionables') return await handleIdeasAccionables(req, res, clienteId, systemPrompt);
    if (modo === 'benchmark-estilo') return await handleBenchmarkEstilo(req, res, clienteId, systemPrompt);
    if (modo === 'optimizacion-semanal') return await handleOptimizacionSemanal(req, res, clienteId, systemPrompt);
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }

  const modoCfg = MODOS[modo];
  if (!modoCfg) {
    return res.status(400).json({ error: `Modo desconocido: ${modo}` });
  }
  const extraTexto = (req.body && req.body.extra != null ? req.body.extra.toString().trim() : '');
  if (modoCfg.necesitaExtra && !extraTexto) {
    return res.status(400).json({ error: 'Falta el dato requerido para este modo.' });
  }

  try {
    const contexto = await construirContexto(clienteId, modoCfg.contexto).catch(() => '');
    const instruccion = modoCfg.instruccion(extraTexto);
    const promptCompleto = [systemPrompt, contexto, instruccion].filter(Boolean).join('\n\n');
    const r = await llamarClaude({ promptCompleto, webSearch: false });
    if (!r.ok) return res.status(r.status || 500).json({ error: r.error });
    return res.status(200).json({ text: r.text });
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
};
