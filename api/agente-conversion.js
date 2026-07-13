// Endpoint server-side para el "agente vivo" de Conversión y Ventas — multi-tenant.
// La ANTHROPIC_API_KEY vive solo aquí (variable de entorno de Vercel), nunca en el cliente.

const fs = require('fs');
const path = require('path');

const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');
const DEFAULT_CLIENTE = 'jefeshub';

// Mapeo explícito cliente -> archivo (evita path traversal desde el body,
// y le da a Vercel un literal detectable para incluir el archivo en el bundle).
const CLIENTES = {
  jefeshub: 'system-prompt-jefeshub.md',
  'rancho-seco': 'system-prompt-rancho-seco.md',
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

  const { mensaje, imagen, cliente } = req.body || {};
  if (!mensaje && !imagen) {
    return res.status(400).json({ error: 'Falta mensaje o imagen.' });
  }

  const clienteId = (cliente || DEFAULT_CLIENTE).toString();
  const systemPrompt = cargarSystemPrompt(clienteId);
  if (!systemPrompt) {
    return res.status(400).json({ error: `Cliente desconocido: ${clienteId}` });
  }

  const content = [];
  if (imagen && imagen.mediaType && imagen.data) {
    content.push({ type: 'image', source: { type: 'base64', media_type: imagen.mediaType, data: imagen.data } });
  }
  content.push({
    type: 'text',
    text: systemPrompt + '\n\nMensaje del cliente / captura a analizar:\n' + (mensaje || '(ver captura adjunta)'),
  });

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
        max_tokens: 600,
        messages: [{ role: 'user', content }],
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
