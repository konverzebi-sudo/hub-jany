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

// ─── Leads y citas del Diagnóstico Exprés (diagnostico-negocio.html, diagnostico.html) ───
// Vive aquí, como caso especial de la key "leads", en vez de en su propio archivo
// api/leads.js: el plan Hobby de Vercel tiene un límite de funciones serverless y este
// proyecto ya estaba justo en el límite -- agregar un archivo nuevo lo pasaba y tumbaba
// TODOS los despliegues (no solo este). Mismo patrón que ya se usa en otros endpoints de
// este proyecto (ej. api/consultor-366.js resuelve más de un agente por dentro de un
// mismo archivo) para no seguir sumando funciones nuevas.
//
// Qué es público y qué no:
// - POST sin id (registrar un lead / apartar una cita): público, como un formulario de contacto.
// - POST con id (actualizar): exige el edit_token que se le devolvió a quien creó el lead
//   (así nadie puede editar el lead de otra persona), o el token de administrador.
// - GET ?disponibilidad=1: público, solo devuelve fechas/horas libres, ningún dato personal.
// - GET (lista) y GET ?id=: solo administrador (nombre, WhatsApp y dolores de clientes reales).

// Horarios de las citas. Fuente única: la landing los lee de GET ?disponibilidad=1,
// así que para cambiar días u horas solo se edita aquí.
const HORARIOS_CITA = ['10:00', '12:00', '17:00', '19:00']; // hora del Centro de México
const DIA_CITA = 3;              // 0 = domingo ... 3 = miércoles
const SEMANAS_VISIBLES = 4;      // cuántos miércoles se ofrecen a la vez
const ANTICIPACION_HORAS = 24;   // no se puede apartar una cita que empieza en menos de esto
const HOLD_MINUTOS = 30;         // tiempo que un horario queda apartado mientras la persona paga
const OFFSET_MX_HORAS = 6;       // UTC-6 fijo: Saltillo no cambia de horario en verano

// Instante UTC (ms) de una fecha 'YYYY-MM-DD' y hora 'HH:MM' en hora de México.
function instanteCita(ymd, hhmm) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h + OFFSET_MX_HORAS, mi);
}

// Próximos miércoles con al menos un horario que cumpla la anticipación mínima.
function fechasDisponibles(ahora = Date.now()) {
  const mx = new Date(ahora - OFFSET_MX_HORAS * 3600 * 1000); // reloj de pared de México
  const cursor = new Date(Date.UTC(mx.getUTCFullYear(), mx.getUTCMonth(), mx.getUTCDate()));
  while (cursor.getUTCDay() !== DIA_CITA) cursor.setUTCDate(cursor.getUTCDate() + 1);
  const limite = ahora + ANTICIPACION_HORAS * 3600 * 1000;
  const fechas = [];
  while (fechas.length < SEMANAS_VISIBLES) {
    const ymd = cursor.toISOString().slice(0, 10);
    const horarios = HORARIOS_CITA.filter(h => instanteCita(ymd, h) >= limite);
    if (horarios.length) fechas.push({ fecha: ymd, horarios });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return fechas;
}

let leadsTablaLista = null;
// Corre una sola vez por instancia de la función (no en cada request).
function ensureLeadsTable() {
  if (!leadsTablaLista) {
    leadsTablaLista = (async () => {
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
      // La tabla ya existía en producción antes de agregar estas columnas --
      // ADD COLUMN IF NOT EXISTS la pone al día sin perder los leads ya guardados.
      await sql`ALTER TABLE diagnostico_leads
        ADD COLUMN IF NOT EXISTS resumen_areas_criticas TEXT,
        ADD COLUMN IF NOT EXISTS resumen_top_oportunidad TEXT,
        ADD COLUMN IF NOT EXISTS resumen_top_accion TEXT,
        ADD COLUMN IF NOT EXISTS email TEXT,
        ADD COLUMN IF NOT EXISTS cita_fecha TEXT,
        ADD COLUMN IF NOT EXISTS cita_hora TEXT,
        ADD COLUMN IF NOT EXISTS cita_estado TEXT,
        ADD COLUMN IF NOT EXISTS origen TEXT,
        ADD COLUMN IF NOT EXISTS edit_token TEXT
      `;
      // Un solo horario activo por fecha+hora: la base de datos misma impide el doble apartado.
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_diagnostico_cita_activa
        ON diagnostico_leads (cita_fecha, cita_hora)
        WHERE cita_estado IN ('pendiente_pago', 'retorno_de_pago', 'confirmada')`;
    })().catch(err => { leadsTablaLista = null; throw err; });
  }
  return leadsTablaLista;
}

// Corta cualquier campo absurdamente largo antes de guardarlo (evita payloads gigantes)
function limitar(v, max) {
  if (typeof v !== 'string') return '';
  return v.slice(0, max);
}

function esEmail(s) {
  return typeof s === 'string' && s.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function iguales(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function esAdmin(req) {
  const token = (req.headers['x-leads-token'] || '').toString().trim();
  const expected = (process.env.LEADS_ADMIN_TOKEN || '').trim();
  return !!token && !!expected && iguales(token, expected);
}

function esChoqueDeHorario(err) {
  return !!err && (err.code === '23505' || /duplicate key|unique constraint/i.test(String(err.message)));
}

// Un horario apartado que no se pagó en HOLD_MINUTOS vuelve a quedar libre.
async function expirarPendientes() {
  await sql`UPDATE diagnostico_leads SET cita_estado = 'expirada'
    WHERE cita_estado = 'pendiente_pago' AND created_at < now() - make_interval(mins => ${HOLD_MINUTOS})`;
}

async function disponibilidad() {
  await expirarPendientes();
  const fechas = fechasDisponibles();
  const { rows } = await sql`SELECT cita_fecha, cita_hora FROM diagnostico_leads
    WHERE cita_fecha >= ${fechas[0].fecha}
      AND cita_estado IN ('pendiente_pago', 'retorno_de_pago', 'confirmada')`;
  const ocupados = new Set(rows.map(r => r.cita_fecha + ' ' + r.cita_hora));
  return {
    holdMinutos: HOLD_MINUTOS,
    fechas: fechas.map(f => ({
      fecha: f.fecha,
      horarios: f.horarios.map(h => ({ hora: h, libre: !ocupados.has(f.fecha + ' ' + h) })),
    })),
  };
}

// [campo del body, columna, largo máximo] — lo que se puede editar en un lead ya creado
const CAMPOS_LEAD = [
  ['nombreEmpresario', 'nombre_empresario', 200],
  ['whatsappProspecto', 'whatsapp_prospecto', 40],
  ['email', 'email', 200],
  ['giro', 'giro', 100],
  ['queVende', 'que_vende', 500],
  ['aQuienVende', 'a_quien_vende', 500],
  ['canales', 'canales', 300],
  ['linkCanal1', 'link_canal1', 300],
  ['linkCanal2', 'link_canal2', 300],
  ['ventasMes', 'ventas_mes', 50],
  ['dolor', 'dolor', 500],
  ['tareaTiempo', 'tarea_tiempo', 500],
  ['competidorUrl', 'competidor_url', 300],
  ['resumenAreasCriticas', 'resumen_areas_criticas', 300],
  ['resumenTopOportunidad', 'resumen_top_oportunidad', 200],
  ['resumenTopAccion', 'resumen_top_accion', 200],
];

async function manejarLeads(req, res) {
  try {
    await ensureLeadsTable();
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo conectar a la base de datos.' });
  }

  if (req.method === 'POST') {
    const b = req.body || {};

    // ── Actualizar un lead existente ──
    if (b.id !== undefined) {
      const id = parseInt(b.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'id inválido.' });
      }
      const admin = esAdmin(req);
      try {
        const { rows } = await sql`SELECT * FROM diagnostico_leads WHERE id = ${id}`;
        const fila = rows[0];
        const tokenOk = fila && fila.edit_token && iguales(fila.edit_token, String(b.token || ''));
        if (!admin && !tokenOk) {
          return res.status(403).json({ error: 'No autorizado.' }); // mismo error exista o no el id
        }
        if (!fila) return res.status(404).json({ error: 'No existe ese lead.' });

        if (b.email !== undefined && b.email !== '' && !esEmail(b.email)) {
          return res.status(400).json({ error: 'email_invalido' });
        }
        const n = {};
        for (const [campo, col, max] of CAMPOS_LEAD) {
          n[col] = b[campo] !== undefined ? limitar(b[campo], max) : fila[col];
        }
        let estado = fila.cita_estado;
        if (b.retornoPago === true && (estado === 'pendiente_pago' || estado === 'expirada')) {
          estado = 'retorno_de_pago';
        }
        if (admin && (b.citaEstado === 'confirmada' || b.citaEstado === 'cancelada')) {
          estado = b.citaEstado;
        }

        // Primero se guardan los datos (sin tocar el estado de la cita) y después se intenta
        // cambiar el estado: si el horario ya lo tomó otra persona, las respuestas no se pierden.
        await sql`
          UPDATE diagnostico_leads SET
            nombre_empresario = ${n.nombre_empresario}, whatsapp_prospecto = ${n.whatsapp_prospecto},
            email = ${n.email}, giro = ${n.giro}, que_vende = ${n.que_vende},
            a_quien_vende = ${n.a_quien_vende}, canales = ${n.canales},
            link_canal1 = ${n.link_canal1}, link_canal2 = ${n.link_canal2},
            ventas_mes = ${n.ventas_mes}, dolor = ${n.dolor}, tarea_tiempo = ${n.tarea_tiempo},
            competidor_url = ${n.competidor_url},
            resumen_areas_criticas = ${n.resumen_areas_criticas},
            resumen_top_oportunidad = ${n.resumen_top_oportunidad},
            resumen_top_accion = ${n.resumen_top_accion}
          WHERE id = ${id}
        `;
        if (estado !== fila.cita_estado) {
          try {
            await sql`UPDATE diagnostico_leads SET cita_estado = ${estado} WHERE id = ${id}`;
          } catch (err) {
            if (esChoqueDeHorario(err)) {
              return res.status(409).json({ error: 'horario_ocupado', guardado: true });
            }
            throw err;
          }
        }
        return res.status(200).json({ ok: true, estado });
      } catch (err) {
        if (esChoqueDeHorario(err)) {
          return res.status(409).json({ error: 'horario_ocupado' });
        }
        return res.status(500).json({ error: 'Error actualizando el lead.' });
      }
    }

    // ── Registrar un lead nuevo (con o sin cita) ──
    if (!b.nombreEmpresario || typeof b.nombreEmpresario !== 'string' || !b.nombreEmpresario.trim()) {
      return res.status(400).json({ error: 'Falta nombreEmpresario.' });
    }
    const quiereCita = b.citaFecha !== undefined || b.citaHora !== undefined;
    let citaFecha = null;
    let citaHora = null;
    let citaEstado = null;
    if (quiereCita) {
      if (!esEmail(b.email)) return res.status(400).json({ error: 'email_invalido' });
      const digitos = String(b.whatsappProspecto || '').replace(/\D/g, '');
      if (digitos.length < 10 || digitos.length > 15) {
        return res.status(400).json({ error: 'whatsapp_invalido' });
      }
      const f = fechasDisponibles().find(x => x.fecha === b.citaFecha);
      if (!f || !f.horarios.includes(b.citaHora)) {
        return res.status(400).json({ error: 'horario_no_valido' });
      }
      citaFecha = b.citaFecha;
      citaHora = b.citaHora;
      citaEstado = 'pendiente_pago';
    }
    const origen = quiereCita ? 'landing' : (b.origen === 'pre_formulario' ? 'pre_formulario' : 'herramienta');
    const token = crypto.randomBytes(16).toString('hex');

    try {
      if (quiereCita) await expirarPendientes();
      const { rows } = await sql`
        INSERT INTO diagnostico_leads (
          nombre_empresario, whatsapp_prospecto, email, giro, que_vende, a_quien_vende,
          canales, link_canal1, link_canal2, ventas_mes, dolor, tarea_tiempo, competidor_url,
          cita_fecha, cita_hora, cita_estado, origen, edit_token
        ) VALUES (
          ${limitar(b.nombreEmpresario, 200)}, ${limitar(b.whatsappProspecto, 40)}, ${limitar(b.email, 200)},
          ${limitar(b.giro, 100)}, ${limitar(b.queVende, 500)}, ${limitar(b.aQuienVende, 500)},
          ${limitar(b.canales, 300)}, ${limitar(b.linkCanal1, 300)}, ${limitar(b.linkCanal2, 300)},
          ${limitar(b.ventasMes, 50)}, ${limitar(b.dolor, 500)}, ${limitar(b.tareaTiempo, 500)},
          ${limitar(b.competidorUrl, 300)}, ${citaFecha}, ${citaHora}, ${citaEstado}, ${origen}, ${token}
        )
        RETURNING id
      `;
      return res.status(200).json({ ok: true, id: rows[0].id, token });
    } catch (err) {
      if (esChoqueDeHorario(err)) {
        return res.status(409).json({ error: 'horario_ocupado' });
      }
      return res.status(500).json({ error: 'Error guardando el lead.' });
    }
  }

  if (req.method === 'GET') {
    // Público: solo fechas y horas libres, ningún dato personal.
    if (req.query && req.query.disponibilidad) {
      try {
        return res.status(200).json(await disponibilidad());
      } catch (err) {
        return res.status(500).json({ error: 'Error leyendo la disponibilidad.' });
      }
    }

    if (!esAdmin(req)) {
      return res.status(401).json({ error: 'No autorizado.' });
    }
    try {
      await expirarPendientes();
      if (req.query && req.query.id !== undefined) {
        const id = parseInt(req.query.id, 10);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id inválido.' });
        const { rows } = await sql`
          SELECT id, created_at, nombre_empresario, whatsapp_prospecto, email, giro, que_vende,
                 a_quien_vende, canales, link_canal1, link_canal2, ventas_mes, dolor, tarea_tiempo,
                 competidor_url, cita_fecha, cita_hora, cita_estado, origen
          FROM diagnostico_leads WHERE id = ${id}`;
        if (!rows[0]) return res.status(404).json({ error: 'No existe ese lead.' });
        return res.status(200).json({ lead: rows[0] });
      }
      // Sin edit_token: ese solo lo tiene quien creó el lead.
      const { rows } = await sql`
        SELECT id, created_at, nombre_empresario, whatsapp_prospecto, email, giro, que_vende,
               a_quien_vende, canales, link_canal1, link_canal2, ventas_mes, dolor, tarea_tiempo,
               competidor_url, resumen_areas_criticas, resumen_top_oportunidad, resumen_top_accion,
               cita_fecha, cita_hora, cita_estado, origen
        FROM diagnostico_leads ORDER BY created_at DESC LIMIT 500`;
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
