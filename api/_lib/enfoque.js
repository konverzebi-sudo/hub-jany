// Enfoque del Jefe de Resultados: qué producto, grupo o campaña de temporada eligió la persona (pastilla de arriba o
// "@" en el chat) para que el contexto del Jefe hable SOLO de eso. Funciones puras (sin red ni base de datos).
// Nada de marca va escrito aquí: todo sale de lo que manda la pantalla y de lo que hay guardado en el ADN.

function normalizar(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Sufijo para guardar datos por enfoque (mismo cálculo en la pantalla): '' con "ecosistema completo".
function sufijoFoco(foco) {
  if (!foco || !foco.id || foco.id === 'all') return '';
  return '-' + String(foco.id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

// Jefes que se pueden "conectar" con @: al etiquetarlos, el Jefe de Resultados lee lo que la persona guardó en ese Jefe.
// `llaves` son las llaves de almacenamiento del hub (<hub>:<llave>) y `titulo` es como se le presenta al modelo.
const JEFES_CONECTABLES = {
  'jefe-366': { nombre: 'Jefe 366', titulo: 'JEFE 366 (oferta, cliente ideal, sistema y comunicación completos, sin acotar al filtro de arriba)', llaves: [], sin_acotar: true },
  'jefe-temporada': { nombre: 'Jefe de Temporada', titulo: 'JEFE DE TEMPORADA (todas sus campañas, en resumen)', llaves: ['temporada-campanas'], campanas: true },
  'jefe-contenido': { nombre: 'Jefe de Contenido', titulo: 'JEFE DE CONTENIDO (lo que lleva guardado)', llaves: ['agente-contenido', 'contenido-ideas-366'] },
  'jefe-anuncios': { nombre: 'Jefe de Anuncios', titulo: 'JEFE DE ANUNCIOS (anuncios y estructura de campaña guardados)', llaves: ['agente-anuncios', 'anuncios-estructura'] },
  'jefe-financiero': { nombre: 'Jefe de Finanzas', titulo: 'JEFE DE FINANZAS (calculadora, números del negocio y métricas)', llaves: ['financiero-calculadora', 'brand-book.financieros', 'brand-book.metricas'] },
  'jefe-radar': { nombre: 'Jefe del Faro', titulo: 'JEFE DEL FARO (mis números, referentes y lecturas del mercado)', llaves: ['radar-mis-numeros', 'radar-referentes', 'radar-historial'] },
  'jefe-whatsapp': { nombre: 'WhatsApp y Ventas', titulo: 'JEFE WHATSAPP Y VENTAS (guiones y conversaciones guardadas)', llaves: ['brand-book.whatsapp-guiones', 'whatsapp-convos'] },
};

// Convierte cualquier valor guardado en texto corto y legible para el modelo (sin imágenes ni textos enormes).
function resumirValor(valor, limite) {
  const tope = limite || 2500;
  const corto = (v) => {
    if (v == null || v === '') return '';
    if (typeof v === 'string') return /^data:/.test(v) ? '' : v.replace(/\s+/g, ' ').trim().slice(0, 220);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.length ? '[' + v.slice(0, 4).map(corto).filter(Boolean).join(' | ') + (v.length > 4 ? ' …' : '') + ']' : '';
    if (typeof v === 'object') return Object.keys(v).slice(0, 8).map((k) => { const t = corto(v[k]); return t ? k + ': ' + t : ''; }).filter(Boolean).join('; ');
    return '';
  };
  const lineas = [];
  const agrega = (txt) => { if (txt) lineas.push(txt); };
  if (Array.isArray(valor)) valor.slice(0, 12).forEach((it, i) => agrega('- ' + (typeof it === 'object' && it ? corto(it) : (corto(it) || '(vacío)'))));
  else if (valor && typeof valor === 'object') Object.keys(valor).slice(0, 25).forEach((k) => { const t = corto(valor[k]); if (t) agrega('- ' + k + ': ' + t); });
  else agrega(corto(valor));
  let out = lineas.filter((l) => l.trim().length > 3).join('\n');
  if (out.length > tope) out = out.slice(0, tope - 1) + '…';
  return out;
}

// Resumen compacto de las campañas de temporada (nombre, producto, fechas y objetivo): el detalle completo solo va de la elegida.
function resumirCampanas(campanas) {
  if (!Array.isArray(campanas) || !campanas.length) return '';
  return campanas.filter((c) => c && (c.nombre || c.producto_nombre)).slice(0, 12).map((c) => {
    const p = [String(c.nombre || c.producto_nombre || '').trim()];
    if (c.producto_nombre && c.nombre && c.producto_nombre !== c.nombre) p.push('producto: ' + c.producto_nombre);
    if (c.fecha_inicio_activa || c.fecha_fin_activa) p.push('fechas: ' + (c.fecha_inicio_activa || '?') + ' a ' + (c.fecha_fin_activa || '?'));
    if (c.objetivo_principal) p.push('objetivo: ' + String(c.objetivo_principal).slice(0, 140));
    if (c.incentivo) p.push('incentivo: ' + String(c.incentivo).slice(0, 120));
    return '- ' + p.join(' · ');
  }).join('\n');
}

// Bloque de contexto de un Jefe conectado. `datos` = { llave: valorLeido }. Devuelve '' si no hay nada guardado.
function formatearJefe(jefeId, datos) {
  const j = JEFES_CONECTABLES[jefeId];
  if (!j) return '';
  const d = datos || {};
  const partes = [];
  if (j.campanas) {
    const r = resumirCampanas(d['temporada-campanas']);
    if (r) partes.push(r);
  } else {
    j.llaves.forEach((k) => {
      const t = resumirValor(d[k], 2200);
      if (t) partes.push('[' + k + ']\n' + t);
    });
  }
  if (!partes.length) return j.sin_acotar ? 'CONEXIÓN @' + j.nombre.toUpperCase().replace(/ /g, '_') + ': ' + j.titulo + '.' : 'CONEXIÓN CON ' + j.nombre.toUpperCase() + ': la persona lo etiquetó pero todavía no tiene nada guardado ahí. Dile que primero lo trabaje en ese Jefe.';
  return 'CONEXIÓN CON ' + j.titulo + ' — la persona etiquetó este Jefe con @ en este mensaje: usa esto como contexto SOLO si ayuda a lo que pide, sin inventar nada que no esté aquí:\n' + partes.join('\n\n');
}

// Saca del cuerpo de la petición el foco de la pastilla y las etiquetas @ del mensaje, ya saneados.
function leerEnfoque(body) {
  const b = body && typeof body === 'object' ? body : {};
  const f = b.foco && typeof b.foco === 'object' ? b.foco : null;
  const foco = f && typeof f.id === 'string' && f.id && f.id !== 'all'
    ? {
        id: f.id.slice(0, 80),
        nombre: String(f.nombre || '').slice(0, 160),
        esGrupo: !!f.esGrupo,
        esCampana: !!f.esCampana,
        campanaId: String(f.campanaId || '').slice(0, 80),
        productoId: String(f.productoId || '').slice(0, 80),
        grupoId: String(f.grupoId || '').slice(0, 80),
      }
    : null;
  const menciones = (Array.isArray(b.menciones) ? b.menciones : [])
    .filter((m) => m && typeof m.id === 'string' && m.id && (m.tipo === 'producto' || m.tipo === 'campana' || (m.tipo === 'jefe' && JEFES_CONECTABLES[m.id])))
    .slice(0, 6)
    .map((m) => ({ tipo: m.tipo, id: m.id.slice(0, 80), nombre: String(m.nombre || '').slice(0, 160) }));
  return { foco, menciones };
}

// Qué se va a trabajar: lo etiquetado con @ en ESTE mensaje manda sobre la pastilla.
function resolverSeleccion(enfoque) {
  const e = enfoque || {};
  const men = e.menciones || [];
  const menCampana = men.filter((m) => m.tipo === 'campana').pop();
  const menProducto = men.filter((m) => m.tipo === 'producto').pop();
  const sel = { campanaId: '', productoId: '', productoNombre: '', grupoId: '', nombre: '', tipo: '', origen: '' };
  if (menCampana) { sel.campanaId = menCampana.id; sel.nombre = menCampana.nombre; sel.tipo = 'campana'; sel.origen = 'mencion'; }
  else if (menProducto) { sel.productoId = menProducto.id; sel.productoNombre = menProducto.nombre; sel.nombre = menProducto.nombre; sel.tipo = 'producto'; sel.origen = 'mencion'; }
  else if (e.foco) {
    const f = e.foco;
    sel.origen = 'pastilla';
    sel.nombre = f.nombre;
    if (f.esCampana && f.campanaId) { sel.campanaId = f.campanaId; sel.tipo = 'campana'; }
    else if (f.esGrupo) { sel.grupoId = f.grupoId || String(f.id).replace(/^g:/, ''); sel.tipo = 'grupo'; }
    else { sel.productoId = f.productoId || f.id; sel.productoNombre = f.nombre; sel.tipo = 'producto'; }
  }
  return sel;
}

function haySeleccion(sel) { return !!(sel && sel.tipo); }

// Conserva los registros del producto elegido: primero por id y por nombre exacto; si no hay, por nombre parecido;
// si tampoco, deja todo (nunca esconde datos del negocio por un nombre que no coincide).
function filtrarPorProducto(items, productoId, productoNombre) {
  if (!Array.isArray(items)) return items;
  const n = normalizar(productoNombre);
  if (!productoId && !n) return items;
  const exacto = items.filter((p) => p && ((productoId && p.producto_id === productoId) || (n && normalizar(p.nombre) === n)));
  if (exacto.length) return exacto;
  const parecido = n ? items.filter((p) => p && normalizar(p.nombre) && (normalizar(p.nombre).includes(n) || n.includes(normalizar(p.nombre)))) : [];
  return parecido.length ? parecido : items;
}

// Para un grupo de negocio: lo del grupo y lo que no pertenece a ningún grupo.
function filtrarPorGrupo(items, grupoId) {
  if (!Array.isArray(items) || !grupoId) return items;
  const f = items.filter((p) => p && (!p.grupo_id || p.grupo_id === grupoId));
  return f.length ? f : items;
}

// Elige la campaña de temporada: la etiquetada / elegida; con un producto, la suya (la que ya arrancó o arranca antes, si no
// la más reciente); sin selección, la lógica de siempre (la vigente más próxima).
function elegirCampana(campanas, sel, hoy) {
  if (!Array.isArray(campanas) || !campanas.length) return null;
  const s = sel || {};
  const dia = hoy || new Date().toISOString().slice(0, 10);
  const mejorDe = (lista) => {
    const noVencidas = lista.filter((c) => c && (!c.fecha_fin_activa || c.fecha_fin_activa >= dia));
    const base = noVencidas.length ? noVencidas : lista;
    const conFecha = base.filter((c) => c && c.fecha_inicio_activa);
    if (conFecha.length) return conFecha.slice().sort((a, b) => a.fecha_inicio_activa.localeCompare(b.fecha_inicio_activa))[0];
    return base.slice().sort((a, b) => String(b.creadoEn || '').localeCompare(String(a.creadoEn || '')))[0] || null;
  };
  if (s.campanaId) return campanas.find((c) => c && c.id === s.campanaId) || null;
  if (s.tipo === 'producto') {
    const n = normalizar(s.productoNombre);
    const suyas = campanas.filter((c) => c && ((s.productoId && c.producto_id === s.productoId) || (n && normalizar(c.producto_nombre) === n)));
    return suyas.length ? mejorDe(suyas) : null;
  }
  if (s.tipo === 'grupo') {
    const suyas = campanas.filter((c) => c && c.grupo_id === s.grupoId);
    return suyas.length ? mejorDe(suyas) : null;
  }
  // sin selección: solo las no vencidas, como siempre
  const noVencidas = campanas.filter((c) => c && (!c.fecha_fin_activa || c.fecha_fin_activa >= dia));
  return noVencidas.length ? mejorDe(noVencidas) : null;
}

// Texto que abre el contexto: deja claro de qué proyecto se habla.
function lineaFoco(sel, opciones) {
  if (!haySeleccion(sel)) return '';
  const o = opciones || {};
  const que = sel.tipo === 'campana' ? 'la CAMPAÑA DE TEMPORADA' : sel.tipo === 'grupo' ? 'el GRUPO DE NEGOCIO' : 'el PRODUCTO O SERVICIO';
  const donde = sel.origen === 'mencion' ? 'La persona etiquetó con @ en este mensaje' : 'La persona eligió en el filtro de arriba';
  const l = [`${donde} ${que} «${sel.nombre}». Todo lo que audites, armes o respondas es SOLO sobre eso: no mezcles otros productos, ofertas ni campañas, y no uses promociones, precios o fechas de otros.`];
  if (sel.tipo !== 'campana' && o.sinCampana) l.push('Este producto o grupo NO tiene campaña de temporada: no asumas promociones, fechas ni urgencia de temporada; si hacen falta, dile que primero armen su campaña en Jefe de Temporada.');
  if (o.campanaNombre && sel.tipo !== 'campana') l.push(`Su campaña de temporada es «${o.campanaNombre}» (viene abajo completa).`);
  return (sel.origen === 'mencion' ? 'ETIQUETA @ DE ESTE MENSAJE: ' : 'FOCO ELEGIDO ARRIBA: ') + l.join(' ');
}

module.exports = { JEFES_CONECTABLES, resumirValor, resumirCampanas, formatearJefe, normalizar, sufijoFoco, leerEnfoque, resolverSeleccion, haySeleccion, filtrarPorProducto, filtrarPorGrupo, elegirCampana, lineaFoco };
