// Proxy server-side para el boton "Verificar" de redes/referentes.
// Un fetch HEAD directo desde el navegador a instagram.com/tiktok.com/etc.
// siempre falla por CORS (esos sitios no mandan headers permisivos), asi
// que la unica forma real de verificar un link es pedirlo desde el servidor.

const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 30;
const hits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_REQUESTS;
}

// Bloqueo basico anti-SSRF: no dejar que este endpoint se use para tocar
// infraestructura interna. No es DNS-resolution-proof, pero cubre el caso
// obvio de que alguien meta una URL a localhost/red privada.
function isHostBloqueado(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h.endsWith('.local')) return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === '::1') return true;
  return false;
}

async function fetchConTimeout(url, opts, ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .toString()
    .split(',')[0]
    .trim();
  if (isRateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'Demasiadas solicitudes, espera unos minutos.' });
  }

  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ ok: false, error: 'Falta url.' });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    return res.status(400).json({ ok: false, error: 'URL inválida.' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ ok: false, error: 'Protocolo no permitido.' });
  }
  if (isHostBloqueado(parsed.hostname)) {
    return res.status(400).json({ ok: false, error: 'Host no permitido.' });
  }

  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; JefesHubLinkCheck/1.0)' };

  try {
    const r = await fetchConTimeout(parsed.toString(), { method: 'HEAD', redirect: 'follow', headers }, 6000);
    return res.status(200).json({ ok: r.status >= 200 && r.status < 400, status: r.status });
  } catch (err) {
    // Algunos sitios bloquean HEAD (405) o cortan la conexion — reintentamos con GET.
    try {
      const r2 = await fetchConTimeout(parsed.toString(), { method: 'GET', redirect: 'follow', headers }, 6000);
      return res.status(200).json({ ok: r2.status >= 200 && r2.status < 400, status: r2.status });
    } catch (err2) {
      return res.status(200).json({ ok: false, error: 'No se pudo contactar el sitio.' });
    }
  }
};
