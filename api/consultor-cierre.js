// Endpoint server-side para el Jefe de Conversión — multi-tenant, multi-modo.
// Sigue el mismo patron que api/consultor-evergreen-builder.js / api/consultor-financiero.js:
// prompt fijo generico (sin datos de negocio hardcoded) + CONTEXTO DEL NEGOCIO cargado en tiempo
// real desde el ADN de cada marca. `modo` decide que fragmento de prompt se concatena.
//
// Dos familias de modos:
// - Modos de chat (audit-tienda, audit-evento-propio, audit-evento-referencia, manual-tienda,
//   manual-evento): reciben el historial completo `messages` (la Messages API no guarda estado
//   en servidor). El manual reutiliza el mismo hilo que su auditoria (el cliente no reinicia
//   `messages` al cambiar de paso), asi el modelo ve la auditoria como contexto sin logica extra.
// - Modos numericos (diagnostico-tienda, diagnostico-evento): reciben `datos` (conteos agregados
//   por etapa, nunca por lead). Las tasas se calculan aqui en JS de forma deterministica -- el
//   modelo nunca hace la aritmetica, solo interpreta.

const fs = require('fs');
const path = require('path');
const { sql } = require('@vercel/postgres');

const DEFAULT_CLIENTE = 'rancho-seco';

const PROMPT_BASE_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-cierre.md');
const PROMPTS_POR_MODO = {
  'audit-tienda': path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-cierre-audit-tienda.md'),
  'audit-evento-propio': path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-cierre-audit-evento-propio.md'),
  'audit-evento-referencia': path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-cierre-audit-evento-referencia.md'),
  'diagnostico-tienda': path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-cierre-diagnostico.md'),
  'diagnostico-evento': path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-cierre-diagnostico.md'),
  'diagnostico-mensaje': path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-cierre-diagnostico.md'),
  'manual-tienda': path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-cierre-manual-tienda.md'),
  'manual-evento': path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-cierre-manual-evento.md'),
};
const MODOS_CHAT = new Set(['audit-tienda', 'audit-evento-propio', 'audit-evento-referencia', 'manual-tienda', 'manual-evento']);
const MODOS_DIAGNOSTICO = new Set(['diagnostico-tienda', 'diagnostico-evento', 'diagnostico-mensaje']);

// Solo audit-tienda puede recibir un link de landing/tienda para leer -- web_fetch es una
// herramienta server-side (Anthropic la ejecuta, no hay loop de tool-use que armar aqui) y
// solo puede leer URLs que ya aparezcan en el mensaje del usuario.
const WEB_FETCH_TOOL = { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3, max_content_tokens: 8000 };

const CONTEXT_CHAR_LIMIT = 5000;
const MAX_MESSAGES = 40;

const promptCache = new Map();
function cargarPrompt(rutaAbsoluta) {
  if (promptCache.has(rutaAbsoluta)) return promptCache.get(rutaAbsoluta);
  const contenido = fs.readFileSync(rutaAbsoluta, 'utf-8');
  promptCache.set(rutaAbsoluta, contenido);
  return contenido;
}

// Rate limit en memoria (por IP). Igual de permisivo que los otros chats guiados: una sesion
// completa de auditoria + manual toma varios turnos.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 40;
const hits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_REQUESTS;
}

// ---------- lectura/escritura de storage (mismo shape que api/storage/[key].js / window.storage) ----------

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
  return 'CATÁLOGO DE PRODUCTOS:\n' + lineas.join('\n');
}

async function construirContextoNegocio(clienteId) {
  const [identidad, tono, audiencia, catalogo] = await Promise.all([
    leerJSON(`${clienteId}:brand-book.identidad`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.tono`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.audiencia`).catch(() => null),
    leerJSON(`${clienteId}:catalogo-productos`).catch(() => null),
  ]);

  const bloques = [
    formatearIdentidad(identidad),
    formatearTono(tono),
    formatearAudiencias(audiencia),
    formatearCatalogo(catalogo),
  ].filter(Boolean);

  if (bloques.length === 0) {
    return 'CONTEXTO DEL NEGOCIO: todavía no hay datos guardados en el ADN de esta marca.';
  }
  return 'CONTEXTO DEL NEGOCIO (ya cargado del ADN — no le pidas al usuario que lo repita):\n\n' + truncar(bloques.join('\n\n'), CONTEXT_CHAR_LIMIT);
}

// ---------- diagnóstico numérico: cálculo determinístico de tasas ----------

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dividir(num, den) {
  if (num == null || den == null || den === 0) return null;
  return num / den;
}

function pct(v) {
  return v == null ? null : Math.round(v * 1000) / 10; // 1 decimal
}

function calcularTasasTienda(datos) {
  const visitas = numero(datos.visitas);
  const visitasProducto = numero(datos.visitasProducto);
  const agregaronCarrito = numero(datos.agregaronCarrito);
  const iniciaronCheckout = numero(datos.iniciaronCheckout);
  const compras = numero(datos.compras);
  const ticketPromedio = numero(datos.ticketPromedio) || dividir(numero(datos.ingresos), compras);

  const carritosAbandonados = agregaronCarrito != null && compras != null ? Math.max(agregaronCarrito - compras, 0) : null;

  return {
    tasaConversionPct: pct(dividir(compras, visitas)),
    tasaProductoACarritoPct: pct(dividir(agregaronCarrito, visitasProducto != null ? visitasProducto : visitas)),
    tasaCarritoACompraPct: pct(dividir(compras, agregaronCarrito)),
    tasaCheckoutACompraPct: pct(dividir(compras, iniciaronCheckout)),
    carritosAbandonados,
    valorPerdidoCarritosAbandonados: carritosAbandonados != null && ticketPromedio != null ? Math.round(carritosAbandonados * ticketPromedio) : null,
  };
}

function calcularTasasEvento(datos) {
  const registrados = numero(datos.registrados);
  const confirmados = numero(datos.confirmados);
  const asistieron = numero(datos.asistieron);
  const compraron = numero(datos.compraron);

  return {
    tasaConfirmacionPct: pct(dividir(confirmados, registrados)),
    tasaShowUpPct: pct(dividir(asistieron, registrados)),
    tasaCierrePct: pct(dividir(compraron, asistieron)),
    tasaRegistroAVentaPct: pct(dividir(compraron, registrados)),
  };
}

function calcularTasasMensaje(datos) {
  const leadsRecibidos = numero(datos.leadsRecibidos);
  const leadsRespondidos = numero(datos.leadsRespondidos);
  const leadsCalificados = numero(datos.leadsCalificados);
  const cotizacionesEnviadas = numero(datos.cotizacionesEnviadas);
  const ventasCerradas = numero(datos.ventasCerradas);
  const leadsSinSeguimiento = numero(datos.leadsSinSeguimiento);
  const ticketPromedio = numero(datos.ticketPromedio);

  const cotizacionesAbiertas = cotizacionesEnviadas != null && ventasCerradas != null ? Math.max(cotizacionesEnviadas - ventasCerradas, 0) : null;

  return {
    tasaRespuestaPct: pct(dividir(leadsRespondidos, leadsRecibidos)),
    tasaCalificacionPct: pct(dividir(leadsCalificados, leadsRespondidos)),
    tasaCierrePct: pct(dividir(ventasCerradas, leadsRecibidos)),
    tasaCotizacionAVentaPct: pct(dividir(ventasCerradas, cotizacionesEnviadas)),
    pctSinSeguimiento: pct(dividir(leadsSinSeguimiento, leadsRecibidos)),
    ingresosPotencialesAbiertos: cotizacionesAbiertas != null && ticketPromedio != null ? Math.round(cotizacionesAbiertas * ticketPromedio) : null,
  };
}

const NOMBRE_RUTA_DIAGNOSTICO = {
  'diagnostico-tienda': 'tienda online',
  'diagnostico-evento': 'evento',
  'diagnostico-mensaje': 'mensaje / WhatsApp',
};

function formatearContextoDiagnostico(ruta, datos, tasas) {
  let bloque;
  try {
    bloque = JSON.stringify({ datosIngresados: datos, tasasCalculadas: tasas }, null, 0);
  } catch (err) {
    bloque = '(no se pudo serializar)';
  }
  return `CONTEXTO DEL DIAGNÓSTICO (ruta: ${NOMBRE_RUTA_DIAGNOSTICO[ruta] || ruta} — tasas ya calculadas por el sistema, no las recalcules):\n\n${bloque}`;
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

  const body = req.body || {};
  const clienteId = (body.cliente || DEFAULT_CLIENTE).toString();
  const modo = (body.modo || '').toString();

  if (!PROMPTS_POR_MODO[modo]) {
    return res.status(400).json({ error: 'Modo inválido o faltante.' });
  }

  let promptBase, promptModo;
  try {
    promptBase = cargarPrompt(PROMPT_BASE_PATH);
    promptModo = cargarPrompt(PROMPTS_POR_MODO[modo]);
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo cargar el prompt del agente.' });
  }

  try {
    const contextoNegocio = await construirContextoNegocio(clienteId);

    if (MODOS_DIAGNOSTICO.has(modo)) {
      const datos = body.datos && typeof body.datos === 'object' ? body.datos : {};
      const sufijoRuta = modo === 'diagnostico-tienda' ? 'tienda' : modo === 'diagnostico-evento' ? 'evento' : 'mensaje';
      const tasas = modo === 'diagnostico-tienda' ? calcularTasasTienda(datos) : modo === 'diagnostico-evento' ? calcularTasasEvento(datos) : calcularTasasMensaje(datos);

      await escribirJSON(`${clienteId}:conversion-cierre-diagnostico-${sufijoRuta}`, datos).catch(() => {});

      const contextoDatos = formatearContextoDiagnostico(modo, datos, tasas);
      const system = [promptBase, promptModo, contextoNegocio, contextoDatos].join('\n\n');

      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 900,
          system,
          messages: [{ role: 'user', content: 'Interpreta mi diagnóstico numérico de conversión con las tasas ya calculadas.' }],
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
      return res.status(200).json({ rates: tasas, text });
    }

    if (MODOS_CHAT.has(modo)) {
      const messages = Array.isArray(body.messages) ? body.messages : null;
      if (!messages || messages.length === 0) {
        return res.status(400).json({ error: 'Falta el historial de la conversación (messages).' });
      }
      const limpio = messages
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .slice(-MAX_MESSAGES)
        .map((m) => ({ role: m.role, content: m.content }));
      if (limpio.length === 0 || limpio[limpio.length - 1].role !== 'user') {
        return res.status(400).json({ error: 'El último mensaje debe ser del usuario.' });
      }

      const system = [promptBase, promptModo, contextoNegocio].join('\n\n');
      const bodyAnthropic = {
        model: 'claude-sonnet-4-6',
        max_tokens: 1600,
        system,
        messages: limpio,
      };
      if (modo === 'audit-tienda') {
        bodyAnthropic.tools = [WEB_FETCH_TOOL];
      }

      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(bodyAnthropic),
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
    }

    return res.status(400).json({ error: 'Modo no reconocido.' });
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
};
