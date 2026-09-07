// Endpoint server-side para el Jefe de Prospección -- genera mensajes de primer contacto de
// WhatsApp para leads de prospección en frío (negocios locales levantados por el propio usuario,
// no clientes existentes). A diferencia de los demás api/*.js de este repo, NO es multi-tenant:
// no lee ADN de ningún cliente ni usa @vercel/postgres, la oferta/tono los manda el propio
// front-end en cada llamada (se editan y guardan ahí, en jefe-prospeccion.html).

const fs = require('fs');
const path = require('path');

const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt-jefe-prospeccion.md');
const MAX_LEADS_POR_LOTE = 15;
const MAX_TEXTO_LARGO = 4000;

let promptCache = null;
function cargarPrompt() {
  if (promptCache) return promptCache;
  promptCache = fs.readFileSync(PROMPT_PATH, 'utf-8');
  return promptCache;
}

// Rate limit básico en memoria (por IP) -- ventana generosa porque un lote completo de leads
// puede necesitar varias llamadas seguidas (una por página de 15).
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 20;
const hits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_REQUESTS;
}

function truncar(str, limite) {
  if (!str) return '';
  const texto = str.toString();
  return texto.length > limite ? texto.slice(0, limite) + '\n[...recortado...]' : texto;
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

  const system = [cargarPrompt(), bloqueOferta, bloqueTono].join('\n\n');
  const userMessage = bloqueLote + '\n\nGenera el mensaje de primer contacto de WhatsApp para cada uno, en el formato JSON (array) indicado, mismo orden y mismo "id".';

  try {
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
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
};
