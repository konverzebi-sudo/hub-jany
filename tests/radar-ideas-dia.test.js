// Faro: ficha de audiencia (ADN + Temporada + 366 resumidos) e Idea del día.
// Sin red ni costos: Anthropic va simulado y se revisa lo que se le habría mandado.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./helpers/simulador');

const RADAR = 'api/consultor-radar.js';
const USO = { input_tokens: 100, output_tokens: 40 };
const FOCO = { id: 'p1', nombre: 'Taller', esGrupo: false };

const FICHA = JSON.stringify({
  quien_es: 'Emprendedora que quiere vender sin gastar horas en redes',
  dolores: ['DOLOR-FICHA-A', 'No sabe qué publicar'],
  deseos_y_aspiraciones: ['Vivir de su negocio'],
  motivaciones: ['Ver ventas esta semana'],
  dudas_y_objeciones: ['¿Y si no tengo tiempo?'],
  contenido_que_les_gusta: ['Historias reales'],
  como_hablarles: ['Cercano, sin tecnicismos'],
  momento_de_temporada: 'Viene el Buen Fin',
  angulos_366: ['ANGULO-366-A'],
  no_esta_en_tus_fuentes: ['Precios de la competencia'],
});
const IDEA = JSON.stringify({
  tema: 'Tres errores al arrancar tu semana de contenido',
  gancho: 'Este lunes no publiques sin hacer esto',
  formato: 'reel',
  como_hacerlo: 'Muestra tu calendario vacío y llénalo en pantalla.',
  por_que_te_sirve: 'Tu cliente ideal sufre por no saber qué publicar.',
  tendencia: { que: 'Crece el contenido de organización semanal', fuente: 'https://ejemplo.com/tendencia', verificada: true },
  post: {
    gancho: 'Este lunes no publiques sin hacer esto',
    caption: 'Antes de grabar nada, llena tu semana 📅 Guarda este reel y arma tu calendario. #TallerDemo #ContenidoConOrden #Calendario #Planeacion #Semana',
    guion: 'GANCHO: Este lunes no publiques sin hacer esto.\nDESARROLLO: Muestro mi calendario vacío y lo lleno con tres temas.\nCTA: Guarda este reel.',
    notas: 'Voz tranquila y directa. Muestra la pantalla del calendario. Dura unos 40 segundos.',
  },
  base: ['ADN', 'Tendencias del nicho'],
});
const POST = JSON.stringify({ post: {
  gancho: 'Gancho armado después',
  caption: 'Caption armado después #TallerDemo #A #B #C #D',
  guion: 'GANCHO: algo\nREMATE: algo más',
  notas: 'Notas armadas después',
} });

// Una respuesta según lo que se le pida: la ficha o la idea del día.
function responder(texto) {
  return (cuerpo) => S.respuestaJSON(texto(JSON.stringify(cuerpo)), USO)(cuerpo);
}
const SEGUN_PEDIDO = responder((c) => (c.includes('ESTÁS ARMANDO EL POST') ? POST : c.includes('ESTÁS EN LA IDEA DEL DÍA') ? IDEA : FICHA));

const DATOS = {
  'demo:brand-book.identidad': { nombre: 'Taller Demo', que_vendemos: 'ADN-IDENTIDAD-LARGA' },
  'demo:brand-book.audiencia': { cliente_ideal: 'ADN-AUDIENCIA-LARGA' },
  'demo:catalogo-productos': [{ id: 'p1', nombre: 'Taller', tipo: 'Servicio' }],
  'demo:temporada-campanas': [
    { id: 'c1', nombre: 'Buen Fin', temporada: 'Noviembre', producto_id: 'p1', producto_nombre: 'Taller', fecha_fin_activa: '2099-12-31', dm_dolor: 'DOLOR-TEMPORADA-X' },
    { id: 'c2', nombre: 'Campaña vieja', temporada: 'Mayo', producto_id: 'p1', producto_nombre: 'Taller', fecha_fin_activa: '2020-01-01', dm_dolor: 'DOLOR-CAMPANA-VIEJA' },
    { id: 'c3', nombre: 'Otro producto', producto_id: 'p9', producto_nombre: 'Otro', fecha_fin_activa: '2099-12-31', dm_dolor: 'DOLOR-DE-OTRO' },
  ],
  'demo:brand-book.366-comunicacion': { lista: [{ nombre: 'Taller', posicionamiento: 'POSICION-366-X', angulos_evergreen: [{ angulo: 'ANGULO-366-A' }] }] },
};

test('ficha-audiencia: sin ADN, Temporada ni 366 avisa y no llama a la IA', async () => {
  S.reiniciar({ datos: {}, respuesta: SEGUN_PEDIDO });
  const e = await S.llamar(RADAR, { modo: 'ficha-estado', cliente: 'demo' });
  assert.equal(e.codigo, 200);
  assert.equal(e.cuerpo.existe, false);
  assert.equal(e.cuerpo.sinFuentes, true);
  const r = await S.llamar(RADAR, { modo: 'ficha-audiencia', cliente: 'demo' });
  assert.equal(r.codigo, 400);
  assert.match(r.cuerpo.error, /Primero llena el ADN/);
  assert.equal(S.enviados.length, 0);
});

test('ficha-audiencia: manda ADN, Temporada y 366 del foco a Claude, la guarda y cuenta contra el tope', async () => {
  S.reiniciar({ datos: DATOS, respuesta: SEGUN_PEDIDO });
  const r = await S.llamar(RADAR, { modo: 'ficha-audiencia', cliente: 'demo', foco: FOCO });
  assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
  assert.equal(r.cuerpo.existe, true);
  assert.equal(r.cuerpo.desactualizada, false);
  assert.deepEqual(r.cuerpo.ficha.dolores, ['DOLOR-FICHA-A', 'No sabe qué publicar']);

  const enviado = JSON.stringify(S.enviados[0]);
  assert.ok(enviado.includes('ADN-IDENTIDAD-LARGA'), 'ADN');
  assert.ok(enviado.includes('DOLOR-TEMPORADA-X'), 'campaña vigente del producto');
  assert.ok(!enviado.includes('DOLOR-CAMPANA-VIEJA'), 'no una campaña ya terminada');
  assert.ok(!enviado.includes('DOLOR-DE-OTRO'), 'no la campaña de otro producto');
  assert.ok(enviado.includes('POSICION-366-X'), 'ficha 366 del producto');
  assert.ok(enviado.includes('Usa SOLO las fuentes de abajo'));
  assert.equal(S.enviados[0].tools, undefined, 'la ficha no busca en la web');

  const guardado = S.leerDato('demo:ficha-audiencia');
  assert.equal(guardado.p1.editada, false);
  assert.equal(guardado.p1.foco.nombre, 'Taller');
  assert.equal(S.registroUso('demo').length, 1);

  const e = await S.llamar(RADAR, { modo: 'ficha-estado', cliente: 'demo', foco: FOCO });
  assert.equal(e.cuerpo.existe, true);
  assert.equal(e.cuerpo.desactualizada, false);
  assert.equal(S.enviados.length, 1, 'leer la ficha no llama a la IA');
});

test('ficha-estado avisa cuando el ADN, la Temporada o el 366 cambiaron; ficha-guardar la deja editada', async () => {
  const vieja = { p1: { date: '1 oct 2026', fecha: '2026-10-01', foco: FOCO, huella: 'huella-vieja', editada: false, ficha: JSON.parse(FICHA) } };
  S.reiniciar({ datos: Object.assign({ 'demo:ficha-audiencia': vieja }, DATOS), respuesta: SEGUN_PEDIDO });
  const e = await S.llamar(RADAR, { modo: 'ficha-estado', cliente: 'demo', foco: FOCO });
  assert.equal(e.cuerpo.existe, true);
  assert.equal(e.cuerpo.desactualizada, true);

  const g = await S.llamar(RADAR, { modo: 'ficha-guardar', cliente: 'demo', foco: FOCO, ficha: { quien_es: 'Corregido a mano', dolores: 'uno\n- dos\n\n' } });
  assert.equal(g.codigo, 200);
  assert.equal(g.cuerpo.editada, true);
  assert.deepEqual(g.cuerpo.ficha.dolores, ['uno', 'dos']);
  assert.equal(g.cuerpo.desactualizada, true, 'sigue avisando que las fuentes cambiaron');
  assert.equal(S.leerDato('demo:ficha-audiencia').p1.huella, 'huella-vieja');
  assert.equal((await S.llamar(RADAR, { modo: 'ficha-guardar', cliente: 'demo', foco: FOCO, ficha: {} })).codigo, 400);
  assert.equal(S.enviados.length, 0);
});

test('la ficha de un foco no se mezcla con la de otro y se guardan máximo 12', async () => {
  const muchas = {};
  for (let i = 0; i < 12; i++) muchas['f' + i] = { date: 'd', fecha: '2026-09-' + String(10 + i), foco: { id: 'f' + i, nombre: 'F' + i }, huella: 'h', editada: false, ficha: JSON.parse(FICHA) };
  S.reiniciar({ datos: Object.assign({ 'demo:ficha-audiencia': muchas }, DATOS), respuesta: SEGUN_PEDIDO });
  const otro = await S.llamar(RADAR, { modo: 'ficha-estado', cliente: 'demo', foco: FOCO });
  assert.equal(otro.cuerpo.existe, false, 'p1 no tiene ficha propia');
  await S.llamar(RADAR, { modo: 'ficha-audiencia', cliente: 'demo', foco: FOCO });
  const g = S.leerDato('demo:ficha-audiencia');
  assert.equal(Object.keys(g).length, 12);
  assert.ok(g.p1);
  assert.ok(!g.f0, 'se borra la más vieja');
});

test('idea-del-dia con ficha: lee el resumen (no las fuentes completas), busca tendencias y guarda UNA idea por día y foco', async () => {
  const ficha = { p1: { date: '1 oct 2026', fecha: '2026-10-01', foco: FOCO, huella: 'x', editada: false, ficha: JSON.parse(FICHA) } };
  const previas = [{ id: 'i0', fecha: '2026-10-01', date: '1 oct 2026', foco: FOCO, idea: { tema: 'IDEA-PREVIA-NO-REPETIR', gancho: 'Gancho previo' } }];
  S.reiniciar({
    datos: Object.assign({ 'demo:ficha-audiencia': ficha, 'demo:radar-ideas-dia': previas, 'demo:radar-historial': [{ id: 'd1', tipo: 'diagnostico-general', date: '2 oct 2026', foco: FOCO, diagnostico: 'DIAGNOSTICO-DEL-FARO' }] }, DATOS),
    respuesta: SEGUN_PEDIDO,
  });
  const r = await S.llamar(RADAR, { modo: 'idea-del-dia', cliente: 'demo', foco: FOCO });
  assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
  assert.equal(r.cuerpo.generada, true);
  assert.equal(r.cuerpo.idea.idea.tema, 'Tres errores al arrancar tu semana de contenido');
  assert.equal(r.cuerpo.idea.conFicha, true);

  const enviado = JSON.stringify(S.enviados[0]);
  assert.ok(enviado.includes('FICHA DE AUDIENCIA Y MERCADO'));
  assert.ok(enviado.includes('DOLOR-FICHA-A'));
  assert.ok(!enviado.includes('ADN-IDENTIDAD-LARGA'), 'con ficha no se vuelve a mandar el ADN completo');
  assert.ok(!enviado.includes('DOLOR-TEMPORADA-X'), 'ni la Temporada completa');
  assert.ok(enviado.includes('DIAGNOSTICO-DEL-FARO'), 'sí lo que ya aprendió el Faro');
  assert.ok(enviado.includes('IDEA-PREVIA-NO-REPETIR'), 'ideas anteriores para no repetir');
  assert.ok(enviado.includes('FECHA DE HOY: '));
  assert.ok(enviado.includes('no inventes cifras'), 'regla de no inventar');
  assert.ok(S.enviados[0].tools.some((t) => t.name === 'web_search'), 'busca tendencias del nicho en la web');
  assert.ok(enviado.includes('POST EN EL FORMATO DEL JEFE DE CONTENIDO'), 'pide el post en el formato de Contenido');
  assert.ok(enviado.includes('EXACTAMENTE 5 hashtags'));
  assert.ok(enviado.includes('NOMBRE DE LA MARCA (para el primer hashtag): Taller Demo'), 'el nombre de la marca sale del ADN');
  assert.equal(r.cuerpo.idea.idea.post.gancho, 'Este lunes no publiques sin hacer esto');
  assert.match(r.cuerpo.idea.idea.post.guion, /DESARROLLO/);

  const guardado = S.leerDato('demo:radar-ideas-dia');
  assert.equal(guardado.length, 2);
  assert.equal(guardado[1].foco.id, 'p1');
  assert.equal(S.leerDato('demo:radar-historial').length, 1, 'no se mete en el historial que leen Contenido y Anuncios');
  assert.equal(S.registroUso('demo').length, 1);

  // Mismo día y mismo foco: devuelve la guardada sin gastar tokens.
  const otra = await S.llamar(RADAR, { modo: 'idea-del-dia', cliente: 'demo', foco: FOCO });
  assert.equal(otra.cuerpo.generada, false);
  assert.equal(otra.cuerpo.idea.id, r.cuerpo.idea.id);
  assert.equal(S.enviados.length, 1);
  const estado = await S.llamar(RADAR, { modo: 'ideas-dia-estado', cliente: 'demo', foco: FOCO });
  assert.equal(estado.cuerpo.idea.id, r.cuerpo.idea.id);
  assert.equal(estado.cuerpo.ficha.existe, true);

  // Otro foco: otra idea. Forzar reemplaza la de hoy en vez de duplicarla.
  const sinFoco = await S.llamar(RADAR, { modo: 'ideas-dia-estado', cliente: 'demo', foco: { id: 'all', nombre: '' } });
  assert.equal(sinFoco.cuerpo.idea, null, 'la idea de un producto no cuenta para el ecosistema');
  await S.llamar(RADAR, { modo: 'idea-del-dia', cliente: 'demo', foco: FOCO, forzar: true });
  assert.equal(S.enviados.length, 2);
  assert.equal(S.leerDato('demo:radar-ideas-dia').filter((e) => e.foco.id === 'p1' && e.fecha === r.cuerpo.idea.fecha).length, 1);
});

test('idea-del-dia sin ficha usa las fuentes completas; sin nada que leer avisa sin llamar a la IA', async () => {
  S.reiniciar({ datos: DATOS, respuesta: SEGUN_PEDIDO });
  const r = await S.llamar(RADAR, { modo: 'idea-del-dia', cliente: 'demo', foco: FOCO });
  assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
  assert.equal(r.cuerpo.idea.conFicha, false);
  const enviado = JSON.stringify(S.enviados[0]);
  assert.ok(enviado.includes('ADN-IDENTIDAD-LARGA'));
  assert.ok(enviado.includes('DOLOR-TEMPORADA-X'));
  assert.ok(enviado.includes('POSICION-366-X'));

  S.reiniciar({ datos: {}, respuesta: SEGUN_PEDIDO });
  const vacio = await S.llamar(RADAR, { modo: 'idea-del-dia', cliente: 'demo' });
  assert.equal(vacio.codigo, 400);
  assert.match(vacio.cuerpo.error, /Primero llena el ADN/);
  assert.equal(S.enviados.length, 0);
});

test('los números propios y el brief de estilo del foco entran a la idea del día', async () => {
  S.reiniciar({
    datos: Object.assign({
      'demo:radar-mis-numeros': [{ id: 'n1', date: '5 oct 2026', foco: FOCO, texto: 'SEGUIDORES: 1,200 (+40)' }],
      'demo:radar-estilo': [{ id: 'e1', date: '6 oct 2026', foco: FOCO, brief: { resumen: 'BRIEF-DE-ESTILO-X' } }],
    }, DATOS),
    respuesta: SEGUN_PEDIDO,
  });
  await S.llamar(RADAR, { modo: 'idea-del-dia', cliente: 'demo', foco: FOCO });
  const enviado = JSON.stringify(S.enviados[0]);
  assert.ok(enviado.includes('SEGUIDORES: 1,200 (+40)'));
  assert.ok(enviado.includes('BRIEF-DE-ESTILO-X'));
});

test('con el tope de tokens lleno: la IA responde 402 tal cual, y leer lo guardado sigue funcionando', async () => {
  const LLENO = { cicloInicio: new Date().toISOString(), usadoCicloUSD: 99, paquetes: [], pagos: [] };
  S.reiniciar({ datos: Object.assign({ 'demo:saldo': LLENO }, DATOS), respuesta: SEGUN_PEDIDO });
  for (const modo of ['idea-del-dia', 'ficha-audiencia']) {
    const r = await S.llamar(RADAR, { modo, cliente: 'demo', foco: FOCO });
    assert.equal(r.codigo, 402, modo);
    assert.equal(r.cuerpo.tope, true);
  }
  assert.equal(S.enviados.length, 0);
  assert.equal((await S.llamar(RADAR, { modo: 'ideas-dia-estado', cliente: 'demo', foco: FOCO })).codigo, 200);
  assert.equal((await S.llamar(RADAR, { modo: 'ficha-estado', cliente: 'demo', foco: FOCO })).codigo, 200);
  assert.equal((await S.llamar(RADAR, { modo: 'ficha-guardar', cliente: 'demo', foco: FOCO, ficha: { quien_es: 'x' } })).codigo, 200);
});

test('si el modelo no devuelve una idea o una ficha utilizable: 502 y no se guarda nada', async () => {
  S.reiniciar({ datos: DATOS, respuesta: S.respuestaJSON('Hoy no se me ocurrió nada, perdón.', USO) });
  const r = await S.llamar(RADAR, { modo: 'idea-del-dia', cliente: 'demo', foco: FOCO });
  assert.equal(r.codigo, 502);
  assert.equal(S.leerDato('demo:radar-ideas-dia'), null);
  const f = await S.llamar(RADAR, { modo: 'ficha-audiencia', cliente: 'demo', foco: FOCO });
  assert.equal(f.codigo, 502);
  assert.equal(S.leerDato('demo:ficha-audiencia'), null);
});

test('normalizarIdea acota textos y exige tema y gancho', () => {
  const P = S.cargar(RADAR)._probar;
  assert.equal(P.normalizarIdea({ tema: 'Solo tema' }), null);
  assert.equal(P.normalizarIdea('texto'), null);
  const i = P.normalizarIdea({ tema: 'T', gancho: 'G', como_hacerlo: 'x'.repeat(5000), tendencia: { que: 'q', verificada: 'sí' }, base: ['ADN', 5, '  Faro '] });
  assert.equal(i.como_hacerlo.length, 900);
  assert.equal(i.tendencia.verificada, false, 'solo cuenta verificada si es exactamente true');
  assert.deepEqual(i.base, ['ADN', 'Faro']);
});

test('campanasDelFoco: producto y grupo toman sus campañas vigentes; todo el hub, las vigentes de todos', () => {
  const { campanasDelFoco } = require('../api/_lib/ficha-audiencia');
  const camps = DATOS['demo:temporada-campanas'].concat([{ id: 'c4', nombre: 'Del grupo', grupo_id: 'g1', fecha_fin_activa: '' }]);
  const ids = (foco) => campanasDelFoco(camps, foco, '2026-11-01').map((c) => c.id);
  assert.deepEqual(ids({ id: 'p1', nombre: 'Taller', esGrupo: false }), ['c1']);
  assert.deepEqual(ids({ id: 'g:g1', nombre: 'Grupo', esGrupo: true }), ['c4']);
  assert.deepEqual(ids({ id: 'all', nombre: '', esGrupo: false }), ['c1', 'c3', 'c4']);
  assert.deepEqual(ids({ id: 'p7', nombre: 'Sin campaña', esGrupo: false }), []);
});

test('post-de-idea arma el post de una idea que no lo trae, sin buscar en la web y sin repetir si ya existe', async () => {
  const sinPost = { id: 'i1', fecha: '2026-11-17', date: '17 nov 2026', foco: { id: 'all', nombre: '' }, idea: { tema: 'Tema viejo', gancho: 'Gancho viejo', formato: 'reel', como_hacerlo: 'Lo que se hacía antes', tendencia: { que: 'Tendencia vieja', fuente: '', verificada: false } } };
  S.reiniciar({ datos: Object.assign({ 'demo:radar-ideas-dia': [sinPost] }, DATOS), respuesta: SEGUN_PEDIDO });
  assert.equal((await S.llamar(RADAR, { modo: 'post-de-idea', cliente: 'demo', ideaId: 'no-existe' })).codigo, 404);
  assert.equal(S.enviados.length, 0);

  const r = await S.llamar(RADAR, { modo: 'post-de-idea', cliente: 'demo', ideaId: 'i1' });
  assert.equal(r.codigo, 200, JSON.stringify(r.cuerpo));
  assert.equal(r.cuerpo.generada, true);
  assert.equal(r.cuerpo.idea.idea.post.caption, 'Caption armado después #TallerDemo #A #B #C #D');
  const enviado = JSON.stringify(S.enviados[0]);
  assert.ok(enviado.includes('TEMA: Tema viejo'));
  assert.ok(enviado.includes('CÓMO HACERLO: Lo que se hacía antes'));
  assert.ok(enviado.includes('NOMBRE DE LA MARCA (para el primer hashtag): Taller Demo'));
  assert.equal(S.enviados[0].tools, undefined, 'armar el post no busca en la web');
  assert.equal(S.leerDato('demo:radar-ideas-dia')[0].idea.post.gancho, 'Gancho armado después', 'queda guardado en la idea');
  assert.equal(S.registroUso('demo').length, 1);

  const otra = await S.llamar(RADAR, { modo: 'post-de-idea', cliente: 'demo', ideaId: 'i1' });
  assert.equal(otra.cuerpo.generada, false);
  assert.equal(S.enviados.length, 1, 'si ya tiene post no vuelve a llamar a la IA');
});

test('post-de-idea: 402 con el tope lleno, 502 si el modelo no devuelve un post, 400 sin nada que leer', async () => {
  const sinPost = { id: 'i1', fecha: '2026-11-17', date: '17 nov 2026', foco: { id: 'all', nombre: '' }, idea: { tema: 'T', gancho: 'G', tendencia: {} } };
  const LLENO = { cicloInicio: new Date().toISOString(), usadoCicloUSD: 99, paquetes: [], pagos: [] };
  S.reiniciar({ datos: Object.assign({ 'demo:saldo': LLENO, 'demo:radar-ideas-dia': [sinPost] }, DATOS), respuesta: SEGUN_PEDIDO });
  const tope = await S.llamar(RADAR, { modo: 'post-de-idea', cliente: 'demo', ideaId: 'i1' });
  assert.equal(tope.codigo, 402);
  assert.equal(S.enviados.length, 0);

  S.reiniciar({ datos: Object.assign({ 'demo:radar-ideas-dia': [sinPost] }, DATOS), respuesta: S.respuestaJSON('No pude.', USO) });
  const mal = await S.llamar(RADAR, { modo: 'post-de-idea', cliente: 'demo', ideaId: 'i1' });
  assert.equal(mal.codigo, 502);
  assert.equal(S.leerDato('demo:radar-ideas-dia')[0].idea.post, undefined);

  S.reiniciar({ datos: { 'demo:radar-ideas-dia': [sinPost] }, respuesta: SEGUN_PEDIDO });
  const vacio = await S.llamar(RADAR, { modo: 'post-de-idea', cliente: 'demo', ideaId: 'i1' });
  assert.equal(vacio.codigo, 400);
  assert.equal(S.enviados.length, 0);
});

test('normalizarPost acota los textos y exige guion o caption', () => {
  const P = S.cargar(RADAR)._probar;
  assert.equal(P.normalizarPost({ gancho: 'solo gancho' }), null);
  assert.equal(P.normalizarPost('texto'), null);
  const p = P.normalizarPost({ gancho: ' G ', caption: 'c'.repeat(5000), guion: 'g', notas: 5 });
  assert.equal(p.gancho, 'G');
  assert.equal(p.caption.length, 2200);
  assert.equal(p.notas, '');
});
