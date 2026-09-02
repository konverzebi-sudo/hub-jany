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

// ─── Leads del Diagnóstico Exprés (diagnostico-negocio.html) ───
// Vive aquí, como caso especial de la key "leads", en vez de en su propio archivo
// api/leads.js: el plan Hobby de Vercel tiene un límite de funciones serverless y este
// proyecto ya estaba justo en el límite -- agregar un archivo nuevo lo pasaba y tumbaba
// TODOS los despliegues (no solo este). Mismo patrón que ya se usa en otros endpoints de
// este proyecto (ej. api/consultor-366.js resuelve más de un agente por dentro de un
// mismo archivo) para no seguir sumando funciones nuevas.
// POST es público (cualquiera que llena el formulario del diagnóstico puede registrar
// su propio lead, igual que un formulario de contacto normal) — GET exige el token de
// administrador porque ahí sí hay datos sensibles de clientes reales (nombre, WhatsApp,
// dolores del negocio) que no deben quedar visibles para cualquiera con el código fuente.
async function ensureLeadsTable() {
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

async function manejarLeads(req, res) {
  try {
    await ensureLeadsTable();
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
}

module.exports = async function handler(req, res) {
  // Los datos cambian por dispositivo en cualquier momento: nunca cachear
  // esta respuesta (ni en el browser ni en el edge de Vercel), o un refresh
  // puede mostrar una copia vieja y dar la impresión de que se perdió lo guardado.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  // jefeshub.com (GitHub Pages) vive en otro origen que agentes.jefeshub.com
  // (Vercel) — sin esto el navegador bloquea el fetch desde /davilada o el diagnóstico.
  res.setHeader('Access-Control-Allow-Origin', 'https://jefeshub.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Storage-Token, X-Leads-Token');
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

  if (key === 'leads') {
    return manejarLeads(req, res);
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
