// Formatea UNA campaña de Jefe de Temporada (llave `${cliente}:temporada-campanas`) para inyectarla
// en el prompt de los Jefes de WhatsApp. Las llaves/columnas de TABLAS_CAMPANA son las mismas de
// TEMPORADA_TABLAS en jefe-temporada.html. Es solo formato: cada endpoint lee la llave por su cuenta.

const CAMPANA_CHAR_LIMIT = 7000;

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
    tabla(c, TABLAS_CAMPANA.mensajesClave),
    tabla(c, TABLAS_CAMPANA.frases),
    tabla(c, TABLAS_CAMPANA.objeciones),
    tabla(c, TABLAS_CAMPANA.angulos),
    tabla(c, TABLAS_CAMPANA.ctas),
  ].filter(Boolean);

  const secciones = [cab.join('\n')];
  if (dm.length) secciones.push('DOCUMENTO MAESTRO DE LA CAMPAÑA (resumen ejecutivo):\n' + dm.join('\n'));
  if (perfil.length) secciones.push('PERFIL DE CLIENTE DE CAMPAÑA (qué siente y qué lo frena en ESTA temporada):\n' + perfil.join('\n'));
  if (prod.length) secciones.push('PRODUCTO PARA LA CAMPAÑA:\n' + prod.join('\n'));
  if (comunicacion.length) secciones.push('ESTRATEGIA DE COMUNICACIÓN DE LA CAMPAÑA:\n' + comunicacion.join('\n'));

  let texto = secciones.join('\n\n');
  if (texto.length > CAMPANA_CHAR_LIMIT) texto = texto.slice(0, CAMPANA_CHAR_LIMIT) + '\n[...recortado por longitud]';
  return texto;
}

module.exports = { formatearCampanaSeleccionada };
