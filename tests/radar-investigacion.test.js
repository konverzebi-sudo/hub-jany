// Jefe del Faro: investigación externa dentro del hub (web pública, capturas, lectura automática),
// foco por producto, brief de estilo y chat. Sin red ni costos: Anthropic y el proveedor van simulados.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./helpers/simulador');

const radar = S.cargar('api/consultor-radar.js');
const P = radar._probar;
const USO = { input_tokens: 100, output_tokens: 40 };
const RADAR = 'api/consultor-radar.js';
const ADN = { 'demo:brand-book.identidad': { nombre: 'Negocio Demo' } };

// fetch de pruebas: el proveedor de lectura se simula aquí; todo lo demás sigue en el simulador (Anthropic o falla).
const fetchSimulador = global.fetch;
const llamadasProveedor = [];
function simularProveedor(respuestaPorRuta) {
  global.fetch = async (url, opciones) => {
    if (String(url).startsWith('https://api.scrapecreators.com')) {
      llamadasProveedor.push({ url: String(url), llave: opciones.headers['x-api-key'] });
      const ruta = new URL(url).pathname;
      const r = respuestaPorRuta[ruta];
      if (!r) return { ok: false, status: 404, json: async () => ({ message: 'no existe' }) };
      return { ok: true, status: 200, json: async () => r };
    }
    return fetchSimulador(url, opciones);
  };
}
test.afterEach(() => {
  global.fetch = fetchSimulador;
  delete process.env.SCRAPECREATORS_API_KEY;
  delete process.env.RADAR_LECTURA_MAX_MES;
  llamadasProveedor.length = 0;
});

const IG = { items: [
  { caption: { text: 'Primer post\nsegunda línea' }, like_count: 100, comment_count: 10, taken_at: 1760000000, play_count: 5000, media_type: 2, product_type: 'clips' },
  { caption: { text: 'Otro post' }, like_count: 300, comment_count: 30, taken_at: 1760604800, media_type: 8 },
] };

// ── puras ──

test('analizarLinkRed: entiende perfiles de cada red y descarta lo que no es un perfil', () => {
  assert.deepEqual(P.analizarLinkRed('https://www.instagram.com/mrbeast/'), { red: 'instagram', handle: 'mrbeast' });
  assert.equal(P.analizarLinkRed('https://www.instagram.com/p/ABC123/'), null);
  assert.deepEqual(P.analizarLinkRed('https://www.tiktok.com/@santi_skss'), { red: 'tiktok', handle: 'santi_skss' });
  assert.equal(P.analizarLinkRed('https://www.tiktok.com/discover'), null);
  assert.deepEqual(P.analizarLinkRed('facebook.com/mimarca'), { red: 'facebook', handle: 'mimarca', url: 'https://www.facebook.com/mimarca' });
  assert.deepEqual(P.analizarLinkRed('https://www.youtube.com/@MrBeast'), { red: 'youtube', handle: 'MrBeast' });
  assert.equal(P.analizarLinkRed('https://example.com/algo'), null);
  assert.equal(P.analizarLinkRed('no es un link'), null);
});

test('bloqueDeCuenta: arma el mismo formato que el prompt de Chrome, sin inventar lo que no hay', () => {
  const texto = P.bloqueDeCuenta({ handle: 'mrbeast', red: 'instagram', posts: P.normalizarPostsInstagram(IG) });
  assert.match(texto, /^CUENTA: @mrbeast/);
  assert.match(texto, /FUENTE: lectura automática de Instagram/);
  assert.match(texto, /CADA CUÁNTO PUBLICAN: aprox\. 1\.0 publicaciones por semana/);
  assert.match(texto, /FORMATOS USADOS: reel x1, carrusel x1/);
  assert.match(texto, /promedio por publicación: 200 me gusta, 20 comentarios, 5,000 vistas/);
  assert.match(texto, /HOOKS USADOS[\s\S]*- Primer post\n- Otro post/);
  assert.match(texto, /COMENTARIOS DESTACADOS del público: no disponible/);
  assert.doesNotMatch(texto, /TIPO DE CUENTA|TEMAS QUE REPITE/, 'esos campos los deduce el diagnóstico, no se inventan aquí');
});

test('normalizadores de TikTok, Facebook y YouTube (RSS)', () => {
  const tt = P.normalizarPostsTikTok({ aweme_list: [{ desc: 'hola', create_time: 1760000000, statistics: { digg_count: 5, comment_count: 2, play_count: 90 } }] });
  assert.deepEqual(tt[0], { fecha: 1760000000, texto: 'hola', likes: 5, comentarios: 2, vistas: 90, tipo: 'video' });
  const fb = P.normalizarPostsFacebook({ posts: [{ text: 'post', publishTime: 1760000000, reactionCount: 7, commentCount: 1, topComments: [{ text: 'qué bien' }] }] });
  assert.equal(fb[0].likes, 7);
  assert.deepEqual(fb[0].top, ['qué bien']);
  const xml = '<feed><title>Canal</title><entry><yt:videoId>x</yt:videoId><title>Video &amp; más</title><published>2026-10-01T10:00:00+00:00</published><media:group><media:description>Descripción</media:description><media:community><media:starRating count="12"/><media:statistics views="345"/></media:community></media:group></entry></feed>';
  const yt = P.leerRssYouTube(xml);
  assert.equal(yt.length, 1);
  assert.equal(yt[0].texto, 'Video & más — Descripción');
  assert.equal(yt[0].vistas, 345);
  assert.equal(yt[0].likes, 12);
});

test('foco: ecosistema completo ve todo; un producto solo ve lo suyo (y lo viejo sin foco cuenta como ecosistema)', () => {
  assert.deepEqual(P.normalizarFoco(null), { id: 'all', nombre: '', esGrupo: false });
  assert.deepEqual(P.normalizarFoco({ id: 'p1', nombre: 'Taller', esGrupo: false }), { id: 'p1', nombre: 'Taller', esGrupo: false });
  assert.equal(P.normalizarFoco({ id: 'p1', nombre: '' }).id, 'all');
  assert.equal(P.lineaFoco(P.normalizarFoco(null)), '');
  assert.match(P.lineaFoco({ id: 'p1', nombre: 'Taller', esGrupo: false }), /PRODUCTO O SERVICIO "Taller"/);
  const items = [
    { tipo: 'diagnostico-general', n: 1 },
    { tipo: 'diagnostico-general', n: 2, foco: { id: 'p1' } },
    { tipo: 'diagnostico-general', n: 3, foco: { id: 'p2' } },
  ];
  assert.equal(P.ultimaEntradaPorTipo(items, 'diagnostico-general', 'all').n, 3);
  assert.equal(P.ultimaEntradaPorTipo(items, 'diagnostico-general', 'p1').n, 2);
  assert.equal(P.ultimaEntradaPorTipo(items, 'diagnostico-general', 'p9'), null);
});

// ── endpoint ──

test('estado-lectura: sin llave del proveedor solo YouTube; con llave, las demás redes', async () => {
  S.reiniciar({ datos: ADN, respuesta: S.respuestaJSON('x', USO) });
  let r = await S.llamar(RADAR, { modo: 'estado-lectura', cliente: 'demo' });
  assert.deepEqual(r.cuerpo.redes, { youtube: true, instagram: false, tiktok: false, facebook: false });
  assert.equal(r.cuerpo.limite, 60);
  process.env.SCRAPECREATORS_API_KEY = 'k';
  process.env.RADAR_LECTURA_MAX_MES = '5';
  r = await S.llamar(RADAR, { modo: 'estado-lectura', cliente: 'demo' });
  assert.equal(r.cuerpo.redes.instagram, true);
  assert.equal(r.cuerpo.limite, 5);
  assert.equal(S.enviados.length, 0, 'no usa IA');
});

test('lectura-automatica sin llave: avisa con 🔒 y no llama a nadie ni gasta cuota', async () => {
  S.reiniciar({ datos: ADN, respuesta: S.respuestaJSON('x', USO) });
  simularProveedor({});
  const r = await S.llamar(RADAR, { modo: 'lectura-automatica', cliente: 'demo', cuentas: [{ link: 'https://www.instagram.com/mrbeast' }] });
  assert.equal(r.codigo, 200);
  assert.equal(r.cuerpo.leidas, 0);
  assert.match(r.cuerpo.texto, /🔒 @mrbeast — no accesible \(la lectura automática de Instagram no está activada/);
  assert.equal(llamadasProveedor.length, 0);
  assert.equal(S.leerDato('demo:radar-lectura-uso'), null);
});

test('lectura-automatica con llave: lee, cuenta la cuota y respeta el tope mensual', async () => {
  process.env.SCRAPECREATORS_API_KEY = 'llave-secreta';
  process.env.RADAR_LECTURA_MAX_MES = '2';
  S.reiniciar({ datos: ADN, respuesta: S.respuestaJSON('x', USO) });
  simularProveedor({ '/v2/instagram/user/posts': IG });
  const uno = await S.llamar(RADAR, { modo: 'lectura-automatica', cliente: 'demo', cuentas: [{ link: 'https://www.instagram.com/mrbeast' }] });
  assert.equal(uno.cuerpo.leidas, 1);
  assert.match(uno.cuerpo.texto, /CUENTA: @mrbeast/);
  assert.equal(llamadasProveedor[0].llave, 'llave-secreta');
  assert.match(llamadasProveedor[0].url, /handle=mrbeast/);
  assert.equal(S.leerDato('demo:radar-lectura-uso').usadas, 1);

  const dos = await S.llamar(RADAR, { modo: 'lectura-automatica', cliente: 'demo', cuentas: [{ link: 'https://www.instagram.com/a' }, { link: 'https://www.instagram.com/b' }] });
  assert.equal(dos.codigo, 429, 'usadas 1 + 2 nuevas supera el tope de 2');
  assert.match(dos.cuerpo.error, /1 de 2 lecturas/);
  assert.equal(llamadasProveedor.length, 1, 'no se llamó al proveedor otra vez');
});

test('lectura-automatica: una cuenta que falla en el proveedor sale con 🔒 y no gasta cuota', async () => {
  process.env.SCRAPECREATORS_API_KEY = 'k';
  S.reiniciar({ datos: ADN, respuesta: S.respuestaJSON('x', USO) });
  simularProveedor({});
  const r = await S.llamar(RADAR, { modo: 'lectura-automatica', cliente: 'demo', cuentas: [{ link: 'https://www.tiktok.com/@nadie' }] });
  assert.equal(r.cuerpo.leidas, 0);
  assert.match(r.cuerpo.texto, /🔒 @nadie — no accesible \(la cuenta no existe o es privada\)/);
  assert.equal(S.leerDato('demo:radar-lectura-uso'), null);
});

test('lectura-automatica y estado-lectura NO se bloquean con el tope de tokens (no usan IA)', async () => {
  const LLENO = { cicloInicio: new Date().toISOString(), usadoCicloUSD: 99, paquetes: [], pagos: [] };
  S.reiniciar({ datos: { 'rim:saldo': LLENO }, respuesta: S.respuestaJSON('x', USO) });
  assert.equal((await S.llamar(RADAR, { modo: 'estado-lectura', cliente: 'rim' })).codigo, 200);
  assert.equal((await S.llamar(RADAR, { modo: 'lectura-automatica', cliente: 'rim', cuentas: [{ link: 'https://www.instagram.com/x' }] })).codigo, 200);
  for (const modo of ['chat', 'investigar-web', 'brief-estilo', 'analisis-capturas']) {
    const r = await S.llamar(RADAR, { modo, cliente: 'rim' });
    assert.equal(r.codigo, 402, modo);
    assert.equal(r.cuerpo.tope, true);
  }
  assert.equal(S.enviados.length, 0);
});

test('investigar-web: usa web_search y web_fetch, manda los links y el foco, y exige algo que investigar', async () => {
  S.reiniciar({ datos: { ...ADN, 'demo:catalogo-productos': [{ id: 'p1', nombre: 'Taller', tipo: 'Taller', notas: 'En vivo' }] }, respuesta: S.respuestaJSON('CUENTA: Marca\nFUENTE: https://x.com', USO) });
  assert.equal((await S.llamar(RADAR, { modo: 'investigar-web', cliente: 'demo' })).codigo, 400);
  const r = await S.llamar(RADAR, { modo: 'investigar-web', cliente: 'demo', consulta: 'competidores de pasteles', links: ['https://www.instagram.com/marca'], foco: { id: 'p1', nombre: 'Taller', esGrupo: false } });
  assert.equal(r.codigo, 200);
  assert.match(r.cuerpo.texto, /CUENTA: Marca/);
  const cuerpo = S.enviados[0];
  assert.deepEqual(cuerpo.tools.map((t) => t.name), ['web_search', 'web_fetch']);
  const prompt = cuerpo.messages[0].content;
  assert.match(prompt, /competidores de pasteles/);
  assert.match(prompt, /instagram\.com\/marca/);
  assert.match(prompt, /FOCO ELEGIDO ARRIBA[\s\S]*"Taller"/);
  assert.match(prompt, /DATOS DEL PRODUCTO EN FOCO[\s\S]*En vivo/);
  assert.match(prompt, /🔒 @cuenta — no accesible/);
});

test('analisis-capturas: manda las imágenes como imágenes y rechaza lo que no sirve', async () => {
  S.reiniciar({ datos: ADN, respuesta: S.respuestaJSON('CUENTA: @x', USO) });
  assert.equal((await S.llamar(RADAR, { modo: 'analisis-capturas', cliente: 'demo', imagenes: [] })).codigo, 400);
  assert.equal((await S.llamar(RADAR, { modo: 'analisis-capturas', cliente: 'demo', imagenes: [{ media_type: 'application/pdf', data: 'A'.repeat(500) }] })).codigo, 400);
  assert.equal((await S.llamar(RADAR, { modo: 'analisis-capturas', cliente: 'demo', imagenes: [{ media_type: 'image/jpeg', data: 'A'.repeat(3000000) }, { media_type: 'image/jpeg', data: 'A'.repeat(3000000) }] })).codigo, 413);
  assert.equal(S.enviados.length, 0);
  const r = await S.llamar(RADAR, { modo: 'analisis-capturas', cliente: 'demo', imagenes: [{ media_type: 'image/jpeg', data: 'A'.repeat(500) }], nota: 'son de @x' });
  assert.equal(r.codigo, 200);
  const contenido = S.enviados[0].messages[0].content;
  assert.equal(contenido[0].type, 'image');
  assert.equal(contenido[0].source.media_type, 'image/jpeg');
  assert.match(contenido[contenido.length - 1].text, /nunca lo deduzcas ni lo inventes/);
  assert.match(contenido[contenido.length - 1].text, /son de @x/);
});

test('diagnóstico y análisis por foco: cada producto trabaja con SU diagnóstico', async () => {
  S.reiniciar({ datos: ADN, respuesta: S.respuestaJSON('Diagnóstico del producto', USO) });
  const foco = { id: 'p1', nombre: 'Taller', esGrupo: false };
  await S.llamar(RADAR, { modo: 'diagnostico-general', cliente: 'demo', extra: 'CUENTA: @a', foco });
  await S.llamar(RADAR, { modo: 'diagnostico-general', cliente: 'demo', extra: 'CUENTA: @b' });
  const historial = S.leerDato('demo:radar-historial');
  assert.deepEqual(historial.map((h) => h.foco.id), ['p1', 'all']);

  // Análisis del producto: parte del diagnóstico de p1 (aunque el último sea el de ecosistema).
  S.reiniciar({ datos: { ...ADN, 'demo:radar-historial': historial }, respuesta: S.respuestaJSON('{"que_funciona":["a"]}\n---INSIGHTS-Y-IDEAS---\n[{"insight":"i","uso":"ambos","prioridad":"alta"}]', USO) });
  const r = await S.llamar(RADAR, { modo: 'analisis-general', cliente: 'demo', foco });
  assert.equal(r.codigo, 200);
  assert.match(S.enviados[0].messages[0].content, /Diagnóstico del producto/);
  const guardado = S.leerDato('demo:radar-historial');
  assert.equal(guardado[guardado.length - 1].foco.id, 'p1');
  // Un producto sin diagnóstico propio no hereda el de otro.
  const otro = await S.llamar(RADAR, { modo: 'analisis-general', cliente: 'demo', foco: { id: 'p9', nombre: 'Otro', esGrupo: false } });
  assert.equal(otro.codigo, 400);
});

test('brief-estilo: se guarda en radar-estilo y NO toca radar-historial (Contenido y Anuncios leen su última entrada)', async () => {
  const diag = { id: 'd1', tipo: 'diagnostico-general', date: '1 oct 2026', foco: { id: 'all', nombre: '' }, diagnostico: 'Todos abren con una promesa', porCuenta: {} };
  const brief = { resumen: 'r', voz_y_tono_a_tomar: ['a'], hooks_que_funcionan: ['b'], formatos: ['c'], temas: ['d'], que_no_copiar: ['e'], como_mezclarlo_con_la_marca: 'f', para_contenido: ['g'], para_anuncios: ['h'] };
  S.reiniciar({ datos: { ...ADN, 'demo:radar-historial': [diag] }, respuesta: S.respuestaJSON(JSON.stringify(brief), USO) });
  const r = await S.llamar(RADAR, { modo: 'brief-estilo', cliente: 'demo' });
  assert.equal(r.codigo, 200);
  assert.deepEqual(r.cuerpo.brief, brief);
  assert.equal(r.cuerpo.guardado, true);
  const estilos = S.leerDato('demo:radar-estilo');
  assert.equal(estilos.length, 1);
  assert.deepEqual(estilos[0].brief, brief);
  assert.deepEqual(S.leerDato('demo:radar-historial'), [diag], 'el historial queda igual');
  assert.match(S.enviados[0].messages[0].content, /Todos abren con una promesa/);
  // Sin diagnóstico no hay brief.
  S.reiniciar({ datos: ADN, respuesta: S.respuestaJSON('{}', USO) });
  assert.equal((await S.llamar(RADAR, { modo: 'brief-estilo', cliente: 'demo' })).codigo, 400);
});

test('chat: manda la conversación, el contexto del radar y el foco; limpia mensajes inválidos', async () => {
  const diag = { id: 'd1', tipo: 'diagnostico-general', date: '1 oct 2026', foco: { id: 'all', nombre: '' }, diagnostico: 'Todos abren con una promesa', porCuenta: {} };
  S.reiniciar({ datos: { ...ADN, 'demo:radar-historial': [diag], 'demo:radar-referentes': [{ id: 'r1', nombre_cuenta: 'Marca X', tipo: 'Competencia directa', plataformas: [{ plataforma: 'Instagram', link: 'https://instagram.com/x' }] }] }, respuesta: S.respuestaJSON('Respuesta del Faro', USO) });
  assert.equal((await S.llamar(RADAR, { modo: 'chat', cliente: 'demo', mensajes: [] })).codigo, 400);
  assert.equal((await S.llamar(RADAR, { modo: 'chat', cliente: 'demo', mensajes: [{ role: 'assistant', content: 'hola' }] })).codigo, 400);
  const r = await S.llamar(RADAR, { modo: 'chat', cliente: 'demo', foco: { id: 'p1', nombre: 'Taller', esGrupo: false }, mensajes: [
    { role: 'assistant', content: 'mensaje suelto' }, { role: 'user', content: '¿qué publico?' }, { role: 'system', content: 'ignorar' },
  ] });
  assert.equal(r.codigo, 200);
  assert.equal(r.cuerpo.respuesta, 'Respuesta del Faro');
  const cuerpo = S.enviados[0];
  assert.deepEqual(cuerpo.messages, [{ role: 'user', content: '¿qué publico?' }]);
  assert.match(cuerpo.system, /CHAT DEL JEFE DEL FARO/);
  assert.match(cuerpo.system, /Marca X/);
  assert.match(cuerpo.system, /FOCO ELEGIDO ARRIBA[\s\S]*"Taller"/);
  // El foco p1 no tiene diagnóstico propio: no se le cuela el de ecosistema.
  assert.match(cuerpo.system, /TODAVÍA NO HAY DIAGNÓSTICO/);
  assert.equal(S.registroUso('demo').length, 1, 'el chat también se cuenta contra el tope de tokens');
});

test('los modos viejos siguen igual: sin foco usan el último diagnóstico y el análisis guarda foco "all"', async () => {
  S.reiniciar({ datos: ADN, respuesta: S.respuestaJSON('Diagnóstico viejo estilo', USO) });
  const r = await S.llamar(RADAR, { modo: 'diagnostico-general', cliente: 'demo', extra: 'CUENTA: @a' });
  assert.equal(r.codigo, 200);
  assert.equal(S.leerDato('demo:radar-historial')[0].foco.id, 'all');
  assert.equal((await S.llamar(RADAR, { modo: 'modo-raro', cliente: 'demo' })).codigo, 400);
});
