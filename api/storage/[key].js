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

module.exports = async function handler(req, res) {
  // Los datos cambian por dispositivo en cualquier momento: nunca cachear
  // esta respuesta (ni en el browser ni en el edge de Vercel), o un refresh
  // puede mostrar una copia vieja y dar la impresión de que se perdió lo guardado.
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const { key } = req.query;
  if (!key || Array.isArray(key) || !/^[a-zA-Z0-9_-]+$/.test(key)) {
    return res.status(400).json({ error: 'Key inválida.' });
  }

  try {
    await ensureTable();
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo conectar a la base de datos.' });
  }

  if (req.method === 'GET') {
    try {
      const { rows } = await sql`SELECT value FROM kv_store WHERE key = ${key}`;
      return res.status(200).json({ value: rows[0] ? rows[0].value : null });
    } catch (err) {
      return res.status(500).json({ error: 'Error leyendo storage.' });
    }
  }

  if (req.method === 'POST') {
    const token = req.headers['x-storage-token'];
    if (!token || !process.env.STORAGE_WRITE_TOKEN || token !== process.env.STORAGE_WRITE_TOKEN) {
      return res.status(401).json({ error: 'No autorizado.' });
    }
    const body = req.body || {};
    if (body.value === undefined) {
      return res.status(400).json({ error: 'Falta value.' });
    }
    const json = JSON.stringify(body.value);
    if (json.length > 2000000) {
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
