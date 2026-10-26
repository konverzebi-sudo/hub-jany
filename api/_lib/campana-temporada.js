// Formatea UNA campaña de Jefe de Temporada (llave `${cliente}:temporada-campanas`) para inyectarla
// en el prompt de los Jefes de WhatsApp. Las llaves/columnas de TABLAS_CAMPANA son las mismas de
// TEMPORADA_TABLAS en jefe-temporada.html. Es solo formato: cada endpoint lee la llave por su cuenta.

const CAMPANA_CHAR_LIMIT = 16000;

const TABLAS_CAMPANA = {
  diferencias: { campo: 'cliente_diferencias', titulo: 'Diferencias clave vs el cliente recurrente (deseo, dolor, miedo y objeción que se activan en ESTA temporada)', cols: [['aspecto', 'Aspecto'], ['respuesta', 'Respuesta']], esencial: ['respuesta'] },
  incentivos: { campo: 'prod_incentivos', titulo: 'Incentivos evaluados', cols: [['objetivo', 'Objetivo'], ['incentivo', 'Incentivo'], ['resultado_esperado', 'Resultado esperado']], esencial: ['incentivo'] },
  mensajeElegido: { campo: 'com_mensaje_elegido', titulo: 'Mensaje elegido', cols: [['pregunta', 'Pregunta'], ['respuesta', 'Respuesta']], esencial: ['respuesta'] },
  razonAhora: { campo: 'com_razon_ahora', titulo: 'Razón para comprar ahora (urgencia real)', cols: [['elemento', 'Elemento'], ['respuesta', 'Respuesta']], esencial: ['respuesta'] },
  mensajesClave: { campo: 'com_mensajes_clave', titulo: 'Mensajes clave', cols: [['mensaje', 'Mensaje clave'], ['que_entender', 'Qué debe entender'], ['emocion', 'Emoción que activa'], ['conecta', 'Cómo conecta con la venta']], esencial: ['que_entender', 'emocion', 'conecta'] },
  frases: { campo: 'com_frases_maestras', titulo: 'Frases maestras (incluye las de "Para WhatsApp / DM" y "Para cierre")', cols: [['tipo', 'Tipo de frase'], ['frases', 'Frases']], esencial: ['frases'] },
  objeciones: { campo: 'com_objeciones', titulo: 'Objeciones de campaña y cómo responderlas', cols: [['objecion', 'Objeción'], ['que_piensa', 'Qué está pensando'], ['que_necesita', 'Qué necesita escuchar'], ['respuesta', 'Respuesta corta']], esencial: ['que_piensa', 'que_necesita', 'respuesta'] },
  angulos: { campo: 'com_angulos', titulo: 'Ángulos de venta', cols: [['angulo', 'Ángulo'], ['enfoque', 'Enfoque'], ['emocion', 'Emoción'], ['idea_principal', 'Idea principal'], ['hook', 'Ejemplo de hook']], esencial: ['idea_principal', 'hook'] },
  ctas: { campo: 'com_ctas', titulo: 'CTAs por momento', cols: [['momento', 'Momento'], ['suave', 'CTA suave'], ['directo', 'CTA directo'], ['urgente', 'CTA urgente']], esencial: ['suave', 'directo', 'urgente'] },
};

function campo(c, k, label) {
  const v = (c[k] || '').toString().trim();
  return v ? `${label}: ${v}` : null;
}

function tabla(c, t) {
  const filas = (Array.isArray(c[t.campo]) ? c[t.campo] : [])
    .filter((f) => f && t.esencial.some((k) => (f[k] || '').toString().trim()));
  if (filas.length === 0) return null;
  const lineas = filas.map((f) => '- ' + t.cols
    .map(([k, label]) => { const v = (f[k] || '').toString().trim(); return v ? `${label}: ${v}` : null; })
    .filter(Boolean)
    .join(' | '));
  return `${t.titulo}:\n${lineas.join('\n')}`;
}

function formatearCampanaSeleccionada(c) {
  if (!c) return null;
  const producto = c.producto_origen === 'nuevo' ? c.producto_nuevo : c.producto_nombre;

  const cab = [`Campaña: ${c.nombre || '(sin nombre)'}${c.temporada ? ' — ' + c.temporada : ''}`];
  if (producto) cab.push(`Producto/servicio de la campaña: ${producto}`);
  if (c.fecha_inicio_activa || c.fecha_fin_activa) cab.push(`Vigencia: ${c.fecha_inicio_activa || '?'} a ${c.fecha_fin_activa || '?'}`);
  if (c.objetivo_principal) cab.push(`Objetivo: ${c.objetivo_principal}`);
  if (c.incentivo) cab.push(`Incentivo/urgencia real: ${c.incentivo}`);

  const dm = [
    campo(c, 'dm_cliente_ideal_temporada', 'Cliente ideal de temporada'),
    campo(c, 'dm_que_cambia', 'Qué cambia en este cliente por la temporada'),
    campo(c, 'dm_dolor', 'Dolor principal de temporada'),
    campo(c, 'dm_deseo', 'Deseo principal de temporada'),
    campo(c, 'dm_objeciones', 'Objeciones específicas de temporada'),
    campo(c, 'dm_oferta', 'Oferta principal'),
    c.dm_incentivo && c.dm_incentivo !== c.incentivo ? campo(c, 'dm_incentivo', 'Incentivo') : null,
    campo(c, 'dm_urgencia', 'Urgencia real'),
    campo(c, 'dm_mensaje_principal', 'Mensaje principal'),
    campo(c, 'dm_frases_clave', 'Frases clave de comunicación'),
    campo(c, 'dm_canal_conversion', 'Canal principal de conversión'),
    campo(c, 'dm_accion_cliente', 'Acción que queremos que tome el cliente'),
  ].filter(Boolean);

  const perfil = [
    campo(c, 'cliente_que_pasa', '¿Qué está pasando en su vida en este momento?'),
    tabla(c, TABLAS_CAMPANA.diferencias),
    campo(c, 'cliente_que_haria_hoy', '¿Qué haría que compre hoy?'),
    campo(c, 'cliente_que_cambio', '¿Qué cambió vs el cliente recurrente?'),
  ].filter(Boolean);

  const prod = [
    campo(c, 'prod_por_que', 'Por qué este producto hace sentido para esta temporada'),
    tabla(c, TABLAS_CAMPANA.incentivos),
  ].filter(Boolean);

  const comunicacion = [
    tabla(c, TABLAS_CAMPANA.mensajeElegido),
    tabla(c, TABLAS_CAMPANA.razonAhora),
    tabla(c, TABLAS_CAMPANA.objeciones),
    tabla(c, TABLAS_CAMPANA.ctas),
    tabla(c, TABLAS_CAMPANA.frases),
    tabla(c, TABLAS_CAMPANA.mensajesClave),
    tabla(c, TABLAS_CAMPANA.angulos),
  ].filter(Boolean);

  // Orden por importancia para vender por WhatsApp: si algún día se recorta por longitud, que se pierda lo accesorio.
  const secciones = [cab.join('\n')];
  if (dm.length) secciones.push('DOCUMENTO MAESTRO DE LA CAMPAÑA (resumen ejecutivo):\n' + dm.join('\n'));
  if (perfil.length) secciones.push('PERFIL DE CLIENTE DE CAMPAÑA (análisis de compra: qué siente, qué desea, qué teme y qué lo frena en ESTA temporada):\n' + perfil.join('\n'));
  if (comunicacion.length) secciones.push('ESTRATEGIA DE COMUNICACIÓN DE LA CAMPAÑA:\n' + comunicacion.join('\n'));
  if (prod.length) secciones.push('PRODUCTO PARA LA CAMPAÑA:\n' + prod.join('\n'));

  let texto = secciones.join('\n\n');
  if (texto.length > CAMPANA_CHAR_LIMIT) texto = texto.slice(0, CAMPANA_CHAR_LIMIT) + '\n[...recortado por longitud]';
  return texto;
}

// ───────── Modo campaña: Contenido y Anuncios reciben TODA la estrategia de la campaña elegida y guían la creación ─────────
const ROTULOS_EJECUCION = {
  meta_ventas: 'Meta de ventas', ticket_promedio: 'Ticket promedio', conversion_pct: 'Conversión estimada %', presupuesto_ads: 'Presupuesto de ads', base_datos_disponible: 'Base de datos disponible',
  pre_objetivo: 'Objetivo de precampaña', pre_captacion: 'Cómo se captan contactos', pre_donde_quedan: 'Dónde se quedan los contactos', pre_incentivo_registro: 'Incentivo de registro', pre_duracion: 'Duración de precampaña',
  ads_objetivo: 'Objetivo de ads', ads_tipo_campana: 'Tipo de campaña de ads', ads_producto: 'Producto a vender en ads', ads_publico: 'Público objetivo', ads_oferta: 'Oferta principal en ads',
  ads_tipo_contenido: 'Tipo de contenido de ads', ads_presupuesto_diario: 'Presupuesto diario', ads_duracion: 'Duración de ads', ads_metrica: 'Métrica principal', ads_resultado_esperado: 'Resultado esperado',
  ads_ubicacion: 'Ubicación', ads_edad: 'Edad', ads_genero: 'Género', ads_intereses: 'Intereses',
};

function lineasCampos(c, campos) {
  return campos.map((k) => { const v = (c[k] || '').toString().trim(); return v ? `${ROTULOS_EJECUCION[k] || k}: ${v}` : null; }).filter(Boolean);
}

function filasLibres(c, campo, titulo) {
  const filas = (Array.isArray(c[campo]) ? c[campo] : []).filter((f) => f && Object.keys(f).some((k) => k !== 'id' && (f[k] || '').toString().trim()));
  if (!filas.length) return null;
  const lineas = filas.map((f) => '- ' + Object.keys(f)
    .filter((k) => k !== 'id' && (f[k] || '').toString().trim())
    .map((k) => `${k.replace(/_/g, ' ')}: ${f[k].toString().trim()}`)
    .join(' | '));
  return `${titulo}:\n${lineas.join('\n')}`;
}

// Metas, precampaña (con su plan de calentamiento y fechas), campaña activa por fases, base de datos, postcampaña, esqueleto de ads y calendario final.
function formatearEjecucionCampana(c) {
  if (!c) return null;
  const bloques = [];
  const metas = lineasCampos(c, ['meta_ventas', 'ticket_promedio', 'conversion_pct', 'presupuesto_ads', 'base_datos_disponible']);
  if (metas.length) bloques.push('METAS:\n' + metas.join('\n'));
  // El calendario va pronto: es lo más accionable (qué se hace cada día) y lo último en recortarse.
  const cal = filasLibres(c, 'calendario', 'Calendario final de ejecución (fecha, fase, acción)');
  if (cal) bloques.push('CALENDARIO FINAL:\n' + cal);
  const pre = [...lineasCampos(c, ['pre_objetivo', 'pre_captacion', 'pre_donde_quedan', 'pre_incentivo_registro', 'pre_duracion']), filasLibres(c, 'pre_calentamiento', 'Plan de calentamiento (con fechas)')].filter(Boolean);
  if (pre.length) bloques.push('PRECAMPAÑA:\n' + pre.join('\n'));
  const fases = filasLibres(c, 'activa_fases', 'Fases de la campaña activa (lanzamiento, intensificación, cierre)');
  if (fases) bloques.push('CAMPAÑA ACTIVA:\n' + fases);
  const bd = filasLibres(c, 'bd_segmentos', 'Segmentos de base de datos');
  if (bd) bloques.push('BASE DE DATOS:\n' + bd);
  const post = filasLibres(c, 'post_acciones', 'Acciones de postcampaña (con fechas)');
  if (post) bloques.push('POSTCAMPAÑA:\n' + post);
  const ads = [...lineasCampos(c, ['ads_objetivo', 'ads_tipo_campana', 'ads_producto', 'ads_publico', 'ads_oferta', 'ads_tipo_contenido', 'ads_presupuesto_diario', 'ads_duracion', 'ads_metrica', 'ads_resultado_esperado', 'ads_ubicacion', 'ads_edad', 'ads_genero', 'ads_intereses']), filasLibres(c, 'ads_creativos', 'Creativos de ads por etapa')].filter(Boolean);
  if (ads.length) bloques.push('ESQUELETO DE ADS:\n' + ads.join('\n'));
  return bloques.length ? bloques.join('\n\n') : null;
}

const GUIA_MODO_CAMPANA = {
  contenido: [
    'MODO CAMPAÑA DE TEMPORADA — CONTENIDO (el usuario eligió trabajar ESTA campaña en el Jefe de Contenido).',
    'Tu trabajo es GUIARLO, paso a paso, para crear el CONTENIDO ORGÁNICO de la campaña usando SOLO la estrategia de arriba (cliente, dolor/deseo/miedo, mensaje, frases maestras, ángulos con sus hooks, objeciones, CTAs, fechas y plan de calentamiento). No inventes precios, bonos, fechas ni promesas que no estén ahí; si falta algo, pregúntalo.',
    'Cómo guiar: (1) si apenas empieza la conversación, ubícalo con FECHA DE HOY frente a las fechas de la campaña (precampaña, campaña activa, postcampaña) y pregúntale con qué etapa quiere empezar; (2) propón un plan corto de piezas por fecha (reel, historias, post, carrusel) cada una con su ángulo y su gancho tomados de la estrategia, y pregunta cuál arma primero; (3) arma la pieza elegida (gancho, guion o caption, cierre con el CTA de la campaña) recordando la urgencia real; (4) al terminar cada pieza, ofrece la siguiente de la lista. Una cosa a la vez.',
  ].join('\n'),
  anuncios: [
    'MODO CAMPAÑA DE TEMPORADA — ANUNCIOS (el usuario eligió trabajar ESTA campaña en el Jefe de Anuncios).',
    'Tu trabajo es GUIARLO, paso a paso, para armar la CAMPAÑA DE ANUNCIOS de esta temporada usando SOLO la estrategia de arriba (oferta, incentivo y urgencia real, público, dolor/deseo/miedo, mensaje, frases, ángulos con hooks, objeciones, CTAs, metas, presupuesto y el esqueleto de ads si ya existe). No inventes precios, bonos ni fechas que no estén ahí; si falta algo, pregúntalo.',
    'Cómo guiar: (1) si apenas empieza, resume en 3 líneas lo que ya está definido para ads (objetivo, público, presupuesto, duración) y di qué falta; (2) propón la estructura (campaña, conjuntos de anuncios por público y anuncios por etapa: lanzamiento, objeción, prueba social, urgencia/cierre) con las fechas de la campaña activa; (3) arma los anuncios de la etapa que elija (texto principal, titular, descripción, CTA, idea de creativo) con los ángulos y hooks de la estrategia; (4) al terminar, ofrece la siguiente etapa. Una cosa a la vez.',
  ].join('\n'),
};

// Lee la campaña elegida y devuelve el bloque completo para el prompt (o null si no existe). leerJSON es el del endpoint que llama.
async function contextoCampanaModo(leerJSON, clienteId, campanaId, agente) {
  if (!campanaId) return null;
  const campanas = await leerJSON(`${clienteId}:temporada-campanas`).catch(() => null);
  const c = Array.isArray(campanas) ? campanas.find((x) => x && x.id === campanaId.toString()) : null;
  if (!c) return null;
  const hoy = new Date().toISOString().slice(0, 10);
  // Primero la fecha de hoy y la guía (lo que nunca debe recortarse); después la estrategia, que sí se recorta si es muy larga.
  const ejecucion = (formatearEjecucionCampana(c) || '').slice(0, 12000);
  const partes = [
    'CAMPAÑA DE TEMPORADA ELEGIDA — el usuario está trabajando ESTA campaña; su estrategia completa va más abajo y es tu única fuente de verdad para esta conversación.',
    `FECHA DE HOY: ${hoy} (fecha real del servidor; úsala para saber en qué etapa está la campaña y no propongas fechas pasadas).`,
    GUIA_MODO_CAMPANA[agente] || GUIA_MODO_CAMPANA.contenido,
    'ESTRATEGIA DE LA CAMPAÑA:',
    formatearCampanaSeleccionada(c),
    ejecucion,
  ].filter(Boolean);
  return partes.join('\n\n');
}

module.exports = { formatearCampanaSeleccionada, formatearEjecucionCampana, contextoCampanaModo };

