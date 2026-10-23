// Proceso recomendado de campaña del Jefe de Agenda (js/agenda-proceso.js) y sus íconos. Sin red ni costos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const AP = require('../js/agenda-proceso.js');

const RAIZ = path.join(__dirname, '..');
const dias = (arranque, plan, id) => { const f = AP.fechasDe(arranque, plan[id]); return [f.inicio, f.fin]; };

test('sin ajustes, las etapas caen en los días 1 al 18 recomendados alrededor del arranque (día 12)', () => {
  const plan = AP.planEfectivo({}, {});
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
  const plan = AP.planEfectivo({}, {});
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

test('lo que el usuario acomoda gana sobre lo recomendado, y solo en esa etapa', () => {
  const plan = AP.planEfectivo({ grabar: { d: -5, n: 4, u: 1 } }, {});
  assert.deepEqual(plan.grabar, { d: -5, n: 4, u: 1 });
  assert.deepEqual(plan.editar, AP.planEfectivo({}, {}).editar);
});

test('el promedio sale solo de las etapas que el usuario acomodó a mano (u:1)', () => {
  const prom = AP.promedios({
    c1: { estrategia: { d: -10, n: 5, u: 1 } },
    c2: { estrategia: { d: -10, n: 7, u: 1 }, grabar: { d: -6, n: 3, u: 1 }, editar: { d: -5, n: 9 } },
    c3: {},
  });
  assert.deepEqual(prom, { estrategia: 6, grabar: 3 }); // "editar" no lo acomodó nadie: no cuenta
  assert.deepEqual(AP.promedios({}), {});
  assert.deepEqual(AP.promedios(null), {});
});

test('con promedio, las etapas se vuelven a acomodar sin encimarse y el arranque no se mueve', () => {
  const plan = AP.planBase({ estrategia: 6, grabar: 3 });
  assert.equal(plan.programar.d, 0);
  assert.equal(plan.estrategia.n, 6);
  assert.equal(plan.grabar.n, 3);
  const fin = (id) => plan[id].d + plan[id].n - 1;
  // cada etapa empieza después de que termine la anterior
  const orden = AP.ETAPAS.map((e) => e.id);
  for (let i = 1; i < orden.length; i++) assert.ok(plan[orden[i]].d > fin(orden[i - 1]), orden[i] + ' no debe encimarse con ' + orden[i - 1]);
  // el hueco recomendado entre revisar (13) y optimizar (18) se conserva: 4 días
  assert.equal(plan.optimizar.d - fin('revisar') - 1, 4);
});

test('cada campaña guarda su plan al verse: acomodar otra campaña después no la mueve', () => {
  const foto = AP.instantanea({});
  assert.equal(Object.keys(foto).length, AP.ETAPAS.length);
  assert.deepEqual(foto.estrategia, { d: -10, n: 3 }); // sin "u": nadie la acomodó
  // otra campaña acomoda "estrategia" a 7 días -> el promedio cambia, pero la foto ya guardada se queda igual
  const prom = AP.promedios({ otra: { estrategia: { d: -10, n: 7, u: 1 } } });
  assert.deepEqual(AP.planEfectivo(foto, prom).estrategia, { d: -10, n: 3 });
  // una campaña nueva sí nace con el promedio aprendido
  assert.equal(AP.instantanea(prom).estrategia.n, 7);
});

test('mover y alargar respetan límites razonables', () => {
  assert.deepEqual(AP.mover({ d: -3, n: 2 }, 2), { d: -1, n: 2 });
  assert.deepEqual(AP.mover({ d: -3, n: 2 }, 100000), { d: 120, n: 2 });
  assert.deepEqual(AP.alargarHasta({ d: -3, n: 2 }, 0), { d: -3, n: 4 });
  assert.equal(AP.alargarHasta({ d: -3, n: 2 }, -10).n, 1); // nunca menos de 1 día
  assert.equal(AP.alargarHasta({ d: -3, n: 2 }, 9999).n, AP.MAX_DURACION);
  assert.deepEqual(AP.desdeFechas('2026-11-12', '2026-11-05', '2026-11-08'), { d: -7, n: 4 });
});

test('lo guardado se limpia: etapas desconocidas y números raros se descartan', () => {
  const limpio = AP.limpiarProceso({
    campanas: {
      c1: { grabar: { d: '-5', n: '3', u: 1 }, inventada: { d: 1, n: 1 }, editar: { d: 'x', n: 2 } },
      c2: { definir: { d: 1e9, n: -4 } },
      c3: 'texto',
    },
  });
  assert.deepEqual(limpio, { campanas: { c1: { grabar: { d: -5, n: 3, u: 1 } }, c2: { definir: { d: 120, n: 1 } } } });
  assert.deepEqual(AP.limpiarProceso(null), { campanas: {} });
  assert.deepEqual(AP.limpiarProceso('basura'), { campanas: {} });
});

test('las marcas del calendario son una por día de cada etapa', () => {
  const plan = AP.planEfectivo({}, {});
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
