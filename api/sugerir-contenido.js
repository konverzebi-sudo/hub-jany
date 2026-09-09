// Endpoint server-side que agrupa DOS funciones sin relación (por el límite de 12 Serverless
// Functions del plan Hobby de Vercel -- mismo motivo por el que api/generar-anuncios.js ya
// consolida 5 modos en un solo archivo). Se distinguen por body.modo:
//
// body.modo ausente     -> (original) sugiere gancho + caption al desarrollar una idea del
//                          Jefe de Historias y Contenido.
// body.modo === 'prospeccion' -> (Jefe de Prospección) genera mensajes de primer contacto de
//                          WhatsApp para un lote de leads. Standalone, NO multi-tenant: no lee
//                          ADN de ningún cliente, la oferta/tono los manda el propio front-end.

const fs = require('fs');
const path = require('path');

const SYSTEM_CONTEXT = `Eres el asistente de contenido de JefesHub, una plataforma de generación de contenido con IA para emprendedores. Tono: mexicano-casual, directo, cercano, con personalidad — nunca corporativo ni acartonado, nunca burlón hacia el cliente.

Vas a recibir una idea cruda para una historia o publicación de redes sociales. Tu trabajo es proponer:
1. Un GANCHO (hook) corto y llamativo para arrancar el video o la historia — máximo 12 palabras, debe generar curiosidad o identificación inmediata.
2. Un CAPTION breve para acompañar la publicación — 1 a 3 líneas, tono cercano, puede incluir un CTA suave si aplica naturalmente.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional antes ni después, con este formato exacto:
{"gancho": "...", "caption": "..."}`;

const PROMPT_PATH_PROSPECCION = path.join(__dirname, '..', 'prompts', 'system-prompt-jefe-prospeccion.md');
const MAX_LEADS_POR_LOTE = 15;
const MAX_TEXTO_LARGO = 4000;

let promptProspeccionCache = null;
function cargarPromptProspeccion() {
  if (promptProspeccionCache) return promptProspeccionCache;
  promptProspeccionCache = fs.readFileSync(PROMPT_PATH_PROSPECCION, 'utf-8');
  return promptProspeccionCache;
}

const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 20;
const hits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_REQUESTS;
}

function extractJson(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
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
    // sigue al fallback
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

function truncar(str, limite) {
  if (!str) return '';
  const texto = str.toString();
  return texto.length > limite ? texto.slice(0, limite) + '\n[...recortado...]' : texto;
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

// ---------- modo ausente: sugerir gancho + caption (Jefe de Historias y Contenido) ----------

async function manejarModoSugerirContenido(body, res) {
  const { idea } = body || {};
  if (!idea || !idea.trim()) {
    return res.status(400).json({ error: 'Falta la idea.' });
  }

  const { ok, status, data } = await llamarClaude(SYSTEM_CONTEXT, 'Idea: ' + idea, 300);
  if (!ok) {
    return res.status(status).json({ error: data?.error?.message || 'Error al llamar a la API.' });
  }

  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const parsed = extractJson(text);
  if (!parsed || !parsed.gancho) {
    return res.status(502).json({ error: 'No se pudo interpretar la sugerencia del modelo.' });
  }

  return res.status(200).json({ gancho: parsed.gancho, caption: parsed.caption || '' });
}

// ---------- modo 'prospeccion': mensajes de primer contacto de WhatsApp (Jefe de Prospección) ----------

async function manejarModoProspeccion(body, res) {
  const leadsEntrada = Array.isArray(body.leads) ? body.leads : [];
  const oferta = truncar(body.oferta, MAX_TEXTO_LARGO);
  const tono = truncar(body.tono, MAX_TEXTO_LARGO);

  if (leadsEntrada.length === 0) {
    return res.status(400).json({ error: 'Falta el lote de negocios a generar.' });
  }
  if (leadsEntrada.length > MAX_LEADS_POR_LOTE) {
    return res.status(400).json({ error: `Máximo ${MAX_LEADS_POR_LOTE} negocios por lote.` });
  }

  const lote = leadsEntrada.map((l, i) => ({
    id: (l && l.id) ? l.id.toString() : `lead${i + 1}`,
    nombre: (l && l.nombre) ? l.nombre.toString().trim() : 'Negocio sin nombre',
    giro: (l && l.giro) ? l.giro.toString().trim() : '',
    motivo: (l && l.motivo) ? l.motivo.toString().trim() : '',
    potencial: (l && l.potencial) ? l.potencial.toString().trim() : '',
  }));

  const bloqueOferta = 'OFERTA/PAQUETE:\n' + (oferta || '(no se especificó -- usa un beneficio genérico creíble sin inventar detalles de precio ni producto)');
  const bloqueTono = 'TONO Y EJEMPLOS:\n' + (tono || '(no se especificó -- usa un tono casual, cercano, mexicano, de tú)');
  const bloqueLote = 'LOTE DE NEGOCIOS (' + lote.length + '):\n' + lote.map((l, i) =>
    `${i + 1}. id="${l.id}"\n   Nombre: ${l.nombre}\n   Giro: ${l.giro || 'sin especificar'}\n   Motivo: ${l.motivo || 'sin especificar'}\n   Potencial: ${l.potencial || 'sin especificar'}`
  ).join('\n');

  const system = [cargarPromptProspeccion(), bloqueOferta, bloqueTono].join('\n\n');
  const userMessage = bloqueLote + '\n\nGenera el mensaje de primer contacto de WhatsApp para cada uno, en el formato JSON (array) indicado, mismo orden y mismo "id".';

  const { ok, status, data } = await llamarClaude(system, userMessage, Math.min(4000, 300 + lote.length * 220));
  if (!ok) {
    return res.status(status).json({ error: data?.error?.message || 'Error al llamar a la API.' });
  }

  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const parsed = extractJsonArray(text);
  if (!parsed || parsed.length === 0) {
    return res.status(502).json({
      error: data.stop_reason === 'max_tokens'
        ? 'La respuesta quedó incompleta. Intenta con menos negocios por lote.'
        : 'No se pudo interpretar la respuesta del modelo.',
    });
  }

  const mensajes = parsed.map((d, i) => ({
    id: (d && d.id) ? d.id.toString() : (lote[i] ? lote[i].id : `lead${i + 1}`),
    mensaje: (d && d.mensaje) ? d.mensaje.toString().trim() : '',
  }));

  return res.status(200).json({
    mensajes,
    usage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 },
  });
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

  try {
    if (body.modo === 'prospeccion') return await manejarModoProspeccion(body, res);
    return await manejarModoSugerirContenido(body, res);
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
};
