// Reemplaza 1:1 el window.storage.get()/set() del entorno de artifacts.
// GET es público (lectura de datos internos no sensibles); POST exige el token compartido.

const crypto = require('crypto');
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
  // La tabla ya existía en producción antes de agregar el mini-resumen del
  // diagnóstico -- ADD COLUMN IF NOT EXISTS la pone al día sin perder los leads
  // que ya se habían guardado.
  await sql`ALTER TABLE diagnostico_leads
    ADD COLUMN IF NOT EXISTS resumen_areas_criticas TEXT,
    ADD COLUMN IF NOT EXISTS resumen_top_oportunidad TEXT,
    ADD COLUMN IF NOT EXISTS resumen_top_accion TEXT
  `;
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

    // Actualiza solo el mini-resumen de un lead ya registrado (se manda cuando
    // Jany visualiza el diagnóstico completo, un rato después del registro inicial).
    if (b.id !== undefined) {
      const id = parseInt(b.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'id inválido.' });
      }
      try {
        await sql`
          UPDATE diagnostico_leads SET
            resumen_areas_criticas = ${limitar(b.resumenAreasCriticas, 300)},
            resumen_top_oportunidad = ${limitar(b.resumenTopOportunidad, 200)},
            resumen_top_accion = ${limitar(b.resumenTopAccion, 200)}
          WHERE id = ${id}
        `;
        return res.status(200).json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: 'Error actualizando el resumen.' });
      }
    }

    if (!b.nombreEmpresario || typeof b.nombreEmpresario !== 'string' || !b.nombreEmpresario.trim()) {
      return res.status(400).json({ error: 'Falta nombreEmpresario.' });
    }
    try {
      const { rows } = await sql`
        INSERT INTO diagnostico_leads (
          nombre_empresario, whatsapp_prospecto, giro, que_vende, a_quien_vende,
          canales, link_canal1, link_canal2, ventas_mes, dolor, tarea_tiempo, competidor_url
        ) VALUES (
          ${limitar(b.nombreEmpresario, 200)}, ${limitar(b.whatsappProspecto, 40)}, ${limitar(b.giro, 100)},
          ${limitar(b.queVende, 500)}, ${limitar(b.aQuienVende, 500)}, ${limitar(b.canales, 300)},
          ${limitar(b.linkCanal1, 300)}, ${limitar(b.linkCanal2, 300)}, ${limitar(b.ventasMes, 50)},
          ${limitar(b.dolor, 500)}, ${limitar(b.tareaTiempo, 500)}, ${limitar(b.competidorUrl, 300)}
        )
        RETURNING id
      `;
      return res.status(200).json({ ok: true, id: rows[0].id });
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

// ─── ADN previo (adn-previo.html) ───
// Formulario que la persona llena ANTES de su primera sesión y que escribe directo en el ADN de su
// espacio (brand-book.*). Vive aquí, como caso especial de la key "adn-previo", por el mismo límite
// de funciones serverless del plan Hobby que explica el caso de "leads".
// Seguridad: nunca se comparte el token maestro. Cada cliente tiene un código derivado (HMAC del
// slug con el token maestro) que solo se puede generar con el token (GET + X-Storage-Token). Con
// ese código solo se pueden escribir las secciones de ADN de ESE cliente, con campos permitidos,
// y solo si la sección está vacía o sigue tal cual la dejó este formulario (firma en
// "{cliente}:adn-previo-firmas") -- nunca pisa lo que ya se editó en el ADN.
function codigoAdnPrevio(cliente) {
  const secreto = (process.env.STORAGE_WRITE_TOKEN || '').trim();
  if (!secreto) return '';
  return crypto.createHmac('sha256', secreto).update('adn-previo:' + cliente).digest('hex').slice(0, 12);
}

function canonico(v) {
  if (Array.isArray(v)) return '[' + v.map(canonico).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonico(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
function firmaDe(v) { return crypto.createHash('sha1').update(canonico(v)).digest('hex'); }

function estaVacio(v) {
  if (v == null) return true;
  if (typeof v === 'string') return !v.trim();
  if (Array.isArray(v)) return v.every(estaVacio);
  if (typeof v === 'object') return Object.values(v).every(estaVacio);
  return false;
}

async function kvLeer(key) {
  const { rows } = await sql`SELECT value FROM kv_store WHERE key = ${key}`;
  if (!rows[0]) return null;
  let v = rows[0].value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { /* queda como texto */ } }
  return v;
}
// Mismo formato que escribe el cliente (storage-client.js): el value es un STRING con el JSON.
async function kvEscribir(key, data) {
  const json = JSON.stringify(JSON.stringify(data));
  await sql`
    INSERT INTO kv_store (key, value, updated_at) VALUES (${key}, ${json}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = ${json}::jsonb, updated_at = now()
  `;
}

const txt = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max || 1000) : '');
const lista = (v, maxItems, maxLen) => (Array.isArray(v) ? v.map((x) => txt(x, maxLen || 80)).filter(Boolean).slice(0, maxItems || 20) : []);

function handleLimpio(h) { return txt(h, 120).replace(/^@/, '').replace(/\s+/g, ''); }
const CANALES_PREVIO = {
  facebook: (h) => `https://facebook.com/${h}`,
  instagram: (h) => `https://instagram.com/${h}`,
  tiktok: (h) => `https://tiktok.com/@${h}`,
  youtube: (h) => `https://youtube.com/@${h}`,
  linkedin: (h) => `https://linkedin.com/in/${h}`,
};

// Cada limpiador devuelve el valor ya en el formato exacto que lee/escribe ADN.html.
const LIMPIADORES_PREVIO = {
  identidad: (d) => ({
    nombre: txt(d.nombre, 200), giro_categoria: txt(d.giro_categoria, 100), giro_texto: txt(d.giro_texto, 200),
    telefono: txt(d.telefono, 40), producto_estrella: txt(d.producto_estrella, 300),
    objetivos: lista(d.objetivos, 8, 60), obj_otro_texto: txt(d.obj_otro_texto, 300),
    anio_inicio: txt(d.anio_inicio, 10), meta_ventas_mensual: txt(d.meta_ventas_mensual, 40),
    historia: txt(d.historia, 2000), objetivo_principal: txt(d.objetivo_principal, 1000), mejora_deseada: txt(d.mejora_deseada, 1000),
  }),
  tono: (d) => ({
    tonos: lista(d.tonos, 8, 40), palabras_si: lista(d.palabras_si, 40, 60), palabras_no: lista(d.palabras_no, 40, 60),
    persona: txt(d.persona, 1500), ejemplo_si: txt(d.ejemplo_si, 1500), ejemplo_no: txt(d.ejemplo_no, 1500),
  }),
  redes: (d) => {
    const out = {};
    const web = txt(d.website, 200).replace(/\s+/g, '');
    if (web && !/^(javascript|data):/i.test(web)) out.website = { handle: web, link: /^https?:\/\//i.test(web) ? web : 'https://' + web };
    Object.keys(CANALES_PREVIO).forEach((k) => {
      const h = handleLimpio(d[k]);
      if (h) out[k] = { handle: h, link: CANALES_PREVIO[k](h) };
    });
    const numero = txt(d.whatsapp_numero, 40).replace(/[^\d+]/g, '');
    if (numero) {
      const mensaje = txt(d.whatsapp_mensaje, 500);
      out.whatsapp = { numero, ctas: [{ id: 'cta-previo', label: 'General', mensaje, link: 'https://wa.me/' + numero + (mensaje ? '?text=' + encodeURIComponent(mensaje) : '') }] };
    }
    const dir = txt(d.direccion, 300);
    if (dir) out.ubicacion = { direccion: dir };
    out._frecuencia = txt(d.frecuencia, 60);
    out._temas = txt(d.temas, 1000);
    out._tipos_contenido = lista(d.tipos_contenido, 12, 40);
    return out;
  },
  catalogo: (d) => (Array.isArray(d) ? d : []).slice(0, 30).map((r, i) => {
    r = r || {};
    const tipo = ['Producto', 'Servicio', 'Paquete'].includes(r.tipo) ? r.tipo : 'Producto';
    const vende = ['Mucho', 'Regular', 'Poco', 'No sé aún'].includes(r.que_tanto_se_vende) ? r.que_tanto_se_vende : '';
    return {
      id: 'previo' + (i + 1) + Date.now().toString(36), nombre: txt(r.nombre, 200), tipo, grupo_id: '',
      precio: txt(String(r.precio == null ? '' : r.precio), 20), costo: '', margen_pct: '', que_tanto_se_vende: vende, inventario: '', notas: txt(r.notas, 400),
    };
  }).filter((r) => r.nombre),
  audiencias: (d) => {
    d = d || {};
    return { lista: [{
      nombre: txt(d.nombre, 120) || 'Cliente ideal', grupo_id: '',
      descripcion_breve: txt(d.descripcion_breve, 1500), edad: txt(d.edad, 80), ubicacion: txt(d.ubicacion, 200), ocupacion: txt(d.ocupacion, 200),
      problema_resuelve: txt(d.problema_resuelve, 1500), que_convenceria: txt(d.que_convenceria, 1500),
      objecion_comun: txt(d.objecion_comun, 1000), frases: txt(d.frases, 1500),
    }] };
  },
};
// Llave real en kv_store de cada sección (sin el prefijo "{cliente}:").
const LLAVES_PREVIO = {
  identidad: 'brand-book.identidad', tono: 'brand-book.tono', redes: 'brand-book.redes',
  catalogo: 'catalogo-productos', audiencias: 'brand-book.audiencias',
};

async function manejarAdnPrevio(req, res) {
  const SLUG = /^[a-z0-9-]{2,40}$/;
  try { await ensureTable(); }
  catch (err) { return res.status(500).json({ error: 'No se pudo conectar a la base de datos.' }); }

  if (req.method === 'GET') {
    const token = (req.headers['x-storage-token'] || '').toString().trim();
    const expected = (process.env.STORAGE_WRITE_TOKEN || '').trim();
    if (!token || !expected || token !== expected) return res.status(401).json({ error: 'No autorizado.' });
    const cliente = (req.query.cliente || '').toString().trim().toLowerCase();
    if (!SLUG.test(cliente)) return res.status(400).json({ error: 'Cliente inválido (solo letras minúsculas, números y guiones).' });
    const codigo = codigoAdnPrevio(cliente);
    return res.status(200).json({ cliente, codigo, ruta: `/adn-previo?c=${cliente}&k=${codigo}` });
  }

  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }

  const b = req.body || {};
  const cliente = (typeof b.cliente === 'string' ? b.cliente : '').trim().toLowerCase();
  const codigo = (typeof b.codigo === 'string' ? b.codigo : '').trim();
  const esperado = SLUG.test(cliente) ? codigoAdnPrevio(cliente) : '';
  const okCodigo = esperado && codigo.length === esperado.length && crypto.timingSafeEqual(Buffer.from(codigo), Buffer.from(esperado));
  if (!okCodigo) return res.status(401).json({ error: 'Enlace no válido. Pide uno nuevo.' });
  if (JSON.stringify(b).length > 120000) return res.status(413).json({ error: 'Demasiado texto.' });
  const secciones = b.secciones && typeof b.secciones === 'object' ? b.secciones : {};

  try {
    const firmasKey = `${cliente}:adn-previo-firmas`;
    const firmas = (await kvLeer(firmasKey)) || {};
    const guardadas = [];
    const omitidas = [];
    for (const nombre of Object.keys(LIMPIADORES_PREVIO)) {
      if (secciones[nombre] === undefined) continue;
      const limpio = LIMPIADORES_PREVIO[nombre](secciones[nombre]);
      if (estaVacio(limpio)) continue;
      const key = `${cliente}:${LLAVES_PREVIO[nombre]}`;
      const actual = await kvLeer(key);
      const intacta = estaVacio(actual) || (firmas[nombre] && firmaDe(actual) === firmas[nombre]);
      if (!intacta) { omitidas.push(nombre); continue; }
      await kvEscribir(key, limpio);
      firmas[nombre] = firmaDe(await kvLeer(key));
      guardadas.push(nombre);
    }
    await kvEscribir(firmasKey, firmas);
    return res.status(200).json({ ok: true, guardadas, omitidas });
  } catch (err) {
    return res.status(500).json({ error: 'Error guardando tu ADN.' });
  }
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

  if (key === 'adn-previo') {
    return manejarAdnPrevio(req, res);
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
