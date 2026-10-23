// Proceso recomendado de campaña del Jefe de Agenda (js/agenda-proceso.js) y sus íconos. Sin red ni costos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const AP = require('../js/agenda-proceso.js');

const RAIZ = path.join(__dirname, '..');
const dias = (arranque, plan, id) => { const f = AP.fechasDe(arranque, plan[id]); return [f.inicio, f.fin]; };
// Campaña de Jefe de Temporada con lo mínimo que la Agenda lee.
const campana = (extra) => Object.assign({ id: 'c1', fecha_inicio_activa: '2026-11-12' }, extra || {});

// ───────────────────────── tiempos recomendados ─────────────────────────

test('sin ajustes, las etapas caen en los días 1 al 18 recomendados alrededor del arranque (día 12)', () => {
  const plan = AP.planEfectivo({}, {}, null);
  const arranque = '2026-11-12';
  assert.deepEqual(dias(arranque, plan, 'definir'), ['2026-11-01', '2026-11-01']);
  assert.deepEqual(dias(arranque, plan, 'estrategia'), ['2026-11-02', '2026-11-04']);
  assert.deepEqual(dias(arranque, plan, 'grabar'), ['2026-11-05', '2026-11-06']);
  assert.deepEqual(dias(arranque, plan, 'editar'), ['2026-11-07', '2026-11-09']);
  assert.deepEqual(dias(arranque, plan, 'whatsapp'), ['2026-11-10', '2026-11-10']);
  assert.deepEqual(dias(arranque, plan, 'campana'), ['2026-11-11', '2026-11-11']);
  assert.deepEqual(dias(arranque, plan, 'programar'), ['2026-11-12', '2026-11-12']);
  assert.deepEqual(dias(arranque, plan, 'revisar'), ['2026-11-13', '2026-11-13']);
  assert.deepEqual(dias(arranque, plan, 'optimizar'), ['2026-11-18', '2026-11-18']);
});

test('si cambia el arranque, todo el plan se recorre junto (incluso cruzando de año)', () => {
  const plan = AP.planEfectivo({}, {}, null);
  assert.deepEqual(dias('2027-01-05', plan, 'definir'), ['2026-12-25', '2026-12-25']);
  assert.deepEqual(dias('2027-01-05', plan, 'optimizar'), ['2027-01-11', '2027-01-11']);
});

test('sumarDias no depende del horario ni de la zona: fin de mes, bisiesto y cambio de año', () => {
  assert.equal(AP.sumarDias('2026-12-30', 3), '2027-01-02');
  assert.equal(AP.sumarDias('2028-02-28', 1), '2028-02-29');
  assert.equal(AP.sumarDias('2026-03-01', -1), '2026-02-28');
  assert.equal(AP.diasEntre('2026-11-01', '2026-11-12'), 11);
  assert.equal(AP.esISO('2026-02-30'), false);
  assert.equal(AP.esISO('12/11'), false);
  assert.equal(AP.esISO('2026-11-12'), true);
});

test('lo que el usuario acomoda gana sobre lo recomendado', () => {
  const plan = AP.planEfectivo({ optimizar: { d: 9, n: 2, u: 1 } }, {}, null);
  assert.deepEqual(plan.optimizar, { d: 9, n: 2 });
  assert.deepEqual(plan.revisar, AP.planEfectivo({}, {}, null).revisar);   // no había nada detrás que empujar
});

test('SECUENCIA: si atrasas una etapa, la que sigue se recorre (y la que sigue de esa)', () => {
  const normal = AP.planEfectivo({}, {}, null);
  // "Revisa" pasa del día 13 al 19 (d +7): "Optimiza" estaba en +6 y ya no puede empezar antes de que termine "Revisa"
  const det = AP.detalleEfectivo({ revisar: { d: 7, n: 1, u: 1 } }, {}, null);
  assert.deepEqual(det.plan.revisar, { d: 7, n: 1 });
  assert.equal(det.plan.optimizar.d, 8);
  assert.equal(det.origen.optimizar, 'secuencia');
  assert.equal(det.empujada.optimizar, 2);
  // lo anterior no se mueve
  ['definir', 'estrategia', 'grabar', 'editar', 'whatsapp', 'campana', 'programar'].forEach((id) => assert.deepEqual(det.plan[id], normal[id], id));
  // si alcanza el hueco que ya había (el recomendado entre el día 13 y el 18), no se mueve nada
  assert.deepEqual(AP.planEfectivo({ revisar: { d: 4, n: 1, u: 1 } }, {}, null).optimizar, normal.optimizar);
});

test('SECUENCIA: alargar una etapa también empuja a la que sigue, y al adelantarla todo regresa', () => {
  const anclas = AP.anclasDeCampana(campana({ pre_calentamiento: [{ fecha: '2026-11-03' }] }));   // hay hueco antes del arranque
  const base = AP.detalleEfectivo({}, {}, anclas).plan;
  const alargada = AP.detalleEfectivo({ estrategia: { d: base.estrategia.d, n: base.estrategia.n + 2, u: 1 } }, {}, anclas);
  assert.equal(alargada.plan.estrategia.n, base.estrategia.n + 2);
  assert.equal(alargada.plan.grabar.d, base.grabar.d + 2);
  assert.equal(alargada.plan.editar.d, base.editar.d + 2);
  assert.equal(alargada.origen.grabar, 'secuencia');
  assert.deepEqual(alargada.plan.whatsapp, base.whatsapp);                // había hueco: no se mueve
  assert.deepEqual(AP.detalleEfectivo({}, {}, anclas).plan, base);       // sin el ajuste, todo regresa
});

test('SECUENCIA: una etapa no puede empezar antes de que termine la anterior', () => {
  const normal = AP.planEfectivo({}, {}, null);
  const det = AP.detalleEfectivo({ grabar: { d: -9, n: 2, u: 1 } }, {}, null);     // la quiere encimar con "Estrategia"
  assert.equal(det.plan.grabar.d, normal.estrategia.d + normal.estrategia.n);      // empieza el día después de que termina
});

test('el promedio sale solo de las etapas que el usuario acomodó a mano (u:1)', () => {
  const prom = AP.promedios({
    c1: { estrategia: { d: -10, n: 5, u: 1 } },
    c2: { estrategia: { d: -10, n: 7, u: 1 }, grabar: { d: -6, n: 3, u: 1 }, editar: { n: 9 } },
    c3: {},
  });
  assert.deepEqual(prom, { estrategia: 6, grabar: 3 }); // "editar" solo está congelada, nadie la acomodó: no cuenta
  assert.deepEqual(AP.promedios({}), {});
  assert.deepEqual(AP.promedios(null), {});
});

test('con promedio, las etapas se vuelven a acomodar sin encimarse y el arranque no se mueve', () => {
  const plan = AP.planBase({ estrategia: 6, grabar: 3 });
  assert.equal(plan.programar.d, 0);
  assert.equal(plan.estrategia.n, 6);
  assert.equal(plan.grabar.n, 3);
  const fin = (id) => plan[id].d + plan[id].n - 1;
  const orden = AP.ETAPAS.map((e) => e.id);
  for (let i = 1; i < orden.length; i++) assert.ok(plan[orden[i]].d > fin(orden[i - 1]), orden[i] + ' no debe encimarse con ' + orden[i - 1]);
  assert.equal(plan.optimizar.d - fin('revisar') - 1, 4); // el hueco recomendado entre el día 13 y el 18 se conserva
});

test('cada campaña congela sus duraciones al verse: acomodar otra campaña después no la mueve', () => {
  const foto = AP.instantanea({});
  assert.equal(Object.keys(foto).length, AP.ETAPAS.length);
  assert.deepEqual(foto.estrategia, { n: 3 });
  // otra campaña acomoda "estrategia" a 7 días -> el promedio cambia, pero esta campaña sigue con sus 3 días
  const prom = AP.promedios({ otra: { estrategia: { d: -10, n: 7, u: 1 } } });
  assert.deepEqual(AP.planEfectivo(foto, prom, null).estrategia, { d: -10, n: 3 });
  // una campaña nueva sí nace con el promedio aprendido
  assert.equal(AP.instantanea(prom).estrategia.n, 7);
  assert.equal(AP.planEfectivo(AP.instantanea(prom), prom, null).estrategia.n, 7);
});

test('mover y alargar respetan límites razonables', () => {
  assert.deepEqual(AP.mover({ d: -3, n: 2 }, 2), { d: -1, n: 2 });
  assert.deepEqual(AP.mover({ d: -3, n: 2 }, 100000), { d: 120, n: 2 });
  assert.deepEqual(AP.alargarHasta({ d: -3, n: 2 }, 0), { d: -3, n: 4 });
  assert.equal(AP.alargarHasta({ d: -3, n: 2 }, -10).n, 1);
  assert.equal(AP.alargarHasta({ d: -3, n: 2 }, 9999).n, AP.MAX_DURACION);
  assert.deepEqual(AP.desdeFechas('2026-11-12', '2026-11-05', '2026-11-08'), { d: -7, n: 4 });
});

test('lo guardado se limpia: etapas desconocidas, números raros y ajustes sin posición', () => {
  const limpio = AP.limpiarProceso({
    campanas: {
      c1: { grabar: { d: '-5', n: '3', u: 1 }, inventada: { d: 1, n: 1 }, editar: { d: 'x', n: 2 }, definir: { d: 4, n: 2 } },
      c2: { definir: { d: 1e9, n: -4, u: 1 } },
      c3: 'texto',
    },
  });
  assert.deepEqual(limpio, { campanas: {
    // "editar" sin posición válida y "definir" sin u quedan solo como duración congelada
    c1: { grabar: { d: -5, n: 3, u: 1 }, editar: { n: 2 }, definir: { n: 2 } },
    c2: { definir: { d: 120, n: 1, u: 1 } },
  } });
  assert.deepEqual(AP.limpiarProceso(null), { campanas: {} });
  assert.deepEqual(AP.limpiarProceso('basura'), { campanas: {} });
});

test('las marcas del calendario son una por día de cada etapa', () => {
  const plan = AP.planEfectivo({}, {}, null);
  const m = AP.marcas('2026-11-12', plan);
  const total = AP.ETAPAS.reduce((s, e) => s + plan[e.id].n, 0);
  assert.equal(m.length, total);
  const estrategia = m.filter((x) => x.etapa === 'estrategia');
  assert.deepEqual(estrategia.map((x) => x.iso), ['2026-11-02', '2026-11-03', '2026-11-04']);
  assert.deepEqual(estrategia.map((x) => x.parte + '/' + x.de), ['1/3', '2/3', '3/3']);
});

test('cada etapa tiene al menos un Jefe que ayuda (día 10 = WhatsApp y Ventas)', () => {
  AP.ETAPAS.forEach((e) => assert.ok(e.jefes.length >= 1, e.id));
  assert.equal(AP.etapaPorId('whatsapp').jefes[0], 'jefe-whatsapp');
});

// ───────────────────────── fechas que ya hay en Jefe de Temporada ─────────────────────────

test('anclas: sin fecha de arranque no hay plan; con ella se leen precampaña, campaña y postcampaña', () => {
  assert.equal(AP.anclasDeCampana(null), null);
  assert.equal(AP.anclasDeCampana({ id: 'x' }), null);
  assert.equal(AP.anclasDeCampana({ id: 'x', fecha_inicio_activa: '12/11' }), null);
  const a = AP.anclasDeCampana(campana({
    fecha_fin_activa: '2026-11-20',
    pre_calentamiento: [{ fecha: '2026-11-05' }, { fecha: '2026-10-29' }, { fecha: '' }, { fecha: '2026-11-20' }], // la última ya no es "pre"
    post_acciones: [{ fecha: '2026-11-25' }, { fecha: '2026-12-02' }, { fecha: '2026-11-01' }],                      // la de antes del arranque no cuenta
  }));
  assert.equal(a.arranque, '2026-11-12');
  assert.equal(a.fin, '2026-11-20');
  assert.equal(a.preInicio, '2026-10-29');
  assert.equal(a.preFuente, 'filas');
  assert.equal(a.postInicio, '2026-11-21'); // el día siguiente a que termina la campaña
  assert.equal(a.postFin, '2026-12-02');
});

test('anclas: sin filas de calentamiento la precampaña sale de su duración ("14 días", "2 semanas")', () => {
  assert.equal(AP.anclasDeCampana(campana({ pre_duracion: '14 días' })).preInicio, '2026-10-29');
  assert.equal(AP.anclasDeCampana(campana({ pre_duracion: '2 semanas' })).preInicio, '2026-10-29');
  assert.equal(AP.anclasDeCampana(campana({ pre_duracion: '2 semanas' })).preFuente, 'duracion');
  assert.equal(AP.anclasDeCampana(campana({ pre_duracion: 'poquito' })).preInicio, '');
  assert.equal(AP.anclasDeCampana(campana({ pre_duracion: '500 días' })).preInicio, '');
  assert.equal(AP.diasDeTexto('Tres días'), 0);
});

test('anclas: el calendario final de Temporada se reconoce por fase y acción', () => {
  assert.equal(AP.etapaDeFila('Definición de campaña', 'Confirmar oferta'), 'definir');
  assert.equal(AP.etapaDeFila('Creación de contenido', 'Grabar videos'), 'grabar');
  assert.equal(AP.etapaDeFila('Creación de contenido', 'Editar los reels'), 'editar');
  assert.equal(AP.etapaDeFila('Creación de contenido', 'Preparar piezas'), 'grabar');
  assert.equal(AP.etapaDeFila('Preparación de campaña', 'Programar anuncios'), 'campana');
  assert.equal(AP.etapaDeFila('Preparación', 'Armar respuestas de WhatsApp'), 'whatsapp');
  assert.equal(AP.etapaDeFila('Campaña activa', 'Revisar métricas'), 'revisar');
  assert.equal(AP.etapaDeFila('Campaña activa', 'Optimizar anuncios'), 'optimizar');
  // la precampaña y la postcampaña no son etapas del proceso
  assert.equal(AP.etapaDeFila('Inicio de precampaña', 'Grabar teaser'), '');
  assert.equal(AP.etapaDeFila('Postcampaña', 'Revisar resultados'), '');
  assert.equal(AP.etapaDeFila('Campaña activa', 'Lanzamiento'), '');
});

test('anclas: las filas fechadas del calendario quedan por etapa (la más temprana) y las que no encajan se ignoran', () => {
  const a = AP.anclasDeCampana(campana({ calendario: [
    { id: 'r1', fecha: '2026-11-04', fase: 'Creación de contenido', accion: 'Grabar videos' },
    { id: 'r2', fecha: '2026-11-03', fase: 'Creación de contenido', accion: 'Grabar más videos' },
    { id: 'r3', fecha: '2026-11-08', fase: 'Creación de contenido', accion: 'Editar' },
    { id: 'r4', fecha: '2026-11-20', fase: 'Definición de campaña', accion: 'Definir' },      // "definir" después del arranque: no encaja
    { id: 'r5', fecha: '', fase: 'Preparación de campaña', accion: 'Programar anuncios' },     // sin fecha
    { id: 'r6', fecha: '2026-11-14', fase: 'Campaña activa', accion: 'Revisar métricas' },
  ] }));
  assert.deepEqual(a.etapas.grabar, { iso: '2026-11-03', fuente: { campo: 'calendario', rowId: 'r2' } });
  assert.equal(a.etapas.editar.iso, '2026-11-08');
  assert.equal(a.etapas.revisar.iso, '2026-11-14');
  assert.equal(a.etapas.definir, undefined);
  assert.equal(a.etapas.campana, undefined);
});

test('RESPETAR: si Temporada ya fechó una etapa, la Agenda usa esa fecha y dice de dónde salió', () => {
  const anclas = AP.anclasDeCampana(campana({ calendario: [{ id: 'r2', fecha: '2026-11-03', fase: 'Creación de contenido', accion: 'Grabar' }] }));
  const det = AP.detalleEfectivo({}, {}, anclas);
  assert.deepEqual(dias('2026-11-12', det.plan, 'grabar'), ['2026-11-03', '2026-11-04']);   // dura lo mismo (2 días), empieza donde dice Temporada
  assert.equal(det.origen.grabar, 'jefe');
  assert.deepEqual(det.fuente.grabar, { campo: 'calendario', rowId: 'r2', iso: '2026-11-03' });
  assert.equal(det.origen.editar, 'sugerido');
  assert.deepEqual(det.plan.editar, AP.planBase({}).editar);
});

test('PRECAMPAÑA: grabar y editar terminan antes de que empiece, y lo previo se corre igual', () => {
  const anclas = AP.anclasDeCampana(campana({ pre_calentamiento: [{ fecha: '2026-11-03' }] }));   // la precampaña arranca el 3 nov
  const det = AP.detalleEfectivo({}, {}, anclas);
  assert.deepEqual(dias('2026-11-12', det.plan, 'editar'), ['2026-10-31', '2026-11-02']);       // termina el día anterior a la precampaña
  assert.deepEqual(dias('2026-11-12', det.plan, 'grabar'), ['2026-10-29', '2026-10-30']);
  assert.deepEqual(dias('2026-11-12', det.plan, 'estrategia'), ['2026-10-26', '2026-10-28']);
  assert.deepEqual(dias('2026-11-12', det.plan, 'definir'), ['2026-10-25', '2026-10-25']);
  ['definir', 'estrategia', 'grabar', 'editar'].forEach((id) => assert.equal(det.origen[id], 'precampana', id));
  // lo que va pegado al arranque no se mueve
  ['whatsapp', 'campana', 'programar', 'revisar', 'optimizar'].forEach((id) => { assert.deepEqual(det.plan[id], AP.planBase({})[id], id); assert.equal(det.origen[id], 'sugerido', id); });
});

test('PRECAMPAÑA corta: si empieza después de lo que ya se tenía previsto, no se mueve nada', () => {
  const anclas = AP.anclasDeCampana(campana({ pre_calentamiento: [{ fecha: '2026-11-10' }] }));
  const det = AP.detalleEfectivo({}, {}, anclas);
  assert.deepEqual(det.plan, AP.planBase({}));
  assert.ok(Object.values(det.origen).every((o) => o === 'sugerido'));
});

test('la fecha que puso Temporada manda sobre el corrimiento por precampaña, y lo que el usuario acomode manda sobre todo', () => {
  const anclas = AP.anclasDeCampana(campana({
    pre_calentamiento: [{ fecha: '2026-11-03' }],
    calendario: [{ id: 'r9', fecha: '2026-11-06', fase: 'Creación de contenido', accion: 'Editar' }],
  }));
  const det = AP.detalleEfectivo({ grabar: { d: -9, n: 1, u: 1 } }, {}, anclas);
  assert.equal(det.plan.editar.d, -6);                 // 6 nov, aunque ya empezó la precampaña: es fecha del Jefe
  assert.equal(det.origen.editar, 'jefe');
  assert.deepEqual(det.plan.grabar, { d: -9, n: 1 });  // lo acomodado a mano
  assert.equal(det.origen.grabar, 'usuario');
});

test('si cambia una fecha en Temporada, las etapas sin ajustar se recorren solas; las acomodadas no', () => {
  const guardado = Object.assign(AP.instantanea({}), { optimizar: { d: 9, n: 1, u: 1 } });
  const antes = AP.detalleEfectivo(guardado, {}, AP.anclasDeCampana(campana({ pre_calentamiento: [{ fecha: '2026-11-03' }] })));
  const despues = AP.detalleEfectivo(guardado, {}, AP.anclasDeCampana(campana({ pre_calentamiento: [{ fecha: '2026-10-30' }] })));
  assert.equal(despues.plan.editar.d, antes.plan.editar.d - 4);
  assert.deepEqual(despues.plan.optimizar, antes.plan.optimizar);
});

test('AVISOS: si dos fechas de Temporada chocan se avisa, no se corrige a escondidas', () => {
  // "Definición" el 28 oct y la precampaña empieza el 1 nov: la secuencia empuja el resto y ya no alcanza a terminar antes de la precampaña
  const anclas = AP.anclasDeCampana(campana({
    pre_calentamiento: [{ fecha: '2026-11-01' }],
    calendario: [{ id: 'k1', fecha: '2026-10-28', fase: 'Definición de campaña', accion: 'Confirmar oferta' }],
  }));
  const det = AP.detalleEfectivo({}, {}, anclas);
  assert.equal(det.plan.definir.d, -15);                                              // la fecha de Temporada se respeta
  assert.equal(det.plan.estrategia.d, -14);                                           // y lo demás va en secuencia después de ella
  assert.ok(det.avisos.some((a) => a.tipo === 'precampana' && a.etapa === 'editar'));
  // dos fechas de Temporada que se encima: no se mueve ninguna, se avisa
  const choque = AP.detalleEfectivo({}, {}, AP.anclasDeCampana(campana({ calendario: [
    { id: 'a', fecha: '2026-11-08', fase: 'Creación de contenido', accion: 'Grabar' },
    { id: 'b', fecha: '2026-11-08', fase: 'Creación de contenido', accion: 'Editar' },
  ] })));
  assert.equal(choque.plan.grabar.d, choque.plan.editar.d);
  assert.ok(choque.avisos.some((a) => a.tipo === 'orden' && a.etapa === 'editar' && a.antes === 'grabar'));
  // una etapa de Temporada que termina después de que empiece la precampaña
  const anclas2 = AP.anclasDeCampana(campana({
    pre_calentamiento: [{ fecha: '2026-11-01' }],
    calendario: [{ id: 'k2', fecha: '2026-11-05', fase: 'Creación de contenido', accion: 'Editar' }],
  }));
  assert.ok(AP.detalleEfectivo({}, {}, anclas2).avisos.some((a) => a.tipo === 'precampana' && a.etapa === 'editar'));
  // sin choques no hay avisos; y lo que el usuario acomoda no genera avisos
  assert.deepEqual(AP.detalleEfectivo({}, {}, null).avisos, []);
  assert.deepEqual(AP.detalleEfectivo({}, {}, AP.anclasDeCampana(campana({ pre_calentamiento: [{ fecha: '2026-11-03' }] }))).avisos, []);
  assert.deepEqual(AP.detalleEfectivo({ editar: { d: -1, n: 1, u: 1 }, grabar: { d: -9, n: 1, u: 1 } }, {}, anclas2).avisos.filter((a) => a.etapa === 'editar'), []);
  // una fecha de Temporada que cae en la campaña o en la postcampaña también se avisa
  const paredes = AP.detalleEfectivo({}, {}, AP.anclasDeCampana(campana({ fecha_fin_activa: '2026-11-14', calendario: [
    { id: 'p', fecha: '2026-11-12', fase: 'Preparación de campaña', accion: 'Programar anuncios' },
    { id: 'q', fecha: '2026-11-20', fase: 'Campaña activa', accion: 'Optimizar anuncios' },
  ] })));
  assert.ok(paredes.avisos.some((a) => a.tipo === 'campana' && a.etapa === 'campana'));
  assert.ok(paredes.avisos.some((a) => a.tipo === 'postcampana' && a.etapa === 'optimizar'));
});

test('PAREDES: la preparación no se mete a la campaña; el movimiento se recorta hasta donde sí cabe', () => {
  const anclas = AP.anclasDeCampana(campana());                       // sin precampaña: la preparación va pegada al arranque, sin holgura
  const normal = AP.planEfectivo({}, {}, anclas);
  const sinHolgura = AP.limitarMovimiento({}, {}, anclas, 'definir', AP.mover(normal.definir, 1));
  assert.equal(sinHolgura.recortado, true);
  assert.equal(sinHolgura.motivo, 'campana');
  assert.deepEqual(sinHolgura.ed, normal.definir);                    // ni un día cabe
  // con precampaña hay hueco: un poco se puede atrasar, mucho no
  const conHueco = AP.anclasDeCampana(campana({ pre_calentamiento: [{ fecha: '2026-11-03' }] }));
  const base = AP.planEfectivo({}, {}, conHueco);
  const poco = AP.limitarMovimiento({}, {}, conHueco, 'estrategia', AP.mover(base.estrategia, 2));
  assert.equal(poco.recortado, false);
  assert.equal(poco.ed.d, base.estrategia.d + 2);
  const mucho = AP.limitarMovimiento({}, {}, conHueco, 'estrategia', AP.mover(base.estrategia, 30));
  assert.equal(mucho.recortado, true);
  assert.equal(mucho.motivo, 'campana');
  assert.ok(mucho.ed.d > base.estrategia.d && mucho.ed.d < base.estrategia.d + 30);
  const resultado = AP.detalleEfectivo(AP.conAjuste({}, 'estrategia', mucho.ed), {}, conHueco);
  assert.deepEqual(AP.violaciones(resultado, conHueco), []);          // lo que quedó sí cabe
  // "muy lejos" por poquito: un día más ya no cabría
  const justo = AP.limitarMovimiento({}, {}, conHueco, 'estrategia', AP.mover(mucho.ed, 1));
  assert.equal(justo.recortado, true);
});

test('PAREDES: lo que pasa durante la campaña no se pasa a la postcampaña', () => {
  const anclas = AP.anclasDeCampana(campana({ fecha_fin_activa: '2026-11-15' }));    // la campaña dura hasta el día +3
  const base = AP.planEfectivo({}, {}, anclas);                                       // "Revisa" en +1
  const dentro = AP.limitarMovimiento({}, {}, anclas, 'revisar', { d: 3, n: 1 });
  assert.equal(dentro.recortado, false);
  const fuera = AP.limitarMovimiento({}, {}, anclas, 'revisar', { d: 5, n: 1 });
  assert.equal(fuera.recortado, true);
  assert.equal(fuera.motivo, 'postcampana');
  assert.equal(fuera.ed.d, 3);
  // sin fecha de fin de campaña no hay pared de postcampaña
  assert.equal(AP.limitarMovimiento({}, {}, AP.anclasDeCampana(campana()), 'revisar', { d: 5, n: 1 }).recortado, false);
  // lo que ya chocaba (la sugerida "Optimiza" cae después del fin) no se castiga ni se empeora sin motivo nuevo
  assert.ok(AP.violaciones(AP.detalleEfectivo({}, {}, anclas), anclas).some((v) => v.tipo === 'postcampana' && v.etapa === 'optimizar'));
  assert.equal(AP.limitarMovimiento({}, {}, anclas, 'optimizar', AP.mover(base.optimizar, -1)).recortado, false);
});

test('la postcampaña empieza el día siguiente al fin de la campaña, aunque Temporada no haya fechado sus acciones', () => {
  const a = AP.anclasDeCampana(campana({ fecha_fin_activa: '2026-11-20' }));
  assert.equal(a.postInicio, '2026-11-21');
  assert.equal(a.postFin, '');
  assert.equal(AP.anclasDeCampana(campana()).postInicio, '');
  assert.deepEqual(AP.promedioPrePost([a]), { pre: 0, post: 0, nPre: 0, nPost: 0 });   // sin fin de postcampaña no hay duración que promediar
});

test('promedio real de precampaña y postcampaña, según las fechas de cada campaña', () => {
  const a1 = AP.anclasDeCampana(campana({ pre_duracion: '10 días', fecha_fin_activa: '2026-11-20', post_acciones: [{ fecha: '2026-11-30' }] }));
  const a2 = AP.anclasDeCampana(campana({ id: 'c2', fecha_inicio_activa: '2026-12-10', pre_duracion: '20 días' }));
  assert.deepEqual(AP.promedioPrePost([a1, a2, null]), { pre: 15, post: 10, nPre: 2, nPost: 1 });
  assert.deepEqual(AP.promedioPrePost([]), { pre: 0, post: 0, nPre: 0, nPost: 0 });
});

// ───────────────────────── íconos ─────────────────────────

test('íconos de Agenda: existen los 3 colores y las pantallas principales usan el blanco con la etiqueta "J. Agenda"', () => {
  ['blanco', 'negro', 'lima'].forEach((c) => assert.ok(fs.existsSync(path.join(RAIZ, 'img', 'jefe-agenda-logo-' + c + '.webp')), c));
  ['consultor.html', 'hub.html', 'rancho-seco-central-jefes.html', 'rim-central-jefes.html', 'optica-one-central-jefes.html'].forEach((f) => {
    const src = fs.readFileSync(path.join(RAIZ, f), 'utf8');
    assert.match(src, /icono:'jefe-agenda-logo-blanco'[^}]*desc:'J\. Agenda'/, f);
    assert.ok(src.includes("d.icono==='jefe-agenda-logo-blanco'"), f + ' debe ocultar el "JEFE 11" como los demás logos');
  });
  const nav = fs.readFileSync(path.join(RAIZ, 'js', 'jefes-nav.js'), 'utf8');
  assert.match(nav, /slug: 'jefe-agenda'[^}]*jefe-agenda-logo-negro[^}]*jefe-agenda-logo-blanco/);
});
