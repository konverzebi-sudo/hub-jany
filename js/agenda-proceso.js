/* Proceso recomendado de una campaña (Jefe de Agenda). Solo lógica de fechas, sin DOM ni red:
   la página consultor-agenda.html lo pinta y las pruebas (tests/agenda-proceso.test.js) lo verifican.

   Idea: el usuario define la fecha de ARRANQUE de su campaña (en Jefe de Temporada: "Fecha inicio campaña
   activa"). El día de arranque es el DÍA 12 del proceso (programas tu contenido y monitoreas tu campaña); las
   etapas de antes (días 1 a 11) y de después (13 y 18) se ponen solas alrededor de esa fecha.

   LAS FECHAS QUE YA ESTÁN EN LOS JEFES SE RESPETAN (anclas, ver anclasDeCampana):
   - si el calendario final de Temporada ya trae fecha para una etapa (definición, grabación, edición, preparación
     de campaña, revisión, optimización), esa fecha manda sobre la sugerida;
   - la precampaña (plan de calentamiento con fechas, o su duración) manda sobre lo que se produce para ella:
     definir, estrategia, grabar y editar terminan ANTES de que empiece;
   - precampaña, campaña y postcampaña se muestran como referencia y de ahí sale el promedio real de cada una.

   Qué se guarda por campaña ("<hub>:agenda-proceso"):
   - { n }            duración congelada de la etapa (la primera vez que se ve la campaña, con el promedio de ese momento),
                      para que acomodar una campaña nunca mueva las marcas de otra que ya está en marcha;
   - { d, n, u: 1 }   etapa que el usuario acomodó a mano ("ajustada por ti"): d = días desde el arranque hasta su primer
                      día (negativo = antes), n = cuántos días dura. Solo estas cuentan para el promedio real del negocio.
   Las posiciones de lo demás se calculan en vivo, así que si cambia una fecha en Temporada todo se recorre solo. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.AgendaProceso = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DIA_ARRANQUE = 12;
  var MAX_DURACION = 45;
  var MAX_DESPLAZO = 120;

  // ini / fin = días del proceso recomendado. jefes = quién ayuda en esa etapa (slug de ruta, el primero es el principal).
  var ETAPAS = [
    { id: 'definir',    ini: 1,  fin: 1,  corto: 'Define',       titulo: 'Define tu producto o servicio',                       jefes: ['jefe-366'] },
    { id: 'estrategia', ini: 2,  fin: 4,  corto: 'Estrategia',   titulo: 'Crea tu estrategia y tus copys',                      jefes: ['jefe-temporada', 'jefe-contenido'] },
    { id: 'grabar',     ini: 5,  fin: 6,  corto: 'Graba',        titulo: 'Graba el contenido de tu campaña',                    jefes: ['jefe-contenido', 'jefe-produccion-video'] },
    { id: 'editar',     ini: 7,  fin: 9,  corto: 'Edita',        titulo: 'Edita el contenido de tu campaña',                    jefes: ['jefe-produccion-video', 'jefe-contenido'] },
    { id: 'whatsapp',   ini: 10, fin: 10, corto: 'WhatsApp',     titulo: 'Arma tus respuestas de WhatsApp',                     jefes: ['jefe-whatsapp'] },
    { id: 'campana',    ini: 11, fin: 11, corto: 'Arma campaña', titulo: 'Arma tu campaña y prográmala en el Business Manager', jefes: ['jefe-anuncios'] },
    { id: 'programar',  ini: 12, fin: 12, corto: 'Arranque',     titulo: 'Programa tu contenido y monitorea tu campaña',        jefes: ['jefe-contenido', 'jefe-optimizacion'] },
    { id: 'revisar',    ini: 13, fin: 13, corto: 'Revisa',       titulo: 'Revisa tu campaña',                                   jefes: ['jefe-optimizacion'] },
    { id: 'optimizar',  ini: 18, fin: 18, corto: 'Optimiza',     titulo: 'Optimiza tu campaña',                                 jefes: ['jefe-optimizacion'] }
  ];
  var IDX_ARRANQUE = (function () {
    for (var i = 0; i < ETAPAS.length; i++) if (ETAPAS[i].ini <= DIA_ARRANQUE && DIA_ARRANQUE <= ETAPAS[i].fin) return i;
    return 0;
  })();
  // Lo que se produce para la precampaña: tiene que estar listo antes de que empiece.
  var ANTES_DE_PRECAMPANA = ['definir', 'estrategia', 'grabar', 'editar'];

  var RE_ISO = /^\d{4}-\d{2}-\d{2}$/;
  function esISO(s) {
    if (!RE_ISO.test(s || '')) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  // Todo en UTC: así un cambio de horario (o la zona del navegador) nunca recorre un día.
  function sumarDias(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function diasEntre(a, b) {
    return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
  }
  function entero(v, min, max, defecto) {
    var n = Math.round(Number(v));
    if (!isFinite(n)) return defecto;
    return Math.max(min, Math.min(max, n));
  }
  function etapaPorId(id) {
    for (var i = 0; i < ETAPAS.length; i++) if (ETAPAS[i].id === id) return ETAPAS[i];
    return null;
  }
  function idxEtapa(id) {
    for (var i = 0; i < ETAPAS.length; i++) if (ETAPAS[i].id === id) return i;
    return -1;
  }

  // Tiempo recomendado de una etapa: { d, n } respecto al arranque.
  function recomendado(id) {
    var e = etapaPorId(id);
    return e ? { d: e.ini - DIA_ARRANQUE, n: e.fin - e.ini + 1 } : null;
  }

  // Promedio real de cuánto dura cada etapa: solo cuentan las etapas que el usuario acomodó a mano (u:1).
  // planes = { <campañaId>: { <etapaId>: { d, n, u } } } -> { <etapaId>: días (entero) }
  function promedios(planes) {
    var suma = {}, cuenta = {}, out = {};
    Object.keys(planes || {}).forEach(function (cid) {
      var plan = planes[cid] || {};
      Object.keys(plan).forEach(function (eid) {
        if (!etapaPorId(eid) || !plan[eid] || !plan[eid].u) return;
        suma[eid] = (suma[eid] || 0) + entero(plan[eid].n, 1, MAX_DURACION, 1);
        cuenta[eid] = (cuenta[eid] || 0) + 1;
      });
    });
    Object.keys(suma).forEach(function (eid) { out[eid] = Math.max(1, Math.round(suma[eid] / cuenta[eid])); });
    return out;
  }

  // Lo guardado de una etapa -> { n } (duración congelada) o { d, n, u:1 } (acomodada por el usuario); null si no sirve.
  function limpiarEtapa(v) {
    if (!v || typeof v !== 'object') return null;
    var n = Number(v.n), d = Number(v.d);
    if (!isFinite(n)) return null;
    n = entero(n, 1, MAX_DURACION, 1);
    if (v.u && isFinite(d)) return { d: entero(d, -MAX_DESPLAZO, MAX_DESPLAZO, 0), n: n, u: 1 };
    return { n: n };
  }
  // Lo que se guarda en "<hub>:agenda-proceso": { campanas: { <id>: { <etapa>: { n } | { d, n, u } } } }
  function limpiarProceso(crudo) {
    var out = { campanas: {} };
    var src = crudo && typeof crudo === 'object' && crudo.campanas && typeof crudo.campanas === 'object' ? crudo.campanas : {};
    Object.keys(src).forEach(function (cid) {
      var plan = {}, hay = false;
      Object.keys(src[cid] || {}).forEach(function (eid) {
        var e = etapaPorId(eid), v = e ? limpiarEtapa(src[cid][eid]) : null;
        if (v) { plan[eid] = v; hay = true; }
      });
      if (hay) out.campanas[cid] = plan;
    });
    return out;
  }

  // Duraciones que se congelan la primera vez que se ve una campaña: lo recomendado o el promedio de ese momento.
  function instantanea(prom) {
    var out = {};
    ETAPAS.forEach(function (e) {
      var rec = e.fin - e.ini + 1;
      out[e.id] = { n: prom && prom[e.id] ? entero(prom[e.id], 1, MAX_DURACION, rec) : rec };
    });
    return out;
  }

  // ───────────────────────── fechas que ya hay en Jefe de Temporada ─────────────────────────
  function sinAcentos(t) { return String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  // A qué etapa se parece una fila del calendario final de Temporada (fase + acción).
  // Primero cuentan las palabras específicas (grabar, editar, WhatsApp...), mirando primero la fase y luego la acción;
  // si no hay ninguna, la fase genérica "creación de contenido" cuenta como el inicio de grabar.
  var REGLAS_FILA = [
    ['whatsapp', /whatsapp/],
    ['grabar', /grab/],
    ['editar', /edici|editar|\bedita\b|montaje/],
    ['estrategia', /estrateg|\bcopys?\b/],
    ['definir', /definicion|definir|\bdefine\b/],
    ['campana', /preparacion de campana|business manager|programar (la |tu )?campana|armar (la |tu )?campana|armado de campana/],
    ['revisar', /\brevis/],
    ['optimizar', /optimiz/]
  ];
  var REGLA_GENERICA = ['grabar', /creacion de contenido|crear contenido|produccion de contenido/];
  var RE_FUERA_DE_PROCESO = /precampana|postcampana|post campana|pre campana|calentamiento/;
  function etapaDeFila(fase, accion) {
    var f = sinAcentos(fase);
    if (RE_FUERA_DE_PROCESO.test(f)) return '';
    var textos = [f, sinAcentos(accion)];
    for (var t = 0; t < textos.length; t++) {
      if (!textos[t]) continue;
      for (var i = 0; i < REGLAS_FILA.length; i++) if (REGLAS_FILA[i][1].test(textos[t])) return REGLAS_FILA[i][0];
    }
    return REGLA_GENERICA[1].test(f) ? REGLA_GENERICA[0] : '';
  }
  // "14 días", "2 semanas" -> días (1 a 90); 0 si no se entiende.
  function diasDeTexto(t) {
    var m = sinAcentos(t).match(/(\d{1,3})\s*(dias?|semanas?)/);
    if (!m) return 0;
    var n = parseInt(m[1], 10) * (/^semana/.test(m[2]) ? 7 : 1);
    return n >= 1 && n <= 90 ? n : 0;
  }
  function filas(v) { return Array.isArray(v) ? v.filter(function (r) { return r && typeof r === 'object'; }) : []; }

  // Lo que la campaña ya trae fechado en Temporada. null si no tiene fecha de arranque.
  // -> { arranque, fin, preInicio, preFuente ('filas'|'duracion'|''), postInicio, postFin, etapas: { <id>: { iso, fuente } } }
  function anclasDeCampana(c) {
    if (!c || !esISO(c.fecha_inicio_activa)) return null;
    var arr = c.fecha_inicio_activa;
    var fin = esISO(c.fecha_fin_activa) && c.fecha_fin_activa >= arr ? c.fecha_fin_activa : '';

    var preFechas = filas(c.pre_calentamiento).map(function (r) { return r.fecha; }).filter(function (f) { return esISO(f) && f < arr; }).sort();
    var pre = '', preFuente = '';
    if (preFechas.length) { pre = preFechas[0]; preFuente = 'filas'; }
    else { var dp = diasDeTexto(c.pre_duracion); if (dp) { pre = sumarDias(arr, -dp); preFuente = 'duracion'; } }

    var postFechas = filas(c.post_acciones).map(function (r) { return r.fecha; }).filter(function (f) { return esISO(f) && f > arr; }).sort();
    var postFin = postFechas.length ? postFechas[postFechas.length - 1] : '';
    var postIni = postFin ? (fin ? sumarDias(fin, 1) : postFechas[0]) : '';
    if (postIni && postIni > postFin) postIni = postFechas[0];

    var etapas = {};
    filas(c.calendario).forEach(function (r) {
      if (!esISO(r.fecha)) return;
      var id = etapaDeFila(r.fase, r.accion);
      if (!id || id === 'programar') return;           // el arranque ya es la fecha de campaña activa
      var off = diasEntre(arr, r.fecha), i = idxEtapa(id);
      if ((i < IDX_ARRANQUE && off > 0) || (i > IDX_ARRANQUE && off < 0) || Math.abs(off) > MAX_DESPLAZO) return;   // no encaja con el orden del proceso
      if (!etapas[id] || r.fecha < etapas[id].iso) etapas[id] = { iso: r.fecha, fuente: { campo: 'calendario', rowId: r.id || '' } };
    });
    return { arranque: arr, fin: fin, preInicio: pre, preFuente: preFuente, postInicio: postIni, postFin: postFin, etapas: etapas };
  }

  // Promedio real de cuánto dura la precampaña y la postcampaña en las campañas que ya traen fechas. -> { pre, post, nPre, nPost }
  function promedioPrePost(listaAnclas) {
    var sp = 0, np = 0, sq = 0, nq = 0;
    (listaAnclas || []).forEach(function (a) {
      if (!a) return;
      if (a.preInicio) { sp += diasEntre(a.preInicio, a.arranque); np++; }
      if (a.postInicio && a.postFin) { sq += diasEntre(a.postInicio, a.postFin) + 1; nq++; }
    });
    return { pre: np ? Math.round(sp / np) : 0, post: nq ? Math.round(sq / nq) : 0, nPre: np, nPost: nq };
  }

  // ───────────────────────── plan de una campaña ─────────────────────────
  // Posiciones (días desde el arranque) con estas duraciones: etapas en orden alrededor del arranque,
  // con los huecos recomendados entre ellas (ej. días 14 a 17).
  function cascada(dur) {
    var n = ETAPAS.length;
    var gap = ETAPAS.map(function (e, i) { return i === 0 ? 0 : e.ini - ETAPAS[i - 1].fin - 1; });
    var d = new Array(n), i;
    d[IDX_ARRANQUE] = 0;
    for (i = IDX_ARRANQUE + 1; i < n; i++) d[i] = d[i - 1] + dur[ETAPAS[i - 1].id] + gap[i];
    for (i = IDX_ARRANQUE - 1; i >= 0; i--) d[i] = d[i + 1] - gap[i + 1] - dur[ETAPAS[i].id];
    var out = {};
    ETAPAS.forEach(function (e, k) { out[e.id] = d[k]; });
    return out;
  }

  // Plan que se ve de una campaña, y de dónde sale cada etapa.
  //   guardado: lo que hay en agenda-proceso de esa campaña ({} si es la primera vez)
  //   prom: promedio real del negocio (promedios()) para campañas que todavía no congelan duraciones
  //   anclas: anclasDeCampana(campaña) o null
  // -> { plan: { <id>: { d, n } },
  //      origen: { <id>: 'usuario' | 'jefe' (fecha del calendario de Temporada) | 'precampana' (se corrió para terminar antes de que empiece) | 'sugerido' },
  //      fuente: { <id>: { campo, rowId, iso } } (fila de Temporada que dio la fecha),
  //      avisos: [ { tipo: 'orden', etapa, antes } (queda antes que la etapa anterior: choque entre fechas de Temporada)
  //              | { tipo: 'precampana', etapa } (termina después de que empieza la precampaña) ] }
  function detalleEfectivo(guardado, prom, anclas) {
    guardado = guardado || {}; prom = prom || {};
    var dur = {};
    ETAPAS.forEach(function (e) {
      var rec = e.fin - e.ini + 1, s = guardado[e.id];
      if (s && s.u) dur[e.id] = rec;                                  // lo que el usuario acomodó no mueve a las demás etapas
      else if (s && s.n) dur[e.id] = entero(s.n, 1, MAX_DURACION, rec);
      else dur[e.id] = prom[e.id] ? entero(prom[e.id], 1, MAX_DURACION, rec) : rec;
    });
    var pos = cascada(dur), origen = {}, fuente = {};
    ETAPAS.forEach(function (e) { origen[e.id] = 'sugerido'; });

    if (anclas) {
      // 1) fechas que ya puso Temporada en su calendario final
      ETAPAS.forEach(function (e) {
        var a = anclas.etapas && anclas.etapas[e.id];
        if (!a) return;
        pos[e.id] = diasEntre(anclas.arranque, a.iso);
        origen[e.id] = 'jefe';
        fuente[e.id] = { campo: a.fuente.campo, rowId: a.fuente.rowId, iso: a.iso };
      });
      // 2) la precampaña manda: lo que se produce para ella termina antes de que empiece
      if (anclas.preInicio) {
        var limite = diasEntre(anclas.arranque, anclas.preInicio) - 1;
        var finEditar = pos.editar + dur.editar - 1;
        var corre = Math.min(0, limite - finEditar);
        if (corre < 0) {
          ANTES_DE_PRECAMPANA.forEach(function (id) {
            if (origen[id] === 'jefe') return;
            pos[id] += corre;
            origen[id] = 'precampana';
          });
        }
      }
    }

    // 3) lo que el usuario acomodó a mano gana sobre todo lo demás
    var plan = {};
    ETAPAS.forEach(function (e) {
      var s = guardado[e.id];
      if (s && s.u && isFinite(Number(s.d))) { plan[e.id] = { d: s.d, n: s.n }; origen[e.id] = 'usuario'; }
      else plan[e.id] = { d: pos[e.id], n: dur[e.id] };
    });
    // Choques entre fechas que puso el usuario o Temporada: se avisan, no se corrigen a escondidas.
    var avisos = [], i;
    for (i = 1; i < ETAPAS.length; i++) {
      var ant = ETAPAS[i - 1].id, act = ETAPAS[i].id;
      if (plan[act].d < plan[ant].d && origen[act] !== 'usuario' && origen[ant] !== 'usuario') avisos.push({ tipo: 'orden', etapa: act, antes: ant });
    }
    if (anclas && anclas.preInicio) {
      var tope = diasEntre(anclas.arranque, anclas.preInicio) - 1;
      ANTES_DE_PRECAMPANA.forEach(function (id) {
        if (plan[id].d + plan[id].n - 1 > tope && origen[id] !== 'usuario') avisos.push({ tipo: 'precampana', etapa: id });
      });
    }
    return { plan: plan, origen: origen, fuente: fuente, avisos: avisos };
  }
  function planEfectivo(guardado, prom, anclas) { return detalleEfectivo(guardado, prom, anclas).plan; }
  // Sin ajustes ni fechas de Temporada: lo recomendado (o el promedio, si se pasa).
  function planBase(prom) { return detalleEfectivo({}, prom, null).plan; }

  // Fechas reales de una etapa dado el arranque (YYYY-MM-DD).
  function fechasDe(arranque, ed) {
    var inicio = sumarDias(arranque, ed.d);
    return { inicio: inicio, fin: sumarDias(inicio, ed.n - 1) };
  }
  // { d, n } a partir de fechas (para cuando se arrastra o se escribe la fecha).
  function desdeFechas(arranque, inicio, fin) {
    var d = diasEntre(arranque, inicio);
    var n = diasEntre(inicio, fin) + 1;
    return { d: entero(d, -MAX_DESPLAZO, MAX_DESPLAZO, 0), n: entero(n, 1, MAX_DURACION, 1) };
  }
  function mover(ed, dias) {
    return { d: entero(ed.d + dias, -MAX_DESPLAZO, MAX_DESPLAZO, ed.d), n: ed.n };
  }
  // Cambia dónde termina la etapa (sin mover dónde empieza): fin = día relativo al arranque.
  function alargarHasta(ed, finRelativo) {
    return { d: ed.d, n: entero(finRelativo - ed.d + 1, 1, MAX_DURACION, ed.n) };
  }

  // Todas las marcas (una por día) de un plan: [{ etapa, iso, parte, de }]
  function marcas(arranque, plan) {
    var out = [];
    ETAPAS.forEach(function (e) {
      var ed = plan[e.id];
      if (!ed) return;
      var f = fechasDe(arranque, ed);
      for (var k = 0; k < ed.n; k++) out.push({ etapa: e.id, iso: sumarDias(f.inicio, k), parte: k + 1, de: ed.n });
    });
    return out;
  }

  return {
    DIA_ARRANQUE: DIA_ARRANQUE, MAX_DURACION: MAX_DURACION, ETAPAS: ETAPAS, ANTES_DE_PRECAMPANA: ANTES_DE_PRECAMPANA,
    esISO: esISO, sumarDias: sumarDias, diasEntre: diasEntre, etapaPorId: etapaPorId,
    recomendado: recomendado, promedios: promedios, instantanea: instantanea,
    anclasDeCampana: anclasDeCampana, etapaDeFila: etapaDeFila, diasDeTexto: diasDeTexto, promedioPrePost: promedioPrePost,
    detalleEfectivo: detalleEfectivo, planEfectivo: planEfectivo, planBase: planBase,
    limpiarProceso: limpiarProceso, limpiarEtapa: limpiarEtapa,
    fechasDe: fechasDe, desdeFechas: desdeFechas, mover: mover, alargarHasta: alargarHasta, marcas: marcas
  };
});
