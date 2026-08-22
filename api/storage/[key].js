// Reemplaza 1:1 el window.storage.get()/set() del entorno de artifacts.
// GET es público (lectura de datos internos no sensibles); POST exige el token compartido.

const { sql } = require('@vercel/postgres');

async function ensureTable() {
  await sql`CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
}

// Llaves de escritura pública: no piden el token compartido porque su
// dueño (una sola herramienta, sin datos de negocio) quiere que cualquiera
// con el link pueda editar sin fricción. Mantener esta lista corta.
const PUBLIC_WRITE_KEYS = ['davilada-arbol-familiar'];

module.exports = async function handler(req, res) {
  // Los datos cambian por dispositivo en cualquier momento: nunca cachear
  // esta respuesta (ni en el browser ni en el edge de Vercel), o un refresh
  // puede mostrar una copia vieja y dar la impresión de que se perdió lo guardado.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  // jefeshub.com (GitHub Pages) vive en otro origen que ia.jefeshub.com
  // (Vercel) — sin esto el navegador bloquea el fetch desde /davilada.
  res.setHeader('Access-Control-Allow-Origin', 'https://jefeshub.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Storage-Token');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { key } = req.query;
  // Permite letras, numeros, "_", "-", ":" (prefijo multi-tenant "cliente:key")
  // y "." (subclaves tipo "brand-book.identidad"). Sigue rechazando espacios,
  // barras y comillas — cualquier caracter fuera de esta lista tumba el match.
  if (!key || Array.isArray(key) || !/^[a-zA-Z0-9_.:-]+$/.test(key)) {
    return res.status(400).json({ error: 'Key inválida.' });
  }

  try {
    await ensureTable();
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo conectar a la base de datos.' });
  }

  if (req.method === 'GET') {
    try {
      const { rows } = await sql`SELECT value, updated_at FROM kv_store WHERE key = ${key}`;
      return res.status(200).json({
        value: rows[0] ? rows[0].value : null,
        updatedAt: rows[0] ? rows[0].updated_at : null,
      });
    } catch (err) {
      return res.status(500).json({ error: 'Error leyendo storage.' });
    }
  }

  if (req.method === 'POST') {
    if (!PUBLIC_WRITE_KEYS.includes(key)) {
      // trim: un espacio o salto de linea de mas al copiar/pegar el token (ya sea
      // al escribirlo en el prompt o al pegarlo en las env vars de Vercel) rompe
      // la comparacion exacta y hace que el cliente borre el token guardado y
      // vuelva a pedirlo en cada guardado.
      const token = (req.headers['x-storage-token'] || '').toString().trim();
      const expected = (process.env.STORAGE_WRITE_TOKEN || '').trim();
      if (!token || !expected || token !== expected) {
        return res.status(401).json({ error: 'No autorizado.' });
      }
    }
    const body = req.body || {};
    if (body.value === undefined) {
      return res.status(400).json({ error: 'Falta value.' });
    }
    const json = JSON.stringify(body.value);
    // 6MB: deja margen para el logo (base64, ya redimensionado a ~400px en el
    // cliente antes de guardarse) conviviendo con el resto del value en la misma key.
    if (json.length > 6000000) {
      return res.status(413).json({ error: 'Valor demasiado grande.' });
    }
    try {
      await sql`
        INSERT INTO kv_store (key, value, updated_at)
        VALUES (${key}, ${json}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = ${json}::jsonb, updated_at = now()
      `;
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Error guardando en storage.' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
};
