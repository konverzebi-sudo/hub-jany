// Memoria del Jefe 366 compartida por los demás Jefes.
// El Jefe 366 guarda una ficha por producto en {lista:[...]} (producto, sistema y comunicación). Aquí vive,
// en un solo lugar, cómo se leen esas fichas (con la llave vieja "evergreen-*" como respaldo), cómo se
// emparejan con un producto y cómo se vuelcan a texto para el prompt. Así un cuadro nuevo en el Jefe 366
// llega a todos los Jefes que usan este módulo sin tocar cada endpoint.
//
// Las funciones que leen storage reciben el leerJSON del endpoint (mismo patrón que api/_lib/saldo.js).

function truncar(str, limite) {
  if (!str) return str;
  return str.length > limite ? str.slice(0, limite) + '\n[...recortado...]' : str;
}

function slugOferta(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const OMITIR_366 = new Set(['uid', 'producto_uid', 'grupo_id', '_importantes', 'activa', 'id', 'nombre', 'numero_whatsapp', 'mensaje_whatsapp', 'whatsapp_link_corto', 'producto_relacionado']);
function etiquetaCampo366(k) { return String(k).replace(/_/g, ' '); }

// Vuelca una ficha 366 tal cual está llena (textos y tablas), sin depender de cómo se llamen sus campos.
function formatearFicha366(it, limite) {
  if (!it || typeof it !== 'object') return '';
  const lineas = [];
  Object.keys(it).forEach((k) => {
    if (OMITIR_366.has(k)) return;
    const v = it[k];
    if (typeof v === 'string' && v.trim()) {
      lineas.push(`${etiquetaCampo366(k)}: ${truncar(v.trim(), 600)}`);
    } else if (Array.isArray(v) && v.length) {
      const filas = v.map((f) => (f && typeof f === 'object'
        ? Object.keys(f).filter((c) => !OMITIR_366.has(c) && typeof f[c] === 'string' && f[c].trim()).map((c) => `${etiquetaCampo366(c)}: ${truncar(f[c].trim(), 220)}`).join(' · ')
        : String(f || ''))).filter(Boolean).slice(0, 8);
      if (filas.length) lineas.push(`${etiquetaCampo366(k)}:\n` + filas.map((x) => '  - ' + x).join('\n'));
    }
  });
  return truncar(lineas.join('\n'), limite);
}

function coincideProducto366(it, nombre, uid) {
  if (!it) return false;
  if (uid && (it.producto_uid === uid || it.uid === uid)) return true;
  return !!nombre && slugOferta(it.nombre) === slugOferta(nombre);
}

// Resumen corto de la comunicación 366 de cada producto (posicionamiento, diferenciador y primeros ángulos).
function resumenComunicaciones366(coms, grupoId) {
  const lista = (coms || []).filter((c) => c && (!grupoId || !c.grupo_id || c.grupo_id === grupoId));
  const lineas = lista.map((c) => {
    const partes = [];
    if (String(c.posicionamiento || '').trim()) partes.push('posicionamiento: ' + truncar(String(c.posicionamiento).trim(), 220));
    if (String(c.diferenciador || '').trim()) partes.push('diferenciador: ' + truncar(String(c.diferenciador).trim(), 180));
    const angulos = (Array.isArray(c.angulos_evergreen) ? c.angulos_evergreen : []).map((a) => a && a.angulo).filter(Boolean).slice(0, 4);
    if (angulos.length) partes.push('ángulos: ' + angulos.join(' / '));
    return partes.length ? `- ${c.nombre || '(producto)'}: ${partes.join(' · ')}` : null;
  }).filter(Boolean);
  return lineas.length ? 'ESTRATEGIA DE COMUNICACIÓN 366 POR PRODUCTO (resumen):\n' + lineas.join('\n') : null;
}

// Lectores que necesitan storage: se arman con el leerJSON de cada endpoint.
function conLector(leerJSON) {
  // Una ficha por producto: {lista:[...]}; el formato viejo era una sola ficha suelta.
  async function leerLista366(clienteId, clave, viejo) {
    let d = await leerJSON(`${clienteId}:${clave}`).catch(() => null);
    if (!d && viejo) d = await leerJSON(`${clienteId}:${viejo}`).catch(() => null);
    if (!d) return [];
    if (Array.isArray(d)) return d.filter(Boolean);
    if (Array.isArray(d.lista)) return d.lista.filter(Boolean);
    return Object.keys(d).length ? [d] : [];
  }

  async function leerOfertas366(clienteId) {
    const nuevo = await leerJSON(`${clienteId}:brand-book.366-producto`).catch(() => null);
    if (nuevo && Array.isArray(nuevo.lista) && nuevo.lista.length) return nuevo.lista;
    if (nuevo && Object.keys(nuevo).length) return [Object.assign({ nombre: 'Producto Principal' }, nuevo)];
    return [];
  }

  // Con un producto elegido: su producto 366, su comunicación y su sistema para vender, completos.
  // limites.{producto,comunicacion,sistema} = tope de caracteres de cada ficha (0 = no incluirla).
  async function construirDetalle366(clienteId, nombre, uid, limites) {
    const lim = Object.assign({ producto: 3500, comunicacion: 5000, sistema: 3500 }, limites || {});
    const [prods, sist, coms] = await Promise.all([
      lim.producto ? leerLista366(clienteId, 'brand-book.366-producto', 'brand-book.evergreen-producto') : [],
      lim.sistema ? leerLista366(clienteId, 'brand-book.366-sistema', 'brand-book.evergreen-sistema') : [],
      lim.comunicacion ? leerLista366(clienteId, 'brand-book.366-comunicacion', 'brand-book.evergreen-comunicacion') : [],
    ]);
    const bloques = [];
    const miProd = prods.find((x) => coincideProducto366(x, nombre, uid));
    const miSis = sist.find((x) => coincideProducto366(x, nombre, uid));
    const miCom = coms.find((x) => coincideProducto366(x, nombre, uid));
    if (miProd) bloques.push('PRODUCTO 366 (qué vendemos, pilares, frases a enfatizar y a evitar):\n' + formatearFicha366(miProd, lim.producto));
    if (miCom) bloques.push('ESTRATEGIA DE COMUNICACIÓN 366 DE ESTE PRODUCTO (posicionamiento, ángulos, frases maestras; úsala como base):\n' + formatearFicha366(miCom, lim.comunicacion));
    if (miSis) bloques.push('SISTEMA 366 PARA VENDER ESTE PRODUCTO (contexto, recorrido del cliente y reglas):\n' + formatearFicha366(miSis, lim.sistema));
    return bloques.length ? bloques.join('\n\n') : null;
  }

  // El producto que llega como id (del catálogo del ADN, o "366-<slug>" si solo existe en Producto 366)
  // se convierte en nombre + uid para poder emparejarlo con sus fichas 366.
  async function resolverProducto(clienteId, catalogo, productoId) {
    if (!productoId) return null;
    const ficha = Array.isArray(catalogo) ? catalogo.find((it) => it && it.id === productoId) : null;
    let nombre = ficha ? ficha.nombre : '';
    let oferta = null;
    if (productoId.indexOf('366-') === 0) {
      const ofertas = await leerOfertas366(clienteId).catch(() => []);
      oferta = ofertas.find((o) => o && '366-' + slugOferta(o.nombre) === productoId) || null;
      if (oferta) nombre = oferta.nombre;
    }
    if (!nombre) return null;
    return { nombre, uid: (ficha && ficha.uid) || (oferta && oferta.uid) || '', ficha };
  }

  return { leerLista366, leerOfertas366, construirDetalle366, resolverProducto };
}

module.exports = { truncar, slugOferta, formatearFicha366, coincideProducto366, resumenComunicaciones366, conLector };
