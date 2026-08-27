// Endpoint server-side para "Generar Estrategia de WhatsApp" del Jefe WhatsApp y Ventas — multi-tenant.
// La ANTHROPIC_API_KEY vive solo aquí. Arranca automáticamente con el ADN completo del negocio
// (identidad, tono, catálogo, audiencia) + el Jefe 366 (Comunicación, Sistema 366,
// ángulos, frases) -- mismo patrón que api/jefe-conversion.js y api/generar-ideas-366.js.
// Si falta información clave, devuelve hasta 3 preguntas de confirmación en vez de generar a ciegas
// (una sola vuelta: el cliente reenvía las respuestas en `qa` y ya no se vuelve a preguntar).

const fs = require('fs');
const path = require('path');
const { sql } = require('@vercel/postgres');

const DEFAULT_CLIENTE = 'rancho-seco';
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt-jefe-estrategia-whatsapp.md');
const CONTEXT_CHAR_LIMIT = 14000;
const TXT_CONVERSACION_LIMIT = 6000;
const MAX_IMAGENES = 4;

const TARJETAS_CAMPOS = [
  's1_bienvenida', 's1_video_apertura',
  's2_preguntas_calificacion', 's2_explicacion_producto',
  's3_mensaje_precio', 's3_faq1_pregunta', 's3_faq1_respuesta', 's3_faq2_pregunta', 's3_faq2_respuesta',
  's4_obj_precio_ideal', 's4_obj_precio_corta',
  's4_obj_tiempo_ideal', 's4_obj_tiempo_corta',
  's4_obj_confianza_ideal', 's4_obj_confianza_corta',
  's4_obj_pensar_ideal', 's4_obj_pensar_corta',
  's4_obj_consulta_ideal', 's4_obj_consulta_corta',
  's5_mensaje_cierre', 's5_checklist_cierre', 's5_mensaje_confirmacion',
  // Seguimiento (leads activos que se quedaron a medias) -- 7 casos x 3 versiones
  'sg_preguntoinfo_calido', 'sg_preguntoinfo_directo', 'sg_preguntoinfo_corto',
  'sg_recibioprecio_calido', 'sg_recibioprecio_directo', 'sg_recibioprecio_corto',
  'sg_pensarlo_calido', 'sg_pensarlo_directo', 'sg_pensarlo_corto',
  'sg_caro_calido', 'sg_caro_directo', 'sg_caro_corto',
  'sg_interesasinpago_calido', 'sg_interesasinpago_directo', 'sg_interesasinpago_corto',
  'sg_disponibilidad_calido', 'sg_disponibilidad_directo', 'sg_disponibilidad_corto',
  'sg_ultimo_calido', 'sg_ultimo_directo', 'sg_ultimo_corto',
  // Reactivación (leads enfriados o clientas que podrían volver) -- 7 segmentos x 2 versiones
  'rx_nuncacompro_principal', 'rx_nuncacompro_corto',
  'rx_preciodesaparecio_principal', 'rx_preciodesaparecio_corto',
  'rx_pensarnovolvio_principal', 'rx_pensarnovolvio_corto',
  'rx_sinrespuesta_principal', 'rx_sinrespuesta_corto',
  'rx_comprouna_principal', 'rx_comprouna_corto',
  'rx_antigua_principal', 'rx_antigua_corto',
  'rx_vip_principal', 'rx_vip_corto',
];

let fixedPromptCache = null;
function cargarPromptFijo() {
  if (fixedPromptCache) return fixedPromptCache;
  fixedPromptCache = fs.readFileSync(PROMPT_PATH, 'utf-8');
  return fixedPromptCache;
}

// Rate limit básico en memoria (por IP) -- ventana más generosa que jefe-conversion.js
// porque una generación completa puede necesitar 2 llamadas (preguntas + generación real).
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 10;
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

// ---------- formateo del CONTEXTO DEL NEGOCIO a partir del ADN (mismo patrón que api/jefe-conversion.js) ----------

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

// ---------- formateo del CONTEXTO 366 (Comunicación + Sistema -- incluye ángulos y frases) ----------
// Mismo formateo genérico que api/consultor-366.js (formatearNotasGuardadas): no le hace
// falta conocer la forma exacta de cada campo (texto, tabla, objeto), lo aplana de forma legible.

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

// Banco de Conversaciones reales de WhatsApp -- se guarda desde esta misma página (Jefe WhatsApp
// y Ventas, {cliente}:whatsapp-convos) y se lee aquí como contexto extra, misma memoria compartida.
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
  return 'BANCO DE CONVERSACIONES REALES DE WHATSAPP (guardadas por el usuario aquí mismo -- son transcripciones reales de clientes, úsalas para frases reales, objeciones y tono; no las inventes ni las repitas tal cual):\n\n' + recortado;
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
    return 'CONTEXTO 366: todavía no hay Comunicación ni Sistema 366 guardados para esta marca -- genera con lo que sí haya del ADN.';
  }
  return 'CONTEXTO 366 (Jefe 366 ya guardado — úsalo para ángulos, frases y tono, no lo repitas tal cual):\n\n' + truncar(bloques.join('\n\n'), CONTEXT_CHAR_LIMIT);
}

// ---------- parseo de la respuesta del modelo ----------

function extractJson(text) {
  if (!text) return null;
  const limpio = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(limpio);
  } catch (err) {
    // sigue al fallback
  }
  const match = limpio.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (err) {
    return null;
  }
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
  const imagenes = Array.isArray(body.imagenes) ? body.imagenes.slice(0, MAX_IMAGENES) : [];
  const txtConversacion = typeof body.txtConversacion === 'string' ? truncar(body.txtConversacion, TXT_CONVERSACION_LIMIT) : '';
  const qa = Array.isArray(body.qa) ? body.qa.filter((x) => x && x.pregunta) : null;
  const tarjetasActuales = body.tarjetasActuales && typeof body.tarjetasActuales === 'object' ? body.tarjetasActuales : null;

  try {
    const promptFijo = cargarPromptFijo();
    const [contextoNegocio, contexto366] = await Promise.all([
      construirContextoNegocio(clienteId),
      construirContexto366(clienteId),
    ]);
    const system = [promptFijo, contextoNegocio, contexto366].join('\n\n');

    const content = [];
    imagenes.forEach((img) => {
      if (img && img.mediaType && img.data) {
        content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
      }
    });

    const partesUsuario = [];
    if (tarjetasActuales) {
      const llenas = TARJETAS_CAMPOS
        .filter((campo) => tarjetasActuales[campo] && tarjetasActuales[campo].toString().trim())
        .map((campo) => `- ${campo}: ${tarjetasActuales[campo].toString().trim()}`);
      if (llenas.length) {
        partesUsuario.push(
          'CONTENIDO ACTUAL DE LAS TARJETAS (ya editado o generado antes por el usuario) -- úsalo como base: conserva lo que sigue siendo bueno, complétalo o mejóralo con la información nueva que tengas, no lo descartes ni lo reescribas sin razón. Los campos que no aparezcan aquí están vacíos, genéralos desde cero:\n' +
          llenas.join('\n')
        );
      }
    }
    if (qa && qa.length) {
      partesUsuario.push(
        'El usuario ya contestó tus preguntas de una ronda anterior. NO vuelvas a preguntar bajo ninguna circunstancia -- genera las tarjetas ahora con lo mejor disponible:\n' +
        qa.map((x, i) => `${i + 1}. ${x.pregunta}\nRespuesta: ${(x.respuesta || '(sin respuesta)').toString().trim()}`).join('\n\n')
      );
    }
    if (txtConversacion) {
      partesUsuario.push('CONVERSACIÓN REAL DE WHATSAPP EXPORTADA (usar solo para tono/vocabulario/objeciones reales, nunca para precios):\n' + txtConversacion);
    }
    if (imagenes.length) {
      partesUsuario.push('Se adjuntan capturas de conversaciones reales como contexto adicional.');
    }
    if (partesUsuario.length === 0) {
      partesUsuario.push('Genera la estrategia de WhatsApp por temperatura para este negocio.');
    }
    content.push({ type: 'text', text: partesUsuario.join('\n\n') });

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 7000,
        system,
        messages: [{ role: 'user', content }],
      }),
    });

    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      return res.status(anthropicRes.status).json({ error: data?.error?.message || 'Error al llamar a la API.' });
    }

    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const parsed = extractJson(text);
    if (!parsed) {
      return res.status(502).json({
        error: data.stop_reason === 'max_tokens'
          ? 'La respuesta quedó incompleta (muy larga). Intenta de nuevo.'
          : 'No se pudo interpretar la respuesta del modelo.',
      });
    }

    await registrarUsoTokens(clienteId, 'jefe-estrategia-whatsapp', data.usage);

    if (Array.isArray(parsed.preguntas) && parsed.preguntas.length > 0 && !parsed.tarjetas) {
      return res.status(200).json({ preguntas: parsed.preguntas.slice(0, 3) });
    }

    if (parsed.tarjetas && typeof parsed.tarjetas === 'object') {
      const tarjetas = {};
      TARJETAS_CAMPOS.forEach((campo) => {
        tarjetas[campo] = typeof parsed.tarjetas[campo] === 'string' ? parsed.tarjetas[campo] : '';
      });
      return res.status(200).json({
        tarjetas,
        usage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 },
      });
    }

    return res.status(502).json({ error: 'Respuesta del modelo en un formato inesperado.' });
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
};
