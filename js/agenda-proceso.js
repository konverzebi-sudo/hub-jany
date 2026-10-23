/* Proceso recomendado de una campaña (Jefe de Agenda). Solo lógica de fechas, sin DOM ni red:
   la página consultor-agenda.html lo pinta y las pruebas (tests/agenda-proceso.test.js) lo verifican.

   Idea: el usuario define la fecha de ARRANQUE de su campaña (en Jefe de Temporada: "Fecha inicio campaña
   activa"). El día de arranque es el DÍA 12 del proceso (programas tu contenido y monitoreas tu campaña); las
   etapas de antes (días 1 a 11) y de después (13 y 18) se ponen solas alrededor de esa fecha.
   Cada etapa se guarda como { d, n }: d = días desde el arranque hasta el primer día de la etapa (negativo = antes),
   n = cuántos días dura. Así, si cambia la fecha de arranque, todo el plan se recorre junto.
   Cada campaña guarda su plan completo la primera vez que se ve (instantanea), con el promedio de ese momento, para que
   acomodar una campaña nunca mueva las marcas de otra que ya está en marcha. Lo que el usuario arrastra a mano lleva
   u:1 ("ajustada por ti"), y solo eso cuenta para calcular el promedio real de su negocio. */
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
    { id: 'definir',   ini: 1,  fin: 1,  corto: 'Define',          titulo: 'Define tu producto o servicio',                         jefes: ['jefe-366'] },
    { id: 'estrategia', ini: 2, fin: 4,  corto: 'Estrategia',    titulo: 'Crea tu estrategia y tus copys',                    jefes: ['jefe-temporada', 'jefe-contenido'] },
    { id: 'grabar',    ini: 5,  fin: 6,  corto: 'Graba',           titulo: 'Graba el contenido de tu campaña',                      jefes: ['jefe-contenido', 'jefe-produccion-video'] },
    { id: 'editar',    ini: 7,  fin: 9,  corto: 'Edita',           titulo: 'Edita el contenido de tu campaña',                      jefes: ['jefe-produccion-video', 'jefe-contenido'] },
    { id: 'whatsapp',  ini: 10, fin: 10, corto: 'WhatsApp',        titulo: 'Arma tus respuestas de WhatsApp',                       jefes: ['jefe-whatsapp'] },
    { id: 'campana',   ini: 11, fin: 11, corto: 'Arma campaña',    titulo: 'Arma tu campaña y prográmala en el Business Manager',   jefes: ['jefe-anuncios'] },
    { id: 'programar', ini: 12, fin: 12, corto: 'Arranque',        titulo: 'Programa tu contenido y monitorea tu campaña',          jefes: ['jefe-contenido', 'jefe-optimizacion'] },
    { id: 'revisar',   ini: 13, fin: 13, corto: 'Revisa',          titulo: 'Revisa tu campaña',                                     jefes: ['jefe-optimizacion'] },
    { id: 'optimizar', ini: 18, fin: 18, corto: 'Optimiza',        titulo: 'Optimiza tu campaña',                                   jefes: ['jefe-optimizacion'] }
  ];
  var IDX_ARRANQUE = (function () {
    for (var i = 0; i < ETAPAS.length; i++) if (ETAPAS[i].ini <= DIA_ARRANQUE && DIA_ARRANQUE <= ETAPAS[i].fin) return i;
    return 0;
  })();

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

  // Plan sin ajustes manuales: etapas en orden alrededor del arranque, con la duración recomendada
  // o, si ya hay promedio del negocio, con ese. Los huecos entre etapas son los recomendados (ej. días 14 a 17).
  function planBase(prom) {
    var n = ETAPAS.length;
    var dur = ETAPAS.map(function (e) {
      var rec = e.fin - e.ini + 1;
      return prom && prom[e.id] ? entero(prom[e.id], 1, MAX_DURACION, rec) : rec;
    });
    var gap = ETAPAS.map(function (e, i) { return i === 0 ? 0 : e.ini - ETAPAS[i - 1].fin - 1; });
    var d = new Array(n);
    d[IDX_ARRANQUE] = 0;
    var i;
    for (i = IDX_ARRANQUE + 1; i < n; i++) d[i] = d[i - 1] + dur[i - 1] + gap[i];
    for (i = IDX_ARRANQUE - 1; i >= 0; i--) d[i] = d[i + 1] - gap[i + 1] - dur[i];
    var plan = {};
    ETAPAS.forEach(function (e, k) { plan[e.id] = { d: d[k], n: dur[k] }; });
    return plan;
  }

  // Ajuste guardado -> { d, n } válido (o null si no sirve).
  function limpiarEtapa(v) {
    if (!v || typeof v !== 'object') return null;
    var d = Number(v.d), n = Number(v.n);
    if (!isFinite(d) || !isFinite(n)) return null;
    var out = { d: entero(d, -MAX_DESPLAZO, MAX_DESPLAZO, 0), n: entero(n, 1, MAX_DURACION, 1) };
    if (v.u) out.u = 1;
    return out;
  }
  // Lo que se guarda en "<hub>:agenda-proceso": { campanas: { <id>: { <etapa>: { d, n } } } }
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

  // Plan completo que se guarda la primera vez que se ve una campaña: lo recomendado o el promedio de ese momento.
  function instantanea(prom) {
    var base = planBase(prom), out = {};
    Object.keys(base).forEach(function (id) { out[id] = { d: base[id].d, n: base[id].n }; });
    return out;
  }

  // Plan que se ve: lo recomendado/promedio y, encima, lo guardado de esa campaña (completo o solo las etapas acomodadas).
  function planEfectivo(ajustes, prom) {
    var plan = planBase(prom);
    Object.keys(ajustes || {}).forEach(function (eid) {
      var v = plan[eid] ? limpiarEtapa(ajustes[eid]) : null;
      if (v) plan[eid] = v;
    });
    return plan;
  }

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
    DIA_ARRANQUE: DIA_ARRANQUE, MAX_DURACION: MAX_DURACION, ETAPAS: ETAPAS,
    esISO: esISO, sumarDias: sumarDias, diasEntre: diasEntre, etapaPorId: etapaPorId,
    recomendado: recomendado, promedios: promedios, planBase: planBase, instantanea: instantanea, planEfectivo: planEfectivo,
    limpiarProceso: limpiarProceso, limpiarEtapa: limpiarEtapa,
    fechasDe: fechasDe, desdeFechas: desdeFechas, mover: mover, alargarHasta: alargarHasta, marcas: marcas
  };
});
