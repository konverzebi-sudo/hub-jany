/* Tablero numérico de Meta Ads (Resultados en Campañas): se calcula en la página a partir del CSV y se
   inyecta en los "huecos" del reporte que arma el Jefe (#slot-kpis, #slot-comportamiento, #slot-embudo).
   Todo en blanco, sin librerías: gráficas con CSS/SVG y calculadora con deslizadores (cierre y meses).
   Uso:  var datos = MetaTablero.calcular([{name,text}, ...], { cierreBase: 12, cierreReal: true });
         var html  = MetaTablero.inyectar(htmlDelReporte, datos);
   No guarda nada de ninguna marca: todo sale del CSV que sube el usuario. */
(function () {
  'use strict';

  /* ───────── CSV ───────── */
  function parseCsv(text) {
    text = String(text || '').replace(/^﻿/, '');
    var first = text.split(/\r?\n/, 1)[0] || '';
    var delim = first.split(';').length > first.split(',').length ? ';' : ',';
    var rows = [], row = [], cur = '', q = false, i, c;
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    var head = rows.shift() || [];
    return { head: head, rows: rows.filter(function (r) { return r.length > 1 || String(r[0] || '').trim() !== ''; }) };
  }

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function find(headN, names) {
    var i, j;
    for (j = 0; j < names.length; j++) for (i = 0; i < headN.length; i++) if (headN[i] === names[j]) return i;
    for (j = 0; j < names.length; j++) for (i = 0; i < headN.length; i++) if (headN[i].indexOf(names[j]) === 0) return i;
    return -1;
  }
  function pNum(v) {
    if (v == null) return 0;
    var s = String(v).replace(/[^0-9.,\-]/g, '');
    if (!s || s === '-') return 0;
    var lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (lc >= 0) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  var NOMBRES = {
    anuncio: ['nombre del anuncio', 'ad name'],
    gasto: ['importe gastado', 'monto gastado', 'amount spent'],
    res: ['resultados', 'results'],
    indicador: ['indicador de resultado', 'result indicator'],
    imp: ['impresiones', 'impressions'],
    alc: ['alcance', 'reach'],
    clics: ['clics todos', 'clicks all', 'clics en el enlace', 'link clicks'],
    frec: ['frecuencia', 'frequency'],
    visitas: ['visitas a la pagina de destino', 'landing page views'],
    pagos: ['pagos iniciados', 'checkouts initiated'],
    compras: ['compras', 'purchases'],
    valor: ['valor de resultados', 'valor de conversion de compras', 'purchase conversion value'],
    plat: ['plataforma', 'platform'],
    ubic: ['ubicacion', 'placement'],
    dia: ['dia', 'day', 'inicio del informe', 'reporting starts'],
    ini: ['inicio del informe', 'reporting starts'],
    fin: ['fin del informe', 'reporting ends']
  };
  function columnas(t) {
    var hn = t.head.map(norm), c = {};
    Object.keys(NOMBRES).forEach(function (k) { c[k] = find(hn, NOMBRES[k]); });
    return c;
  }

  function parseFecha(s) {
    s = String(s || '').trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    return null;
  }

  function tipoDe(indicadores) {
    var cuenta = {}, top = '', max = 0;
    indicadores.forEach(function (v) { if (!v) return; cuenta[v] = (cuenta[v] || 0) + 1; if (cuenta[v] > max) { max = cuenta[v]; top = v; } });
    var t = norm(top);
    if (/messag|mensaje|conversation|conversaci/.test(t)) return { tipo: 'mensajes', etiqueta: 'Conversaciones' };
    if (/purchase|compra/.test(t)) return { tipo: 'compras', etiqueta: 'Compras' };
    if (/lead|prospecto|cliente potencial/.test(t)) return { tipo: 'leads', etiqueta: 'Leads' };
    if (/follow|seguid/.test(t)) return { tipo: 'seguidores', etiqueta: 'Seguidores' };
    if (/engage|interac/.test(t)) return { tipo: 'interaccion', etiqueta: 'Interacciones' };
    return { tipo: 'resultados', etiqueta: 'Resultados' };
  }

  var DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  var DIAS_LARGO = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  function hayDesglose(t, c) {
    if (c.ubic < 0 && c.plat < 0 && c.dia < 0) return false;
    var vals = {};
    var col = c.ubic >= 0 ? c.ubic : (c.plat >= 0 ? c.plat : c.dia);
    t.rows.forEach(function (r) { vals[r[col]] = 1; });
    return Object.keys(vals).length > 1;
  }

  /* ───────── Cálculo ───────── */
  function calcular(files, opts) {
    opts = opts || {};
    if (!files || !files.length) return null;
    var main = parseCsv(files[0].text), c = columnas(main);
    if (c.gasto < 0) return null;
    var tot = { gasto: 0, res: 0, imp: 0, alc: 0, clics: 0, visitas: 0, pagos: 0, compras: 0, valor: 0 };
    var anuncios = {}, indicadores = [], fMin = null, fMax = null;
    main.rows.forEach(function (r) {
      var g = pNum(r[c.gasto]);
      tot.gasto += g;
      tot.res += c.res >= 0 ? pNum(r[c.res]) : 0;
      tot.imp += c.imp >= 0 ? pNum(r[c.imp]) : 0;
      tot.alc += c.alc >= 0 ? pNum(r[c.alc]) : 0;
      tot.clics += c.clics >= 0 ? pNum(r[c.clics]) : 0;
      tot.visitas += c.visitas >= 0 ? pNum(r[c.visitas]) : 0;
      tot.pagos += c.pagos >= 0 ? pNum(r[c.pagos]) : 0;
      tot.compras += c.compras >= 0 ? pNum(r[c.compras]) : 0;
      tot.valor += c.valor >= 0 ? pNum(r[c.valor]) : 0;
      if (g > 0) {
        if (c.anuncio >= 0) anuncios[r[c.anuncio]] = 1;
        if (c.indicador >= 0) indicadores.push(String(r[c.indicador] || '').trim());
      }
      [c.ini, c.fin].forEach(function (ix) {
        if (ix < 0) return;
        var d = parseFecha(r[ix]);
        if (d) { if (!fMin || d < fMin) fMin = d; if (!fMax || d > fMax) fMax = d; }
      });
    });
    var ti = tipoDe(indicadores);
    var dias = fMin && fMax ? Math.round((fMax - fMin) / 86400000) + 1 : null;

    // Desglose: el segundo CSV si lo trae; si no, el principal (cuando sus filas ya vienen por ubicación / día / plataforma)
    var src = null, sc = null;
    if (files[1]) { var t2 = parseCsv(files[1].text), c2 = columnas(t2); if (c2.gasto >= 0 && hayDesglose(t2, c2)) { src = t2; sc = c2; } }
    if (!src && hayDesglose(main, c)) { src = main; sc = c; }

    var ubic = {}, plat = {}, dia = {}, fechas = {};
    if (src) {
      src.rows.forEach(function (r) {
        var g = pNum(r[sc.gasto]), rs = sc.res >= 0 ? pNum(r[sc.res]) : 0;
        if (!(g > 0 || rs > 0)) return;
        var p = sc.plat >= 0 ? String(r[sc.plat] || '').trim() : '';
        var u = sc.ubic >= 0 ? String(r[sc.ubic] || '').trim() : '';
        var k = u ? (p ? p + ' · ' + u : u) : p;
        if (k) { ubic[k] = ubic[k] || { gasto: 0, res: 0 }; ubic[k].gasto += g; ubic[k].res += rs; }
        if (p) {
          var pn = norm(p), pk = /instagram/.test(pn) ? 'Instagram' : /facebook/.test(pn) ? 'Facebook' : /messenger/.test(pn) ? 'Messenger' : /audience/.test(pn) ? 'Audience Network' : /whatsapp/.test(pn) ? 'WhatsApp' : p;
          plat[pk] = plat[pk] || { gasto: 0, res: 0 }; plat[pk].gasto += g; plat[pk].res += rs;
        }
        if (sc.dia >= 0) {
          var d = parseFecha(r[sc.dia]);
          if (d) { fechas[d.getTime()] = 1; var w = d.getDay(); dia[w] = dia[w] || { gasto: 0, res: 0 }; dia[w].gasto += g; dia[w].res += rs; }
        }
      });
    }
    var lista = function (o) { return Object.keys(o).map(function (k) { return { k: k, gasto: o[k].gasto, res: o[k].res }; }).sort(function (a, b) { return (b.res - a.res) || (b.gasto - a.gasto); }); };
    var diasArr = null;
    if (Object.keys(fechas).length >= 2) {
      diasArr = DIAS.map(function (n, i) { var o = dia[i] || { gasto: 0, res: 0 }; return { k: n, largo: DIAS_LARGO[i], gasto: o.gasto, res: o.res }; });
    }

    var esProspecto = ti.tipo === 'mensajes' || ti.tipo === 'leads';
    return {
      tipo: ti.tipo, etiqueta: ti.etiqueta, esProspecto: esProspecto,
      nAnuncios: Object.keys(anuncios).length, dias: dias,
      gasto: tot.gasto, res: tot.res, cpr: tot.res > 0 ? tot.gasto / tot.res : null,
      imp: tot.imp, alc: tot.alc, clics: tot.clics, visitas: tot.visitas, pagos: tot.pagos, compras: tot.compras, valor: tot.valor,
      frec: tot.alc > 0 ? tot.imp / tot.alc : null,
      cpm: tot.imp > 0 ? tot.gasto / tot.imp * 1000 : null,
      ctr: tot.imp > 0 && tot.clics > 0 ? tot.clics / tot.imp * 100 : null,
      roas: tot.gasto > 0 && tot.valor > 0 ? tot.valor / tot.gasto : null,
      ubic: lista(ubic).slice(0, 8), plat: lista(plat), dias7: diasArr,
      cierre: Math.min(100, Math.max(1, Math.round(opts.cierreBase || 10))), cierreReal: !!opts.cierreReal,
      metaDef: 10
    };
  }

  /* ───────── Presentación ───────── */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function dinero(n) { if (n == null || !isFinite(n)) return '—'; return '$' + (Math.abs(n) < 100 ? n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(n).toLocaleString('es-MX')); }
  function entero(n) { return n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('es-MX'); }
  function dec(n, d) { return n == null || !isFinite(n) ? '—' : n.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }); }

  var PALETA = ['#C0F800', '#111111', '#2563eb', '#d97706', '#7c3aed', '#16a34a', '#db2777', '#94a3b8'];

  function donut(items, valorFn) {
    var total = items.reduce(function (a, i) { return a + valorFn(i); }, 0);
    if (!(total > 0)) return '';
    var acum = 0, partes = [], leyenda = [];
    items.forEach(function (it, ix) {
      var v = valorFn(it), pct = v / total * 100, col = PALETA[ix % PALETA.length];
      partes.push(col + ' ' + acum.toFixed(2) + '% ' + (acum + pct).toFixed(2) + '%');
      acum += pct;
      leyenda.push('<li><i style="background:' + col + '"></i><span class="nx-ln">' + esc(it.k) + '</span><b>' + dec(pct, 1) + '%</b></li>');
    });
    return '<div class="nx-donut-wrap"><div class="nx-donut" style="background:conic-gradient(' + partes.join(',') + ')"><div class="nx-donut-hole"></div></div><ul class="nx-leyenda">' + leyenda.join('') + '</ul></div>';
  }

  var CSS = '' +
    '.nx *{box-sizing:border-box}.nx{font-family:Inter,system-ui,sans-serif;color:#111}' +
    '.nx-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:0 0 14px}' +
    '.nx-kpi{background:#fff;border:1px solid #e2e2e2;border-radius:14px;padding:16px 18px;position:relative;overflow:hidden;box-shadow:0 4px 18px rgba(0,0,0,.05)}' +
    '.nx-kpi:before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:#C0F800}' +
    '.nx-kl{font:700 11px/1.2 Inter,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#6b6b6b;margin-bottom:8px}' +
    '.nx-kv{font:800 clamp(30px,4vw,40px)/1 Sora,Inter,sans-serif;letter-spacing:-.01em}' +
    '.nx-ks{margin-top:6px;font-size:12.5px;color:#6b6b6b;line-height:1.4}' +
    '.nx-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 14px}' +
    '.nx-tile{background:#f7f7f7;border:1px solid #ececec;border-radius:12px;padding:11px 13px}.nx-tile b{display:block;font:800 19px Sora,Inter,sans-serif}.nx-tile span{font-size:11.5px;color:#6b6b6b}' +
    '.nx-card{background:#fff;border:1px solid #e2e2e2;border-radius:14px;padding:18px 20px;margin:0 0 14px;box-shadow:0 4px 18px rgba(0,0,0,.05)}' +
    '.nx-card h4{margin:0 0 4px;font:800 12px Inter,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#4E7A00}.nx-card p{margin:0 0 12px;font-size:13px;color:#6b6b6b;line-height:1.5}' +
    '.nx-row{display:flex;flex-wrap:wrap;align-items:center;gap:14px 18px}' +
    '.nx-input{background:#f0f0f0;border:1.5px solid #C0F800;border-radius:10px;font:800 26px Sora,Inter,sans-serif;padding:8px 14px;width:130px;color:#111;outline:none}' +
    '.nx-big{font:800 34px Sora,Inter,sans-serif;color:#111;min-width:70px;background:#F1FFC2;border-radius:10px;padding:2px 12px}' +
    '.nx-range{flex:1;min-width:180px;accent-color:#4E7A00}' +
    '.nx-3{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin:0 0 14px}' +
    '.nx-3 .nx-card{margin:0}' +
    '.nx-donut-wrap{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.nx-donut{width:130px;height:130px;border-radius:50%;position:relative;flex:none}.nx-donut-hole{position:absolute;inset:26px;background:#fff;border-radius:50%}' +
    '.nx-leyenda{list-style:none;margin:0;padding:0;flex:1;min-width:120px;font-size:12.5px}.nx-leyenda li{display:flex;align-items:center;gap:8px;padding:3px 0}.nx-leyenda i{width:10px;height:10px;border-radius:3px;flex:none}.nx-ln{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nx-leyenda b{font-weight:700}' +
    '.nx-bars{display:flex;align-items:flex-end;gap:8px;height:150px;padding-top:6px}.nx-bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;font-size:11px;color:#6b6b6b}.nx-bar i{display:block;width:100%;max-width:34px;border-radius:7px 7px 3px 3px;background:#d9f58a;min-height:3px}.nx-bar.top i{background:#C0F800;outline:2px solid #4E7A00}.nx-bar b{font-size:11.5px;color:#111;margin-bottom:3px}' +
    '.nx-vacio{font-size:13px;color:#6b6b6b;background:#f7f7f7;border:1px dashed #d4d4d4;border-radius:10px;padding:14px;line-height:1.5}' +
    '.nx-nota{font-size:12.5px;color:#6b6b6b;margin-top:10px;line-height:1.5}.nx-nota b{color:#111}' +
    '.nx-sim{display:inline-block;font:700 10.5px Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#4E7A00;background:#F1FFC2;border-radius:99px;padding:2px 8px;margin-left:6px;vertical-align:middle}' +
    '.nx-sec-t{font:800 20px Sora,Inter,sans-serif;margin:26px 0 12px;padding-bottom:8px;border-bottom:3px solid #C0F800}' +
    '@media(max-width:560px){.nx-card{padding:14px}.nx-input{width:110px}}' +
    '@media print{.nx-card,.nx-kpi{box-shadow:none;break-inside:avoid}.nx-range{display:none}}';

  function bloqueKpis(d) {
    var porDia = d.dias ? ' · ' + dinero(d.gasto / d.dias) + '/día est.' : '';
    var k = [];
    k.push('<div class="nx-kpi"><div class="nx-kl">Inversión total</div><div class="nx-kv">' + dinero(d.gasto) + '</div><div class="nx-ks">' + entero(d.nAnuncios) + ' anuncios con gasto' + porDia + '</div></div>');
    k.push('<div class="nx-kpi"><div class="nx-kl">' + esc(d.etiqueta) + '</div><div class="nx-kv">' + entero(d.res) + '</div><div class="nx-ks">Costo por resultado: ' + dinero(d.cpr) + '</div></div>');
    if (d.esProspecto) {
      k.push('<div class="nx-kpi"><div class="nx-kl">Ventas estimadas</div><div class="nx-kv" id="nx-ventas">~' + entero(d.res * d.cierre / 100) + '</div><div class="nx-ks" id="nx-ventas-sub">Con cierre ' + d.cierre + '%' + (d.cierreReal ? ' (tu cierre real)' : ' <span class="nx-sim">simulación</span>') + '</div></div>');
    } else if (d.tipo === 'compras') {
      k.push('<div class="nx-kpi"><div class="nx-kl">ROAS</div><div class="nx-kv">' + (d.roas != null ? dec(d.roas, 2) + 'x' : '—') + '</div><div class="nx-ks">Valor de compras: ' + dinero(d.valor) + '</div></div>');
    } else {
      k.push('<div class="nx-kpi"><div class="nx-kl">Alcance</div><div class="nx-kv">' + entero(d.alc) + '</div><div class="nx-ks">Personas alcanzadas (suma por anuncio)</div></div>');
    }
    k.push('<div class="nx-kpi"><div class="nx-kl">Costo por ' + (d.esProspecto ? 'prospecto' : 'resultado') + '</div><div class="nx-kv">' + dinero(d.cpr) + '</div><div class="nx-ks">Gasto ÷ ' + esc(d.etiqueta.toLowerCase()) + '</div></div>');

    var tiles = [];
    [['Impresiones', entero(d.imp), d.imp], ['Alcance', entero(d.alc), d.alc], ['Frecuencia', dec(d.frec, 2), d.frec], ['CPM', dinero(d.cpm), d.cpm],
     ['CTR (todos)', d.ctr != null ? dec(d.ctr, 2) + '%' : '—', d.ctr], ['Clics', entero(d.clics), d.clics], ['Visitas a la página', entero(d.visitas), d.visitas],
     ['Pagos iniciados', entero(d.pagos), d.pagos], ['Compras', entero(d.compras), d.compras], ['ROAS', d.roas != null ? dec(d.roas, 2) + 'x' : '—', d.roas]]
      .forEach(function (t) { if (t[2]) tiles.push('<div class="nx-tile"><b>' + t[1] + '</b><span>' + t[0] + '</span></div>'); });

    var meta = d.esProspecto || d.tipo === 'compras'
      ? '<div class="nx-card"><h4>Meta de ventas del período</h4><p>¿Cuántas ventas quieres lograr? Con esto calculo cuánto invertir (abajo, en «Datos duros»).</p><div class="nx-row"><input id="nx-meta" class="nx-input" type="number" min="1" max="9999" value="' + d.metaDef + '" inputmode="numeric"><div id="nx-meta-res" class="nx-ks"></div></div></div>'
      : '';
    return '<div class="nx"><div class="nx-kpis">' + k.join('') + '</div>' + (tiles.length ? '<div class="nx-tiles">' + tiles.join('') + '</div>' : '') + meta + '</div>';
  }

  function bloqueComportamiento(d) {
    var aviso = '<div class="nx-vacio">Sube también el CSV con desglose (el mismo reporte por ubicación, día o plataforma) y aquí aparece esta gráfica.</div>';
    var ub = d.ubic && d.ubic.length ? donut(d.ubic.filter(function (u) { return u.res > 0; }).length ? d.ubic.filter(function (u) { return u.res > 0; }) : d.ubic, function (u) { return u.res > 0 ? u.res : u.gasto; }) : '';
    var plat = d.plat && d.plat.length > 0 ? donut(d.plat, function (p) { return p.gasto; }) : '';
    var dias = '';
    if (d.dias7) {
      var max = Math.max.apply(null, d.dias7.map(function (x) { return x.res; })), mejor = null;
      d.dias7.forEach(function (x) { if (x.res > 0 && (mejor == null || x.res > mejor.res)) mejor = x; });
      dias = '<div class="nx-bars">' + d.dias7.map(function (x) {
        var h = max > 0 ? Math.max(3, x.res / max * 100) : 3;
        return '<div class="nx-bar' + (mejor && x.k === mejor.k ? ' top' : '') + '" title="' + esc(x.k) + ': ' + entero(x.res) + ' · ' + dinero(x.gasto) + '"><b>' + (x.res ? entero(x.res) : '') + '</b><i style="height:' + h.toFixed(0) + '%"></i>' + esc(x.k) + '</div>';
      }).join('') + '</div>' + (mejor ? '<div class="nx-nota">Día más activo: <b>' + mejor.largo + '</b> (' + entero(mejor.res) + ' ' + esc(d.etiqueta.toLowerCase()) + ', ' + dinero(mejor.res ? mejor.gasto / mejor.res : null) + ' por resultado).</div>' : '');
    }
    var porTipo = d.etiqueta.toLowerCase();
    return '<div class="nx"><div class="nx-3">' +
      '<div class="nx-card"><h4>📍 ' + esc(d.etiqueta) + ' por ubicación</h4><p>Dónde se generan tus ' + esc(porTipo) + '.</p>' + (ub || aviso) + '</div>' +
      '<div class="nx-card"><h4>📅 ' + esc(d.etiqueta) + ' por día de la semana</h4><p>Cuáles son tus días más activos.</p>' + (dias || aviso) + '</div>' +
      '<div class="nx-card"><h4>📱 Facebook vs Instagram</h4><p>Cómo se reparte tu inversión.</p>' + (plat || aviso) + '</div>' +
      '</div></div>';
  }

  function bloqueEmbudo(d) {
    var items = [['Inversión', dinero(d.gasto), 'Total invertido en el período'], ['Alcance', entero(d.alc), 'Personas alcanzadas'], ['Impresiones', entero(d.imp), 'Veces que se mostró tu anuncio'],
      [d.etiqueta, entero(d.res), 'Resultados del período'], ['Costo por resultado', dinero(d.cpr), 'Gasto ÷ resultados']];
    var cards = '<div class="nx-kpis">' + items.map(function (i) { return '<div class="nx-kpi"><div class="nx-kl">' + esc(i[0]) + '</div><div class="nx-kv" style="font-size:28px">' + i[1] + '</div><div class="nx-ks">' + i[2] + '</div></div>'; }).join('') + '</div>';
    var calc = '';
    if (d.esProspecto || d.tipo === 'compras') {
      var sliderCierre = d.esProspecto
        ? '<div class="nx-card"><h4>Cierre de ventas' + (d.cierreReal ? '' : ' <span class="nx-sim">simulación</span>') + '</h4><p>' +
          (d.cierreReal ? 'Arranca con tu tasa de cierre real (la que mediste en WhatsApp / Mensajes). ' : 'Aún no mides tu cierre: mueve el deslizador a tu tasa real. ') +
          'Todo se recalcula solo.</p><div class="nx-row"><input id="nx-cierre" class="nx-range" type="range" min="1" max="100" value="' + d.cierre + '"><span class="nx-big" id="nx-cierre-v">' + d.cierre + '%</span></div><div class="nx-tiles" id="nx-calc" style="margin-top:14px"></div></div>'
        : '<div class="nx-card"><h4>Meta de ventas</h4><p>En campañas de compras cada resultado ya es una venta.</p><div class="nx-tiles" id="nx-calc"></div></div>';
      calc = sliderCierre + '<div class="nx-card"><h4>Fecha para cumplir la meta</h4><p>¿En cuántos meses quieres alcanzar tu meta de ventas?</p><div class="nx-row"><input id="nx-meses" class="nx-range" type="range" min="1" max="12" value="3"><span class="nx-big" id="nx-meses-v">3 meses</span></div><div class="nx-nota" id="nx-fecha"></div></div>';
    } else {
      calc = '<div class="nx-vacio">Para este tipo de campaña (' + esc(d.etiqueta.toLowerCase()) + ') la calculadora de ventas no aplica: mide su costo por resultado y tendencia.</div>';
    }
    return '<div class="nx">' + cards + calc + '</div>';
  }

  // Script que mueve la calculadora (va dentro del reporte, así también funciona al descargarlo)
  var SCRIPT = '(function(){var D=window.__NX;if(!D)return;function $(i){return document.getElementById(i)}' +
    'function m(n){if(n==null||!isFinite(n))return"—";return"$"+Math.round(n).toLocaleString("es-MX")}' +
    'function calc(){var metaEl=$("nx-meta");var meta=Math.max(1,parseInt(metaEl&&metaEl.value)||D.metaDef);var cEl=$("nx-cierre");var cierre=D.esProspecto?(cEl?+cEl.value:D.cierre):100;var meses=$("nx-meses")?+$("nx-meses").value:3;' +
    'if($("nx-cierre-v"))$("nx-cierre-v").textContent=cierre+"%";if($("nx-meses-v"))$("nx-meses-v").textContent=meses+(meses===1?" mes":" meses");' +
    'if($("nx-ventas"))$("nx-ventas").textContent="~"+Math.round(D.res*cierre/100).toLocaleString("es-MX");' +
    'if($("nx-ventas-sub"))$("nx-ventas-sub").innerHTML="Con cierre "+cierre+"%"+(D.cierreReal&&cierre===D.cierre?" (tu cierre real)":" <span class=\\"nx-sim\\">simulación</span>");' +
    'var prosp=Math.ceil(meta/(cierre/100));var cpr=D.cpr;var pres=cpr!=null?prosp*cpr:null;var mens=pres!=null?pres/meses:null;' +
    'if($("nx-meta-res"))$("nx-meta-res").innerHTML=cpr!=null?"Para <b>"+meta+" ventas</b> necesitas ~<b>"+prosp.toLocaleString("es-MX")+" "+(D.esProspecto?D.etiqueta.toLowerCase():"compras")+"</b> → inversión aprox. <b>"+m(pres)+"</b>"+(pres>D.gasto?" ("+m(pres-D.gasto)+" más de lo que invertiste)":""):"";' +
    'var t=$("nx-calc");if(t)t.innerHTML=[["Meta de ventas",meta,"Definida arriba"],[D.esProspecto?"Prospectos necesarios":"Compras necesarias",prosp.toLocaleString("es-MX"),"Con cierre "+cierre+"%"],["Costo por "+(D.esProspecto?"prospecto":"resultado"),m(cpr),"Real del período"],["Presupuesto necesario",m(pres),"("+meta+" × "+m(cpr)+") ÷ "+cierre+"%"]].map(function(x){return"<div class=\\"nx-tile\\"><b>"+x[1]+"</b><span>"+x[0]+" · "+x[2]+"</span></div>"}).join("");' +
    'var f=$("nx-fecha");if(f){var dt=new Date();dt.setMonth(dt.getMonth()+meses);f.innerHTML="📅 Meta para <b>"+dt.toLocaleDateString("es-MX",{month:"long",year:"numeric"})+"</b> · Inversión mensual necesaria: <b>"+m(mens)+"/mes</b><br>Para "+meta+" ventas en "+meses+(meses===1?" mes":" meses")+" necesitas invertir "+m(pres)+" en total con tu costo actual de "+m(cpr)+"."}}' +
    '["nx-meta","nx-cierre","nx-meses"].forEach(function(id){var e=$(id);if(e){e.addEventListener("input",calc);e.addEventListener("change",calc)}});calc()})();';

  var SLOTS = [
    ['slot-kpis', bloqueKpis, '01 · Calienta motores'],
    ['slot-comportamiento', bloqueComportamiento, '04 · Análisis del comportamiento'],
    ['slot-embudo', bloqueEmbudo, '05 · Datos duros — revisemos tu embudo']
  ];

  function inyectar(html, d) {
    if (!d || !html) return html;
    var out = String(html), faltan = [];
    SLOTS.forEach(function (s) {
      var re = new RegExp('<div[^>]*id=["\']' + s[0] + '["\'][^>]*>\\s*</div>', 'i');
      if (re.test(out)) out = out.replace(re, function () { return s[1](d); });
      else faltan.push(s);
    });
    var extra = faltan.map(function (s) { return '<h2 class="nx-sec-t">' + esc(s[2]) + '</h2>' + s[1](d); }).join('');
    var json = JSON.stringify({ tipo: d.tipo, etiqueta: d.etiqueta, esProspecto: d.esProspecto, gasto: d.gasto, res: d.res, cpr: d.cpr, cierre: d.cierre, cierreReal: d.cierreReal, metaDef: d.metaDef }).replace(/</g, '\\u003c');
    var inyeccion = '<style>' + CSS + '</style>';
    var cola = (extra ? '<div class="nx" style="max-width:1200px;margin:0 auto;padding:0 20px 20px">' + extra + '</div>' : '') +
      '<script>window.__NX=' + json + ';' + SCRIPT + '<\/script>';
    out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, function () { return inyeccion + '</head>'; }) : inyeccion + out;
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, function () { return cola + '</body>'; }) : out + cola;
    return out;
  }

  window.MetaTablero = { calcular: calcular, inyectar: inyectar, _parseCsv: parseCsv, _pNum: pNum };
})();
