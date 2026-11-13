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
    .filter((m) => m && typeof m.id === 'string' && m.id && (m.tipo === 'producto' || m.tipo === 'campana'))
    .slice(0, 4)
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

module.exports = { normalizar, sufijoFoco, leerEnfoque, resolverSeleccion, haySeleccion, filtrarPorProducto, filtrarPorGrupo, elegirCampana, lineaFoco };
