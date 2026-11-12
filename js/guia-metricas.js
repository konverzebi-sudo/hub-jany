/* Métricas y embudo de conversión — Guía del taller (clase 09).
   Se monta en los huecos [data-metricas="metas|registro|embudo|historial"] que pinta la guía.
   Los datos se guardan en el navegador de cada persona (igual que el resto de la guía).
   Reglas: si falta un dato o el denominador es cero NO se calcula el porcentaje; el semáforo
   solo usa las metas que la persona configura (no hay porcentajes universales). */
(function () {
  'use strict';
  var KEY = 'guia-metricas-v1';
  var CANALES = ['Facebook', 'Instagram', 'TikTok', 'Google', 'Otro'];
  var QUE = ['Clientes', 'Mensajes', 'Alcance', 'Impresiones', 'Otro'];
  var ui = { editando: null, verId: '', comparar: [], f: { desde: '', hasta: '', canal: '', q: '' }, error: '' };

  function leer() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    d = d || {};
    d.metas = d.metas || { mensajes: null, cierre: null, conversion: null, frecuenciaMax: null, margen: 70 };
    if (d.metas.margen == null) d.metas.margen = 70;
    d.registros = d.registros || [];
    return d;
  }
  var db = leer();
  function guardar() { try { localStorage.setItem(KEY, JSON.stringify(db)); return true; } catch (e) { return false; } }

  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var num = function (v) { if (v === '' || v == null) return null; var n = Number(String(v).replace(/,/g, '')); return isFinite(n) && n >= 0 ? n : null; };
  var fmt = function (n) { return n == null ? '—' : Number(n).toLocaleString('es-MX', { maximumFractionDigits: 0 }); };
  var fmtP = function (n) { return Number(n).toLocaleString('es-MX', { maximumFractionDigits: n < 10 ? 2 : 1 }) + '%'; };
  var id = function () { return Math.random().toString(36).slice(2, 10); };
  var norm = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); };

  /* ───── Cálculos ───── */
  // Porcentaje: { ok:true, v } o { ok:false, motivo:'falta'|'cero' }
  function pct(n, d) {
    if (n == null || d == null) return { ok: false, motivo: 'falta' };
    if (d === 0) return { ok: false, motivo: 'cero' };
    return { ok: true, v: n / d * 100 };
  }
  function razon(n, d) {
    if (n == null || d == null) return { ok: false, motivo: 'falta' };
    if (d === 0) return { ok: false, motivo: 'cero' };
    return { ok: true, v: n / d };
  }
  function indicadores(r) {
    return {
      mensajes: pct(r.mensajes, r.alcance),
      cierre: pct(r.clientes, r.mensajes),
      conversion: pct(r.clientes, r.alcance),
      frecuencia: razon(r.impresiones, r.alcance)
    };
  }
  // Suma de varios registros: cada tasa usa solo los registros que tienen numerador y denominador
  function agregado(lista) {
    function par(nk, dk) {
      var n = 0, d = 0, c = 0;
      lista.forEach(function (r) { if (r[nk] != null && r[dk] != null) { n += r[nk]; d += r[dk]; c++; } });
      return c ? { n: n, d: d } : null;
    }
    function suma(k) { var s = 0, c = 0; lista.forEach(function (r) { if (r[k] != null) { s += r[k]; c++; } }); return c ? s : null; }
    var pm = par('mensajes', 'alcance'), pc = par('clientes', 'mensajes'), pt = par('clientes', 'alcance'), pf = par('impresiones', 'alcance');
    return {
      alcance: suma('alcance'), impresiones: suma('impresiones'), mensajes: suma('mensajes'), clientes: suma('clientes'),
      ind: {
        mensajes: pm ? pct(pm.n, pm.d) : { ok: false, motivo: 'falta' },
        cierre: pc ? pct(pc.n, pc.d) : { ok: false, motivo: 'falta' },
        conversion: pt ? pct(pt.n, pt.d) : { ok: false, motivo: 'falta' },
        frecuencia: pf ? razon(pf.n, pf.d) : { ok: false, motivo: 'falta' }
      }
    };
  }
  var NOMBRES = { mensajes: 'Tasa de mensajes', cierre: 'Tasa de cierre', conversion: 'Conversión total', frecuencia: 'Frecuencia' };
  var EXPLICA = {
    mensajes: 'De las personas alcanzadas, cuántas te escribieron.',
    cierre: 'De las conversaciones, cuántas terminaron en venta.',
    conversion: 'De las personas alcanzadas, cuántas se volvieron clientes.',
    frecuencia: 'Cuántas veces, en promedio, vio tu contenido cada persona.'
  };
  // Semáforo contra la meta de la persona. margen = % de la meta que todavía cuenta como "normal".
  function semaforo(k, ind) {
    if (!ind.ok) return { c: 'gris', t: 'Sin datos suficientes', d: ind.motivo === 'cero' ? 'El dato base es cero: no se puede calcular.' : 'Falta un dato para calcularlo.' };
    var m = db.metas, margen = Math.min(99, Math.max(1, Number(m.margen) || 70)) / 100;
    if (k === 'frecuencia') {
      if (m.frecuenciaMax == null) return { c: 'gris', t: 'Sin meta', d: 'Configura tu frecuencia máxima para ver el semáforo.' };
      if (ind.v <= m.frecuenciaMax) return { c: 'verde', t: 'Muy bien', d: 'Dentro de tu frecuencia máxima (' + m.frecuenciaMax + ').' };
      if (ind.v <= m.frecuenciaMax * (2 - margen)) return { c: 'amarillo', t: 'Normal', d: 'Un poco arriba de tu máximo: vigila que no canse a tu público.' };
      return { c: 'rojo', t: 'Mejorable', d: 'Tu contenido se repite demasiado: amplía tu público o renueva el anuncio.' };
    }
    var meta = m[k];
    if (meta == null || meta === 0) return { c: 'gris', t: 'Sin meta', d: 'Configura tu meta para ver el semáforo.' };
    if (ind.v >= meta) return { c: 'verde', t: 'Muy bien', d: 'Alcanzaste o superaste tu meta de ' + fmtP(meta) + '.' };
    if (ind.v >= meta * margen) return { c: 'amarillo', t: 'Normal', d: 'Cerca de tu meta de ' + fmtP(meta) + '.' };
    return { c: 'rojo', t: 'Mejorable', d: 'Por debajo de tu meta de ' + fmtP(meta) + ': esta etapa necesita atención.' };
  }
  function valorTxt(k, ind) {
    if (!ind.ok) return 'Sin datos suficientes';
    return k === 'frecuencia' ? ind.v.toLocaleString('es-MX', { maximumFractionDigits: 2 }) + ' veces' : fmtP(ind.v);
  }
  // Objetivo vs resultado (cumplimiento de meta; NO es una tasa del embudo)
  function resultadoDe(r) {
    if (r.resultadoNum != null) return r.resultadoNum;
    var mapa = { Clientes: 'clientes', Mensajes: 'mensajes', Alcance: 'alcance', Impresiones: 'impresiones' };
    return mapa[r.metaQue] ? r[mapa[r.metaQue]] : null;
  }
  function cumplimiento(r) {
    var res = resultadoDe(r);
    var p = pct(res, r.metaNum);
    if (!p.ok) return { ok: false, motivo: p.motivo, res: res };
    var e = p.v < 100 ? { c: 'rojo', t: 'Por debajo de la meta' } : p.v <= 110 ? { c: 'verde', t: 'Dentro de la meta' } : { c: 'verde', t: 'Por encima de la meta' };
    return { ok: true, v: p.v, res: res, c: e.c, t: e.t };
  }
  function avisos(r) {
    var a = [];
    if (r.mensajes != null && r.alcance != null && r.mensajes > r.alcance) a.push('Hay más mensajes que personas alcanzadas: revisa los datos.');
    if (r.clientes != null && r.mensajes != null && r.clientes > r.mensajes) a.push('Hay más clientes que mensajes: revisa los datos (o cuenta ventas que llegaron por otro lado).');
    if (r.impresiones != null && r.alcance != null && r.impresiones < r.alcance) a.push('Las impresiones no pueden ser menos que el alcance: revisa los datos.');
    return a;
  }
  var periodo = function (r) { return r.desde && r.hasta ? r.desde + ' → ' + r.hasta : r.desde || r.hasta || 'Sin fecha'; };
  var canalDe = function (r) { return r.canal === 'Otro' && r.canalOtro ? r.canalOtro : (r.canal || '—'); };

  function filtrados() {
    var f = ui.f;
    return db.registros.filter(function (r) {
      if (f.canal && r.canal !== f.canal) return false;
      if (f.q && norm(r.nombre).indexOf(norm(f.q)) < 0) return false;
      if (f.desde && (r.hasta || r.desde || '') < f.desde) return false;
      if (f.hasta && (r.desde || r.hasta || '') > f.hasta) return false;
      return true;
    }).sort(function (a, b) { return (b.desde || '').localeCompare(a.desde || '') || (b.creado || '').localeCompare(a.creado || ''); });
  }

  /* ───── Piezas visuales ───── */
  function chipSem(s) { return '<span class="gm-sem gm-' + s.c + '"><i></i>' + esc(s.t) + '</span>'; }
  function tarjetaInd(k, ind) {
    var s = semaforo(k, ind);
    return '<div class="gm-ind gm-b-' + s.c + '"><small>' + NOMBRES[k] + '</small><b>' + valorTxt(k, ind) + '</b>' + chipSem(s) + '<p>' + esc(s.d) + '</p><em>' + EXPLICA[k] + '</em></div>';
  }
  function embudoHtml(d, ind) {
    var a = d.alcance, m = d.mensajes, c = d.clientes;
    var ancho = function (v) { if (v == null) return 0; if (!a) return v ? 100 : 0; return Math.max(16, Math.round(26 + 74 * Math.log(v + 1) / Math.log(a + 1))); };
    var etapa = function (t, v, w, extra) { return '<div class="gm-et"><div class="gm-barra" style="width:' + (v == null ? 100 : w) + '%"' + (v == null ? ' data-vacio' : '') + '><b>' + fmt(v) + '</b><span>' + t + '</span></div>' + (extra || '') + '</div>'; };
    var paso = function (k) { var s = semaforo(k, ind[k]); return '<div class="gm-paso">↓ <b>' + valorTxt(k, ind[k]) + '</b> ' + NOMBRES[k].toLowerCase() + ' ' + chipSem(s) + '</div>'; };
    // Etapa donde se pierden más oportunidades: la de peor desempeño contra su meta
    var peor = null;
    ['mensajes', 'cierre'].forEach(function (k) {
      var i = ind[k], meta = db.metas[k];
      if (i.ok && meta) { var r = i.v / meta; if (!peor || r < peor.r) peor = { k: k, r: r }; }
    });
    var pista = peor ? (peor.r >= 1 ? '✅ Las dos etapas van en o arriba de tu meta.' : '🔎 Aquí pierdes más oportunidades: <b>' + (peor.k === 'mensajes' ? 'de alcance a mensajes' : 'de mensajes a clientes') + '</b>. ' + (peor.k === 'mensajes' ? 'Mejora tu gancho, tu oferta o tu llamado a escribir.' : 'Mejora tu respuesta, seguimiento y cierre de las conversaciones.'))
      : '⚙️ Configura tus metas y completa alcance, mensajes y clientes para saber qué etapa mejorar.';
    return '<div class="gm-embudo">'
      + etapa('ALCANCE · personas', a, 100, '<div class="gm-imp">👁️ ' + fmt(d.impresiones) + ' impresiones · frecuencia ' + valorTxt('frecuencia', ind.frecuencia) + '</div>')
      + paso('mensajes')
      + etapa('MENSAJES · conversaciones', m, ancho(m))
      + paso('cierre')
      + etapa('CLIENTES CERRADOS', c, ancho(c))
      + '<div class="gm-paso gm-total">De todo tu alcance: <b>' + valorTxt('conversion', ind.conversion) + '</b> se volvió cliente ' + chipSem(semaforo('conversion', ind.conversion)) + '</div>'
      + '</div><p class="gm-pista">' + pista + '</p>';
  }
  function evolucionHtml(lista) {
    var pts = lista.slice().reverse().map(function (r) { var i = indicadores(r); return { r: r, m: i.mensajes.ok ? i.mensajes.v : null, c: i.conversion.ok ? i.conversion.v : null }; })
      .filter(function (p) { return p.m != null || p.c != null; });
    if (pts.length < 2) return '<p class="gm-muted">Necesitas al menos 2 registros con datos para ver la evolución.</p>';
    var W = 600, H = 200, P = 30, max = Math.max.apply(null, pts.map(function (p) { return Math.max(p.m || 0, p.c || 0); })) || 1;
    var x = function (i) { return P + i * (W - 2 * P) / (pts.length - 1); }, y = function (v) { return H - P - v / max * (H - 2 * P); };
    var linea = function (k, col) {
      var seg = pts.map(function (p, i) { return p[k] == null ? null : x(i).toFixed(1) + ',' + y(p[k]).toFixed(1); }).filter(Boolean);
      return '<polyline fill="none" stroke="' + col + '" stroke-width="3" stroke-linejoin="round" points="' + seg.join(' ') + '"/>'
        + pts.map(function (p, i) { return p[k] == null ? '' : '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p[k]).toFixed(1) + '" r="4.5" fill="' + col + '"><title>' + esc(p.r.nombre) + ': ' + fmtP(p[k]) + '</title></circle>'; }).join('');
    };
    return '<svg class="gm-evo" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Evolución de tasa de mensajes y conversión total">'
      + '<line x1="' + P + '" y1="' + (H - P) + '" x2="' + (W - P) + '" y2="' + (H - P) + '" stroke="#E6DDF2"/>'
      + linea('m', '#7B2FBE') + linea('c', '#7BA300')
      + pts.map(function (p, i) { return '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="#7A6E8C">' + esc((p.r.desde || '').slice(5) || (i + 1)) + '</text>'; }).join('')
      + '</svg><div class="gm-ley"><span><i style="background:#7B2FBE"></i>Tasa de mensajes</span><span><i style="background:#7BA300"></i>Conversión total</span></div>';
  }

  /* ───── Partes ───── */
  function parteMetas() {
    var m = db.metas;
    var campo = function (k, t, ayuda, suf) { return '<label class="gm-f"><span>' + t + '</span><div class="gm-in"><input type="number" min="0" step="any" data-meta="' + k + '" value="' + (m[k] == null ? '' : m[k]) + '" placeholder="Ej. ' + (k === 'frecuenciaMax' ? '3' : k === 'cierre' ? '20' : '1') + '"><em>' + suf + '</em></div><small>' + ayuda + '</small></label>'; };
    return '<div class="gm-card"><div class="gm-grid">'
      + campo('mensajes', 'Meta de tasa de mensajes', '¿Qué % de tu alcance esperas que te escriba?', '%')
      + campo('cierre', 'Meta de tasa de cierre', '¿Qué % de tus conversaciones esperas cerrar?', '%')
      + campo('conversion', 'Meta de conversión total', '¿Qué % de tu alcance esperas que compre?', '%')
      + campo('frecuenciaMax', 'Frecuencia máxima', '¿Cuántas veces máximo quieres que te vea cada persona?', 'veces')
      + '</div><label class="gm-f gm-margen"><span>Rango amarillo ("normal")</span><div class="gm-in"><input type="number" min="1" max="99" data-meta="margen" value="' + m.margen + '"><em>% de la meta</em></div>'
      + '<small>🟢 Verde: llegas a tu meta · 🟡 Amarillo: logras al menos este % de tu meta · 🔴 Rojo: por debajo. Sin meta, el semáforo queda gris.</small></label>'
      + '<button type="button" class="btn gm-btn" data-gm="guardar-metas">Guardar mis metas</button></div>';
  }
  function parteRegistro() {
    var r = ui.editando ? db.registros.find(function (x) { return x.id === ui.editando; }) || {} : {};
    var v = function (k) { return r[k] == null ? '' : esc(r[k]); };
    var n = function (k, t, ayuda) { return '<label class="gm-f"><span>' + t + '</span><input type="number" min="0" step="1" name="' + k + '" value="' + v(k) + '" placeholder="Si aún no lo sabes, déjalo vacío"><small>' + ayuda + '</small></label>'; };
    return '<form class="gm-card" data-gm-form>'
      + (ui.editando ? '<p class="gm-editando">✏️ Editando: <b>' + esc(r.nombre) + '</b> · <a href="javascript:void 0" data-gm="cancelar">Cancelar</a></p>' : '')
      + '<h4>A · Tu campaña o actividad</h4><div class="gm-grid">'
      + '<label class="gm-f gm-ancho"><span>Nombre de la campaña o actividad *</span><input type="text" name="nombre" maxlength="80" required value="' + v('nombre') + '" placeholder="Ej. Promo pasteles Día de Muertos"></label>'
      + '<label class="gm-f"><span>Desde</span><input type="date" name="desde" value="' + v('desde') + '"></label>'
      + '<label class="gm-f"><span>Hasta</span><input type="date" name="hasta" value="' + v('hasta') + '"></label>'
      + '<label class="gm-f"><span>Canal</span><select name="canal">' + CANALES.map(function (c) { return '<option ' + (r.canal === c ? 'selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>'
      + '<label class="gm-f"><span>¿Cuál otro canal?</span><input type="text" name="canalOtro" maxlength="40" value="' + v('canalOtro') + '" placeholder="Solo si elegiste Otro"></label>'
      + '<label class="gm-f gm-ancho"><span>Objetivo de la campaña</span><input type="text" name="objetivo" maxlength="140" value="' + v('objetivo') + '" placeholder="Ej. Conseguir 10 pedidos"></label>'
      + '<label class="gm-f gm-ancho"><span>Resultado u objetivo alcanzado</span><input type="text" name="resultado" maxlength="140" value="' + v('resultado') + '" placeholder="Ej. Llegaron 7 pedidos"></label>'
      + '</div><h4>Meta numérica (opcional)</h4><div class="gm-grid">'
      + '<label class="gm-f"><span>¿Qué querías conseguir?</span><select name="metaQue">' + QUE.map(function (c) { return '<option ' + (r.metaQue === c ? 'selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>'
      + n('metaNum', 'Meta (número)', 'Ej. 10 clientes')
      + n('resultadoNum', 'Resultado (número)', 'Si lo dejas vacío usamos el dato de abajo')
      + '</div><h4>B · Visibilidad</h4><div class="gm-grid">'
      + n('alcance', 'Alcance', 'Personas únicas a las que llegaste')
      + n('impresiones', 'Impresiones', 'Veces que se mostró tu contenido o anuncio')
      + '</div><h4>C · Conversación y ventas</h4><div class="gm-grid">'
      + n('mensajes', 'Mensajes recibidos', 'Conversaciones que se iniciaron')
      + n('clientes', 'Clientes cerrados', 'Personas que terminaron comprando')
      + '</div>' + (ui.error ? '<p class="gm-error">' + esc(ui.error) + '</p>' : '')
      + '<button class="btn gm-btn">' + (ui.editando ? 'Guardar cambios' : 'Guardar registro') + '</button>'
      + '<p class="gm-muted">Puedes guardar aunque te falten datos y completarlo después. No inventamos valores.</p></form>';
  }
  function parteEmbudo() {
    var lista = filtrados();
    if (!db.registros.length) return '<div class="gm-card gm-vacio">📭 Cuando guardes tu primer registro, aquí verás tu embudo y tu semáforo.</div>';
    var sel = ui.verId && db.registros.find(function (x) { return x.id === ui.verId; });
    var d, ind, titulo;
    if (sel) { d = sel; ind = indicadores(sel); titulo = esc(sel.nombre) + ' · ' + esc(canalDe(sel)) + ' · ' + esc(periodo(sel)); }
    else { var g = agregado(lista); d = g; ind = g.ind; titulo = 'Resumen de ' + lista.length + ' registro' + (lista.length === 1 ? '' : 's') + (lista.length !== db.registros.length ? ' (con tus filtros)' : ''); }
    var cu = sel ? cumplimiento(sel) : null;
    return '<div class="gm-card"><div class="gm-top"><b>' + titulo + '</b><select data-gm="ver"><option value="">Resumen de todos (con filtros)</option>' + db.registros.map(function (r) { return '<option value="' + r.id + '" ' + (r.id === ui.verId ? 'selected' : '') + '>' + esc(r.nombre) + ' · ' + esc(periodo(r)) + '</option>'; }).join('') + '</select></div>'
      + embudoHtml(d, ind)
      + '<div class="gm-inds">' + ['mensajes', 'cierre', 'conversion', 'frecuencia'].map(function (k) { return tarjetaInd(k, ind[k]); }).join('') + '</div>'
      + (cu ? '<div class="gm-meta"><small>OBJETIVO VS. RESULTADO</small>' + (cu.ok ? '<b>' + fmtP(cu.v) + ' de tu meta</b> ' + chipSem(cu) + '<p>Querías ' + fmt(sel.metaNum) + ' ' + esc(String(sel.metaQue || '').toLowerCase()) + ' y conseguiste ' + fmt(cu.res) + '. <em>(Esto es cumplimiento de tu meta, no una tasa del embudo.)</em></p><div class="gm-prog"><i style="width:' + Math.min(100, cu.v) + '%"></i></div>' : '<p>' + (cu.motivo === 'cero' ? 'Tu meta es cero: no se puede calcular el cumplimiento.' : 'Agrega una meta numérica y su resultado para ver tu cumplimiento.') + '</p>') + '</div>' : '')
      + (sel && avisos(sel).length ? '<p class="gm-error">⚠️ ' + avisos(sel).map(esc).join('<br>⚠️ ') + '</p>' : '')
      + (!sel ? '<p class="gm-muted">El alcance sumado de varias campañas es aproximado: una misma persona pudo verlas todas. Cada tasa usa solo los registros que tienen los dos datos.</p>' : '')
      + '</div>';
  }
  function parteHistorial() {
    var f = ui.f, lista = filtrados();
    var filtros = '<div class="gm-filtros"><input type="search" data-f="q" placeholder="Buscar campaña" value="' + esc(f.q) + '"><select data-f="canal"><option value="">Todos los canales</option>' + CANALES.map(function (c) { return '<option ' + (f.canal === c ? 'selected' : '') + '>' + c + '</option>'; }).join('') + '</select>'
      + '<label>Desde <input type="date" data-f="desde" value="' + esc(f.desde) + '"></label><label>Hasta <input type="date" data-f="hasta" value="' + esc(f.hasta) + '"></label></div>';
    if (!db.registros.length) return '<div class="gm-card gm-vacio">Aún no tienes registros.</div>';
    var cards = lista.map(function (r) {
      var i = indicadores(r), cu = cumplimiento(r);
      return '<div class="gm-reg"><div class="gm-reg-h"><div><b>' + esc(r.nombre) + '</b><small>' + esc(canalDe(r)) + ' · ' + esc(periodo(r)) + '</small></div>'
        + '<label class="gm-cmp"><input type="checkbox" data-cmp="' + r.id + '" ' + (ui.comparar.indexOf(r.id) >= 0 ? 'checked' : '') + '> Comparar</label></div>'
        + '<div class="gm-nums"><span>Alcance <b>' + fmt(r.alcance) + '</b></span><span>Impresiones <b>' + fmt(r.impresiones) + '</b></span><span>Mensajes <b>' + fmt(r.mensajes) + '</b></span><span>Clientes <b>' + fmt(r.clientes) + '</b></span></div>'
        + '<div class="gm-chips">' + ['mensajes', 'cierre', 'conversion', 'frecuencia'].map(function (k) { var s = semaforo(k, i[k]); return '<span class="gm-sem gm-' + s.c + '" title="' + esc(s.d) + '"><i></i>' + NOMBRES[k] + ': ' + valorTxt(k, i[k]) + '</span>'; }).join('')
        + (cu.ok ? '<span class="gm-sem gm-' + cu.c + '"><i></i>Meta: ' + fmtP(cu.v) + '</span>' : '') + '</div>'
        + '<div class="gm-acc"><button type="button" class="chip-btn" data-gm="ver-reg" data-id="' + r.id + '">📊 Ver embudo</button><button type="button" class="chip-btn" data-gm="editar" data-id="' + r.id + '">✏️ Editar</button><button type="button" class="chip-btn" data-gm="borrar" data-id="' + r.id + '">🗑️ Eliminar</button></div></div>';
    }).join('') || '<p class="gm-muted">Ningún registro coincide con tus filtros.</p>';
    var cmp = '';
    var A = db.registros.find(function (x) { return x.id === ui.comparar[0]; }), B = db.registros.find(function (x) { return x.id === ui.comparar[1]; });
    if (A && B) {
      var ia = indicadores(A), ib = indicadores(B);
      var fila = function (t, va, vb, esPct) {
        var dif = (va != null && vb != null) ? (vb - va) : null;
        return '<tr><td>' + t + '</td><td>' + (va == null ? 'Sin datos' : esPct ? fmtP(va) : fmt(va)) + '</td><td>' + (vb == null ? 'Sin datos' : esPct ? fmtP(vb) : fmt(vb)) + '</td><td class="' + (dif == null ? '' : dif >= 0 ? 'gm-up' : 'gm-down') + '">' + (dif == null ? '—' : (dif >= 0 ? '▲ ' : '▼ ') + (esPct ? Math.abs(dif).toLocaleString('es-MX', { maximumFractionDigits: 2 }) + ' pts' : fmt(Math.abs(dif)))) + '</td></tr>';
      };
      var v = function (x) { return x.ok ? x.v : null; };
      cmp = '<div class="gm-card gm-comparar"><b>Comparación</b><table><tr><th></th><th>' + esc(A.nombre) + '<small>' + esc(periodo(A)) + '</small></th><th>' + esc(B.nombre) + '<small>' + esc(periodo(B)) + '</small></th><th>Cambio</th></tr>'
        + fila('Alcance', A.alcance, B.alcance) + fila('Impresiones', A.impresiones, B.impresiones) + fila('Mensajes', A.mensajes, B.mensajes) + fila('Clientes', A.clientes, B.clientes)
        + fila('Tasa de mensajes', v(ia.mensajes), v(ib.mensajes), true) + fila('Tasa de cierre', v(ia.cierre), v(ib.cierre), true) + fila('Conversión total', v(ia.conversion), v(ib.conversion), true)
        + '</table></div>';
    } else if (ui.comparar.length === 1) cmp = '<p class="gm-muted">Marca otro registro para compararlos.</p>';
    return filtros + cmp + '<div class="gm-regs">' + cards + '</div><div class="gm-card"><b>Evolución</b>' + evolucionHtml(lista) + '</div>';
  }

  var PARTES = { metas: parteMetas, registro: parteRegistro, embudo: parteEmbudo, historial: parteHistorial };
  function pintar() {
    document.querySelectorAll('[data-metricas]').forEach(function (el) { var p = PARTES[el.dataset.metricas]; if (p) el.innerHTML = p(); });
  }
  function aviso(t) { if (typeof window.toast === 'function') window.toast(t); }

  /* ───── Eventos (delegados, una sola vez) ───── */
  document.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-gm-form]'); if (!form) return;
    e.preventDefault();
    var fd = new FormData(form), g = function (k) { return (fd.get(k) || '').toString().trim(); };
    var r = {
      nombre: g('nombre'), desde: g('desde'), hasta: g('hasta'), canal: g('canal'), canalOtro: g('canalOtro'),
      objetivo: g('objetivo'), resultado: g('resultado'), metaQue: g('metaQue'), metaNum: num(g('metaNum')), resultadoNum: num(g('resultadoNum')),
      alcance: num(g('alcance')), impresiones: num(g('impresiones')), mensajes: num(g('mensajes')), clientes: num(g('clientes'))
    };
    if (!r.nombre) { ui.error = 'Ponle nombre a tu campaña o actividad.'; return pintar(); }
    if (r.desde && r.hasta && r.hasta < r.desde) { ui.error = 'La fecha "hasta" no puede ser antes de "desde".'; return pintar(); }
    var clave = norm(r.nombre) + '|' + r.canal + '|' + r.desde + '|' + r.hasta;
    var dup = db.registros.find(function (x) { return x.id !== ui.editando && norm(x.nombre) + '|' + x.canal + '|' + x.desde + '|' + x.hasta === clave; });
    if (dup) { ui.error = 'Ya tienes un registro de esta campaña, canal y periodo. Edítalo en tu historial para no contarlo dos veces.'; return pintar(); }
    ui.error = '';
    var ahora = new Date().toISOString();
    if (ui.editando) { var x = db.registros.find(function (y) { return y.id === ui.editando; }); Object.assign(x, r, { editado: ahora }); ui.verId = x.id; }
    else { var nuevo = Object.assign({ id: id(), creado: ahora }, r); db.registros.push(nuevo); ui.verId = nuevo.id; }
    ui.editando = null;
    aviso(guardar() ? '✅ Registro guardado' : '⚠️ No se pudo guardar en este navegador');
    pintar();
    var emb = document.querySelector('[data-metricas="embudo"]'); if (emb) emb.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-gm]'); if (!b) return;
    var acc = b.dataset.gm, rid = b.dataset.id;
    if (acc === 'guardar-metas') {
      document.querySelectorAll('[data-meta]').forEach(function (i) { db.metas[i.dataset.meta] = i.dataset.meta === 'margen' ? (num(i.value) || 70) : num(i.value); });
      aviso(guardar() ? '✅ Metas guardadas' : '⚠️ No se pudo guardar'); pintar();
    } else if (acc === 'editar') { ui.editando = rid; ui.error = ''; pintar(); var f = document.querySelector('[data-metricas="registro"]'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (acc === 'cancelar') { ui.editando = null; ui.error = ''; pintar(); }
    else if (acc === 'ver-reg') { ui.verId = rid; pintar(); var em = document.querySelector('[data-metricas="embudo"]'); if (em) em.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (acc === 'borrar') {
      var r = db.registros.find(function (x) { return x.id === rid; });
      if (r && confirm('¿Eliminar el registro "' + r.nombre + '"? No se puede deshacer.')) {
        db.registros = db.registros.filter(function (x) { return x.id !== rid; });
        ui.comparar = ui.comparar.filter(function (x) { return x !== rid; }); if (ui.verId === rid) ui.verId = '';
        guardar(); pintar();
      }
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches('[data-gm="ver"]')) { ui.verId = t.value; pintar(); }
    else if (t.matches('[data-f]')) { ui.f[t.dataset.f] = t.value; pintar(); }
    else if (t.matches('[data-cmp]')) {
      var i = ui.comparar.indexOf(t.dataset.cmp);
      if (t.checked && i < 0) { ui.comparar.push(t.dataset.cmp); if (ui.comparar.length > 2) ui.comparar.shift(); }
      if (!t.checked && i >= 0) ui.comparar.splice(i, 1);
      pintar();
    }
  });
  document.addEventListener('input', function (e) { if (e.target.matches('input[data-f="q"]')) { ui.f.q = e.target.value; clearTimeout(ui.t); ui.t = setTimeout(function () { var pos = e.target.selectionStart; pintar(); var n = document.querySelector('input[data-f="q"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} } }, 350); } });
  window.addEventListener('storage', function (e) { if (e.key === KEY) { db = leer(); pintar(); } });

  window.GuiaMetricas = { montar: pintar, _calc: { pct: pct, razon: razon, indicadores: indicadores, agregado: agregado, cumplimiento: cumplimiento, semaforo: function (k, i, metas) { var o = db.metas; if (metas) db.metas = metas; var s = semaforo(k, i); db.metas = o; return s; } } };
})();
