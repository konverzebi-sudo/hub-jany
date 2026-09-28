// Endpoint server-side para el Jefe de Conversión — multi-tenant, multi-modo.
// Sigue el mismo patron que api/consultor-366.js / api/consultor-financiero.js:
// prompt fijo generico (sin datos de negocio hardcoded) + CONTEXTO DEL NEGOCIO cargado en tiempo
// real desde el ADN de cada marca. `modo` decide que fragmento de prompt se concatena.
//
// Dos familias de modos:
// - Modos de chat (audit-tienda, audit-evento-propio, audit-evento-referencia, manual-tienda,
//   manual-evento): reciben el historial completo `messages` (la Messages API no guarda estado
//   en servidor). El manual reutiliza el mismo hilo que su auditoria (el cliente no reinicia
//   `messages` al cambiar de paso), asi el modelo ve la auditoria como contexto sin logica extra.
// - Modos numericos (diagnostico-tienda, diagnostico-evento): reciben `datos` (conteos agregados
//   por etapa, nunca por lead). Las tasas se calculan aqui en JS de forma deterministica -- el
//   modelo nunca hace la aritmetica, solo interpreta.

const fs = require('fs');
const path = require('path');
const { sql } = require('@vercel/postgres');

const DEFAULT_CLIENTE = 'rancho-seco';

const PROMPT_BASE_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-cierre.md');
const PROMPTS_POR_MODO = {
  'audit-tienda': path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-cierre-audit-tienda.md'),
  'audit-evento-propio': path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-cierre-audit-evento-propio.md'),
  'audit-evento-referencia': path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-cierre-audit-evento-referencia.md'),
  'diagnostico-tienda': path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-cierre-diagnostico.md'),
  'diagnostico-evento': path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-cierre-diagnostico.md'),
  'diagnostico-mensaje': path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-cierre-diagnostico.md'),
  'manual-tienda': path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-cierre-manual-tienda.md'),
  'manual-evento': path.join(__dirname, '..', 'prompts', 'system-prompt-consultor-cierre-manual-evento.md'),
};
const MODOS_CHAT = new Set(['audit-tienda', 'audit-evento-propio', 'audit-evento-referencia', 'manual-tienda', 'manual-evento']);
const MODOS_DIAGNOSTICO = new Set(['diagnostico-tienda', 'diagnostico-evento', 'diagnostico-mensaje']);

// Solo audit-tienda puede recibir un link de landing/tienda para leer -- web_fetch es una
// herramienta server-side (Anthropic la ejecuta, no hay loop de tool-use que armar aqui) y
// solo puede leer URLs que ya aparezcan en el mensaje del usuario.
const WEB_FETCH_TOOL = { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3, max_content_tokens: 8000 };

const CONTEXT_CHAR_LIMIT = 7000;
const MAX_MESSAGES = 40;

const promptCache = new Map();
function cargarPrompt(rutaAbsoluta) {
  if (promptCache.has(rutaAbsoluta)) return promptCache.get(rutaAbsoluta);
  const contenido = fs.readFileSync(rutaAbsoluta, 'utf-8');
  promptCache.set(rutaAbsoluta, contenido);
  return contenido;
}

// Rate limit en memoria (por IP). Igual de permisivo que los otros chats guiados: una sesion
// completa de auditoria + manual toma varios turnos.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 40;
const hits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_REQUESTS;
}

// ---------- lectura/escritura de storage (mismo shape que api/storage/[key].js / window.storage) ----------

let tableEnsured = false;
async function ensureTable() {
  if (tableEnsured) return;
  await sql`CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  tableEnsured = true;
}

async function leerJSON(key) {
  await ensureTable();
  const { rows } = await sql`SELECT value FROM kv_store WHERE key = ${key}`;
  if (!rows[0] || rows[0].value == null) return null;
  try {
    return JSON.parse(rows[0].value);
  } catch (err) {
    return null;
  }
}

async function escribirJSON(key, valor) {
  await ensureTable();
  const value = JSON.stringify(valor);
  const json = JSON.stringify(value);
  await sql`
    INSERT INTO kv_store (key, value, updated_at)
    VALUES (${key}, ${json}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = ${json}::jsonb, updated_at = now()
  `;
}

async function registrarUsoTokens(clienteId, endpoint, usage) {
  try {
    const key = `${clienteId}:uso-tokens-log`;
    const items = (await leerJSON(key)) || [];
    items.push({ date: new Date().toISOString(), endpoint, inputTokens: usage?.input_tokens || 0, outputTokens: usage?.output_tokens || 0 });
    await escribirJSON(key, items.slice(-500));
  } catch (err) {
    // No bloquear la respuesta al usuario si falla el registro de uso.
  }
}

function truncar(str, limite) {
  if (!str) return str;
  return str.length > limite ? str.slice(0, limite) + '\n[...recortado...]' : str;
}

// ---------- formateo del CONTEXTO DEL NEGOCIO a partir del ADN ----------

function formatearIdentidad(d) {
  if (!d) return null;
  const lineas = [];
  if (d.nombre) lineas.push(`Nombre: ${d.nombre}`);
  if (d.giro_categoria || d.giro_texto) lineas.push(`Giro: ${d.giro_texto || d.giro_categoria}`);
  if (d.producto_estrella) lineas.push(`Producto estrella: ${d.producto_estrella}`);
  if (lineas.length === 0) return null;
  return 'IDENTIDAD DEL NEGOCIO:\n' + lineas.join('\n');
}

function formatearTono(d) {
  if (!d) return null;
  const lineas = [];
  if (Array.isArray(d.tonos) && d.tonos.length) lineas.push(`Tonos: ${d.tonos.join(', ')}`);
  if (Array.isArray(d.palabras_si) && d.palabras_si.length) lineas.push(`Palabras que sí usa: ${d.palabras_si.join(', ')}`);
  if (Array.isArray(d.palabras_no) && d.palabras_no.length) lineas.push(`Palabras que NO usa: ${d.palabras_no.join(', ')}`);
  if (lineas.length === 0) return null;
  return 'TONO DE MARCA:\n' + lineas.join('\n');
}

function nombreGrupo(grupos, grupoId) {
  if (!grupoId || !Array.isArray(grupos)) return '';
  const g = grupos.find((x) => x && x.id === grupoId);
  return g ? g.nombre : '';
}

// Perfiles de cliente: misma llave y misma migración de 3 niveles que usa api/consultor-366.js
// (brand-book.audiencias {lista:[...]} -> brand-book.audiencia vieja -> 366-perfil-cliente /
// evergreen-perfil-cliente) -- una sola fuente de verdad, se edita solo en Jefe 366.
async function leerAudiencias(clienteId) {
  const nuevo = await leerJSON(`${clienteId}:brand-book.audiencias`).catch(() => null);
  if (nuevo && Array.isArray(nuevo.lista) && nuevo.lista.length) return nuevo.lista;
  const viejo = await leerJSON(`${clienteId}:brand-book.audiencia`).catch(() => null);
  if (Array.isArray(viejo) && viejo.length) return viejo;
  if (viejo && viejo.descripcion_clientes) return [{ nombre: 'Perfil Principal', quien_compra: viejo.descripcion_clientes }];
  const perfil366 = (await leerJSON(`${clienteId}:brand-book.366-perfil-cliente`).catch(() => null))
    || (await leerJSON(`${clienteId}:brand-book.evergreen-perfil-cliente`).catch(() => null));
  if (perfil366 && Object.keys(perfil366).length) return [Object.assign({ nombre: 'Perfil Principal' }, perfil366)];
  return [];
}

function formatearAudiencias(items, grupos) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const bloques = items
    .filter((a) => a && (a.nombre || a.ocupacion || a.descripcion_breve || a.quien_compra))
    .map((a, i) => {
      const nombreG = nombreGrupo(grupos, a.grupo_id);
      const l = [`Perfil ${i + 1}${a.nombre ? ': ' + a.nombre : ''}${nombreG ? ` [Grupo: ${nombreG}]` : ''} (prioridad de compra ${i + 1} de ${items.length})`];
      if (a.quien_compra) l.push(`  Quién compra: ${a.quien_compra}`);
      if (a.que_busca) l.push(`  Qué busca: ${a.que_busca}`);
      if (a.miedo_deseo) l.push(`  Miedo/deseo: ${a.miedo_deseo}`);
      if (a.objecion_comun) l.push(`  Objeción más común: ${a.objecion_comun}`);
      if (a.descripcion_breve) l.push(`  Descripción breve: ${a.descripcion_breve}`);
      return l.join('\n');
    });
  if (bloques.length === 0) return null;
  return 'CLIENTE IDEAL (perfiles ordenados de mayor a menor prioridad de compra — si hay varios grupos de negocio, cada uno trae "[Grupo: nombre]", usa solo los del grupo con el que se está trabajando):\n' + bloques.join('\n\n');
}

function formatearCatalogo(items, grupos) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const nombrePorGrupo = {};
  (grupos || []).forEach((g) => { nombrePorGrupo[g.id] = g.nombre; });
  const lineas = items
    .filter((p) => p && p.nombre)
    .map((p) => {
      const partes = [p.nombre];
      if (p.tipo) partes.push(p.tipo);
      if (p.grupo_id && nombrePorGrupo[p.grupo_id]) partes.push(`grupo: ${nombrePorGrupo[p.grupo_id]}`);
      if (p.precio != null && p.precio !== '') partes.push(`precio $${p.precio}`);
      if (p.notas) partes.push(`notas: ${p.notas}`);
      return '- ' + partes.join(' · ');
    });
  if (lineas.length === 0) return null;
  return 'CATÁLOGO DE PRODUCTOS:\n' + lineas.join('\n');
}

// Sistema 366, Producto 366 y Comunicación 366: mismas llaves y misma migración de 3 niveles
// (lista nueva -> objeto plano 366-* -> evergreen-* viejo) que usa api/consultor-366.js. Jefe de
// Conversión solo LEE esto -- a diferencia del builder de 366, no necesita reproducir tablas
// exactas para poder guardarlas de vuelta, solo un resumen para que sus auditorías y manuales
// sean consistentes con lo que ya se construyó en Jefe 366, en vez de reinventarlo.
async function leerSistemas366(clienteId) {
  const nuevo = await leerJSON(`${clienteId}:brand-book.366-sistema`).catch(() => null);
  if (nuevo && Array.isArray(nuevo.lista) && nuevo.lista.length) return nuevo.lista;
  if (nuevo && Object.keys(nuevo).length) return [Object.assign({ nombre: 'Sistema Principal' }, nuevo)];
  const viejo = await leerJSON(`${clienteId}:brand-book.evergreen-sistema`).catch(() => null);
  if (viejo && Object.keys(viejo).length) return [Object.assign({ nombre: 'Sistema Principal' }, viejo)];
  return [];
}

function formatearSistemas366(items, grupos) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const bloques = items
    .filter((p) => p && (p.nombre || p.contexto_general))
    .map((p, i) => {
      const nombreG = nombreGrupo(grupos, p.grupo_id);
      const l = [`Sistema 366 ${i + 1}${p.nombre ? ': ' + p.nombre : ''}${nombreG ? ` [Grupo: ${nombreG}]` : ''}`];
      if (p.contexto_general) l.push(`  Contexto: ${p.contexto_general}`);
      if (p.oportunidades_iniciales) l.push(`  Oportunidades iniciales: ${p.oportunidades_iniciales}`);
      return l.join('\n');
    });
  if (bloques.length === 0) return null;
  return 'SISTEMA 366 (las etapas de venta recurrente ya definidas para este negocio — tu auditoría y manual deben ser consistentes con esto, no reinventarlo):\n' + bloques.join('\n\n');
}

async function leerProductos366(clienteId) {
  const nuevo = await leerJSON(`${clienteId}:brand-book.366-producto`).catch(() => null);
  if (nuevo && Array.isArray(nuevo.lista) && nuevo.lista.length) return nuevo.lista;
  if (nuevo && Object.keys(nuevo).length) return [Object.assign({ nombre: 'Producto Principal' }, nuevo)];
  const viejo = await leerJSON(`${clienteId}:brand-book.evergreen-producto`).catch(() => null);
  if (viejo && Object.keys(viejo).length) return [Object.assign({ nombre: 'Producto Principal' }, viejo)];
  return [];
}

function formatearProductos366(items, grupos) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const bloques = items
    .filter((p) => p && (p.nombre || p.que_vendemos))
    .map((p, i) => {
      const nombreG = nombreGrupo(grupos, p.grupo_id);
      const l = [`Oferta 366 ${i + 1}${p.nombre ? ': ' + p.nombre : ''}${nombreG ? ` [Grupo: ${nombreG}]` : ''}`];
      if (p.que_vendemos) l.push(`  Qué vendemos: ${p.que_vendemos}`);
      if (p.oferta_irresistible) l.push(`  Oferta Irresistible 366: ${p.oferta_irresistible}`);
      return l.join('\n');
    });
  if (bloques.length === 0) return null;
  return 'PRODUCTO / OFERTA 366 (ya definida — tu manual de página o de evento debe presentar esta oferta, no inventar una distinta):\n' + bloques.join('\n\n');
}

async function leerComunicaciones366(clienteId) {
  const nuevo = await leerJSON(`${clienteId}:brand-book.366-comunicacion`).catch(() => null);
  if (nuevo && Array.isArray(nuevo.lista) && nuevo.lista.length) return nuevo.lista;
  if (nuevo && Object.keys(nuevo).length) return [Object.assign({ nombre: 'Comunicación Principal' }, nuevo)];
  const viejo = await leerJSON(`${clienteId}:brand-book.evergreen-comunicacion`).catch(() => null);
  if (viejo && Object.keys(viejo).length) return [Object.assign({ nombre: 'Comunicación Principal' }, viejo)];
  return [];
}

function formatearComunicaciones366(items, grupos) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const bloques = items
    .filter((p) => p && (p.nombre || p.posicionamiento))
    .map((p, i) => {
      const nombreG = nombreGrupo(grupos, p.grupo_id);
      const l = [`Comunicación 366 ${i + 1}${p.nombre ? ': ' + p.nombre : ''}${nombreG ? ` [Grupo: ${nombreG}]` : ''}`];
      if (p.posicionamiento) l.push(`  Posicionamiento: ${p.posicionamiento}`);
      if (p.diferenciador) l.push(`  Diferenciador principal: ${p.diferenciador}`);
      if (p.por_que_elegirnos) l.push(`  Por qué elegirnos: ${p.por_que_elegirnos}`);
      return l.join('\n');
    });
  if (bloques.length === 0) return null;
  return 'COMUNICACIÓN 366 (posicionamiento y diferenciador ya definidos — úsalos, no inventes unos distintos):\n' + bloques.join('\n\n');
}

// Jefe de Temporada no escribe nada en brand-book.* -- sus campañas viven en su propia llave
// (temporada-campanas, un arreglo). Si alguna está vigente hoy (fecha_inicio_activa/fin_activa),
// se la damos a Jefe de Conversión para que la landing/manual/auditoría reflejen la promoción y
// urgencia reales de esa campaña en vez de una genérica.
async function leerCampanaTemporadaActiva(clienteId) {
  const campanas = await leerJSON(`${clienteId}:temporada-campanas`).catch(() => null);
  if (!Array.isArray(campanas) || campanas.length === 0) return null;
  const hoy = new Date().toISOString().slice(0, 10);
  return campanas.find((c) => c && c.fecha_inicio_activa && c.fecha_fin_activa
    && c.fecha_inicio_activa <= hoy && hoy <= c.fecha_fin_activa) || null;
}

function formatearCampanaTemporada(c) {
  if (!c) return null;
  const l = [`Campaña activa ahora: ${c.nombre || '(sin nombre)'}${c.temporada ? ' — ' + c.temporada : ''}`];
  if (c.producto_nombre) l.push(`  Producto/servicio de la campaña: ${c.producto_nombre}`);
  if (c.fecha_inicio_activa || c.fecha_fin_activa) l.push(`  Vigencia: ${c.fecha_inicio_activa || '?'} a ${c.fecha_fin_activa || '?'}`);
  if (c.objetivo_principal) l.push(`  Objetivo: ${c.objetivo_principal}`);
  if (c.incentivo) l.push(`  Incentivo/promoción: ${c.incentivo}`);
  if (c.dm_oferta) l.push(`  Oferta de campaña: ${c.dm_oferta}`);
  if (c.dm_urgencia) l.push(`  Razón de urgencia: ${c.dm_urgencia}`);
  if (c.dm_mensaje_principal) l.push(`  Mensaje principal: ${c.dm_mensaje_principal}`);
  if (c.dm_frases_clave) l.push(`  Frases clave: ${c.dm_frases_clave}`);
  if (c.dm_accion_cliente) l.push(`  Acción que debe tomar el cliente: ${c.dm_accion_cliente}`);
  if (l.length === 1) return null;
  return 'CAMPAÑA DE TEMPORADA ACTIVA (de Jefe de Temporada — hay una vigente hoy, tu auditoría/manual debe reflejar esta promoción y urgencia reales, no una genérica):\n' + l.join('\n');
}

async function construirContextoNegocio(clienteId) {
  const [identidad, tono, catalogo, grupos, audienciasRaw, productosRaw, sistemasRaw, comunicacionesRaw, campanaTemporada] = await Promise.all([
    leerJSON(`${clienteId}:brand-book.identidad`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.tono`).catch(() => null),
    leerJSON(`${clienteId}:catalogo-productos`).catch(() => null),
    leerJSON(`${clienteId}:grupos-negocio`).catch(() => null),
    leerAudiencias(clienteId).catch(() => []),
    leerProductos366(clienteId).catch(() => []),
    leerSistemas366(clienteId).catch(() => []),
    leerComunicaciones366(clienteId).catch(() => []),
    leerCampanaTemporadaActiva(clienteId).catch(() => null),
  ]);

  const bloques = [
    formatearIdentidad(identidad),
    formatearTono(tono),
    formatearAudiencias(audienciasRaw, grupos),
    formatearCatalogo(catalogo, grupos),
    formatearProductos366(productosRaw, grupos),
    formatearSistemas366(sistemasRaw, grupos),
    formatearComunicaciones366(comunicacionesRaw, grupos),
    formatearCampanaTemporada(campanaTemporada),
  ].filter(Boolean);

  if (bloques.length === 0) {
    return 'CONTEXTO DEL NEGOCIO: todavía no hay datos guardados en el ADN de esta marca.';
  }
  return 'CONTEXTO DEL NEGOCIO (ya cargado del ADN y de Jefe 366 — no le pidas al usuario que lo repita):\n\n' + truncar(bloques.join('\n\n'), CONTEXT_CHAR_LIMIT);
}

// ---------- diagnóstico numérico: cálculo determinístico de tasas ----------

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dividir(num, den) {
  if (num == null || den == null || den === 0) return null;
  return num / den;
}

function pct(v) {
  return v == null ? null : Math.round(v * 1000) / 10; // 1 decimal
}

function calcularTasasTienda(datos) {
  const visitas = numero(datos.visitas);
  const visitasProducto = numero(datos.visitasProducto);
  const agregaronCarrito = numero(datos.agregaronCarrito);
  const iniciaronCheckout = numero(datos.iniciaronCheckout);
  const compras = numero(datos.compras);
  const ticketPromedio = numero(datos.ticketPromedio) || dividir(numero(datos.ingresos), compras);

  const carritosAbandonados = agregaronCarrito != null && compras != null ? Math.max(agregaronCarrito - compras, 0) : null;

  return {
    tasaConversionPct: pct(dividir(compras, visitas)),
    tasaProductoACarritoPct: pct(dividir(agregaronCarrito, visitasProducto != null ? visitasProducto : visitas)),
    tasaCarritoACompraPct: pct(dividir(compras, agregaronCarrito)),
    tasaCheckoutACompraPct: pct(dividir(compras, iniciaronCheckout)),
    carritosAbandonados,
    valorPerdidoCarritosAbandonados: carritosAbandonados != null && ticketPromedio != null ? Math.round(carritosAbandonados * ticketPromedio) : null,
  };
}

function calcularTasasEvento(datos) {
  const registrados = numero(datos.registrados);
  const confirmados = numero(datos.confirmados);
  const asistieron = numero(datos.asistieron);
  const compraron = numero(datos.compraron);

  return {
    tasaConfirmacionPct: pct(dividir(confirmados, registrados)),
    tasaShowUpPct: pct(dividir(asistieron, registrados)),
    tasaCierrePct: pct(dividir(compraron, asistieron)),
    tasaRegistroAVentaPct: pct(dividir(compraron, registrados)),
  };
}

function calcularTasasMensaje(datos) {
  const leadsRecibidos = numero(datos.leadsRecibidos);
  const leadsRespondidos = numero(datos.leadsRespondidos);
  const leadsCalificados = numero(datos.leadsCalificados);
  const cotizacionesEnviadas = numero(datos.cotizacionesEnviadas);
  const ventasCerradas = numero(datos.ventasCerradas);
  const leadsSinSeguimiento = numero(datos.leadsSinSeguimiento);
  const ticketPromedio = numero(datos.ticketPromedio);

  const cotizacionesAbiertas = cotizacionesEnviadas != null && ventasCerradas != null ? Math.max(cotizacionesEnviadas - ventasCerradas, 0) : null;

  return {
    tasaRespuestaPct: pct(dividir(leadsRespondidos, leadsRecibidos)),
    tasaCalificacionPct: pct(dividir(leadsCalificados, leadsRespondidos)),
    tasaCierrePct: pct(dividir(ventasCerradas, leadsRecibidos)),
    tasaCotizacionAVentaPct: pct(dividir(ventasCerradas, cotizacionesEnviadas)),
    pctSinSeguimiento: pct(dividir(leadsSinSeguimiento, leadsRecibidos)),
    ingresosPotencialesAbiertos: cotizacionesAbiertas != null && ticketPromedio != null ? Math.round(cotizacionesAbiertas * ticketPromedio) : null,
  };
}

const NOMBRE_RUTA_DIAGNOSTICO = {
  'diagnostico-tienda': 'tienda online',
  'diagnostico-evento': 'evento',
  'diagnostico-mensaje': 'mensaje / WhatsApp',
};

function formatearContextoDiagnostico(ruta, datos, tasas) {
  let bloque;
  try {
    bloque = JSON.stringify({ datosIngresados: datos, tasasCalculadas: tasas }, null, 0);
  } catch (err) {
    bloque = '(no se pudo serializar)';
  }
  return `CONTEXTO DEL DIAGNÓSTICO (ruta: ${NOMBRE_RUTA_DIAGNOSTICO[ruta] || ruta} — tasas ya calculadas por el sistema, no las recalcules):\n\n${bloque}`;
}

// ---------- handler ----------

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .toString()
    .split(',')[0]
    .trim();
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Demasiadas solicitudes, espera unos minutos.' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY en el servidor.' });
  }

  const body = req.body || {};
  const clienteId = (body.cliente || DEFAULT_CLIENTE).toString();
  const modo = (body.modo || '').toString();

  if (!PROMPTS_POR_MODO[modo]) {
    return res.status(400).json({ error: 'Modo inválido o faltante.' });
  }

  let promptBase, promptModo;
  try {
    promptBase = cargarPrompt(PROMPT_BASE_PATH);
    promptModo = cargarPrompt(PROMPTS_POR_MODO[modo]);
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo cargar el prompt del agente.' });
  }

  try {
    const contextoNegocio = await construirContextoNegocio(clienteId);

    if (MODOS_DIAGNOSTICO.has(modo)) {
      const datos = body.datos && typeof body.datos === 'object' ? body.datos : {};
      const sufijoRuta = modo === 'diagnostico-tienda' ? 'tienda' : modo === 'diagnostico-evento' ? 'evento' : 'mensaje';
      const tasas = modo === 'diagnostico-tienda' ? calcularTasasTienda(datos) : modo === 'diagnostico-evento' ? calcularTasasEvento(datos) : calcularTasasMensaje(datos);

      await escribirJSON(`${clienteId}:conversion-cierre-diagnostico-${sufijoRuta}`, datos).catch(() => {});

      const contextoDatos = formatearContextoDiagnostico(modo, datos, tasas);
      const system = [promptBase, promptModo, contextoNegocio, contextoDatos].join('\n\n');

      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 900,
          system,
          messages: [{ role: 'user', content: 'Interpreta mi diagnóstico numérico de conversión con las tasas ya calculadas.' }],
        }),
      });

      const data = await anthropicRes.json();
      if (!anthropicRes.ok) {
        return res.status(anthropicRes.status).json({ error: data?.error?.message || 'Error al llamar a la API.' });
      }
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      if (!text) {
        return res.status(502).json({ error: 'Respuesta vacía del modelo.' });
      }
      await registrarUsoTokens(clienteId, 'consultor-cierre', data.usage);
      return res.status(200).json({ rates: tasas, text });
    }

    if (MODOS_CHAT.has(modo)) {
      const messages = Array.isArray(body.messages) ? body.messages : null;
      if (!messages || messages.length === 0) {
        return res.status(400).json({ error: 'Falta el historial de la conversación (messages).' });
      }
      const limpio = messages
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .slice(-MAX_MESSAGES)
        .map((m) => ({ role: m.role, content: m.content }));
      if (limpio.length === 0 || limpio[limpio.length - 1].role !== 'user') {
        return res.status(400).json({ error: 'El último mensaje debe ser del usuario.' });
      }

      const system = [promptBase, promptModo, contextoNegocio].join('\n\n');
      const bodyAnthropic = {
        model: 'claude-sonnet-4-6',
        max_tokens: 1600,
        system,
        messages: limpio,
      };
      if (modo === 'audit-tienda') {
        bodyAnthropic.tools = [WEB_FETCH_TOOL];
      }

      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(bodyAnthropic),
      });

      const data = await anthropicRes.json();
      if (!anthropicRes.ok) {
        return res.status(anthropicRes.status).json({ error: data?.error?.message || 'Error al llamar a la API.' });
      }
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      if (!text) {
        return res.status(502).json({ error: 'Respuesta vacía del modelo.' });
      }
      await registrarUsoTokens(clienteId, 'consultor-cierre', data.usage);
      return res.status(200).json({ text });
    }

    return res.status(400).json({ error: 'Modo no reconocido.' });
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
};
