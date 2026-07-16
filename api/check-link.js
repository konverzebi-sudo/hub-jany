// Proxy server-side para el boton "Verificar" de redes/referentes.
// Un fetch HEAD directo desde el navegador a instagram.com/tiktok.com/etc.
// siempre falla por CORS (esos sitios no mandan headers permisivos), asi
// que la unica forma real de verificar un link es pedirlo desde el servidor.
//
// Es un endpoint publico (sin token) que hace fetch de una URL que llega del
// cliente, asi que el filtro de SSRF no puede ser solo "bloquear localhost":
// - Las plataformas conocidas (redes sociales, wa.me) se validan contra una
//   lista blanca de dominios.
// - El campo Website y "Otro" en Radar de referentes son abiertos por diseno
//   (cualquier dominio del negocio o del referente), asi que para esos se
//   resuelve el DNS y se verifica que la IP real no caiga en un rango
//   privado/loopback/link-local antes de conectar — esto tambien cierra el
//   hueco de DNS rebinding que un filtro de solo-hostname no cubre.

const dns = require('dns').promises;

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

const DOMINIOS_PERMITIDOS = [
  'instagram.com',
  'facebook.com',
  'fb.com',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
  'wa.me',
  'whatsapp.com',
  'x.com',
  'twitter.com',
  'linkedin.com',
];

function esDominioPermitido(hostname) {
  const h = hostname.toLowerCase();
  return DOMINIOS_PERMITIDOS.some((d) => h === d || h.endsWith('.' + d));
}

// Cubre IPv4 e IPv6: loopback, redes privadas RFC1918, link-local (incluye
// 169.254.169.254, el endpoint de metadata en AWS/GCP/Azure), y unique-local IPv6.
function esIpPrivada(ip) {
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
    const partes = ip.split('.').map(Number);
    const [a, b] = partes;
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
    return false;
  }
  const low = ip.toLowerCase();
  if (low === '::1') return true;
  if (low.startsWith('fe80:')) return true;
  if (low.startsWith('fc') || low.startsWith('fd')) return true;
  if (low.startsWith('::ffff:')) return esIpPrivada(low.split('::ffff:')[1]);
  return false;
}

// Guarda rapida sobre el string del hostname (IPs literales tipeadas
// directamente en la URL, sin necesidad de resolver DNS).
function esHostLiteralBloqueado(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h.endsWith('.local')) return true;
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return esIpPrivada(h);
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

  const hostname = parsed.hostname;
  if (esHostLiteralBloqueado(hostname)) {
    return res.status(400).json({ ok: false, error: 'Host no permitido.' });
  }

  const enListaBlanca = esDominioPermitido(hostname);
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; JefesHubLinkCheck/1.0)' };

  if (enListaBlanca) {
    // Dominio conocido: se sigue redirect normal, es infraestructura publica
    // de terceros de la que ya confiamos.
    try {
      const r = await fetchConTimeout(parsed.toString(), { method: 'HEAD', redirect: 'follow', headers }, 6000);
      return res.status(200).json({ ok: r.status >= 200 && r.status < 400, status: r.status });
    } catch (err) {
      try {
        const r2 = await fetchConTimeout(parsed.toString(), { method: 'GET', redirect: 'follow', headers }, 6000);
        return res.status(200).json({ ok: r2.status >= 200 && r2.status < 400, status: r2.status });
      } catch (err2) {
        return res.status(200).json({ ok: false, error: 'No se pudo contactar el sitio.' });
      }
    }
  }

  // Dominio fuera de la lista blanca (Website del negocio, o "Otro" en Radar
  // de referentes): resolvemos DNS primero y verificamos la IP real antes de
  // conectar — esto bloquea el caso obvio (un dominio que resuelve a una IP
  // privada). Seguimos redirects igual que en la lista blanca: con
  // redirect:'manual', fetch() de Node devuelve status 0 (opaque redirect,
  // por spec WHATWG) en vez del 3xx real, lo que rompería la verificación
  // para cualquier sitio que redirija (ej. sin-www -> con-www), que es casi
  // todos. Queda como riesgo residual conocido: un dominio que pase el check
  // de DNS inicial y luego redirija a una IP interna en el propio fetch no
  // se detecta — aceptable para esta herramienta interna de bajo riesgo.
  let direccion;
  try {
    const resuelto = await dns.lookup(hostname);
    direccion = resuelto.address;
  } catch (err) {
    return res.status(200).json({ ok: false, error: 'No se pudo resolver el dominio.' });
  }
  if (esIpPrivada(direccion)) {
    return res.status(400).json({ ok: false, error: 'Host no permitido.' });
  }

  try {
    const r = await fetchConTimeout(parsed.toString(), { method: 'HEAD', redirect: 'follow', headers }, 6000);
    return res.status(200).json({ ok: r.status >= 200 && r.status < 400, status: r.status });
  } catch (err) {
    try {
      const r2 = await fetchConTimeout(parsed.toString(), { method: 'GET', redirect: 'follow', headers }, 6000);
      return res.status(200).json({ ok: r2.status >= 200 && r2.status < 400, status: r2.status });
    } catch (err2) {
      return res.status(200).json({ ok: false, error: 'No se pudo contactar el sitio.' });
    }
  }
};
