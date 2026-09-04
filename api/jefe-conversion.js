// Endpoint server-side para el "Jefe vivo" de Conversión y Ventas — multi-tenant.
// La ANTHROPIC_API_KEY vive solo aquí (variable de entorno de Vercel), nunca en el cliente.
// El prompt fijo es una plantilla generica compartida por las 3 marcas -- lo unico que cambia
// por cliente es el CONTEXTO DEL NEGOCIO, cargado en tiempo real desde su propio ADN (mismo
// patron que api/consultor-366.js). No hay datos de negocio hardcoded aqui.

const fs = require('fs');
const path = require('path');
const { sql } = require('@vercel/postgres');

const DEFAULT_CLIENTE = 'jefeshub';
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'system-prompt-jefe-conversion.md');
const CONTEXT_CHAR_LIMIT = 12000;

let fixedPromptCache = null;
function cargarPromptFijo() {
  if (fixedPromptCache) return fixedPromptCache;
  fixedPromptCache = fs.readFileSync(PROMPT_PATH, 'utf-8');
  return fixedPromptCache;
}

// Rate limit básico en memoria (por IP, best-effort entre invocaciones warm de la misma instancia).
const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 12;
const hits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_REQUESTS;
}

// ---------- lectura de storage (mismo shape que api/storage/[key].js / window.storage) ----------

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

// Busca el nombre real de un grupo de negocio (Publicidad, Torneo...) por su id -- sin esta
// etiqueta por item, la IA solo sabe a qué grupo pertenece cada Perfil/Producto/Sistema/
// Comunicación/producto de catálogo por lo que se haya dicho en la conversación (frágil).
function nombreGrupo(grupos, grupoId) {
  if (!grupoId || !Array.isArray(grupos)) return '';
  const g = grupos.find((x) => x && x.id === grupoId);
  return g ? g.nombre : '';
}

function formatearGrupos(grupos) {
  if (!Array.isArray(grupos) || grupos.length === 0) return null;
  return 'GRUPOS DE NEGOCIO YA DEFINIDOS (líneas de producto/servicio -- si el negocio tiene más de uno, cada Perfil/Producto/Sistema/Comunicación de Jefe 366 y cada producto del catálogo más abajo trae "[Grupo: nombre]"; usa SOLO la información del grupo con el que se está trabajando, nunca mezcles información de dos grupos distintos en la misma respuesta):\n' +
    grupos.map((g) => `- ${g.nombre}`).join('\n');
}

function formatearAudiencias(items, grupos) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const bloques = items
    .filter((a) => a && (a.nombre || a.ocupacion || a.descripcion_breve))
    .map((a, i) => {
      const nombreG = nombreGrupo(grupos, a.grupo_id);
      const l = [`Perfil ${i + 1}${a.nombre ? ': ' + a.nombre : ''}${nombreG ? ` [Grupo: ${nombreG}]` : ''} (prioridad de compra ${i + 1} de ${items.length})`];
      if (a.producto_relacionado) l.push(`  Producto/oferta que más probablemente compra: ${a.producto_relacionado}`);
      if (a.miedo_deseo) l.push(`  Miedo/deseo: ${a.miedo_deseo}`);
      if (a.objecion_comun) l.push(`  Objeción más común: ${a.objecion_comun}`);
      if (a.quien_compra) l.push(`  Quién compra: ${a.quien_compra}`);
      if (a.dudas) l.push(`  Dudas frecuentes: ${a.dudas}`);
      if (a.frases) l.push(`  Frases reales de clientes: ${a.frases}`);
      if (a.problema_resuelve) l.push(`  Problema que resuelve: ${a.problema_resuelve}`);
      if (a.que_convenceria) l.push(`  Qué lo convencería: ${a.que_convenceria}`);
      if (a.insight_estrategico) l.push(`  Insight estratégico: ${a.insight_estrategico}`);
      Object.entries(TABLAS_AUDIENCIAS_366).forEach(([campo, { nombreGuardar, columnas }]) => {
        const f = formatearFilasConLabel(a[campo], columnas);
        if (f) l.push(`  ${nombreGuardar}:\n${f}`);
      });
      return l.join('\n');
    });
  if (bloques.length === 0) return null;
  return 'PERFILES DE CLIENTE (de Jefe 366, ordenados de mayor a menor probabilidad de compra -- si el producto que se está trabajando coincide con el "producto relacionado" de un perfil, prioriza ese perfil; si no, usa el primero de la lista. Si el negocio tiene varios grupos de negocio, cada perfil trae "[Grupo: nombre]" -- usa SOLO los del grupo con el que se está trabajando):\n' + bloques.join('\n\n');
}

function formatearCatalogo(items, grupos) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const lineas = items
    .filter((p) => p && p.nombre)
    .map((p) => {
      const nombreG = nombreGrupo(grupos, p.grupo_id);
      const partes = [p.nombre];
      if (p.tipo) partes.push(p.tipo);
      if (p.precio != null && p.precio !== '') partes.push(`precio $${p.precio}`);
      if (p.notas) partes.push(`notas: ${p.notas}`);
      if (nombreG) partes.push(`[Grupo: ${nombreG}]`);
      return '- ' + partes.join(' · ');
    });
  if (lineas.length === 0) return null;
  return 'CATÁLOGO DE PRODUCTOS (precios reales — úsalos siempre que pregunten precio. Si el negocio tiene varios grupos de negocio, cada producto trae "[Grupo: nombre]" -- usa SOLO los del grupo con el que se está trabajando):\n' + lineas.join('\n');
}

function formatearGuionesGuardados(d) {
  if (!d) return null;
  const etiquetas = {
    apertura: 'Apertura (1–2 Frío)',
    calificacion: 'Calificación (3–4 Tibio)',
    oferta_precio: 'Oferta + precio (5–6 Interés)',
    anti_objecion: 'Anti-objeción (7–8 Objeciones)',
    cierre: 'Cierre (9–10)',
  };
  const lineas = Object.keys(etiquetas)
    .filter((k) => d[k] && d[k].trim())
    .map((k) => `${etiquetas[k]}:\n${d[k].trim()}`);
  if (lineas.length === 0) return null;
  return 'GUIONES DE WHATSAPP YA GUARDADOS POR EL USUARIO (úsalos como base, no los repitas tal cual si no aplican al mensaje):\n\n' + lineas.join('\n\n');
}

async function construirContextoNegocio(clienteId) {
  const [identidad, tono, audiencia, catalogo, guiones, grupos] = await Promise.all([
    leerJSON(`${clienteId}:brand-book.identidad`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.tono`).catch(() => null),
    leerAudiencias(clienteId).catch(() => []),
    leerJSON(`${clienteId}:catalogo-productos`).catch(() => null),
    leerJSON(`${clienteId}:brand-book.whatsapp-guiones`).catch(() => null),
    leerJSON(`${clienteId}:grupos-negocio`).catch(() => null),
  ]);

  const bloques = [
    formatearIdentidad(identidad),
    formatearTono(tono),
    formatearGrupos(grupos),
    formatearAudiencias(audiencia, grupos),
    formatearCatalogo(catalogo, grupos),
    formatearGuionesGuardados(guiones),
  ].filter(Boolean);

  if (bloques.length === 0) {
    return 'CONTEXTO DEL NEGOCIO: todavía no hay datos guardados en el ADN de esta marca. Avísale al usuario que conviene llenar el ADN antes de confiar en las respuestas de precio.';
  }
  return 'CONTEXTO DEL NEGOCIO (ya cargado del ADN — no le pidas al usuario que lo repita):\n\n' + truncar(bloques.join('\n\n'), CONTEXT_CHAR_LIMIT);
}

// ---------- CONTEXTO 366 (dolores, deseos, miedos, objeciones, ángulos, frases, sistema) ----------

function formatearValorNota(valor) {
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

// Columnas EXACTAS (deben calzar con CAMPO_LOOKUP/TABLA_CONFIGS de consultor-366.html) para las
// tablas de las 4 secciones de Notas 366 -- sin esto, formatearValorNota mostraría las claves
// internas del objeto (ej. "mes", "titulo") en vez de los nombres de columna reales.
function formatearFilasConLabel(filas, columnas) {
  if (!Array.isArray(filas)) return '';
  const vivas = filas.filter((f) => f && columnas.some((c) => (f[c.key] || '').toString().trim()));
  if (vivas.length === 0) return '';
  return vivas
    .map((f) => columnas.map((c) => `${c.label}: ${(f[c.key] || '').toString().trim()}`).filter((s) => !s.endsWith(': ')).join(' | '))
    .map((l) => '  - ' + l)
    .join('\n');
}

const TABLAS_AUDIENCIAS_366 = {
  dolores: { nombreGuardar: 'Dolores (visibles y ocultos)', columnas: [{ key: 'visible', label: 'Visible' }, { key: 'oculto', label: 'Oculto' }] },
  miedos: { nombreGuardar: 'Miedos', columnas: [{ key: 'miedo', label: 'Miedo' }, { key: 'frena', label: 'Cómo puede frenar la compra' }] },
  deseos: { nombreGuardar: 'Deseos (visibles y secretos)', columnas: [{ key: 'visible', label: 'Visible' }, { key: 'secreto', label: 'Secreto' }] },
  objeciones: { nombreGuardar: 'Objeciones', columnas: [{ key: 'tipo', label: 'Tipo' }, { key: 'objecion', label: 'Objeción' }, { key: 'porque', label: 'Por qué la tiene' }, { key: 'resuelve', label: 'Cómo podemos resolverla' }] },
  frases_reales: { nombreGuardar: 'Frases reales del cliente', columnas: [{ key: 'frase', label: 'Frase real' }, { key: 'revela', label: 'Qué revela' }, { key: 'respuesta', label: 'Respuesta estratégica' }, { key: 'tono', label: 'Tono recomendado' }] },
};

const TABLAS_PRODUCTO_366 = {
  pilar_deseo: { nombreGuardar: '🔥 Deseo', columnas: [{ key: 'pregunta', label: '¿Qué desea lograr / sentir?' }, { key: 'resolucion', label: '¿Cómo lo resolvemos con nuestra oferta?' }] },
  pilar_confianza: { nombreGuardar: '🟢 Confianza', columnas: [{ key: 'pregunta', label: '¿Qué duda / miedo tiene?' }, { key: 'resolucion', label: '¿Cómo lo resolvemos dentro de la oferta?' }] },
  pilar_facilidad: { nombreGuardar: '🔵 Facilidad', columnas: [{ key: 'pregunta', label: '¿Qué frena la compra?' }, { key: 'resolucion', label: '¿Cómo hacemos más fácil que compre hoy?' }] },
  frases_enfatizar: { nombreGuardar: 'Frases que debo enfatizar al vender', columnas: [{ key: 'frase', label: 'Frase real' }, { key: 'revela', label: 'Qué revela' }] },
  frases_evitar: { nombreGuardar: 'Frases que debo evitar al vender', columnas: [{ key: 'frase', label: 'Frase real' }, { key: 'revela', label: 'Qué revela' }] },
  sistema_productos: { nombreGuardar: 'Sistema de Productos 366', columnas: [{ key: 'tipo', label: 'Tipo' }, { key: 'producto', label: 'Producto' }, { key: 'incluye', label: 'Qué incluye' }, { key: 'precio', label: 'Precio' }, { key: 'porque_funciona', label: 'Por qué funciona' }, { key: 'dato_estrategico', label: 'Dato estratégico' }] },
};

const TABLAS_COMUNICACION_366 = {
  frases_maestras: { nombreGuardar: 'Frases maestras', columnas: [{ key: 'frase', label: 'Frase' }, { key: 'activa', label: 'Qué activa en el cliente' }, { key: 'donde', label: 'Dónde usarla' }] },
  frases_objeciones: { nombreGuardar: 'Frases para objeciones', columnas: [{ key: 'objecion', label: 'Objeción' }, { key: 'frase', label: 'Frase para responderla' }] },
  frases_conexion: { nombreGuardar: 'Frases para conectar la oferta al resultado emocional', columnas: [{ key: 'frase', label: 'Frase' }, { key: 'resultado', label: 'Resultado emocional que busca el cliente' }] },
  angulos_evergreen: { nombreGuardar: 'Ángulos 366', columnas: [{ key: 'angulo', label: 'Ángulo' }, { key: 'accion', label: 'Acción' }, { key: 'emocion', label: 'Qué emoción activa' }, { key: 'conecta', label: 'Cómo conecta con la venta' }, { key: 'ejemplo', label: 'Ejemplo de mensaje' }] },
};

const TABLAS_SISTEMA_366 = {
  plan_implementacion: { nombreGuardar: 'Plan de Implementación', columnas: [{ key: 'plazo', label: 'Plazo' }, { key: 'cuando', label: 'Semana / Mes' }, { key: 'fecha', label: 'Fecha objetivo' }, { key: 'que_se_implementa', label: 'Qué se implementa' }, { key: 'estado', label: 'Estado' }] },
  secuencia_seguimiento: { nombreGuardar: 'Secuencia de Seguimiento', columnas: [{ key: 'mes', label: 'Día' }, { key: 'titulo', label: 'Título del ciclo' }, { key: 'mensaje', label: 'Mensaje / contenido' }] },
  oportunidades_iniciales: { nombreGuardar: 'Oportunidades iniciales', columnas: [{ key: 'oportunidad', label: 'Oportunidad' }, { key: 'como', label: 'Por qué / cómo aprovecharla' }] },
};

// Sistema 366 y Comunicación 366 también funcionan con pestañas (varios sistemas/comunicaciones
// -- uno compartido para todo el negocio, u otros independientes por grupo/producto). Misma
// migración de 3 niveles que Producto 366 y Perfil de Cliente.
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
    .filter((p) => p && (p.nombre || p.contexto_general || (p.customer_journey && Object.keys(p.customer_journey).length)))
    .map((p, i) => {
      const nombreG = nombreGrupo(grupos, p.grupo_id);
      const l = [`Sistema ${i + 1}${p.nombre ? ': ' + p.nombre : ''}${nombreG ? ` [Grupo: ${nombreG}]` : ''}`];
      if (p.contexto_general) l.push(`  Contexto general: ${p.contexto_general}`);
      const cj = formatearValorNota(p.customer_journey);
      if (cj) l.push(`  Tu Sistema 366 (qué hacemos por etapa):\n${cj}`);
      Object.entries(TABLAS_SISTEMA_366).forEach(([campo, { nombreGuardar, columnas }]) => {
        const f = formatearFilasConLabel(p[campo], columnas);
        if (f) l.push(`  ${nombreGuardar}:\n${f}`);
      });
      if (p.info_faltante) l.push(`  Información faltante: ${p.info_faltante}`);
      if (p.reglas_equipo_ia) l.push(`  Reglas para el Equipo de Marketing IA: ${p.reglas_equipo_ia}`);
      return l.join('\n');
    });
  if (bloques.length === 0) return null;
  return 'SISTEMA 366 (puede haber varios sistemas guardados. Si el negocio tiene varios grupos de negocio, cada sistema trae "[Grupo: nombre]" -- usa SOLO el del grupo con el que se está trabajando):\n' + bloques.join('\n\n');
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
      const l = [`Comunicación ${i + 1}${p.nombre ? ': ' + p.nombre : ''}${nombreG ? ` [Grupo: ${nombreG}]` : ''}`];
      if (p.posicionamiento) l.push(`  Posicionamiento: ${p.posicionamiento}`);
      if (p.diferenciador) l.push(`  Diferenciador principal: ${p.diferenciador}`);
      if (p.que_no_es) l.push(`  Qué NO es la oferta: ${p.que_no_es}`);
      if (p.resultado_entender) l.push(`  Resultado que el cliente debe entender: ${p.resultado_entender}`);
      if (p.por_que_elegirnos) l.push(`  Por qué elegirnos: ${p.por_que_elegirnos}`);
      Object.entries(TABLAS_COMUNICACION_366).forEach(([campo, { nombreGuardar, columnas }]) => {
        const f = formatearFilasConLabel(p[campo], columnas);
        if (f) l.push(`  ${nombreGuardar}:\n${f}`);
      });
      return l.join('\n');
    });
  if (bloques.length === 0) return null;
  return 'COMUNICACIÓN 366 (puede haber varias guardadas, una por grupo de negocio -- cada una trae "[Grupo: nombre]" si aplica, usa SOLO la del grupo con el que se está trabajando):\n' + bloques.join('\n\n');
}

// Producto 366 también funciona con pestañas (varias ofertas) -- misma migración de 3 niveles
// que leerAudiencias: {lista:[...]} nuevo -> objeto plano 366-producto viejo -> evergreen-producto.
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
      const l = [`Oferta ${i + 1}${p.nombre ? ': ' + p.nombre : ''}${nombreG ? ` [Grupo: ${nombreG}]` : ''}`];
      if (p.que_vendemos) l.push(`  Qué vendemos: ${p.que_vendemos}`);
      if (p.por_que_potencial) l.push(`  Por qué tiene potencial 366: ${p.por_que_potencial}`);
      if (p.oferta_irresistible) l.push(`  Oferta Irresistible 366: ${p.oferta_irresistible}`);
      if (p.insight_estrategico) l.push(`  Insight estratégico: ${p.insight_estrategico}`);
      Object.entries(TABLAS_PRODUCTO_366).forEach(([campo, { nombreGuardar, columnas }]) => {
        const f = formatearFilasConLabel(p[campo], columnas);
        if (f) l.push(`  ${nombreGuardar}:\n${f}`);
      });
      return l.join('\n');
    });
  if (bloques.length === 0) return null;
  return 'PRODUCTO 366 (puede haber varias ofertas guardadas. Si el negocio tiene varios grupos de negocio, cada oferta trae "[Grupo: nombre]" -- usa SOLO la del grupo con el que se está trabajando):\n' + bloques.join('\n\n');
}

async function formatearConversacion366NoGuardada(clienteId) {
  const mensajes = (await leerJSON(`${clienteId}:366-builder-conversacion`).catch(() => null))
    || (await leerJSON(`${clienteId}:evergreen-builder-conversacion`).catch(() => null));
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

async function construirContexto366(clienteId) {
  const [productos, sistemas, comunicaciones, grupos] = await Promise.all([
    leerProductos366(clienteId).catch(() => []),
    leerSistemas366(clienteId).catch(() => []),
    leerComunicaciones366(clienteId).catch(() => []),
    leerJSON(`${clienteId}:grupos-negocio`).catch(() => null),
  ]);
  const bloques = [];
  const productosBloque = formatearProductos366(productos, grupos);
  if (productosBloque) bloques.push(productosBloque);
  const sistemasBloque = formatearSistemas366(sistemas, grupos);
  if (sistemasBloque) bloques.push(sistemasBloque);
  const comunicacionesBloque = formatearComunicaciones366(comunicaciones, grupos);
  if (comunicacionesBloque) bloques.push(comunicacionesBloque);

  const conversacionReciente = await formatearConversacion366NoGuardada(clienteId).catch(() => null);
  if (conversacionReciente) bloques.push(conversacionReciente);

  const bancoConversaciones = await formatearBancoConversacionesWhatsApp(clienteId).catch(() => null);
  if (bancoConversaciones) bloques.push(bancoConversaciones);

  if (bloques.length === 0) {
    return 'CONTEXTO 366: todavía no hay nada guardado en el Jefe 366 para esta marca -- usa lo que sí haya del ADN.';
  }
  return 'CONTEXTO 366 (Jefe 366 ya guardado — dolores, deseos, miedos y objeciones reales del cliente, úsalos para responder mejor):\n\n' + truncar(bloques.join('\n\n'), CONTEXT_CHAR_LIMIT);
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

  const { mensaje, imagen, cliente, grupo } = req.body || {};
  if (!mensaje && !imagen) {
    return res.status(400).json({ error: 'Falta mensaje o imagen.' });
  }

  const clienteId = (cliente || DEFAULT_CLIENTE).toString();
  const grupoSeleccionado = grupo && typeof grupo === 'object' && grupo.nombre ? grupo : null;

  try {
    const promptFijo = cargarPromptFijo();
    const [contexto, contexto366] = await Promise.all([
      construirContextoNegocio(clienteId),
      construirContexto366(clienteId),
    ]);
    const system = [promptFijo, contexto, contexto366].join('\n\n');

    const content = [];
    if (imagen && imagen.mediaType && imagen.data) {
      content.push({ type: 'image', source: { type: 'base64', media_type: imagen.mediaType, data: imagen.data } });
    }
    const partesTexto = [];
    if (grupoSeleccionado) {
      partesTexto.push(`GRUPO DE NEGOCIO SELECCIONADO POR EL USUARIO (desde las pestañas de arriba): "${grupoSeleccionado.nombre}". Responde usando ÚNICAMENTE la información etiquetada [Grupo: ${grupoSeleccionado.nombre}] (o sin etiqueta de grupo, si aplica al negocio en general) -- no uses precios ni datos de otros grupos.`);
    }
    partesTexto.push('Mensaje del cliente / captura a analizar:\n' + (mensaje || '(ver captura adjunta)'));
    content.push({
      type: 'text',
      text: partesTexto.join('\n\n'),
    });

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system,
        messages: [{ role: 'user', content }],
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
    await registrarUsoTokens(clienteId, 'jefe-conversion', data.usage);
    return res.status(200).json({ text });
  } catch (err) {
    return res.status(500).json({ error: 'Error de conexión con el Agente.' });
  }
};

