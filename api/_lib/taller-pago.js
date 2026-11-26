// Alta automática al taller cuando alguien paga en la landing de GoHighLevel (GHL).
//
// Flujo: la persona paga en GHL → un workflow de GHL manda un aviso (acción "Webhook") a
// POST https://agentes.jefeshub.com/api/storage/ghl-pago → aquí se revisa la clave secreta y se agrega su correo a la
// tabla `invitados` del taller en Supabase. Cuando entra a jefeshub.com/taller-app/ con ese
// correo (enlace mágico, sin contraseña) queda dentro del taller y todo lo que llena se guarda
// en SU cuenta (las reglas de Supabase no dejan que nadie más lo vea).
//
// Variables en Vercel (nunca en el código):
//   GHL_WEBHOOK_SECRET            clave que también se pone en el workflow de GHL
//   TALLER_SUPABASE_URL           https://<proyecto>.supabase.co (la misma de taller-app/config.js)
//   TALLER_SUPABASE_SERVICE_KEY   service_role / secret key de Supabase (solo el servidor la ve)

const crypto = require('crypto');

const LINK_TALLER = 'https://jefeshub.com/taller-app/';
const TALLER_DEFAULT = 'primer-agente';
const SLUG_TALLER = /^[a-z0-9][a-z0-9-]{1,59}$/;
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,24}$/i;

const texto = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '');

function igualesSeguro(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

// La clave puede venir en el encabezado `x-ghl-secreto` (acción "Custom Webhook" de GHL) o como
// campo `secreto` dentro de los datos del aviso (acción "Webhook" normal → Custom Data).
function secretoValido(req) {
  const esperado = (process.env.GHL_WEBHOOK_SECRET || '').trim();
  if (!esperado) return false;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const cd = body.customData && typeof body.customData === 'object' ? body.customData : {};
  const recibido = texto(req.headers['x-ghl-secreto'], 200) || texto(cd.secreto, 200) || texto(body.secreto, 200);
  return !!recibido && igualesSeguro(recibido, esperado);
}

// GHL manda los datos del contacto en la raíz (email, first_name, full_name, contact_id…),
// a veces dentro de `contact`, y lo que se agregue en "Custom Data" dentro de `customData`.
function datosDelAviso(body) {
  const b = body && typeof body === 'object' ? body : {};
  const c = b.contact && typeof b.contact === 'object' ? b.contact : {};
  const cd = b.customData && typeof b.customData === 'object' ? b.customData : {};
  const email = (texto(cd.email, 260) || texto(b.email, 260) || texto(c.email, 260)).toLowerCase();
  const nombre = texto(cd.nombre, 120) || texto(b.full_name, 120) || texto(c.name, 120)
    || [texto(b.first_name, 60), texto(b.last_name, 60)].filter(Boolean).join(' ')
    || [texto(c.firstName, 60), texto(c.lastName, 60)].filter(Boolean).join(' ');
  const taller = (texto(cd.taller, 60) || TALLER_DEFAULT).toLowerCase();
  return { email, nombre, taller };
}

// Agrega el correo como alumno. Si ya estaba (o es la ponente / soporte) no cambia nada:
// así un pago repetido o una compra de Jany nunca le quita su rol.
async function darAcceso({ email, nombre, taller }, fetchFn) {
  const url = (process.env.TALLER_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const clave = (process.env.TALLER_SUPABASE_SERVICE_KEY || '').trim();
  if (!url || !clave) return { codigo: 500, cuerpo: { error: 'Falta configurar Supabase del taller en Vercel.' } };
  const h = { apikey: clave, Authorization: 'Bearer ' + clave, 'Content-Type': 'application/json' };

  let r = await fetchFn(url + '/rest/v1/talleres?select=id&slug=eq.' + encodeURIComponent(taller), { headers: h });
  if (!r.ok) return { codigo: 502, cuerpo: { error: 'No se pudo consultar el taller.' } }; // GHL reintenta
  const filas = await r.json();
  if (!Array.isArray(filas) || !filas[0] || !filas[0].id) return { codigo: 400, cuerpo: { error: 'Ese taller no existe.' } };

  r = await fetchFn(url + '/rest/v1/invitados?on_conflict=taller_id,email', {
    method: 'POST',
    headers: Object.assign({}, h, { Prefer: 'resolution=ignore-duplicates,return=minimal' }),
    body: JSON.stringify({ taller_id: filas[0].id, email, nombre: nombre || null, rol: 'alumno' }),
  });
  if (!r.ok) return { codigo: 502, cuerpo: { error: 'No se pudo dar el acceso.' } };
  return { codigo: 200, cuerpo: { ok: true, taller, link: LINK_TALLER } };
}

async function manejarPagoGhl(req, res, fetchFn) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (!secretoValido(req)) return res.status(401).json({ error: 'No autorizado.' });
  const datos = datosDelAviso(req.body);
  if (!EMAIL.test(datos.email)) return res.status(400).json({ error: 'El aviso no trae un correo válido.' });
  if (!SLUG_TALLER.test(datos.taller)) return res.status(400).json({ error: 'Taller inválido.' });
  try {
    const r = await darAcceso(datos, fetchFn || fetch);
    return res.status(r.codigo).json(r.cuerpo);
  } catch (err) {
    return res.status(502).json({ error: 'No se pudo dar el acceso.' });
  }
}

// ¿Ya pagó este correo? La página de gracias de GHL lo consulta antes de crear la contraseña.
// Solo se aceptan estos talleres (lista cerrada para que nadie pueda consultar otros).
const TALLERES_DE_PAGO = ['master-class-ia-agente', 'primer-agente'];
async function tienePago(email, taller, fetchFn) {
  const url = (process.env.TALLER_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const clave = (process.env.TALLER_SUPABASE_SERVICE_KEY || '').trim();
  if (!url || !clave) return null;
  const h = { apikey: clave, Authorization: 'Bearer ' + clave };
  let r = await fetchFn(url + '/rest/v1/talleres?select=id&slug=eq.' + encodeURIComponent(taller), { headers: h });
  if (!r.ok) return null;
  const filas = await r.json();
  if (!Array.isArray(filas) || !filas[0]) return null;
  r = await fetchFn(url + '/rest/v1/invitados?select=id&taller_id=eq.' + filas[0].id + '&email=eq.' + encodeURIComponent(email.toLowerCase()), { headers: h });
  if (!r.ok) return null;
  const inv = await r.json();
  return Array.isArray(inv) && inv.length > 0;
}

async function manejarVerificarPago(req, res, fetchFn) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const body = req.body || {};
  const email = String(body.email || '').trim();
  const taller = TALLERES_DE_PAGO.includes(body.taller) ? body.taller : 'master-class-ia-agente';
  if (!EMAIL.test(email)) return res.status(400).json({ ok: false, error: 'Correo no válido.' });
  const ok = await tienePago(email, taller, fetchFn || fetch);
  if (ok === null) return res.status(502).json({ ok: false, error: 'No pudimos verificar tu pago. Intenta de nuevo en unos minutos.' });
  return res.status(200).json({ ok });
}

module.exports = { manejarPagoGhl, manejarVerificarPago, datosDelAviso, secretoValido, darAcceso, LINK_TALLER };
