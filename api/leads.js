// Registro de leads del Diagnóstico Exprés (diagnostico-negocio.html).
// POST es público (cualquiera que llena el formulario del diagnóstico puede registrar
// su propio lead, igual que un formulario de contacto normal) — GET exige el token de
// administrador porque ahí sí hay datos sensibles de clientes reales (nombre, WhatsApp,
// dolores del negocio) que no deben quedar visibles para cualquiera con el código fuente.

const { sql } = require('@vercel/postgres');

async function ensureTable() {
  await sql`CREATE TABLE IF NOT EXISTS diagnostico_leads (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    nombre_empresario TEXT,
    whatsapp_prospecto TEXT,
    giro TEXT,
    que_vende TEXT,
    a_quien_vende TEXT,
    canales TEXT,
    link_canal1 TEXT,
    link_canal2 TEXT,
    ventas_mes TEXT,
    dolor TEXT,
    tarea_tiempo TEXT,
    competidor_url TEXT
  )`;
}

// Corta cualquier campo absurdamente largo antes de guardarlo (evita payloads gigantes)
function limitar(v, max) {
  if (typeof v !== 'string') return '';
  return v.slice(0, max);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  // diagnostico-negocio.html vive en jefeshub.com (GitHub Pages), este endpoint en
  // agentes.jefeshub.com (Vercel) — sin esto el navegador bloquea el fetch cross-origin.
  res.setHeader('Access-Control-Allow-Origin', 'https://jefeshub.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Leads-Token');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    await ensureTable();
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo conectar a la base de datos.' });
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    if (!b.nombreEmpresario || typeof b.nombreEmpresario !== 'string' || !b.nombreEmpresario.trim()) {
      return res.status(400).json({ error: 'Falta nombreEmpresario.' });
    }
    try {
      await sql`
        INSERT INTO diagnostico_leads (
          nombre_empresario, whatsapp_prospecto, giro, que_vende, a_quien_vende,
          canales, link_canal1, link_canal2, ventas_mes, dolor, tarea_tiempo, competidor_url
        ) VALUES (
          ${limitar(b.nombreEmpresario, 200)}, ${limitar(b.whatsappProspecto, 40)}, ${limitar(b.giro, 100)},
          ${limitar(b.queVende, 500)}, ${limitar(b.aQuienVende, 500)}, ${limitar(b.canales, 300)},
          ${limitar(b.linkCanal1, 300)}, ${limitar(b.linkCanal2, 300)}, ${limitar(b.ventasMes, 50)},
          ${limitar(b.dolor, 500)}, ${limitar(b.tareaTiempo, 500)}, ${limitar(b.competidorUrl, 300)}
        )
      `;
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Error guardando el lead.' });
    }
  }

  if (req.method === 'GET') {
    const token = (req.headers['x-leads-token'] || '').toString().trim();
    const expected = (process.env.LEADS_ADMIN_TOKEN || '').trim();
    if (!token || !expected || token !== expected) {
      return res.status(401).json({ error: 'No autorizado.' });
    }
    try {
      const { rows } = await sql`SELECT * FROM diagnostico_leads ORDER BY created_at DESC LIMIT 500`;
      return res.status(200).json({ leads: rows });
    } catch (err) {
      return res.status(500).json({ error: 'Error leyendo los leads.' });
    }
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS');
  return res.status(405).json({ error: 'Method not allowed' });
};
