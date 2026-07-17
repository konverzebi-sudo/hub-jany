// Endpoint server-side para el Consultor de Radar de Mercado y Tendencias — multi-tenant.
// Mismo patron que api/agente-conversion.js: la ANTHROPIC_API_KEY vive solo aqui.
// A diferencia de ese agente, este llama a Claude con la tool nativa web_search
// para modos que necesitan analizar cuentas en tiempo real, y arma su propio
// contexto (Brand Book, lista maestra, radar de referentes, historial) leyendo
// directo de kv_store en vez de depender de que el cliente lo mande.

const fs = require('fs');
const path = require('path');
const { sql } = require('@vercel/postgres');

const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');
const DEFAULT_CLIENTE = 'rancho-seco';

// Mismo motivo que en agente-conversion.js: mapeo explicito evita path
// traversal desde el body y le da a Vercel un literal detectable para
// incluir el archivo en el bundle.
const CLIENTES = {
  'rancho-seco': 'system-prompt-consultor-radar-rancho-seco.md',
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
  const { rows } = await sql`SELECT value FROM kv_store WHERE key = ${key}`;
  if (!rows[0] || rows[0].value == null) return null;
  try {
    return JSON.parse(rows[0].value);
  } catch (err) {
    return null;
  }
}

async function escribirJSON(key, valor) {
  const value = JSON.stringify(valor);
  const json = JSON.stringify(value);
  await sql`
    INSERT INTO kv_store (key, value, updated_at)
    VALUES (${key}, ${json}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = ${json}::jsonb, updated_at = now()
  `;
}

// ---------- construccion de contexto dinamico (Brand Book, radar, historial) ----------

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

function formatearReferentes(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const lineas = items.map((it) => {
    const nombre = it.nombre_cuenta || it.plataforma || 'sin nombre';
    const notas = it.notas ? ` — notas: ${it.notas}` : '';
    const queHaceBien = it.que_hace_bien ? ` — qué hace bien: ${it.que_hace_bien}` : '';
    return `- ${nombre} (${it.plataforma || 'plataforma sin definir'}, ${it.tipo || 'tipo sin definir'}): ${it.link || 'sin link'}${queHaceBien}${notas}`;
  });
  return 'Cuentas del radar de referentes:\n' + lineas.join('\n');
}

function formatearHistorial(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const lineas = items.slice(-8).map((it) => `### ${it.date} (${it.modo})\n${it.text}`);
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
  await ensureTable();
  const valores = await Promise.all(
    campos.map((campo) => leerJSON(`${cliente}:${campo}`).catch(() => null))
  );

  const bloques = [];
  campos.forEach((campo, i) => {
    const valor = valores[i];
    if (valor == null) return;
    let bloque = null;
    if (campo === 'lista-maestra-cliente-ideal') bloque = formatearListaMaestra(valor);
    else if (campo === 'radar-referentes') bloque = formatearReferentes(valor);
    else if (campo === 'radar-historial') bloque = formatearHistorial(valor);
    else bloque = formatearBrandBookCampo(CAMPOS_LABEL[campo] || campo, valor);
    if (bloque) bloques.push(bloque);
  });

  if (bloques.length === 0) return '';
  return 'CONTEXTO DEL NEGOCIO (Brand Book y datos guardados):\n' + truncar(bloques.join('\n\n'), CONTEXT_CHAR_LIMIT);
}

async function guardarHistorial(cliente, modo, text) {
  const key = `${cliente}:radar-historial`;
  const actual = (await leerJSON(key)) || [];
  const items = Array.isArray(actual) ? actual : [];
  items.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    modo,
    date: new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }),
    text,
  });
  // Evita crecimiento sin limite: solo se necesitan las corridas recientes
  // para el contexto de Optimizacion semanal y para el historial visible.
  const recortado = items.slice(-30);
  await escribirJSON(key, recortado);
}

// ---------- modos ----------

const MODOS = {
  'radar-semanal': {
    webSearch: true,
    guardaHistorial: true,
    necesitaExtra: false,
    contexto: ['brand-book.identidad', 'brand-book.tono', 'brand-book.audiencia', 'brand-book.contenido_actual', 'lista-maestra-cliente-ideal', 'radar-referentes'],
    instruccion() {
      return 'Genera el RADAR SEMANAL. Usa web_search para entrar directo a cada cuenta listada en "Cuentas del radar de referentes" (abajo) y analizar su contenido más reciente en tiempo real. Si no logras acceder al contenido de una cuenta, dilo explícitamente en vez de inventar. Entrega exactamente: máximo 5 insights, 10 ideas accionables, 3 prioridades — con el formato obligatorio del rol.';
    },
  },
  'analisis-cuenta': {
    webSearch: true,
    guardaHistorial: false,
    necesitaExtra: 'link',
    contexto: ['brand-book.identidad', 'brand-book.tono', 'brand-book.audiencia', 'lista-maestra-cliente-ideal'],
    instruccion(extra) {
      return `Analiza esta cuenta o publicación específica usando web_search: ${extra}\n\nDetecta patrones (hook, estructura narrativa, tema, formato, emoción, objeción, deseo, insight de mercado), explica por qué funcionan, y cómo adaptarlos a nuestro negocio — sin copiar. Si no puedes acceder al contenido, dilo explícitamente.`;
    },
  },
  'analisis-contenido': {
    webSearch: false,
    guardaHistorial: false,
    necesitaExtra: 'contenido',
    contexto: ['brand-book.identidad', 'brand-book.tono', 'brand-book.audiencia', 'lista-maestra-cliente-ideal'],
    instruccion(extra) {
      return `Analiza este contenido pegado manualmente (NO tienes web_search en este modo, trabaja únicamente con el texto de abajo):\n\n"""\n${extra}\n"""\n\nDetecta patrones y cómo adaptarlos a nuestro negocio — sin copiar.`;
    },
  },
  'insights-a-ideas': {
    webSearch: false,
    guardaHistorial: false,
    necesitaExtra: 'insights',
    contexto: ['brand-book.identidad', 'brand-book.tono', 'brand-book.audiencia', 'lista-maestra-cliente-ideal'],
    instruccion(extra) {
      return `Convierte estos insights en ideas de contenido accionables y concretas para nuestro negocio:\n\n${extra}`;
    },
  },
  'ideas-a-creativos': {
    webSearch: false,
    guardaHistorial: false,
    necesitaExtra: 'ideas',
    contexto: ['brand-book.identidad', 'brand-book.tono', 'brand-book.audiencia', 'lista-maestra-cliente-ideal'],
    instruccion(extra) {
      return `Convierte estas ideas en conceptos creativos listos para anuncios pagados (ads): describe concepto, hook visual/texto, y formato recomendado — sin copiar diseño ni claims ajenos:\n\n${extra}`;
    },
  },
  'benchmark-estilo': {
    webSearch: true,
    guardaHistorial: false,
    necesitaExtra: 'referencia',
    contexto: ['brand-book.identidad', 'brand-book.tono', 'brand-book.audiencia'],
    instruccion(extra) {
      return `Haz un benchmark de estilo entre nuestra marca y esta referencia (usa web_search si es un link): ${extra}\n\nCompara tono, estructura narrativa y formato — nunca recomiendes copiar diseño o identidad visual idéntica.`;
    },
  },
  'optimizacion-semanal': {
    webSearch: false,
    guardaHistorial: false,
    necesitaExtra: false,
    contexto: ['radar-historial'],
    instruccion() {
      return 'Revisa el historial de radares semanales (abajo) y genera una optimización semanal: qué insights se repiten corrida tras corrida, qué ideas nunca se llevaron a producción, y qué ajustar en el próximo radar.';
    },
  },
};

async function handleActivacionSilenciosa(res, cliente) {
  try {
    await ensureTable();
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
      `Corridas de Radar Semanal guardadas: ${corridas}${ultima ? ` (última: ${ultima})` : ''}`,
      'No se realizó ningún análisis — este modo solo confirma estado.',
    ];
    return res.status(200).json({ text: lineas.join('\n') });
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo leer el estado.' });
  }
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

  const { modo, cliente, extra } = req.body || {};
  const clienteId = (cliente || DEFAULT_CLIENTE).toString();
  if (!CLIENTES[clienteId]) {
    return res.status(400).json({ error: `Cliente desconocido: ${clienteId}` });
  }

  if (modo === 'activacion-silenciosa') {
    return handleActivacionSilenciosa(res, clienteId);
  }

  const modoCfg = MODOS[modo];
  if (!modoCfg) {
    return res.status(400).json({ error: `Modo desconocido: ${modo}` });
  }
  const extraTexto = extra != null ? extra.toString().trim() : '';
  if (modoCfg.necesitaExtra && !extraTexto) {
    return res.status(400).json({ error: 'Falta el dato requerido para este modo.' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY en el servidor.' });
  }

  const systemPrompt = cargarSystemPrompt(clienteId);
  if (!systemPrompt) {
    return res.status(400).json({ error: `Cliente desconocido: ${clienteId}` });
  }

  let contexto = '';
  try {
    contexto = await construirContexto(clienteId, modoCfg.contexto);
  } catch (err) {
    contexto = '';
  }

  const instruccion = modoCfg.instruccion(extraTexto);
  const promptCompleto = [systemPrompt, contexto, instruccion].filter(Boolean).join('\n\n');

  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    messages: [{ role: 'user', content: promptCompleto }],
  };
  if (modoCfg.webSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      return res.status(anthropicRes.status).json({ error: data?.error?.message || 'Error al llamar a la API.' });
    }

    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (!text) {
      return res.status(502).json({ error: 'Respuesta vacía del modelo.' });
    }

    if (modoCfg.guardaHistorial) {
      try {
        await guardarHistorial(clienteId, modo, text);
      } catch (err) {
        // No bloquear la respuesta al usuario si falla el guardado del historial.
      }
    }

    return res.status(200).json({ text });
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
};
