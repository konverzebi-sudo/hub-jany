// Enfoque del Jefe de Resultados (api/_lib/enfoque.js): funciones puras, sin red ni costos.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../api/_lib/enfoque');

test('leerEnfoque ignora basura, "all" y recorta; deja pasar foco y menciones válidos', () => {
  assert.deepEqual(E.leerEnfoque(null), { foco: null, menciones: [] });
  assert.equal(E.leerEnfoque({ foco: { id: 'all' } }).foco, null);
  const r = E.leerEnfoque({
    foco: { id: 'c:abc', nombre: 'Campaña X', esCampana: true, campanaId: 'abc' },
    menciones: [{ tipo: 'producto', id: 'p1', nombre: 'Taller' }, { tipo: 'otra', id: 'x' }, { tipo: 'campana' }, null],
  });
  assert.equal(r.foco.esCampana, true);
  assert.equal(r.foco.campanaId, 'abc');
  assert.equal(r.menciones.length, 1);
  assert.equal(r.menciones[0].id, 'p1');
});

test('sufijoFoco: vacío con ecosistema completo y estable con un producto o campaña', () => {
  assert.equal(E.sufijoFoco(null), '');
  assert.equal(E.sufijoFoco({ id: 'all' }), '');
  assert.equal(E.sufijoFoco({ id: 'p1' }), '-p1');
  assert.equal(E.sufijoFoco({ id: 'c:abc 1' }), '-c_abc_1');
});

test('resolverSeleccion: la mención @ manda sobre la pastilla; campaña sobre producto', () => {
  const foco = { id: 'p1', nombre: 'Producto A', esCampana: false, esGrupo: false, productoId: 'p1' };
  assert.equal(E.resolverSeleccion({ foco, menciones: [] }).tipo, 'producto');
  assert.equal(E.resolverSeleccion({ foco, menciones: [] }).origen, 'pastilla');
  const conMencion = E.resolverSeleccion({ foco, menciones: [{ tipo: 'producto', id: 'p2', nombre: 'Producto B' }] });
  assert.equal(conMencion.productoId, 'p2');
  assert.equal(conMencion.origen, 'mencion');
  const camp = E.resolverSeleccion({ foco, menciones: [{ tipo: 'producto', id: 'p2', nombre: 'B' }, { tipo: 'campana', id: 'c1', nombre: 'Camp' }] });
  assert.equal(camp.tipo, 'campana');
  assert.equal(camp.campanaId, 'c1');
  assert.equal(E.haySeleccion(E.resolverSeleccion({ foco: null, menciones: [] })), false);
  const grupo = E.resolverSeleccion({ foco: { id: 'g:g1', nombre: 'Grupo', esGrupo: true, grupoId: 'g1' }, menciones: [] });
  assert.equal(grupo.tipo, 'grupo');
  assert.equal(grupo.grupoId, 'g1');
});

test('filtrarPorProducto: exacto primero; "Hub de Jefes" no jala "Capacitación + Hub de Jefes"; sin coincidencia no esconde nada', () => {
  const items = [{ nombre: 'Hub de Jefes' }, { nombre: 'Capacitación Grupal + Hub de Jefes' }, { nombre: 'Taller' }];
  const r = E.filtrarPorProducto(items, '', 'hub de jefes');
  assert.equal(r.length, 1);
  assert.equal(r[0].nombre, 'Hub de Jefes');
  assert.equal(E.filtrarPorProducto(items, '', 'Algo inexistente').length, 3);
  assert.equal(E.filtrarPorProducto(items, '', '').length, 3);
  const conId = E.filtrarPorProducto([{ nombre: 'X', producto_id: 'p9' }, { nombre: 'Y' }], 'p9', '');
  assert.equal(conId.length, 1);
});

test('filtrarPorGrupo deja lo del grupo y lo que no tiene grupo', () => {
  const items = [{ nombre: 'a', grupo_id: 'g1' }, { nombre: 'b', grupo_id: 'g2' }, { nombre: 'c' }];
  assert.deepEqual(E.filtrarPorGrupo(items, 'g1').map((x) => x.nombre), ['a', 'c']);
  assert.equal(E.filtrarPorGrupo(items, '').length, 3);
});

test('elegirCampana: la elegida, la de un producto, la de un grupo o la vigente de siempre', () => {
  const hoy = '2026-11-02';
  const campanas = [
    { id: 'c1', producto_id: 'p1', producto_nombre: 'Taller', fecha_inicio_activa: '2026-10-07', fecha_fin_activa: '2026-10-15' }, // vencida
    { id: 'c2', producto_id: 'p2', producto_nombre: 'Jefe IA', fecha_inicio_activa: '2026-11-10', fecha_fin_activa: '2026-11-30', grupo_id: 'g1' },
    { id: 'c3', producto_id: 'p3', producto_nombre: 'Otro', creadoEn: '2026-10-01' },
  ];
  assert.equal(E.elegirCampana(campanas, { campanaId: 'c1' }, hoy).id, 'c1');
  assert.equal(E.elegirCampana(campanas, { campanaId: 'nada' }, hoy), null);
  assert.equal(E.elegirCampana(campanas, { tipo: 'producto', productoId: 'p2', productoNombre: 'Jefe IA' }, hoy).id, 'c2');
  assert.equal(E.elegirCampana(campanas, { tipo: 'producto', productoId: 'zzz', productoNombre: 'Sin campaña' }, hoy), null);
  assert.equal(E.elegirCampana(campanas, { tipo: 'grupo', grupoId: 'g1' }, hoy).id, 'c2');
  // sin selección: la vigente más próxima (las vencidas no cuentan)
  assert.equal(E.elegirCampana(campanas, {}, hoy).id, 'c2');
  assert.equal(E.elegirCampana([], {}, hoy), null);
});

test('lineaFoco dice de qué proyecto se habla y avisa si no tiene campaña', () => {
  assert.equal(E.lineaFoco({ tipo: '' }), '');
  const l = E.lineaFoco({ tipo: 'producto', nombre: 'Taller', origen: 'pastilla' }, { sinCampana: true });
  assert.ok(/FOCO ELEGIDO ARRIBA/.test(l) && /Taller/.test(l) && /NO tiene campaña de temporada/.test(l));
  const m = E.lineaFoco({ tipo: 'campana', nombre: 'Camp', origen: 'mencion' }, {});
  assert.ok(/ETIQUETA @ DE ESTE MENSAJE/.test(m) && /CAMPAÑA DE TEMPORADA/.test(m));
});
