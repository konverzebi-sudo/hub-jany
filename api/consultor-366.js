// Endpoint server-side del Jefe 366: el chat guiado multi-turno (Módulos 1-6, Documento Maestro)
// y el chat de Jefe de Temporada, que se fusionó aquí mismo por el límite de 12 Serverless
// Functions del plan Hobby de Vercel -- se distinguen por body.agente === 'temporada'.
// La rama de "pregunta suelta sin memoria" (Consulta en vivo con el Agente) que vivía aquí se
// retiró -- esa caja nunca guardaba nada en Notas y se quitó de la interfaz por ser redundante
// con el chat guiado.

const fs = require('fs');
const path = require('path');
const { sql } = require('@vercel/postgres');

const DEFAULT_CLIENTE = 'rancho-seco'; // no rompe la ruta actual, que todavia no manda `cliente`

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

function truncar(str, limite) {
  if (!str) return str;
  return str.length > limite ? str.slice(0, limite) + '\n[...recortado...]' : str;
}

// Banco de Conversaciones reales de WhatsApp -- se guarda desde Jefe WhatsApp y Ventas
// ({cliente}:whatsapp-convos) y se lee aquí como contexto extra, misma memoria compartida, sin
// duplicarla.
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
  return 'BANCO DE CONVERSACIONES REALES DE WHATSAPP (guardadas por el usuario en Jefe WhatsApp y Ventas -- son transcripciones reales de clientes, úsalas para frases reales, objeciones y tono; no las inventes ni las repitas tal cual, tradúcelas a lo que estés construyendo):\n\n' + recortado;
}

async function llamarClaude(system, body) {
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const data = await anthropicRes.json();
  return { ok: anthropicRes.ok, status: anthropicRes.status, data };
}

// =============================================================================================
// RAMA "builder" (original api/consultor-366.js) -- chat guiado multi-turno.
// =============================================================================================

const BUILDER_PROMPTS_POR_MODO = {
  normal: path.join(__dirname, '..', 'prompts', 'system-prompt-constructor-oferta-366.md'),
  'documento-maestro': path.join(__dirname, '..', 'prompts', 'system-prompt-documento-maestro.md'),
};

// RAMA "temporada" (nuevo -- Jefe de Temporada) se agrega más abajo, reempacada en este mismo
// archivo por el mismo límite de 12 Serverless Functions: reutiliza el contexto de negocio y
// las Notas Evergreen ya construidas aquí (builderConstruirContextoNegocio /
// builderFormatearNotasGuardadas) en vez de duplicarlas.
// "plan" es el chat guiado general (Definición + Metas..Calendario); los otros 3 son los
// mini-chats dedicados de cada módulo profundo (más detallados que el flujo general, calcados
// de las sub-páginas del Notion "Día 6 — Campaña de Temporada").
const TEMPORADA_PROMPTS_POR_MODULO = {
  plan: path.join(__dirname, '..', 'prompts', 'system-prompt-temporada.md'),
  producto: path.join(__dirname, '..', 'prompts', 'system-prompt-temporada-producto.md'),
  'perfil-cliente': path.join(__dirname, '..', 'prompts', 'system-prompt-temporada-perfil-cliente.md'),
  comunicacion: path.join(__dirname, '..', 'prompts', 'system-prompt-temporada-comunicacion.md'),
};
const temporadaPromptCache = new Map();
function cargarPromptTemporada(modulo) {
  const ruta = TEMPORADA_PROMPTS_POR_MODULO[modulo] || TEMPORADA_PROMPTS_POR_MODULO.plan;
  if (temporadaPromptCache.has(ruta)) return temporadaPromptCache.get(ruta);
  const contenido = fs.readFileSync(ruta, 'utf-8');
  temporadaPromptCache.set(ruta, contenido);
  return contenido;
}
const BUILDER_CONTEXT_CHAR_LIMIT = 6000;
const BUILDER_NOTAS_CHAR_LIMIT = 6000;
const BUILDER_MAX_MESSAGES = 40;

const builderPromptCache = new Map();
function cargarPromptBuilder(modo) {
  const ruta = BUILDER_PROMPTS_POR_MODO[modo] || BUILDER_PROMPTS_POR_MODO.normal;
  if (builderPromptCache.has(ruta)) return builderPromptCache.get(ruta);
  const contenido = fs.readFileSync(ruta, 'utf-8');
  builderPromptCache.set(ruta, contenido);
  return contenido;
}

const builderHits = new Map();
const BUILDER_WINDOW_MS = 10 * 60 * 1000;
const BUILDER_MAX_REQUESTS = 40;
function builderRateLimited(ip) {
  const now = Date.now();
  const recent = (builderHits.get(ip) || []).filter((t) => now - t < BUILDER_WINDOW_MS);
  recent.push(now);
  builderHits.set(ip, recent);
  return recent.length > BUILDER_MAX_REQUESTS;
}

async function registrarUsoTokens(clienteId, endpoint, usage) {
  try {
    const key = `${clienteId}:uso-tokens-log`;
    const items = (await leerJSON(key)) || [];
    items.push({
      date: new Date().toISOString(),
      endpoint,
      inputTokens: usage?.input_tokens || 0,
      outputTokens: usage?.output_tokens || 0,
    });
    await escribirJSON(key, items.slice(-500));
  } catch (err) {
    // No bloquear la respuesta al usuario si falla el registro de uso.
  }
}

function builderFormatearIdentidad(d) {
  if (!d) return null;
  const lineas = [];
  if (d.nombre) lineas.push(`Nombre: ${d.nombre}`);
  if (d.giro_categoria || d.giro_texto) lineas.push(`Giro: ${d.giro_texto || d.giro_categoria}`);
  if (d.producto_estrella) lineas.push(`Producto estrella: ${d.producto_estrella}`);
  if (Array.isArray(d.objetivos) && d.objetivos.length) lineas.push(`Objetivos: ${d.objetivos.join(', ')}`);
  if (d.objetivo_principal) lineas.push(`Objetivo principal: ${d.objetivo_principal}`);
  if (d.historia) lineas.push(`Historia: ${d.historia}`);
  if (d.mejora_deseada) lineas.push(`Qué quiere mejorar: ${d.mejora_deseada}`);
  if (lineas.length === 0) return null;
  return 'IDENTIDAD DEL NEGOCIO:\n' + lineas.join('\n');
}

function builderFormatearTono(d) {
  if (!d) return null;
  const lineas = [];
  if (Array.isArray(d.tonos) && d.tonos.length) lineas.push(`Tonos: ${d.tonos.join(', ')}`);
  if (d.persona) lineas.push(`Persona de marca: ${d.persona}`);
  if (Array.isArray(d.palabras_si) && d.palabras_si.length) lineas.push(`Palabras que sí usa: ${d.palabras_si.join(', ')}`);
  if (Array.isArray(d.palabras_no) && d.palabras_no.length) lineas.push(`Palabras que NO usa: ${d.palabras_no.join(', ')}`);
  if (d.ejemplo_si) lineas.push(`Ejemplo de tono correcto: ${d.ejemplo_si}`);
  if (d.ejemplo_no) lineas.push(`Ejemplo de tono incorrecto: ${d.ejemplo_no}`);
  if (lineas.length === 0) return null;
  return 'TONO DE MARCA:\n' + lineas.join('\n');
}

// Perfiles de cliente: misma llave que usa Jefe 366 para su "Perfil de Cliente" en pestañas
// (brand-book.audiencias, {lista:[...]}) -- una sola fuente de verdad, se edita solo en Jefe 366,
// el ADN la muestra de solo lectura. El orden de la lista es la prioridad de compra.
async function builderLeerAudiencias(clienteId) {
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

function builderFormatearAudiencias(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const bloques = items
    .filter((a) => a && (a.nombre || a.ocupacion || a.descripcion_breve))
    .map((a, i) => {
      const l = [`Perfil ${i + 1}${a.nombre ? ': ' + a.nombre : ''} (prioridad de compra ${i + 1} de ${items.length})`];
      if (a.producto_relacionado) l.push(`  Producto/oferta que más probablemente compra: ${a.producto_relacionado}`);
      if (a.ocupacion) l.push(`  Ocupación: ${a.ocupacion}`);
      if (a.edad) l.push(`  Edad: ${a.edad}`);
      if (a.ubicacion) l.push(`  Ubicación: ${a.ubicacion}`);
      if (a.miedo_deseo) l.push(`  Miedo/deseo: ${a.miedo_deseo}`);
      if (a.como_ayuda) l.push(`  Cómo le ayuda: ${a.como_ayuda}`);
      if (a.quien_compra) l.push(`  Quién compra: ${a.quien_compra}`);
      if (a.que_busca) l.push(`  Qué busca: ${a.que_busca}`);
      if (a.objecion_comun) l.push(`  Objeción más común: ${a.objecion_comun}`);
      if (a.por_que_si) l.push(`  Por qué SÍ compran: ${a.por_que_si}`);
      if (a.por_que_no) l.push(`  Por qué NO compran: ${a.por_que_no}`);
      if (a.dudas) l.push(`  Dudas frecuentes: ${a.dudas}`);
      if (a.frases) l.push(`  Frases reales de clientes: ${a.frases}`);
      if (a.descripcion_breve) l.push(`  Descripción breve: ${a.descripcion_breve}`);
      if (a.situacion_compra) l.push(`  Situación de compra: ${a.situacion_compra}`);
      if (a.problema_resuelve) l.push(`  Problema que resuelve: ${a.problema_resuelve}`);
      if (a.emocion_impulsa) l.push(`  Emoción que lo impulsa: ${a.emocion_impulsa}`);
      if (a.que_convenceria) l.push(`  Qué lo convencería: ${a.que_convenceria}`);
      if (a.insight_estrategico) l.push(`  Insight estratégico: ${a.insight_estrategico}`);
      ['caracteristicas', 'dolores', 'miedos', 'deseos', 'objeciones', 'frases_reales'].forEach((campo) => {
        const f = builderFormatearValorNota(a[campo]);
        if (f) l.push(`  ${campo}:\n${f}`);
      });
      return l.join('\n');
    });
  if (bloques.length === 0) return null;
  return 'PERFILES DE CLIENTE (ordenados de mayor a menor probabilidad de compra -- si el producto/ángulo en cuestión coincide con el "producto relacionado" de un perfil, prioriza ese; si no, usa el primero de la lista):\n' + bloques.join('\n\n');
}

function builderFormatearGrupos(grupos) {
  if (!Array.isArray(grupos) || grupos.length === 0) return null;
  return 'GRUPOS DE NEGOCIO YA DEFINIDOS (líneas de producto/servicio -- usa estos nombres tal cual, nunca inventes otros; si el usuario menciona una línea que no está aquí, dile que la agregue en el Catálogo del ADN):\n' +
    grupos.map((g) => `- ${g.nombre}`).join('\n');
}

function builderFormatearCatalogo(items, grupos) {
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
      if (p.costo != null && p.costo !== '') partes.push(`costo $${p.costo}`);
      if (p.que_tanto_se_vende) partes.push(`se vende: ${p.que_tanto_se_vende}`);
      if (p.inventario) partes.push(`inventario: ${p.inventario}`);
      if (p.notas) partes.push(`notas: ${p.notas}`);
      return '- ' + partes.join(' · ');
    });
  if (lineas.length === 0) return null;
  return 'CATÁLOGO DE PRODUCTOS:\n' + lineas.join('\n');
}

function builderFormatearJourney(d) {
  if (!d) return null;
  const lineas = [];
  if (Array.isArray(d.pasos) && d.pasos.length) {
    d.pasos.forEach((p, i) => {
      if (p && (p.opciones?.length || p.otro)) {
        lineas.push(`Paso ${i + 1}: ${(p.opciones || []).join(', ')}${p.otro ? ' — ' + p.otro : ''}`);
      }
    });
  }
  const diag = d.diagnostico || {};
  const diagLineas = [];
  if (diag.perdida) diagLineas.push(`Dónde se pierden ventas: ${diag.perdida}`);
  if (diag.objecion) diagLineas.push(`Objeción más común en journey: ${diag.objecion}`);
  if (diag.desorden) diagLineas.push(`Qué está desordenado: ${diag.desorden}`);
  const todo = [...lineas, ...diagLineas];
  if (todo.length === 0) return null;
  return 'CUSTOMER JOURNEY ACTUAL:\n' + todo.join('\n');
}

function builderFormatearMetricasFinancieros(m, f) {
  const lineas = [];
  if (m) {
    if (m.ticket_promedio) lineas.push(`Ticket promedio: $${m.ticket_promedio}`);
    if (m.num_ventas_mes) lineas.push(`Ventas al mes: ${m.num_ventas_mes}`);
    if (m.tasa_conversion_pct) lineas.push(`Tasa de conversión: ${m.tasa_conversion_pct}%`);
  }
  if (f) {
    if (f.margen_bruto_pct) lineas.push(`Margen bruto: ${f.margen_bruto_pct}%`);
    if (f.costo_variable_pct) lineas.push(`Costo variable: ${f.costo_variable_pct}%`);
  }
  if (lineas.length === 0) return null;
  return 'MÉTRICAS Y FINANCIEROS:\n' + lineas.join('\n');
}

async function builderConstruirContextoNegocio(clienteId) {
  const [identidad, tono, audiencia, catalogo, grupos, journey, metricas, financieros] = await Promise.all([
    leerJSON(`${clienteId}:brand-book.identidad`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.tono`).catch(() => null),
    builderLeerAudiencias(clienteId).catch(() => []),
    leerJSON(`${clienteId}:catalogo-productos`).catch(() => null),
    leerJSON(`${clienteId}:grupos-negocio`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.customer_journey`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.metricas`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.financieros`).catch(() => null),
  ]);

  const bloques = [
    builderFormatearIdentidad(identidad),
    builderFormatearTono(tono),
    builderFormatearAudiencias(audiencia),
    builderFormatearGrupos(grupos),
    builderFormatearCatalogo(catalogo, grupos),
    builderFormatearJourney(journey),
    builderFormatearMetricasFinancieros(metricas, financieros),
  ].filter(Boolean);

  if (bloques.length === 0) {
    return 'CONTEXTO DEL NEGOCIO: el ADN de esta marca todavía no tiene datos guardados. Avísale al usuario que antes de continuar sería ideal llenar el ADN, pero si quiere seguir de todas formas, hazle tú las preguntas mínimas necesarias antes del Paso 1.';
  }
  return 'CONTEXTO DEL NEGOCIO (ya cargado del ADN — no le pidas al usuario que lo repita):\n\n' + truncar(bloques.join('\n\n'), BUILDER_CONTEXT_CHAR_LIMIT);
}

function builderFormatearValorNota(valor) {
  if (valor == null) return '';
  if (Array.isArray(valor)) {
    const filas = valor.filter((f) => f && Object.values(f).some((v) => (v || '').toString().trim()));
    if (filas.length === 0) return '';
    return filas
      .map((f) => Object.entries(f).filter(([k, v]) => k !== '_marcada' && (v || '').toString().trim()).map(([k, v]) => `${k}: ${v}`).join(' | '))
      .map((l) => '  - ' + l)
      .join('\n');
  }
  if (typeof valor === 'object') {
    const partes = Object.entries(valor).filter(([, v]) => (v || '').toString().trim()).map(([k, v]) => `  - ${k}: ${v}`);
    return partes.join('\n');
  }
  return valor.toString().trim() ? '  ' + valor.toString().trim() : '';
}

// Sistema 366 y Comunicación 366 también funcionan con pestañas (varios sistemas/comunicaciones
// -- uno compartido para todo el negocio, u otros independientes por grupo/producto). Misma
// migración de 3 niveles que Producto 366 y Perfil de Cliente.
async function builderLeerSistemas366(clienteId) {
  const nuevo = await leerJSON(`${clienteId}:brand-book.366-sistema`).catch(() => null);
  if (nuevo && Array.isArray(nuevo.lista) && nuevo.lista.length) return nuevo.lista;
  if (nuevo && Object.keys(nuevo).length) return [Object.assign({ nombre: 'Sistema Principal' }, nuevo)];
  const viejo = await leerJSON(`${clienteId}:brand-book.evergreen-sistema`).catch(() => null);
  if (viejo && Object.keys(viejo).length) return [Object.assign({ nombre: 'Sistema Principal' }, viejo)];
  return [];
}

function builderFormatearSistemas366(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const bloques = items
    .filter((p) => p && (p.nombre || p.contexto_general || (p.customer_journey && Object.keys(p.customer_journey).length)))
    .map((p, i) => {
      const l = [`Sistema ${i + 1}${p.nombre ? ': ' + p.nombre : ''}`];
      if (p.contexto_general) l.push(`  Contexto general: ${p.contexto_general}`);
      const cj = builderFormatearValorNota(p.customer_journey);
      if (cj) l.push(`  Tu Sistema 366 (qué hacemos por etapa):\n${cj}`);
      ['plan_implementacion', 'secuencia_seguimiento', 'oportunidades_iniciales'].forEach((campo) => {
        const f = builderFormatearValorNota(p[campo]);
        if (f) l.push(`  ${campo}:\n${f}`);
      });
      if (p.info_faltante) l.push(`  Información faltante: ${p.info_faltante}`);
      if (p.reglas_equipo_ia) l.push(`  Reglas para el Equipo de Marketing IA: ${p.reglas_equipo_ia}`);
      return l.join('\n');
    });
  if (bloques.length === 0) return null;
  return 'SISTEMA 366 (puede haber varios sistemas guardados):\n' + bloques.join('\n\n');
}

async function builderLeerComunicaciones366(clienteId) {
  const nuevo = await leerJSON(`${clienteId}:brand-book.366-comunicacion`).catch(() => null);
  if (nuevo && Array.isArray(nuevo.lista) && nuevo.lista.length) return nuevo.lista;
  if (nuevo && Object.keys(nuevo).length) return [Object.assign({ nombre: 'Comunicación Principal' }, nuevo)];
  const viejo = await leerJSON(`${clienteId}:brand-book.evergreen-comunicacion`).catch(() => null);
  if (viejo && Object.keys(viejo).length) return [Object.assign({ nombre: 'Comunicación Principal' }, viejo)];
  return [];
}

function builderFormatearComunicaciones366(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const bloques = items
    .filter((p) => p && (p.nombre || p.posicionamiento))
    .map((p, i) => {
      const l = [`Comunicación ${i + 1}${p.nombre ? ': ' + p.nombre : ''}`];
      if (p.posicionamiento) l.push(`  Posicionamiento: ${p.posicionamiento}`);
      if (p.diferenciador) l.push(`  Diferenciador principal: ${p.diferenciador}`);
      if (p.que_no_es) l.push(`  Qué NO es la oferta: ${p.que_no_es}`);
      if (p.resultado_entender) l.push(`  Resultado que el cliente debe entender: ${p.resultado_entender}`);
      if (p.por_que_elegirnos) l.push(`  Por qué elegirnos: ${p.por_que_elegirnos}`);
      ['frases_maestras', 'frases_objeciones', 'frases_conexion', 'angulos_evergreen'].forEach((campo) => {
        const f = builderFormatearValorNota(p[campo]);
        if (f) l.push(`  ${campo}:\n${f}`);
      });
      return l.join('\n');
    });
  if (bloques.length === 0) return null;
  return 'COMUNICACIÓN 366 (puede haber varias guardadas):\n' + bloques.join('\n\n');
}

// Producto 366 también funciona con pestañas (varias ofertas) -- misma migración de 3 niveles
// que audiencias: {lista:[...]} nuevo -> objeto plano 366-producto viejo -> evergreen-producto.
async function builderLeerProductos366(clienteId) {
  const nuevo = await leerJSON(`${clienteId}:brand-book.366-producto`).catch(() => null);
  if (nuevo && Array.isArray(nuevo.lista) && nuevo.lista.length) return nuevo.lista;
  if (nuevo && Object.keys(nuevo).length) return [Object.assign({ nombre: 'Producto Principal' }, nuevo)];
  const viejo = await leerJSON(`${clienteId}:brand-book.evergreen-producto`).catch(() => null);
  if (viejo && Object.keys(viejo).length) return [Object.assign({ nombre: 'Producto Principal' }, viejo)];
  return [];
}

function builderFormatearProductos366(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const bloques = items
    .filter((p) => p && (p.nombre || p.que_vendemos))
    .map((p, i) => {
      const l = [`Oferta ${i + 1}${p.nombre ? ': ' + p.nombre : ''}`];
      if (p.que_vendemos) l.push(`  Qué vendemos: ${p.que_vendemos}`);
      if (p.por_que_potencial) l.push(`  Por qué tiene potencial 366: ${p.por_que_potencial}`);
      if (p.oferta_irresistible) l.push(`  Oferta Irresistible 366: ${p.oferta_irresistible}`);
      if (p.insight_estrategico) l.push(`  Insight estratégico: ${p.insight_estrategico}`);
      ['pilar_deseo', 'pilar_confianza', 'pilar_facilidad', 'frases_enfatizar', 'frases_evitar', 'sistema_productos'].forEach((campo) => {
        const f = builderFormatearValorNota(p[campo]);
        if (f) l.push(`  ${campo}:\n${f}`);
      });
      return l.join('\n');
    });
  if (bloques.length === 0) return null;
  return 'PRODUCTO 366 (puede haber varias ofertas guardadas):\n' + bloques.join('\n\n');
}

async function builderFormatearNotasGuardadas(clienteId) {
  const [perfiles, productos, sistemas, comunicaciones] = await Promise.all([
    builderLeerAudiencias(clienteId).catch(() => []),
    builderLeerProductos366(clienteId).catch(() => []),
    builderLeerSistemas366(clienteId).catch(() => []),
    builderLeerComunicaciones366(clienteId).catch(() => []),
  ]);
  const bloques = [];
  // Perfil de Cliente 366 ya no vive en su propio grupo de Notas -- vive en brand-book.audiencias
  // (los mismos perfiles que Jefe 366 y el ADN comparten), se agrega aquí para que la regla de
  // "revisa lo ya guardado antes de proponer" también aplique a estos campos.
  const perfilesBloque = builderFormatearAudiencias(perfiles);
  if (perfilesBloque) bloques.push('PERFIL DE CLIENTE 366:\n' + perfilesBloque);
  const productosBloque = builderFormatearProductos366(productos);
  if (productosBloque) bloques.push(productosBloque);
  const sistemasBloque = builderFormatearSistemas366(sistemas);
  if (sistemasBloque) bloques.push(sistemasBloque);
  const comunicacionesBloque = builderFormatearComunicaciones366(comunicaciones);
  if (comunicacionesBloque) bloques.push(comunicacionesBloque);

  if (bloques.length === 0) {
    return 'NOTAS 366 YA GUARDADAS: todavía no hay nada guardado en ninguna de las 4 secciones de Notas.';
  }
  return 'NOTAS 366 YA GUARDADAS (esto es lo real, guardado por el usuario -- tu revisión se basa en esto, no en esta conversación):\n\n' + truncar(bloques.join('\n\n'), BUILDER_NOTAS_CHAR_LIMIT);
}

async function manejarChatGuiado(req, res) {
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').toString().split(',')[0].trim();
  if (builderRateLimited(ip)) {
    return res.status(429).json({ error: 'Demasiadas solicitudes, espera unos minutos.' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY en el servidor.' });
  }

  const body = req.body || {};
  const clienteId = (body.cliente || DEFAULT_CLIENTE).toString();
  const modo = body.modo === 'documento-maestro' ? 'documento-maestro' : 'normal';
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    return res.status(400).json({ error: 'Falta el historial de la conversación (messages).' });
  }
  const limpio = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-BUILDER_MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content }));
  if (limpio.length === 0 || limpio[limpio.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'El último mensaje debe ser del usuario.' });
  }

  const imagenes = Array.isArray(body.imagenes) ? body.imagenes.filter((img) => img && img.mediaType && img.data).slice(0, 6) : [];
  const txtConversacion = typeof body.txtConversacion === 'string' ? body.txtConversacion : '';
  if (imagenes.length || txtConversacion.trim()) {
    const ultimo = limpio[limpio.length - 1];
    const partes = imagenes.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } }));
    let texto = ultimo.content;
    if (txtConversacion.trim()) {
      texto += '\n\n--- Conversación(es) de WhatsApp adjuntas por el usuario ---\n' + truncar(txtConversacion.trim(), 90000);
    }
    partes.push({ type: 'text', text: texto });
    ultimo.content = partes;
  }

  try {
    const promptFijo = cargarPromptBuilder(modo);
    const contexto = await builderConstruirContextoNegocio(clienteId);
    const partesSystem = [promptFijo, contexto];
    const bancoConversaciones = await formatearBancoConversacionesWhatsApp(clienteId).catch(() => null);
    if (bancoConversaciones) partesSystem.push(bancoConversaciones);
    // Se inyecta siempre (no solo en modo documento-maestro) para que el chat guiado normal
    // también sepa qué ya está guardado y pueda comparar en vez de proponer siempre desde cero.
    partesSystem.push(await builderFormatearNotasGuardadas(clienteId));
    const system = partesSystem.join('\n\n');

    const { ok, status, data } = await llamarClaude(system, {
      model: 'claude-sonnet-4-6',
      max_tokens: modo === 'documento-maestro' ? 3000 : 2200,
      system,
      messages: limpio,
    });
    if (!ok) {
      return res.status(status).json({ error: data?.error?.message || 'Error al llamar a la API.' });
    }

    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (!text) {
      return res.status(502).json({ error: 'Respuesta vacía del modelo.' });
    }
    await registrarUsoTokens(clienteId, 'consultor-366-builder', data.usage);
    return res.status(200).json({
      text,
      usage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
}

// =============================================================================================
// RAMA "temporada" (Jefe de Temporada) -- chat guiado multi-turno, igual forma que el builder
// (body.messages) pero con su propio prompt y su propio contexto: la campaña de temporada en
// curso, además del contexto de negocio y las Notas Evergreen que ya construye este archivo.
// =============================================================================================

const TEMPORADA_CAMPO_LABEL = {
  temporada: 'Temporada o evento', objetivo_principal: 'Objetivo principal', incentivo: 'Incentivo o urgencia real',
  prod_por_que: 'Por qué este producto hace sentido para esta temporada', prod_incentivos: 'Incentivos de producto',
  cliente_que_pasa: '¿Qué está pasando en su vida en este momento?', cliente_diferencias: 'Diferencias clave',
  cliente_que_haria_hoy: '¿Qué haría que compre hoy?', cliente_que_cambio: '¿Qué cambió vs el cliente recurrente?',
  com_mensajes_opciones: 'Opciones de mensaje principal', com_mensaje_elegido: 'Mensaje elegido',
  com_razon_ahora: 'Razón para comprar ahora', com_mensajes_clave: 'Mensajes clave',
  com_frases_maestras: 'Frases maestras de campaña', com_objeciones: 'Objeciones de campaña',
  com_angulos: 'Ángulos de venta de campaña', com_ctas: 'CTAs de campaña',
  dm_cliente_ideal_temporada: 'Cliente ideal de temporada', dm_que_cambia: 'Qué cambia en este cliente por la temporada',
  dm_dolor: 'Dolor principal de temporada', dm_deseo: 'Deseo principal de temporada', dm_objeciones: 'Objeciones específicas de temporada',
  dm_oferta: 'Oferta principal', dm_incentivo: 'Incentivo', dm_urgencia: 'Urgencia real', dm_mensaje_principal: 'Mensaje principal',
  dm_frases_clave: 'Frases clave de comunicación', dm_canal_conversion: 'Canal principal de conversión', dm_accion_cliente: 'Acción que queremos que tome el cliente',
  meta_ventas: 'Meta de ventas', ticket_promedio: 'Ticket promedio', conversion_pct: 'Conversión estimada %',
  presupuesto_ads: 'Presupuesto de ads', base_datos_disponible: 'Base de datos disponible',
  pre_objetivo: 'Objetivo de precampaña', pre_captacion: 'Cómo vamos a captar contactos', pre_donde_quedan: 'Dónde se quedan los contactos',
  pre_incentivo_registro: 'Incentivo de registro', pre_duracion: 'Duración de precampaña', pre_calentamiento: 'Plan de calentamiento',
  activa_fases: 'Fases de campaña activa', bd_segmentos: 'Segmentos de base de datos', post_acciones: 'Acciones de postcampaña',
  ads_objetivo: 'Objetivo de campaña de ads', ads_tipo_campana: 'Tipo de campaña', ads_producto: 'Producto o servicio a vender',
  ads_resultado_esperado: 'Resultado esperado (ads)', ads_publico: 'Público objetivo', ads_oferta: 'Oferta principal (ads)',
  ads_tipo_contenido: 'Tipo de contenido (ads)', ads_presupuesto_diario: 'Presupuesto diario sugerido',
  ads_duracion: 'Duración de campaña (ads)', ads_metrica: 'Métrica principal',
  ads_ubicacion: 'Ubicación (targeting)', ads_edad: 'Edad (targeting)', ads_genero: 'Género (targeting)', ads_intereses: 'Intereses (targeting)',
  ads_creativos: 'Creativos de ads', calendario: 'Calendario final de ejecución',
};

function temporadaFormatearProducto(camp) {
  if (camp.producto_origen === 'nuevo' && camp.producto_nuevo) return `Producto/oferta NUEVO de esta temporada (no está en Evergreen): ${camp.producto_nuevo}`;
  if (camp.producto_origen === 'evergreen' && camp.producto_nombre) return `Producto evergreen elegido como base: ${camp.producto_nombre}`;
  return null;
}

// Solo lo usa el módulo "perfil-cliente" -- ahí el prompt pide explícitamente no recrear al
// cliente recurrente desde cero, así que se le manda el Perfil de Cliente 366 ya guardado. Los
// perfiles viven en brand-book.audiencias (varios, en orden de prioridad de compra); si la
// campaña ya tiene un producto elegido se usa el perfil cuyo "producto relacionado" coincida,
// si no hay coincidencia (o no hay producto elegido) se usa el primero de la lista.
async function temporadaFormatearClienteRecurrente(clienteId, productoNombre) {
  const perfiles = await builderLeerAudiencias(clienteId).catch(() => []);
  if (!perfiles.length) return 'CLIENTE RECURRENTE (Perfil de Cliente 366): todavía no está guardado -- pregúntale al usuario lo mínimo indispensable antes de seguir.';
  const nombreBuscado = (productoNombre || '').toString().trim().toLowerCase();
  const porProducto = nombreBuscado
    ? perfiles.find((p) => p && p.producto_relacionado && p.producto_relacionado.toString().toLowerCase().includes(nombreBuscado))
    : null;
  const elegido = porProducto || perfiles[0];
  const campos = { nombre: 'Nombre del perfil', descripcion_breve: 'Descripción breve', situacion_compra: 'Situación de compra', problema_resuelve: 'Qué problema resuelve', emocion_impulsa: 'Qué emoción lo impulsa', que_convenceria: 'Qué lo convencería', quien_compra: 'Quién compra', miedo_deseo: 'Miedo/deseo' };
  const lineas = Object.keys(campos).map((k) => (elegido[k] ? `${campos[k]}: ${elegido[k]}` : null)).filter(Boolean);
  if (lineas.length === 0) return 'CLIENTE RECURRENTE (Perfil de Cliente 366): todavía no está guardado -- pregúntale al usuario lo mínimo indispensable antes de seguir.';
  return 'CLIENTE RECURRENTE (Perfil de Cliente 366 ya construido' + (porProducto ? ', elegido por coincidir con el producto de esta campaña' : '') + ' -- nunca lo recrees desde cero):\n' + lineas.join('\n');
}

function temporadaFormatearCampana(camp) {
  if (!camp) return 'CAMPAÑA DE TEMPORADA EN CURSO: todavía no hay campaña seleccionada -- si el usuario no ha dicho qué campaña quiere trabajar, pregúntaselo primero.';
  const lineas = [`Nombre de campaña: ${camp.nombre || '(sin nombre todavía)'}`, `Estado: ${camp.estado || 'borrador'}`];
  const prod = temporadaFormatearProducto(camp);
  if (prod) lineas.push(prod);
  if (camp.fecha_inicio_activa || camp.fecha_fin_activa) lineas.push(`Fecha de campaña activa: ${camp.fecha_inicio_activa || '?'} a ${camp.fecha_fin_activa || '?'}`);
  Object.keys(TEMPORADA_CAMPO_LABEL).forEach((campo) => {
    const valor = camp[campo];
    const formateado = builderFormatearValorNota(valor);
    if (formateado) lineas.push(`${TEMPORADA_CAMPO_LABEL[campo]}:\n${formateado}`);
  });
  return 'CAMPAÑA DE TEMPORADA EN CURSO (esto es lo real, ya guardado por el usuario en el Documento de esta campaña -- tu trabajo es completar lo que falte, no repetir lo que ya está):\n\n' + truncar(lineas.join('\n'), BUILDER_NOTAS_CHAR_LIMIT);
}

async function manejarChatTemporada(req, res) {
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').toString().split(',')[0].trim();
  if (builderRateLimited(ip)) {
    return res.status(429).json({ error: 'Demasiadas solicitudes, espera unos minutos.' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY en el servidor.' });
  }

  const body = req.body || {};
  const clienteId = (body.cliente || DEFAULT_CLIENTE).toString();
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    return res.status(400).json({ error: 'Falta el historial de la conversación (messages).' });
  }
  const limpio = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-BUILDER_MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content }));
  if (limpio.length === 0 || limpio[limpio.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'El último mensaje debe ser del usuario.' });
  }

  const modulo = TEMPORADA_PROMPTS_POR_MODULO[body.modulo] ? body.modulo.toString() : 'plan';

  try {
    const campanas = (await leerJSON(`${clienteId}:temporada-campanas`).catch(() => null)) || [];
    const campanaId = (body.campanaId || '').toString();
    const campana = campanaId ? campanas.find((c) => c && c.id === campanaId) : null;

    const [contextoNegocio, notasEvergreen, clienteRecurrente] = await Promise.all([
      builderConstruirContextoNegocio(clienteId),
      builderFormatearNotasGuardadas(clienteId),
      modulo === 'perfil-cliente' ? temporadaFormatearClienteRecurrente(clienteId, campana && (campana.producto_nombre || campana.producto_nuevo)) : Promise.resolve(null),
    ]);
    const partesSystem = [cargarPromptTemporada(modulo), contextoNegocio, notasEvergreen];
    if (clienteRecurrente) partesSystem.push(clienteRecurrente);
    partesSystem.push(temporadaFormatearCampana(campana));
    const system = partesSystem.join('\n\n');

    const { ok, status, data } = await llamarClaude(system, {
      model: 'claude-sonnet-4-6',
      max_tokens: modulo === 'plan' ? 1500 : 2200,
      system,
      messages: limpio,
    });
    if (!ok) {
      return res.status(status).json({ error: data?.error?.message || 'Error al llamar a la API.' });
    }

    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (!text) {
      return res.status(502).json({ error: 'Respuesta vacía del modelo.' });
    }
    await registrarUsoTokens(clienteId, 'consultor-temporada-chat-' + modulo, data.usage);
    return res.status(200).json({
      text,
      usage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0 },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
}

// =============================================================================================
// handler -- messages con agente:'temporada' va a Jefe de Temporada, cualquier otro con
// messages va al chat guiado de Jefe 366.
// =============================================================================================

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  if (Array.isArray(body.messages)) {
    if (body.agente === 'temporada') return manejarChatTemporada(req, res);
    return manejarChatGuiado(req, res);
  }
  return res.status(400).json({ error: 'Falta el historial de la conversación (messages).' });
};
