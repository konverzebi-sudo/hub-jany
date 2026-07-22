// Endpoint server-side para el "agente vivo" del Consultor Evergreen (Publicidad — Rancho Seco).
// Mismo patron que api/agente-conversion.js: la ANTHROPIC_API_KEY vive solo aqui.

const fs = require('fs');
const path = require('path');

const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-evergreen-rancho-seco.md');

let systemPromptCache = null;
function cargarSystemPrompt() {
  if (systemPromptCache) return systemPromptCache;
  systemPromptCache = fs.readFileSync(PROMPT_PATH, 'utf-8');
  return systemPromptCache;
}

// Rate limit básico en memoria (por IP, best-effort entre invocaciones warm de la misma instancia).
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

  const { mensaje } = req.body || {};
  if (!mensaje || !mensaje.toString().trim()) {
    return res.status(400).json({ error: 'Falta mensaje.' });
  }

  const systemPrompt = cargarSystemPrompt();

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
        max_tokens: 800,
        messages: [{ role: 'user', content: systemPrompt + '\n\nPregunta del usuario:\n' + mensaje }],
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
    return res.status(200).json({ text });
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
};
