// Ficha de audiencia y mercado: un resumen corto y reutilizable de lo que el hub YA sabe de a quién le vende
// (ADN, Jefe de Temporada y Jefe 366). Se arma una sola vez con Claude y se guarda en {cliente}:ficha-audiencia;
// después los Jefes leen la ficha en vez de volver a mandar el ADN, la Temporada y el 366 completos en cada
// llamada (menos tokens). Aquí vive solo el formato: cada endpoint lee y escribe el storage con su propio leerJSON.
// Nada de marca en el código: todo sale del storage del hub.

const crypto = require('crypto');
const { truncar, formatearFicha366, resumenComunicaciones366, conLector } = require('./memoria-366');
const { formatearCampanaSeleccionada } = require('./campana-temporada');

const CAMPOS_FICHA = [
  { k: 'quien_es', titulo: 'Quién es tu cliente ideal', tipo: 'texto' },
  { k: 'dolores', titulo: 'Dolores y frustraciones', tipo: 'lista' },
  { k: 'deseos_y_aspiraciones', titulo: 'Deseos y aspiraciones', tipo: 'lista' },
  { k: 'motivaciones', titulo: 'Qué los motiva a comprar', tipo: 'lista' },
  { k: 'dudas_y_objeciones', titulo: 'Dudas y objeciones', tipo: 'lista' },
  { k: 'contenido_que_les_gusta', titulo: 'Contenido que les gusta', tipo: 'lista' },
  { k: 'como_hablarles', titulo: 'Cómo hablarles (tono, palabras, qué evitar)', tipo: 'lista' },
  { k: 'momento_de_temporada', titulo: 'Momento de temporada', tipo: 'texto' },
  { k: 'angulos_366', titulo: 'Ángulos y diferenciadores del Jefe 366', tipo: 'lista' },
  { k: 'no_esta_en_tus_fuentes', titulo: 'Lo que falta en tus fuentes', tipo: 'lista' },
];

// Fecha de hoy (YYYY-MM-DD) en hora de México: "una idea por día" cambia a medianoche de allá, no del servidor.
function fechaMx() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

function idGrupo(foco) {
  return foco && foco.esGrupo ? String(foco.id).replace(/^g:/, '') : '';
}

// Campañas de Temporada que aplican al foco y siguen vigentes (sin fecha de fin cuenta como vigente).
function campanasDelFoco(campanas, foco, hoy) {
  const lista = (Array.isArray(campanas) ? campanas : []).filter((c) => c && typeof c === 'object');
  let base = lista;
  if (foco && foco.id !== 'all') {
    if (foco.esGrupo) {
      const gid = idGrupo(foco);
      base = lista.filter((c) => gid && c.grupo_id === gid);
    } else {
      const n = String(foco.nombre || '').trim().toLowerCase();
      base = lista.filter((c) => c.producto_origen !== 'nuevo' && (c.producto_id === foco.id || (n && String(c.producto_nombre || '').trim().toLowerCase() === n)));
    }
  }
  return base.filter((c) => !c.fecha_fin_activa || String(c.fecha_fin_activa) >= hoy).slice(0, 3);
}

async function textoTemporada(leerJSON, clienteId, foco, hoy) {
  const campanas = await leerJSON(`${clienteId}:temporada-campanas`).catch(() => null);
  return campanasDelFoco(campanas, foco, hoy)
    .map((c) => truncar(formatearCampanaSeleccionada(c) || '', 4200))
    .filter(Boolean)
    .join('\n\n---\n\n');
}

// Con un producto en foco: su ficha 366 (producto y comunicación). Con todo el hub o un grupo: el resumen de cada producto.
async function texto366(leerJSON, clienteId, foco) {
  const m = conLector(leerJSON);
  if (foco && foco.id !== 'all' && !foco.esGrupo) {
    const catalogo = await leerJSON(`${clienteId}:catalogo-productos`).catch(() => null);
    const p = await m.resolverProducto(clienteId, catalogo, foco.id).catch(() => null);
    if (p) {
      const d = await m.construirDetalle366(clienteId, p.nombre, p.uid, { producto: 2500, comunicacion: 4000, sistema: 0 }).catch(() => null);
      if (d) return truncar(d, 7000);
    }
  }
  const gid = idGrupo(foco);
  const [prods, coms] = await Promise.all([
    m.leerLista366(clienteId, 'brand-book.366-producto', 'brand-book.evergreen-producto').catch(() => []),
    m.leerLista366(clienteId, 'brand-book.366-comunicacion', 'brand-book.evergreen-comunicacion').catch(() => []),
  ]);
  const productos = prods
    .filter((x) => x && (!gid || !x.grupo_id || x.grupo_id === gid))
    .slice(0, 6)
    .map((x) => `- ${x.nombre || '(producto)'}:\n${formatearFicha366(x, 450)}`)
    .filter((t) => t.length > 8);
  const partes = [];
  if (productos.length) partes.push('PRODUCTOS 366:\n' + productos.join('\n'));
  const resumen = resumenComunicaciones366(coms, gid);
  if (resumen) partes.push(resumen);
  return truncar(partes.join('\n\n'), 6000);
}

function huellaDe(partes) {
  return crypto.createHash('sha1').update(partes.map((p) => String(p || '')).join('\u0001')).digest('hex').slice(0, 16);
}

// adn = texto del ADN que ya arma el endpoint (construirContexto), para no duplicar cómo se lee el Brand Book.
async function reunirFuentes({ leerJSON, clienteId, foco, adn }) {
  const hoy = fechaMx();
  const [temporada, e366] = await Promise.all([
    textoTemporada(leerJSON, clienteId, foco, hoy).catch(() => ''),
    texto366(leerJSON, clienteId, foco).catch(() => ''),
  ]);
  const adnTxt = adn || '';
  const bloques = [];
  if (adnTxt) bloques.push(adnTxt);
  bloques.push(temporada ? 'JEFE DE TEMPORADA (campañas vigentes de este foco):\n' + temporada : 'JEFE DE TEMPORADA: no hay una campaña vigente para este foco.');
  bloques.push(e366 ? 'JEFE 366 (estrategia del producto o productos):\n' + e366 : 'JEFE 366: todavía no hay estrategia 366 para este foco.');
  return {
    adn: adnTxt,
    temporada,
    e366,
    texto: bloques.join('\n\n'),
    huella: huellaDe([adnTxt, temporada, e366]),
    vacio: !adnTxt && !temporada && !e366,
  };
}

const FORMATO_FICHA =
  '{"quien_es": "2 o 3 frases", "dolores": ["..."], "deseos_y_aspiraciones": ["..."], "motivaciones": ["..."], "dudas_y_objeciones": ["..."], ' +
  '"contenido_que_les_gusta": ["..."], "como_hablarles": ["..."], "momento_de_temporada": "1 o 2 frases", "angulos_366": ["..."], "no_esta_en_tus_fuentes": ["..."]}';

function instruccionFicha(fuentes, lineaFoco) {
  return 'Arma la FICHA DE AUDIENCIA Y MERCADO de este negocio: un resumen corto que los demás Jefes van a leer ANTES de crear contenido, en lugar de volver a leer todo el ADN, la Temporada y el 366. ' +
    'Usa SOLO las fuentes de abajo (ADN del negocio, Jefe de Temporada y Jefe 366). No inventes datos, cifras, precios, fechas ni citas. ' +
    'Si algo no aparece en las fuentes, deja ese campo vacío y anótalo en "no_esta_en_tus_fuentes" (en vez de suponerlo). ' +
    'Escribe en lenguaje cotidiano, con puntos cortos (máximo ~18 palabras cada uno, 3 a 7 por campo), sin repetir y sin relleno. ' +
    '"momento_de_temporada" dice qué campaña o fecha viene y qué cambia en el cliente por ella (si no hay campaña vigente, déjalo vacío). ' +
    '"como_hablarles" junta el tono de la marca, las palabras que usa el cliente y lo que hay que evitar decir.\n\n' +
    'Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional antes ni después, con este formato exacto:\n' + FORMATO_FICHA +
    (lineaFoco ? '\n\n' + lineaFoco : '') +
    `\n\nFUENTES:\n"""\n${fuentes.texto}\n"""`;
}

// Deja la ficha con la forma esperada (la IA o la persona pueden mandar basura): textos acotados y listas de frases.
function normalizarFicha(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const ficha = {};
  let hayAlgo = false;
  CAMPOS_FICHA.forEach(({ k, tipo }) => {
    const v = raw[k];
    if (tipo === 'texto') {
      const t = typeof v === 'string' ? v.trim().slice(0, 700) : '';
      ficha[k] = t;
      if (t && k !== 'no_esta_en_tus_fuentes') hayAlgo = true;
    } else {
      const arr = (Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [])
        .map((x) => (typeof x === 'string' ? x.trim().replace(/^[-•]\s*/, '') : ''))
        .filter(Boolean)
        .slice(0, 8)
        .map((x) => x.slice(0, 260));
      ficha[k] = arr;
      if (arr.length && k !== 'no_esta_en_tus_fuentes') hayAlgo = true;
    }
  });
  return hayAlgo ? ficha : null;
}

// Texto para pegar en el prompt de un Jefe (corto: es lo que sustituye al ADN + Temporada + 366 completos).
function formatearFicha(entrada) {
  const f = entrada && entrada.ficha;
  if (!f) return '';
  const lineas = [];
  CAMPOS_FICHA.forEach(({ k, titulo, tipo }) => {
    if (k === 'no_esta_en_tus_fuentes') return;
    const v = f[k];
    if (tipo === 'texto') {
      if (v) lineas.push(`${titulo}: ${v}`);
    } else if (Array.isArray(v) && v.length) {
      lineas.push(`${titulo}:\n` + v.map((x) => `- ${x}`).join('\n'));
    }
  });
  if (!lineas.length) return '';
  const faltan = Array.isArray(f.no_esta_en_tus_fuentes) && f.no_esta_en_tus_fuentes.length ? `\nNo está en las fuentes (no lo supongas): ${f.no_esta_en_tus_fuentes.join('; ')}` : '';
  const foco = entrada.foco && entrada.foco.nombre ? ` · enfocada en ${entrada.foco.nombre}` : '';
  return `FICHA DE AUDIENCIA Y MERCADO (resumen del ADN, el Jefe de Temporada y el Jefe 366${entrada.date ? ', ' + entrada.date : ''}${foco}):\n` + lineas.join('\n') + faltan;
}

module.exports = { CAMPOS_FICHA, fechaMx, campanasDelFoco, reunirFuentes, instruccionFicha, normalizarFicha, formatearFicha, huellaDe };
