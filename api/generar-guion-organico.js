// Endpoint server-side para el Jefe Contenido -- Guionista Organico. Dos modos:
// 'ideas' genera un banco de ideas con sus 7 angulos estrategicos; 'contenido' toma UNA idea ya
// elegida y genera caption + guion siguiendo la estructura del objetivo. Lee en vivo el mismo
// CONTEXTO DEL NEGOCIO que usa Jefe 366 + sus Notas de Comunicacion 366 + el Radar de
// Mercado mas reciente. Multi-tenant, sin datos hardcoded de ninguna marca.

const fs = require('fs');
const path = require('path');
const { sql } = require('@vercel/postgres');
const { sumarAlMes } = require('./_lib/uso-mensual');
const { revisar: revisarSaldo, cobrar: cobrarSaldo } = require('./_lib/saldo');
const { formatearCampanaSeleccionada } = require('./_lib/campana-temporada');
const { systemConCache, historialConCache, camposUso } = require('./_lib/cache-claude');

const DEFAULT_CLIENTE = 'jefeshub';
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt-guion-organico.md');
const PREGUNTAS_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt-post-ia-preguntas.md');
const ARRANQUE_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt-post-ia-arranque.md');
const MEDIOS_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt-prompt-medios.md');
const ARMAR_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt-post-ia-armar.md');
const CONTEXT_CHAR_LIMIT = 10000;

let fixedPromptCache = null;
function cargarPromptFijo() {
  if (fixedPromptCache) return fixedPromptCache;
  fixedPromptCache = fs.readFileSync(PROMPT_PATH, 'utf-8');
  return fixedPromptCache;
}

let preguntasPromptCache = null;
function cargarPromptPreguntas() {
  if (preguntasPromptCache) return preguntasPromptCache;
  preguntasPromptCache = fs.readFileSync(PREGUNTAS_PROMPT_PATH, 'utf-8');
  return preguntasPromptCache;
}

// Guía de la primera conversación (¿ya publicas?, capturas de su estilo, 5 ideas, primer post).
// Se agrega al prompt de preguntas solo cuando el cliente manda fase 'arranque'.
// Prompt para crear el prompt de imagen o de video de un post (modo 'prompt-medio').
// Guía para armar un post con preguntas en el chat (fase 'armar'): link o idea, objetivo y algo más.
let armarPromptCache = null;
function cargarPromptArmar() {
  if (armarPromptCache) return armarPromptCache;
  armarPromptCache = fs.readFileSync(ARMAR_PROMPT_PATH, 'utf-8');
  return armarPromptCache;
}

let mediosPromptCache = null;
function cargarPromptMedios() {
  if (mediosPromptCache) return mediosPromptCache;
  mediosPromptCache = fs.readFileSync(MEDIOS_PROMPT_PATH, 'utf-8');
  return mediosPromptCache;
}

let arranquePromptCache = null;
function cargarPromptArranque() {
  if (arranquePromptCache) return arranquePromptCache;
  arranquePromptCache = fs.readFileSync(ARRANQUE_PROMPT_PATH, 'utf-8');
  return arranquePromptCache;
}

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 15;
const hits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_REQUESTS;
}

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
    items.push({ date: new Date().toISOString(), endpoint, ...camposUso(usage) });
    await escribirJSON(key, items.slice(-500));
    // Resumen mensual permanente (el registro de arriba solo guarda los últimos 500 usos).
    const keyMes = `${clienteId}:uso-tokens-mensual`;
    await escribirJSON(keyMes, sumarAlMes(await leerJSON(keyMes).catch(() => null), items[items.length - 1]));
    // Descuenta el costo real de esta llamada del tope del hub (api/_lib/saldo.js).
    await cobrarSaldo(clienteId, items[items.length - 1], leerJSON, escribirJSON);
  } catch (err) {
    // No bloquear la respuesta al usuario si falla el registro de uso.
  }
}

function truncar(str, limite) {
  if (!str) return str;
  return str.length > limite ? str.slice(0, limite) + '\n[...recortado...]' : str;
}

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

// Perfiles de cliente: misma llave que usa Jefe 366 para su "Perfil de Cliente" en pestañas
// (brand-book.audiencias, {lista:[...]}) -- una sola fuente de verdad, se edita solo en Jefe 366,
// el ADN la muestra de solo lectura. El orden de la lista es la prioridad de compra.
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

// Columnas EXACTAS (deben calzar con CAMPO_LOOKUP de consultor-366.html) para las tablas de
// Perfil de Cliente 366 -- sin esto se mostrarían las claves internas del objeto en vez de los
// nombres de columna reales.
const TABLAS_AUDIENCIAS_366 = [
  { campo: 'dolores', titulo: 'Dolores (visibles y ocultos)', columnas: [{ key: 'visible', label: 'Visible' }, { key: 'oculto', label: 'Oculto' }] },
  { campo: 'miedos', titulo: 'Miedos', columnas: [{ key: 'miedo', label: 'Miedo' }, { key: 'frena', label: 'Cómo puede frenar la compra' }] },
  { campo: 'deseos', titulo: 'Deseos (visibles y secretos)', columnas: [{ key: 'visible', label: 'Visible' }, { key: 'secreto', label: 'Secreto' }] },
  { campo: 'objeciones', titulo: 'Objeciones', columnas: [{ key: 'tipo', label: 'Tipo' }, { key: 'objecion', label: 'Objeción' }, { key: 'porque', label: 'Por qué la tiene' }, { key: 'resuelve', label: 'Cómo podemos resolverla' }] },
  { campo: 'frases_reales', titulo: 'Frases reales del cliente', columnas: [{ key: 'frase', label: 'Frase real' }, { key: 'revela', label: 'Qué revela' }, { key: 'respuesta', label: 'Respuesta estratégica' }, { key: 'tono', label: 'Tono recomendado' }] },
];

function formatearAudiencias(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const bloques = items
    .filter((a) => a && (a.nombre || a.ocupacion || a.descripcion_breve))
    .map((a, i) => {
      const l = [`Perfil ${i + 1}${a.nombre ? ': ' + a.nombre : ''} (prioridad de compra ${i + 1} de ${items.length})`];
      if (a.producto_relacionado) l.push(`  Producto/oferta que más probablemente compra: ${a.producto_relacionado}`);
      if (a.miedo_deseo) l.push(`  Miedo/deseo: ${a.miedo_deseo}`);
      if (a.que_busca) l.push(`  Qué busca: ${a.que_busca}`);
      if (a.frases) l.push(`  Frases reales de clientes: ${a.frases}`);
      if (a.que_convenceria) l.push(`  Qué lo convencería: ${a.que_convenceria}`);
      if (a.insight_estrategico) l.push(`  Insight estratégico: ${a.insight_estrategico}`);
      TABLAS_AUDIENCIAS_366.forEach(({ campo, titulo, columnas }) => {
        const f = formatearTabla(a[campo], columnas, `  ${titulo}`);
        if (f) l.push(f);
      });
      return l.join('\n');
    });
  if (bloques.length === 0) return null;
  return 'PERFILES DE CLIENTE (de Jefe 366, ordenados de mayor a menor probabilidad de compra -- si el producto que se está trabajando coincide con el "producto relacionado" de un perfil, prioriza ese perfil; si no, usa el primero de la lista):\n' + bloques.join('\n\n');
}

function formatearCatalogo(items, grupos, grupoId) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const nombrePorGrupo = {};
  (grupos || []).forEach((g) => { nombrePorGrupo[g.id] = g.nombre; });
  let filtrados = items.filter((p) => p && p.nombre);
  if (grupoId) filtrados = filtrados.filter((p) => p.grupo_id === grupoId);
  if (filtrados.length === 0) return null;
  const lineas = filtrados.map((p) => {
    const partes = [p.nombre];
    if (p.tipo) partes.push(p.tipo);
    if (p.grupo_id && nombrePorGrupo[p.grupo_id]) partes.push(`grupo: ${nombrePorGrupo[p.grupo_id]}`);
    if (p.notas) partes.push(`notas: ${p.notas}`);
    return '- ' + partes.join(' · ');
  });
  return 'CATÁLOGO DE PRODUCTOS' + (grupoId && nombrePorGrupo[grupoId] ? ` (grupo: ${nombrePorGrupo[grupoId]})` : '') + ':\n' + lineas.join('\n');
}

// Mismos datos que guarda ADN > Redes (brand-book.redes): uno o varios mensajes de WhatsApp ya
// armados con wa.me (o su link corto si el usuario lo pegó), handles de redes sociales ya
// convertidos a link, y dirección/link de Google Maps si el negocio tiene ubicación física. Si hay
// varios mensajes de WhatsApp, cada uno trae su etiqueta (ej. "Agendar cita") -- usa el que mejor
// encaje con el tema del contenido. Se usan tal cual en los CTA -- nunca se inventa un dato si esto
// viene vacío.
function formatearRedes(redes) {
  if (!redes || typeof redes !== 'object') return null;
  const lineas = [];
  const wa = redes.whatsapp;
  if (wa && wa.numero) {
    const num = wa.numero.toString().replace(/[^\d+]/g, '');
    if (Array.isArray(wa.ctas) && wa.ctas.length) {
      wa.ctas.forEach((cta) => {
        const link = cta.shortLink || cta.link || ('https://wa.me/' + num + (cta.mensaje ? '?text=' + encodeURIComponent(cta.mensaje) : ''));
        lineas.push(`WhatsApp${cta.label ? ` (${cta.label})` : ''}: ${link}`);
      });
    } else {
      lineas.push(`WhatsApp: ${wa.link || ('https://wa.me/' + num)}`);
    }
  }
  const CANALES = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn' };
  Object.entries(CANALES).forEach(([key, label]) => {
    const canal = redes[key];
    if (canal && canal.link) lineas.push(`${label}: ${canal.link}`);
  });
  const ubi = redes.ubicacion;
  if (ubi && ubi.direccion) {
    lineas.push(`Dirección: ${ubi.direccion}`);
    if (ubi.mapsLink) lineas.push(`Google Maps: ${ubi.mapsLink}`);
  }
  if (lineas.length === 0) return null;
  return 'CONTACTO Y REDES (datos reales -- úsalos tal cual en CTAs como "mándame mensaje" o "visítanos", nunca inventes un link, número o dirección si no aparece aquí):\n' + lineas.map((l) => '  ' + l).join('\n');
}

// Mismos datos que guarda ADN > Redes > "Contenido que convierte" (brand-book.redes, campos
// _ventas_reales/_mejor_N/_peor_N). No podemos "ver" el post detrás de un link, pero sí sirve
// como referencia real de qué formato/patrón ya funcionó o no, para inspirar ideas nuevas
// (no para copiar tal cual).
function formatearHistorialContenido(redes) {
  if (!redes || typeof redes !== 'object') return null;
  const lineas = [];
  if (redes._ventas_reales) lineas.push(`Qué le ha generado ventas reales: ${redes._ventas_reales}`);
  const mejores = [redes._mejor_1, redes._mejor_2, redes._mejor_3].filter(Boolean);
  if (mejores.length) lineas.push('Links a su mejor contenido (referencia de qué SÍ funcionó):\n' + mejores.map((l) => '    - ' + l).join('\n'));
  const peores = [redes._peor_1, redes._peor_2, redes._peor_3].filter(Boolean);
  if (peores.length) lineas.push('Links a su peor contenido (referencia de qué evitar):\n' + peores.map((l) => '    - ' + l).join('\n'));
  if (lineas.length === 0) return null;
  return 'HISTORIAL DE CONTENIDO QUE CONVIERTE (no puedes abrir estos links, úsalos solo como referencia de que existen -- nunca describas o inventes qué muestran):\n' + lineas.map((l) => '  ' + l).join('\n');
}

function formatearTabla(filas, columnas, titulo) {
  if (!Array.isArray(filas) || filas.length === 0) return null;
  const utiles = filas.filter((f) => f && Object.values(f).some((v) => (v || '').toString().trim()));
  if (utiles.length === 0) return null;
  const lineas = utiles.map((f) => columnas.map((c) => f[c.key] ? `${c.label}: ${f[c.key]}` : null).filter(Boolean).join(' | '));
  return titulo + ':\n' + lineas.map((l) => '- ' + l).join('\n');
}

function formatearComunicacion366(d) {
  if (!d) return null;
  const bloques = [];
  const textoLineas = [];
  if (d.posicionamiento) textoLineas.push(`Posicionamiento: ${d.posicionamiento}`);
  if (d.diferenciador) textoLineas.push(`Diferenciador: ${d.diferenciador}`);
  if (textoLineas.length) bloques.push('ESTRATEGIA DE COMUNICACIÓN 366:\n' + textoLineas.join('\n'));

  bloques.push(formatearTabla(
    d.angulos_evergreen,
    [{ key: 'angulo', label: 'Ángulo' }, { key: 'accion', label: 'Acción' }, { key: 'emocion', label: 'Emoción' }, { key: 'ejemplo', label: 'Ejemplo de mensaje' }],
    'ÁNGULOS 366 YA DEFINIDOS'
  ));
  bloques.push(formatearTabla(
    d.frases_maestras,
    [{ key: 'frase', label: 'Frase' }, { key: 'activa', label: 'Qué activa' }, { key: 'donde', label: 'Dónde usarla' }],
    'FRASES MAESTRAS YA DEFINIDAS'
  ));

  const finales = bloques.filter(Boolean);
  if (finales.length === 0) return null;
  return finales.join('\n\n');
}

// Estilo de referentes: brief que arma el Jefe del Faro (paso 6) en <hub>:radar-estilo. "para" = lo que
// le toca a este Jefe ('contenido' | 'anuncios'). Inspiración para adaptar, nunca para copiar.
function formatearEstiloReferentes(estilos, para) {
  const lista = Array.isArray(estilos) ? estilos.filter((e) => e && e.brief) : [];
  if (lista.length === 0) return null;
  const ultimo = lista[lista.length - 1];
  const b = ultimo.brief || {};
  const puntos = (titulo, arr) => {
    const a = (Array.isArray(arr) ? arr : []).filter((x) => typeof x === 'string' && x.trim()).slice(0, 5);
    return a.length ? `${titulo}\n${a.map((x) => `- ${x}`).join('\n')}` : null;
  };
  const partes = [
    b.resumen ? `Resumen: ${b.resumen}` : null,
    puntos('Voz y tono a tomar:', b.voz_y_tono_a_tomar),
    puntos('Hooks que funcionan:', b.hooks_que_funcionan),
    puntos('Qué NO copiar:', b.que_no_copiar),
    b.como_mezclarlo_con_la_marca ? `Cómo mezclarlo con la marca: ${b.como_mezclarlo_con_la_marca}` : null,
    puntos(para === 'anuncios' ? 'Para los anuncios:' : 'Para el contenido:', para === 'anuncios' ? b.para_anuncios : b.para_contenido),
  ].filter(Boolean);
  if (partes.length === 0) return null;
  const foco = ultimo.foco && ultimo.foco.nombre ? ` · enfocado en ${ultimo.foco.nombre}` : '';
  return `ESTILO DE REFERENTES (brief del Jefe del Faro${ultimo.date ? ', ' + ultimo.date : ''}${foco}) — úsalo como inspiración para darle estilo mezclado con la voz de la marca; nunca copies frases, guiones ni identidad visual de nadie:\n` + partes.join('\n');
}

function formatearRadar(historial, estilos, para) {
  const items = Array.isArray(historial) ? historial : [];
  // Última corrida CON insights: un diagnóstico más reciente (que no trae insights) no debe esconder el radar.
  let ultimo = null;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i] && Array.isArray(items[i].insights) && items[i].insights.length > 0) { ultimo = items[i]; break; }
  }
  const bloques = [];
  if (ultimo) {
    const lineas = ultimo.insights.slice(0, 8).map((ins) => {
      const esObjeto = ins && typeof ins === 'object';
      const texto = esObjeto ? ins.insight : ins;
      if (!texto) return null;
      const partes = [texto];
      if (esObjeto && ins.uso) partes.push(`uso: ${ins.uso}`);
      if (esObjeto && ins.prioridad) partes.push(`prioridad: ${ins.prioridad}`);
      return '- ' + partes.join(' · ');
    }).filter(Boolean);
    if (lineas.length > 0) bloques.push(`RADAR DE MERCADO (corrida más reciente${ultimo.date ? ', ' + ultimo.date : ''}):\n` + lineas.join('\n'));
  }
  const estilo = formatearEstiloReferentes(estilos, para);
  if (estilo) bloques.push(estilo);
  return bloques.length > 0 ? bloques.join('\n\n') : null;
}

function formatearProducto(items, productoId) {
  if (!productoId || !Array.isArray(items)) return null;
  const p = items.find((it) => it && it.id === productoId);
  if (!p) return null;
  const partes = [p.nombre];
  if (p.tipo) partes.push(p.tipo);
  if (p.notas) partes.push(`notas: ${p.notas}`);
  return 'PRODUCTO ESPECÍFICO A ENFOCAR (el guion debe girar en torno a este producto puntual):\n- ' + partes.join(' · ');
}

async function formatearConversacion366NoGuardada(clienteId) {
  const mensajes = (await leerJSON(`${clienteId}:366-builder-conversacion`).catch(() => null)) || (await leerJSON(`${clienteId}:evergreen-builder-conversacion`).catch(() => null));
  if (!Array.isArray(mensajes) || mensajes.length === 0) return null;
  const texto = mensajes
    .filter((m) => m && m.role === 'assistant' && typeof m.content === 'string' && m.content.trim())
    .map((m) => m.content.trim())
    .join('\n\n');
  if (!texto) return null;
  const limite = 4000;
  const recortado = texto.length > limite ? '[...conversación anterior omitida...]\n' + texto.slice(-limite) : texto;
  return 'CONVERSACIÓN RECIENTE CON JEFE 366 (puede no estar copiada aún a Notas, pero es información real y reciente del negocio -- tómala en cuenta si aplica):\n\n' + recortado;
}

// Banco de Conversaciones reales de WhatsApp -- se guarda desde Jefe WhatsApp y Ventas
// ({cliente}:whatsapp-convos) y se lee aquí como contexto extra, misma memoria compartida.
async function formatearBancoConversacionesWhatsApp(clienteId) {
  const items = await leerJSON(`${clienteId}:whatsapp-convos`).catch(() => null);
  if (!Array.isArray(items) || items.length === 0) return null;
  const texto = items
    .slice(-10)
    .map((c) => (c && c.text ? c.text.toString().trim() : ''))
    .filter(Boolean)
    .join('\n\n---\n\n');
  if (!texto) return null;
  const limite = 4000;
  const recortado = texto.length > limite ? '[...conversaciones más antiguas omitidas...]\n' + texto.slice(-limite) : texto;
  return 'BANCO DE CONVERSACIONES REALES DE WHATSAPP (guardadas por el usuario en Jefe WhatsApp y Ventas -- son transcripciones reales de clientes, úsalas para frases reales, objeciones y tono; no las inventes ni las repitas tal cual):\n\n' + recortado;
}

// Migración de storage: esta llave vivía bajo el nombre "evergreen-comunicacion" -- si la nueva
// viene vacía, se cae a la vieja (solo lectura, el cliente es quien migra escribiendo hacia adelante).
async function leerComunicacion366(clienteId) {
  const nuevo = await leerJSON(`${clienteId}:brand-book.366-comunicacion`).catch(() => null);
  if (nuevo) return nuevo;
  return await leerJSON(`${clienteId}:brand-book.evergreen-comunicacion`).catch(() => null);
}

// ─── ENFOQUE POR PRODUCTO ──────────────────────────────────────────────────────────────────
// Cuando la pastilla de arriba tiene un producto o servicio, el chat responde solo sobre él: su ficha del
// catálogo del ADN, su oferta de Producto 366 (si existe) y su campaña de temporada más reciente (si existe).
function slugOferta(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
async function leerOfertas366(clienteId) {
  const nuevo = await leerJSON(`${clienteId}:brand-book.366-producto`).catch(() => null);
  if (nuevo && Array.isArray(nuevo.lista) && nuevo.lista.length) return nuevo.lista;
  if (nuevo && Object.keys(nuevo).length) return [Object.assign({ nombre: 'Producto Principal' }, nuevo)];
  return [];
}
async function construirEnfoqueProducto(clienteId, catalogo, productoId) {
  if (!productoId) return null;
  const ficha = Array.isArray(catalogo) ? catalogo.find((it) => it && it.id === productoId) : null;
  const ofertas = await leerOfertas366(clienteId).catch(() => []);
  let oferta = null;
  let nombre = ficha ? ficha.nombre : '';
  if (productoId.indexOf('366-') === 0) {
    oferta = ofertas.find((o) => o && '366-' + slugOferta(o.nombre) === productoId) || null;
    if (oferta) nombre = oferta.nombre;
  } else if (nombre) {
    oferta = ofertas.find((o) => o && slugOferta(o.nombre) === slugOferta(nombre)) || null;
  }
  if (!nombre) return null;

  const lineas = [`PRODUCTO ESPECÍFICO A ENFOCAR: ${nombre}`];
  if (ficha) {
    if (ficha.tipo) lineas.push(`Tipo: ${ficha.tipo}`);
    if (ficha.precio) lineas.push(`Precio: ${ficha.precio}`);
    if (ficha.notas) lineas.push(`Notas: ${truncar(ficha.notas, 700)}`);
  }
  if (oferta) {
    if (oferta.que_vendemos) lineas.push(`Qué vendemos: ${truncar(oferta.que_vendemos, 500)}`);
    if (oferta.por_que_potencial) lineas.push(`Por qué tiene potencial 366: ${truncar(oferta.por_que_potencial, 500)}`);
    if (oferta.oferta_irresistible) lineas.push(`Oferta irresistible 366: ${truncar(oferta.oferta_irresistible, 500)}`);
    if (oferta.insight_estrategico) lineas.push(`Insight estratégico: ${truncar(oferta.insight_estrategico, 500)}`);
  }
  lineas.push('Todo lo que respondas debe servir para este producto o servicio; no mezcles otros del catálogo ni inventes precios o promociones que no estén aquí o en el ADN.');

  const campanas = await leerJSON(`${clienteId}:temporada-campanas`).catch(() => null);
  const delProducto = (Array.isArray(campanas) ? campanas : []).filter((c) => c && c.producto_id === productoId);
  if (delProducto.length) {
    const clave = (c) => String(c.fecha_fin_activa || c.fecha_inicio_activa || '');
    const camp = delProducto.slice().sort((a, b) => clave(b).localeCompare(clave(a)))[0];
    const texto = formatearCampanaSeleccionada(camp);
    if (texto) lineas.push('', 'CAMPAÑA DE TEMPORADA DE ESTE PRODUCTO (úsala si la conversación es de esa temporada):', truncar(texto, 3500));
  }
  return lineas.join('\n');
}

async function construirContexto(clienteId, grupoId) {
  const [identidad, tono, audiencia, catalogo, grupos, comunicacion, radarHistorial, radarEstilo, conversacionReciente, bancoConversaciones, redes] = await Promise.all([
    leerJSON(`${clienteId}:brand-book.identidad`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.tono`).catch(() => null),
    leerAudiencias(clienteId).catch(() => []),
    leerJSON(`${clienteId}:catalogo-productos`).catch(() => null),
    leerJSON(`${clienteId}:grupos-negocio`).catch(() => null),
    leerComunicacion366(clienteId),
    leerJSON(`${clienteId}:radar-historial`).catch(() => null),
    leerJSON(`${clienteId}:radar-estilo`).catch(() => null),
    formatearConversacion366NoGuardada(clienteId).catch(() => null),
    formatearBancoConversacionesWhatsApp(clienteId).catch(() => null),
    leerJSON(`${clienteId}:brand-book.redes`).catch(() => null),
  ]);

  const bloquesNegocio = [
    formatearIdentidad(identidad),
    formatearTono(tono),
    formatearAudiencias(audiencia),
    formatearCatalogo(catalogo, grupos, grupoId),
    formatearRedes(redes),
    formatearHistorialContenido(redes),
  ].filter(Boolean);

  const bloque366 = formatearComunicacion366(comunicacion);
  const bloqueRadar = formatearRadar(radarHistorial, radarEstilo, 'contenido');

  const partes = [];
  partes.push(bloquesNegocio.length
    ? 'CONTEXTO DEL NEGOCIO:\n\n' + bloquesNegocio.join('\n\n')
    : 'CONTEXTO DEL NEGOCIO: todavía no hay datos guardados en el ADN de esta marca.');
  partes.push(bloque366
    ? 'CONTEXTO 366 (Notas de Comunicación 366 ya guardadas):\n\n' + bloque366
    : 'CONTEXTO 366: todavía no hay ángulos ni frases maestras guardadas en el Jefe 366 -- usa lo que sí haya del ADN.');
  partes.push(bloqueRadar
    ? bloqueRadar
    : 'RADAR DE MERCADO: todavía no hay corridas guardadas -- ignora esta sección.');
  if (conversacionReciente) partes.push(conversacionReciente);
  if (bancoConversaciones) partes.push(bancoConversaciones);

  return { contexto: truncar(partes.join('\n\n---\n\n'), CONTEXT_CHAR_LIMIT), catalogo };
}

function extractJson(text) {
  if (!text) return null;
  const limpio = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(limpio);
  } catch (err) {
    // Fallback: busca el primer '{' al primer '}' que cierre balanceado.
  }
  const match = limpio.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (err) {
    return null;
  }
}

const OBJETIVOS_VALIDOS = ['alcance', 'educativo', 'confianza', 'historia', 'opinion', 'venta_sutil', 'venta_directa', 'tendencia'];

function formatearIdeaSeleccionada(idea) {
  if (!idea || typeof idea !== 'object') return '';
  const lineas = [`Idea: ${idea.idea || ''}`];
  ['problema', 'error', 'deseo', 'historia', 'descubrimiento', 'objecion', 'comparacion'].forEach((k) => {
    if (idea[k]) lineas.push(`${k.charAt(0).toUpperCase() + k.slice(1)}: ${idea[k]}`);
  });
  if (idea.uso_sugerido) lineas.push(`Uso sugerido: ${idea.uso_sugerido}`);
  return lineas.join('\n');
}

async function llamarClaude({ system, mensaje, maxTokens, conBusqueda }) {
  const requestBody = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: mensaje }],
  };
  if (conBusqueda) {
    requestBody.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }];
  }
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
  });
  const data = await anthropicRes.json();
  if (!anthropicRes.ok) {
    const err = new Error(data?.error?.message || 'Error al llamar a la API.');
    err.status = anthropicRes.status;
    throw err;
  }
  const texto = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const parsed = extractJson(texto);
  if (!parsed) {
    const err = new Error(data.stop_reason === 'max_tokens' ? 'La respuesta quedó incompleta (muy larga). Intenta de nuevo.' : 'No se pudo interpretar la respuesta del modelo.');
    err.status = 502;
    throw err;
  }
  return { parsed, usage: data.usage };
}

const PREGUNTA_MAX_MESSAGES = 40;

async function llamarClaudeTexto({ system, mensaje, messages, maxTokens, conBusqueda }) {
  const msgs = Array.isArray(messages) && messages.length ? messages : [{ role: 'user', content: mensaje }];
  const requestBody = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system,
    messages: msgs,
  };
  if (conBusqueda) {
    requestBody.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }];
  }
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
  });
  const data = await anthropicRes.json();
  if (!anthropicRes.ok) {
    const err = new Error(data?.error?.message || 'Error al llamar a la API.');
    err.status = anthropicRes.status;
    throw err;
  }
  const texto = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return { texto, usage: data.usage };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Tope de uso de IA del hub (api/_lib/saldo.js): al llegar al tope los Jefes no usan la IA hasta
  // que se renueva el ciclo o se compra un paquete. La interfaz sigue funcionando.
  const bloqueoSaldo = await revisarSaldo((((req.body || {}).cliente) || DEFAULT_CLIENTE).toString(), leerJSON);
  if (bloqueoSaldo) return res.status(bloqueoSaldo.status).json(bloqueoSaldo.cuerpo);

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
  const grupoId = body.grupo_id ? body.grupo_id.toString() : '';
  const productoId = body.producto_id ? body.producto_id.toString() : '';
  const modo = body.modo === 'contenido' ? 'contenido' : body.modo === 'pregunta' ? 'pregunta' : body.modo === 'prompt-medio' ? 'prompt-medio' : 'ideas';
  const objetivo = OBJETIVOS_VALIDOS.includes(body.objetivo) ? body.objetivo : 'alcance';
  const esTendencia = objetivo === 'tendencia';

  try {
    if (modo === 'prompt-medio') {
      const tipo = body.tipo === 'video' ? 'video' : 'imagen';
      const post = body.post && typeof body.post === 'object' ? body.post : {};
      const campo = (v, n) => (v == null ? '' : String(v)).trim().slice(0, n);
      const lineas = ['TIPO DE PROMPT: ' + tipo, '', 'POST:'];
      if (campo(post.gancho, 300)) lineas.push('Título: ' + campo(post.gancho, 300));
      if (campo(post.formato, 40)) lineas.push('Formato: ' + campo(post.formato, 40));
      if (campo(post.caption, 2500)) lineas.push('Caption: ' + campo(post.caption, 2500));
      if (campo(post.guion, 2500)) lineas.push('Guion: ' + campo(post.guion, 2500));
      if (campo(post.notas, 1200)) lineas.push('Notas: ' + campo(post.notas, 1200));
      const material = campo(body.texto, 1500);
      const promptActual = campo(body.prompt_actual, 3000);
      if (promptActual) {
        // Actualizar: partir del prompt que ya existe y aplicar solo los cambios pedidos.
        lineas.push('', 'PROMPT ACTUAL (la persona ya lo tiene; ACTUALÍZALO y devuélvelo completo, conservando todo lo que no pidió cambiar):', promptActual);
        lineas.push('', material ? 'CAMBIOS QUE PIDE LA PERSONA: ' + material : 'La persona no escribió cambios: mejora el prompt manteniendo su idea.');
      } else if (material) lineas.push('', 'MATERIAL REAL (lo que la persona cuenta que tiene o cómo lo imagina):', material);
      const imagenes = Array.isArray(body.imagenes)
        ? body.imagenes.filter((img) => img && img.mediaType && img.data).slice(0, 4)
        : [];
      if (imagenes.length) lineas.push('', 'Las imágenes adjuntas son el MATERIAL REAL (si vienen de un video, son cuadros de ese video).');
      lineas.push('', 'Escribe ahora el prompt de ' + tipo + '.');
      const partes = imagenes.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } }));
      partes.push({ type: 'text', text: lineas.join('\n') });
      const { contexto } = await construirContexto(clienteId, grupoId);
      const system = systemConCache(cargarPromptMedios(), contexto);
      const { texto, usage } = await llamarClaudeTexto({ system, messages: [{ role: 'user', content: partes }], maxTokens: 1000, conBusqueda: false });
      if (!texto) {
        return res.status(502).json({ error: 'No se pudo crear el prompt. Intenta de nuevo.' });
      }
      await registrarUsoTokens(clienteId, 'generar-guion-organico-prompt-medio', usage);
      return res.status(200).json({ text: texto });
    }

    if (modo === 'pregunta') {
      const mensajeSuelto = (body.mensaje || '').toString().trim();
      const messagesRaw = Array.isArray(body.messages) ? body.messages : null;
      const validos = messagesRaw ? messagesRaw.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()) : [];
      const historial = messagesRaw
        ? validos
            .slice(-PREGUNTA_MAX_MESSAGES)
            .map((m) => ({ role: m.role, content: m.content }))
        : mensajeSuelto
        ? [{ role: 'user', content: mensajeSuelto }]
        : [];
      if (!historial.length || historial[historial.length - 1].role !== 'user') {
        return res.status(400).json({ error: 'Falta la pregunta.' });
      }

      const imagenes = Array.isArray(body.imagenes)
        ? body.imagenes.filter((img) => img && img.mediaType && img.data).slice(0, 4)
        : [];
      if (imagenes.length) {
        const ultimo = historial[historial.length - 1];
        const partes = imagenes.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } }));
        partes.push({ type: 'text', text: ultimo.content || 'Revisa esta imagen de referencia y ayúdame con ideas de post.' });
        ultimo.content = partes;
      }

      const promptPreguntas = cargarPromptPreguntas();
      const { contexto, catalogo } = await construirContexto(clienteId, grupoId);
      const arranque = body.fase === 'arranque' ? '\n\n' + cargarPromptArranque() : '';
      const armar = body.fase === 'armar' ? '\n\n' + cargarPromptArmar() : '';
      const enfoque = await construirEnfoqueProducto(clienteId, catalogo, productoId).catch(() => null);
      const system = systemConCache(promptPreguntas + arranque + armar, contexto, enfoque);

      const { texto, usage } = await llamarClaudeTexto({ system, messages: historialConCache(historial, { noReutilizable: imagenes.length > 0, total: validos.length, max: PREGUNTA_MAX_MESSAGES }), maxTokens: 1100, conBusqueda: true });
      if (!texto) {
        return res.status(502).json({ error: 'El Agente no devolvió respuesta. Intenta de nuevo.' });
      }
      await registrarUsoTokens(clienteId, 'generar-guion-organico-pregunta', usage);
      return res.status(200).json({ text: texto });
    }

    const promptFijo = cargarPromptFijo();
    const { contexto, catalogo } = await construirContexto(clienteId, grupoId);
    const bloqueProducto = formatearProducto(catalogo, productoId);

    if (modo === 'ideas') {
      const tema = (body.tema || '').toString().trim();
      const cantidad = Math.min(Math.max(parseInt(body.cantidad, 10) || 6, 1), 10);

      const instruccion = 'INSTRUCCIÓN DE ESTA GENERACIÓN — MODO "ideas":\n' +
        `OBJETIVO: ${objetivo}\n` +
        `CANTIDAD DE IDEAS: ${cantidad}` +
        (tema ? `\nTEMA / CONTEXTO SEMILLA (opcional, úsalo como punto de partida): ${tema}` : '') +
        (bloqueProducto ? '\n\n' + bloqueProducto : '') +
        (esTendencia ? '\n\nEl objetivo es "tendencia": usa la herramienta de búsqueda web para encontrar qué está pasando AHORA antes de responder. Basa las ideas en hallazgos reales, no en suposiciones.' : '');

      const system = systemConCache(promptFijo, contexto, instruccion);
      const { parsed, usage } = await llamarClaude({
        system,
        mensaje: 'Genera las ideas de contenido orgánico pedidas, siguiendo el formato JSON obligatorio del MODO "ideas" al pie de la letra.',
        maxTokens: esTendencia ? 4000 : 3000,
        conBusqueda: esTendencia,
      });

      const ideas = Array.isArray(parsed.ideas) ? parsed.ideas : [];
      if (!ideas.length) {
        return res.status(502).json({ error: 'El modelo no devolvió ideas. Intenta de nuevo.' });
      }
      await registrarUsoTokens(clienteId, 'generar-guion-organico-ideas', usage);
      return res.status(200).json({ ideas, usage: camposUso(usage) });
    }

    // modo === 'contenido'
    const formato = (body.formato || 'reel').toString();
    const idea = body.idea;
    if (!idea || !idea.idea) {
      return res.status(400).json({ error: 'Falta la idea seleccionada.' });
    }

    const instruccion = 'INSTRUCCIÓN DE ESTA GENERACIÓN — MODO "contenido":\n' +
      `OBJETIVO: ${objetivo}\n` +
      `FORMATO: ${formato}\n` +
      'IDEA ELEGIDA (con sus ángulos):\n' + formatearIdeaSeleccionada(idea) +
      (bloqueProducto ? '\n\n' + bloqueProducto : '') +
      (esTendencia ? '\n\nEl objetivo es "tendencia": si es útil, usa la herramienta de búsqueda web para confirmar el hallazgo antes de escribir el contenido.' : '');

    const system = systemConCache(promptFijo, contexto, instruccion);
    const { parsed, usage } = await llamarClaude({
      system,
      mensaje: 'Genera el caption y el guion pedidos para la idea elegida, siguiendo el formato JSON obligatorio del MODO "contenido" al pie de la letra.',
      maxTokens: esTendencia ? 2500 : 2000,
      conBusqueda: esTendencia,
    });

    if (!parsed.guion) {
      return res.status(502).json({ error: 'El modelo no devolvió el contenido esperado. Intenta de nuevo.' });
    }
    await registrarUsoTokens(clienteId, 'generar-guion-organico-contenido', usage);
    return res.status(200).json({
      caption: parsed.caption || '',
      guion: parsed.guion || '',
      notas_grabacion: parsed.notas_grabacion || '',
      duracion_aproximada: parsed.duracion_aproximada || '',
      usage: camposUso(usage),
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.status ? err.message : 'Error de conexión con el Agente.' });
  }
};

