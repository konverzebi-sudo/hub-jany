// Tope de uso de IA por hub ("válvulas") y paquetes extra.
//
// Cada hub tiene un tope de US$15 de costo de IA cada 30 días (desde su alta). Al llegar al tope,
// los Jefes dejan de usar la IA (la interfaz sigue funcionando) hasta que el ciclo se renueva o el
// cliente compra un paquete extra: otros US$15 de uso (~4.5 millones de tokens) por $750 MXN, con
// vigencia de 45 días. Primero se gasta el tope del ciclo y después los paquetes, empezando por el
// que vence antes.
//
// El documento vive en <hub>:saldo y SOLO lo escribe el servidor (api/storage/[key].js rechaza
// escrituras a esa llave): { cicloInicio, usadoCicloUSD, paquetes: [{ id, usd, usadoUSD, compra,
// vence, origen }], pagos: [ids de pagos ya acreditados] }.

const TOPE_USD = 15;
const PAQUETE_USD = 15;
const PAQUETE_DIAS = 45;
const CICLO_DIAS = 30;
const DIA_MS = 86400000;
// Hubs internos: ven la barra pero nunca se bloquean.
const SIN_TOPE = ['jefeshub'];
// Promedio real de los Jefes (oct 2026): entre 290 y 310 mil tokens por dólar de costo. Solo se usa
// para mostrar tokens al cliente; el tope se controla en dólares de costo real.
const TOKENS_POR_USD = 300000;
const PRECIO_MXN = 750;
const PRECIO_ANTES_MXN = 1000;

const USD_ENTRADA = 3, USD_SALIDA = 15, USD_CACHE_ESCRITURA = 3.75, USD_CACHE_LECTURA = 0.30;

// Costo en dólares de un registro de uso ({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }).
function costoUSD(u) {
  const i = (u && u.inputTokens) || 0, cr = (u && u.cacheReadTokens) || 0, cw = (u && u.cacheWriteTokens) || 0;
  const normal = Math.max(0, i - cr - cw);
  return (normal * USD_ENTRADA + cw * USD_CACHE_ESCRITURA + cr * USD_CACHE_LECTURA + ((u && u.outputTokens) || 0) * USD_SALIDA) / 1e6;
}

function docNuevo(inicio) {
  return { cicloInicio: new Date(inicio).toISOString(), usadoCicloUSD: 0, paquetes: [], pagos: [] };
}

// Avanza el ciclo si ya pasaron 30 días y quita los paquetes vencidos. Modifica y devuelve doc.
function normalizar(doc, ahora) {
  const t = new Date(ahora).getTime();
  let inicio = new Date(doc.cicloInicio).getTime();
  if (isNaN(inicio)) inicio = t;
  if (t >= inicio + CICLO_DIAS * DIA_MS) {
    const ciclos = Math.floor((t - inicio) / (CICLO_DIAS * DIA_MS));
    inicio += ciclos * CICLO_DIAS * DIA_MS;
    doc.usadoCicloUSD = 0;
  }
  doc.cicloInicio = new Date(inicio).toISOString();
  doc.usadoCicloUSD = doc.usadoCicloUSD || 0;
  doc.paquetes = (Array.isArray(doc.paquetes) ? doc.paquetes : []).filter((p) => new Date(p.vence).getTime() > t);
  doc.pagos = Array.isArray(doc.pagos) ? doc.pagos.slice(-200) : [];
  return doc;
}

// Estado para mostrar en la barra y para decidir si se bloquea.
function estado(doc, slug, ahora) {
  const d = normalizar(JSON.parse(JSON.stringify(doc)), ahora);
  const sinTope = SIN_TOPE.includes(slug);
  const totalUSD = TOPE_USD + d.paquetes.reduce((a, p) => a + p.usd, 0);
  const usadoUSD = Math.min(d.usadoCicloUSD, TOPE_USD) + d.paquetes.reduce((a, p) => a + Math.min(p.usadoUSD || 0, p.usd), 0);
  const restanteUSD = Math.max(0, totalUSD - usadoUSD);
  const porcentaje = totalUSD > 0 ? Math.min(100, Math.round((usadoUSD / totalUSD) * 1000) / 10) : 100;
  return {
    sinTope,
    bloqueado: !sinTope && restanteUSD <= 0,
    porcentaje,
    tokensUsados: Math.round(usadoUSD * TOKENS_POR_USD),
    tokensTotales: Math.round(totalUSD * TOKENS_POR_USD),
    renueva: new Date(new Date(d.cicloInicio).getTime() + CICLO_DIAS * DIA_MS).toISOString(),
    paquetes: d.paquetes.map((p) => ({ vence: p.vence, tokensRestantes: Math.round(Math.max(0, p.usd - (p.usadoUSD || 0)) * TOKENS_POR_USD) })),
    paquete: { tokens: PAQUETE_USD * TOKENS_POR_USD, precioMXN: PRECIO_MXN, precioAntesMXN: PRECIO_ANTES_MXN, vigenciaDias: PAQUETE_DIAS },
  };
}

// Descuenta un costo: primero del tope del ciclo, luego de los paquetes que vencen antes.
// Si ya no queda nada (llamada que ya estaba en curso), el excedente se suma al ciclo.
function descontar(doc, costo, ahora) {
  normalizar(doc, ahora);
  let resto = Math.max(0, costo || 0);
  const libreCiclo = Math.max(0, TOPE_USD - doc.usadoCicloUSD);
  const delCiclo = Math.min(resto, libreCiclo);
  doc.usadoCicloUSD += delCiclo;
  resto -= delCiclo;
  const paquetes = doc.paquetes.slice().sort((a, b) => new Date(a.vence) - new Date(b.vence));
  for (const p of paquetes) {
    if (resto <= 0) break;
    const libre = Math.max(0, p.usd - (p.usadoUSD || 0));
    const usar = Math.min(resto, libre);
    p.usadoUSD = (p.usadoUSD || 0) + usar;
    resto -= usar;
  }
  if (resto > 0) doc.usadoCicloUSD += resto;
  return doc;
}

// Acredita un paquete pagado. Devuelve false si ese pago ya se había acreditado (Stripe reintenta avisos).
function agregarPaquete(doc, idPago, ahora, origen) {
  normalizar(doc, ahora);
  if (doc.pagos.includes(idPago)) return false;
  const t = new Date(ahora).getTime();
  doc.paquetes.push({ id: idPago, usd: PAQUETE_USD, usadoUSD: 0, compra: new Date(t).toISOString(), vence: new Date(t + PAQUETE_DIAS * DIA_MS).toISOString(), origen: origen || 'stripe' });
  doc.pagos.push(idPago);
  return true;
}

// Lee el saldo de un hub; si no existe, lo crea con el ciclo desde su alta (hubs creados en /hubs)
// o desde hoy (hubs fijos). No escribe: quien lo modifique lo guarda.
async function cargar(slug, leerJSON, ahora) {
  const doc = await leerJSON(`${slug}:saldo`).catch(() => null);
  if (doc && typeof doc === 'object' && doc.cicloInicio) return doc;
  const registro = await leerJSON('hubs:registro').catch(() => null);
  const hub = registro && Array.isArray(registro.hubs) ? registro.hubs.find((h) => h && h.slug === slug) : null;
  const alta = hub && hub.creado && !isNaN(new Date(hub.creado)) ? hub.creado : ahora;
  return docNuevo(alta);
}

const MENSAJE_TOPE = 'Llegaste al tope de tokens de tu plan en este ciclo, así que por ahora los Jefes no pueden usar la IA (todo lo demás sigue funcionando). '
  + 'Puedes comprar un paquete extra de 4.5 millones de tokens por $750 MXN (antes $1,000), con vigencia de 45 días, desde tu Hub de Jefes.';

// Para los servicios de IA: null si puede seguir; si no, la respuesta 402 que hay que mandar.
async function revisar(slug, leerJSON) {
  try {
    if (SIN_TOPE.includes(slug)) return null;
    const ahora = new Date().toISOString();
    const e = estado(await cargar(slug, leerJSON, ahora), slug, ahora);
    if (!e.bloqueado) return null;
    return { status: 402, cuerpo: { error: MENSAJE_TOPE, tope: true, saldo: e } };
  } catch (err) {
    return null; // si falla la lectura del saldo no se bloquea a nadie
  }
}

// Para registrarUsoTokens: descuenta el costo real de la llamada que acaba de terminar.
async function cobrar(slug, item, leerJSON, escribirJSON) {
  const ahora = (item && item.date) || new Date().toISOString();
  const doc = await cargar(slug, leerJSON, ahora);
  descontar(doc, costoUSD(item), ahora);
  await escribirJSON(`${slug}:saldo`, doc);
}

module.exports = {
  TOPE_USD, PAQUETE_USD, PAQUETE_DIAS, CICLO_DIAS, SIN_TOPE, TOKENS_POR_USD, PRECIO_MXN, PRECIO_ANTES_MXN, MENSAJE_TOPE,
  costoUSD, docNuevo, normalizar, estado, descontar, agregarPaquete, cargar, revisar, cobrar,
};
