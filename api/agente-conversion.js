// Endpoint server-side para el "agente vivo" del Agente de Conversión y Ventas.
// La ANTHROPIC_API_KEY vive solo aquí (variable de entorno de Vercel), nunca en el cliente.

const AGENT_SYSTEM_CONTEXT = `Eres el Agente de Conversión y Ventas de JefesHub, un negocio de Jany Dávila.

NEGOCIO: JefesHub — plataforma de generación de contenido con IA para emprendedores. $22 USD/mes, 30 días de trial gratis (se pide tarjeta, se cobra automático si no se cancela, se puede cancelar cuando quieran).
CLIENTE IDEAL: Emprendedor(a) independiente, 28-40 años, opera su negocio mayormente solo/a, ya probó IA genérica sin resultados, busca libertad real.
TONO: Cercano, directo, mexicano-casual, irreverente pero NUNCA burlón hacia el cliente. Nada de lenguaje corporativo.
REGLAS DURAS: Toda pregunta de precio se contesta con el número exacto, siempre. "No entiendo" nunca se deja abierto — se ofrece captura o videollamada de 5 min. Nunca presión falsa ni urgencia inventada. Nunca ofrecer descuentos extra al código JEFE5 sin aprobación de Jany.

Vas a recibir el último mensaje real de un cliente (o la descripción de una captura de conversación). Responde en este formato exacto, breve y accionable:

RESPUESTA LISTA PARA COPIAR: [el mensaje exacto que Jany debería mandar]
POR QUÉ FUNCIONA: [1 línea]
VERSIÓN CORTA: [alternativa más breve para WhatsApp/DM]
SIGUIENTE SEGUIMIENTO: [qué hacer si no contesta]`;

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

  const { mensaje, imagen } = req.body || {};
  if (!mensaje && !imagen) {
    return res.status(400).json({ error: 'Falta mensaje o imagen.' });
  }

  const content = [];
  if (imagen && imagen.mediaType && imagen.data) {
    content.push({ type: 'image', source: { type: 'base64', media_type: imagen.mediaType, data: imagen.data } });
  }
  content.push({
    type: 'text',
    text: AGENT_SYSTEM_CONTEXT + '\n\nMensaje del cliente / captura a analizar:\n' + (mensaje || '(ver captura adjunta)'),
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
