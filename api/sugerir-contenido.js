// Endpoint server-side para sugerir gancho + caption al desarrollar una idea
// del Agente de Historias y Contenido. Mismo patron que api/agente-conversion.js:
// la ANTHROPIC_API_KEY vive solo aqui, nunca en el cliente.

const SYSTEM_CONTEXT = `Eres el asistente de contenido de JefesHub, una plataforma de generación de contenido con IA para emprendedores. Tono: mexicano-casual, directo, cercano, con personalidad — nunca corporativo ni acartonado, nunca burlón hacia el cliente.

Vas a recibir una idea cruda para una historia o publicación de redes sociales. Tu trabajo es proponer:
1. Un GANCHO (hook) corto y llamativo para arrancar el video o la historia — máximo 12 palabras, debe generar curiosidad o identificación inmediata.
2. Un CAPTION breve para acompañar la publicación — 1 a 3 líneas, tono cercano, puede incluir un CTA suave si aplica naturalmente.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional antes ni después, con este formato exacto:
{"gancho": "...", "caption": "..."}`;

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
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (err) {
    return null;
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

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY en el servidor.' });
  }

  const { idea } = req.body || {};
  if (!idea || !idea.trim()) {
    return res.status(400).json({ error: 'Falta la idea.' });
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system: SYSTEM_CONTEXT,
        messages: [{ role: 'user', content: 'Idea: ' + idea }],
      }),
    });

    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      return res.status(anthropicRes.status).json({ error: data?.error?.message || 'Error al llamar a la API.' });
    }

    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const parsed = extractJson(text);
    if (!parsed || !parsed.gancho) {
      return res.status(502).json({ error: 'No se pudo interpretar la sugerencia del modelo.' });
    }

    return res.status(200).json({ gancho: parsed.gancho, caption: parsed.caption || '' });
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
};
