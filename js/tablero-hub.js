/* Tablero principal del hub: una tarjeta por Jefe con lo de HOY, leído en vivo del storage del hub.
 * Sale encima del mapa de estrellas; el mapa queda chiquito en la esquina y al picarlo se abre completo.
 * Nada de datos de marca en el código: todo se lee de <hub>:... (lo llena cada Jefe y el ADN).
 * Uso: <script src="/js/tablero-hub.js"></script><script>window.__tableroHub.montar('jefeshub', { prefijo: '' })</script>
 */
(function () {
  'use strict';

  var ADN_SECCIONES = [
    ['identidad', 'Identidad'], ['visual', 'Identidad visual'], ['tono', 'Tono de voz'], ['redes', 'Redes'],
    ['audiencias', 'Audiencias'], ['metricas', 'Métricas'], ['customer_journey', 'Recorrido del cliente']
  ];
  var DIAS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var DIAS_LARGO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hoyISO() {
    try { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function aFecha(iso) { var p = String(iso).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function esISO(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ''); }
  function diasEntre(a, b) { return Math.round((aFecha(b) - aFecha(a)) / 86400000); }
  function fechaCorta(s) { var d = aFecha(s); return DIAS_LARGO[d.getDay()] + ' ' + d.getDate() + ' ' + MESES[d.getMonth()]; }
  function corta(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trim() + '…' : s; }
  function lleno(v) {
    if (v == null) return false;
    if (typeof v === 'string') return v.trim() !== '';
    if (typeof v === 'number') return true;
    if (Array.isArray(v)) return v.some(lleno);
    if (typeof v === 'object') return Object.keys(v).some(function (k) { return lleno(v[k]); });
    return !!v;
  }

  // Lo que se calcula con los datos (sin tocar la página): se prueba en tests/tablero-hub.test.js.
  function proximosEventosTemporada(agenda, hoy) {
    var ev = agenda && Array.isArray(agenda.eventos) ? agenda.eventos : [];
    return ev.filter(function (e) { return e && e.origen === 'temporada' && esISO(e.fecha) && e.fecha >= hoy; })
      .sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0; })
      .map(function (e) {
        var t = String(e.titulo || ''), i = t.indexOf(' · ');
        return { fecha: e.fecha, dias: diasEntre(hoy, e.fecha), campana: i > 0 ? t.slice(0, i) : '', accion: i > 0 ? t.slice(i + 3) : t };
      });
  }
  function porPublicar(data) {
    var lista = [];
    ['contenido', 'historias'].forEach(function (tab) {
      (data && Array.isArray(data[tab]) ? data[tab] : []).forEach(function (r) {
        if (r && (r.estado === 'proceso' || r.estado === 'programado')) lista.push({ id: r.id, tab: tab, titulo: r.gancho || r.descripcion || 'Sin título', estado: r.estado, fecha: esISO(r.fecha) ? r.fecha : '' });
      });
    });
    return lista.sort(function (a, b) {
      if (a.fecha && b.fecha) return a.fecha < b.fecha ? -1 : 1;
      if (a.fecha) return -1; if (b.fecha) return 1;
      return a.estado === 'programado' ? -1 : 1;
    });
  }
  function semana(data, hoy) {
    var h = aFecha(hoy), lunes = new Date(h); lunes.setDate(h.getDate() - ((h.getDay() + 6) % 7));
    var cuenta = {};
    ['contenido', 'historias'].forEach(function (tab) {
      (data && Array.isArray(data[tab]) ? data[tab] : []).forEach(function (r) { if (r && esISO(r.fecha)) cuenta[r.fecha] = (cuenta[r.fecha] || 0) + 1; });
    });
    var out = [];
    for (var i = 0; i < 7; i++) { var d = new Date(lunes); d.setDate(lunes.getDate() + i); var k = iso(d); out.push({ letra: DIAS[d.getDay()], fecha: k, n: cuenta[k] || 0, hoy: k === hoy }); }
    return out;
  }
  function avanceADN(secciones) {
    var faltan = ADN_SECCIONES.filter(function (s) { return !lleno(secciones[s[0]]); }).map(function (s) { return s[1]; });
    return { pct: Math.round(100 * (ADN_SECCIONES.length - faltan.length) / ADN_SECCIONES.length), faltan: faltan };
  }
  function finanzas(calc) {
    if (!calc || typeof calc !== 'object') return null;
    var s = calc.situacion || {}, m = (calc['366'] && calc['366'].metaFacturacionMensual) || (calc.evergreen && calc.evergreen.metaFacturacionMensual) || null;
    var fac = typeof s.facturacionActual === 'number' ? s.facturacionActual : null;
    var ventas = typeof s.ventasActuales === 'number' && s.ventasActuales >= 0 ? s.ventasActuales : null;
    if (m && fac != null) return { tipo: 'meta', pct: Math.min(100, Math.round(100 * fac / m)), meta: m, fac: fac };
    if (ventas != null) return { tipo: 'ventas', ventas: ventas, conMeta: !!m };
    return null;
  }

  var CSS = '' +
    '#tablero{position:fixed;inset:0;z-index:30;overflow:auto;background:#F6F7F1;color:#0F0E0C;font-family:Barlow,sans-serif;' +
    '--blanco:#FFFFFF;--gris-fondo:#F6F7F1;--gris-borde:#E4E6DB;--negro:#0F0E0C;--lima:#C9F507;--oliva:#A4B41C;--gris-texto:#5D6055;}' +
    'body.modo-mapa #tablero{display:none;}' +
    '#tablero *{box-sizing:border-box;}#tablero a{color:inherit;text-decoration:none;}' +
    '#tablero .wrap{max-width:1240px;margin:0 auto;padding:28px 24px 90px;}' +
    '#tablero header{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:22px;}' +
    '#tablero .marca{font-family:"Bebas Neue",sans-serif;font-size:38px;letter-spacing:.04em;line-height:1;}' +
    // Nombre del negocio (del ADN) junto a HUB DE JEFES, misma letra, en verde oliva (el lima no se lee sobre fondo claro).
    '#tablero .marca-cliente{color:var(--oliva);margin-left:.15em;}#tablero .marca-cliente:empty{display:none;}' +
    '#tablero h1{font-family:"Inter Tight",sans-serif;font-weight:900;font-size:clamp(28px,4vw,44px);letter-spacing:-.035em;margin:6px 0 0;line-height:1.05;}' +
    '#tablero .resalta{background:var(--lima);padding:0 .18em;border-radius:4px;}' +
    '#tablero .fecha{font-size:14px;color:var(--gris-texto);font-weight:600;margin-top:10px;}' +
    '#tablero .mapa-mini{width:250px;height:148px;border-radius:16px;overflow:hidden;position:relative;cursor:pointer;border:1px solid #262D10;' +
    'background:radial-gradient(ellipse 120% 80% at 50% 0%,#1A2510 0%,#0D1008 60%);box-shadow:0 10px 26px rgba(15,14,12,.18);transition:transform .18s;flex:none;}' +
    '#tablero .mapa-mini:hover{transform:translateY(-2px);}' +
    '#tablero .mapa-mini svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;}' +
    '#tablero .mapa-mini span{position:absolute;left:10px;bottom:10px;background:var(--lima);color:var(--negro);font:700 12px Barlow,sans-serif;padding:5px 10px;border-radius:999px;}' +
    '#tablero .etiqueta{font:700 11px Barlow,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--gris-texto);}' +
    '#tablero .chip{display:inline-block;font:700 10.5px Barlow,sans-serif;letter-spacing:.12em;text-transform:uppercase;background:var(--lima);color:var(--negro);padding:3px 8px;border-radius:4px;}' +
    '#tablero .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;}' +
    '#tablero .w{background:var(--blanco);border:1px solid var(--gris-borde);border-radius:20px;padding:20px;display:flex;flex-direction:column;gap:14px;min-width:0;}' +
    '#tablero .span2{grid-column:span 2;}' +
    '#tablero .doble{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;background:var(--blanco);border:1px solid var(--gris-borde);border-radius:20px;overflow:hidden;}' +
    '#tablero .doble>.w{border:0;border-radius:0;}#tablero .doble>.w+.w{border-left:1px solid var(--gris-borde);}' +
    '#tablero .w-top{display:flex;align-items:center;gap:12px;border-radius:12px;}' +
    '#tablero .w-top:hover .w-nombre{text-decoration:underline;text-decoration-color:var(--oliva);text-underline-offset:4px;}' +
    '#tablero .w-logo{width:46px;height:46px;flex:none;border-radius:14px;background:var(--gris-fondo);display:grid;place-items:center;}' +
    '#tablero .w-logo img{width:32px;height:32px;object-fit:contain;}' +
    '#tablero .w-nombre{font-family:"Bebas Neue",sans-serif;font-size:24px;letter-spacing:.03em;line-height:1;}' +
    '#tablero .w-que{font-size:13.5px;color:var(--gris-texto);line-height:1.3;margin-top:2px;}' +
    '#tablero .w-ir{margin-left:auto;width:32px;height:32px;border-radius:50%;border:1px solid var(--gris-borde);display:grid;place-items:center;font-weight:700;flex:none;}' +
    '#tablero .w-top:hover .w-ir{background:var(--negro);color:#fff;border-color:var(--negro);}' +
    '#tablero .w-body{flex:1;display:flex;flex-direction:column;gap:10px;}' +
    '#tablero .w-acciones{display:flex;gap:8px;flex-wrap:wrap;}' +
    '#tablero .btn{display:inline-block;font:700 14px Barlow,sans-serif;border-radius:12px;padding:10px 16px;border:1px solid var(--gris-borde);background:transparent;color:var(--negro);cursor:pointer;}' +
    '#tablero .btn.principal{background:var(--lima);border-color:var(--lima);}' +
    '#tablero .btn:hover{filter:brightness(.96);}' +
    '#tablero .preview{background:var(--negro);color:#fff;border-radius:16px;padding:18px;}' +
    '#tablero .preview .etiqueta{color:var(--lima);}' +
    '#tablero .preview .faro-top{display:flex;gap:10px;align-items:center;margin-bottom:6px;}' +
    '#tablero .preview .faro-top img{width:24px;height:24px;object-fit:contain;}' +
    '#tablero .preview h3{font-family:"Inter Tight",sans-serif;font-weight:800;letter-spacing:-.025em;font-size:22px;margin:6px 0 8px;line-height:1.15;}' +
    '#tablero .preview p{margin:0 0 8px;color:#D9DBD0;font-size:14.5px;line-height:1.45;}' +
    '#tablero .preview .gancho{font-style:italic;}' +
    '#tablero .preview .sub{font-size:13px;color:#B9BCAE;}' +
    '#tablero .preview .sub a{color:#B9BCAE;text-decoration:underline;word-break:break-all;}' +
    '#tablero .preview .btn.principal{margin-top:6px;font-size:13px;padding:8px 14px;}' +
    '#tablero .cargando{display:flex;gap:10px;align-items:center;color:#D9DBD0;font-size:14px;}' +
    '#tablero .cargando i{width:16px;height:16px;border-radius:50%;border:2px solid #444;border-top-color:var(--lima);animation:tbGira 1s linear infinite;flex:none;}' +
    '@keyframes tbGira{to{transform:rotate(360deg)}}' +
    '#tablero .num-grande{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}' +
    '#tablero .num-grande .num{font-family:"Bebas Neue",sans-serif;font-size:56px;line-height:.9;}' +
    '#tablero .barra{height:8px;background:var(--gris-fondo);border-radius:99px;overflow:hidden;border:1px solid var(--gris-borde);}' +
    '#tablero .barra i{display:block;height:100%;background:var(--lima);border-radius:99px;}' +
    '#tablero .semana{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;}' +
    '#tablero .semana div{text-align:center;font-size:11px;color:var(--gris-texto);font-weight:700;}' +
    '#tablero .semana span{display:grid;place-items:center;margin-top:4px;height:30px;border-radius:8px;background:var(--gris-fondo);border:1px solid var(--gris-borde);color:var(--negro);font-size:12px;}' +
    '#tablero .semana span.hay{background:var(--oliva);border-color:var(--oliva);}' +
    '#tablero .semana span.hoy{outline:2px solid var(--negro);outline-offset:1px;}' +
    '#tablero .lista{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;}' +
    '#tablero .lista li{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;background:var(--gris-fondo);font-size:14px;}' +
    '#tablero .lista a.fila{display:flex;align-items:center;gap:10px;width:100%;}' +
    '#tablero .lista .dot{width:8px;height:8px;border-radius:50%;background:var(--oliva);flex:none;}' +
    '#tablero .lista .txt{flex:1;min-width:0;}#tablero .lista .txt b{display:block;font-weight:600;}' +
    '#tablero .lista .txt small{color:var(--gris-texto);}' +
    '#tablero .mini-post{width:38px;height:48px;border-radius:8px;background:var(--negro);flex:none;display:grid;place-items:center;color:var(--lima);font:700 10px Barlow,sans-serif;}' +
    '#tablero .burbuja{background:var(--negro);color:#fff;border-radius:16px 16px 16px 4px;padding:12px 14px;font-size:14px;line-height:1.45;white-space:pre-line;}' +
    '#tablero .cifra{font-family:"Bebas Neue",sans-serif;font-size:52px;line-height:.9;letter-spacing:.02em;}' +
    '#tablero .cifra small{font-size:22px;color:var(--gris-texto);}' +
    '#tablero .vacio{font-size:14px;color:var(--gris-texto);line-height:1.45;}' +
    '#tablero .w.negocio{background:var(--negro);color:#fff;border-color:var(--negro);grid-column:1/-1;}' +
    '#tablero .w.negocio .etiqueta,#tablero .w.negocio .w-que{color:#B9BCAE;}' +
    '#tablero .w.negocio .barra{background:#2A2925;border-color:#2A2925;}' +
    '#tablero .neg-nombre{font-family:"Inter Tight",sans-serif;font-weight:900;font-size:26px;letter-spacing:-.03em;line-height:1.05;}' +
    '#tablero .seccion{margin:34px 0 14px;display:flex;align-items:center;gap:12px;}' +
    '#tablero .seccion h2{font-family:"Inter Tight",sans-serif;font-weight:800;font-size:22px;letter-spacing:-.025em;margin:0;}' +
    '#tablero .seccion .linea{flex:1;height:1px;background:var(--gris-borde);}' +
    '#tablero .compactos{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;}' +
    '#tablero .c{background:var(--blanco);border:1px solid var(--gris-borde);border-radius:16px;padding:14px;display:flex;gap:12px;align-items:flex-start;transition:transform .18s,box-shadow .18s;}' +
    '#tablero .c:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(15,14,12,.08);}' +
    '#tablero .c .w-logo{width:42px;height:42px;}#tablero .c .w-nombre{font-size:20px;}' +
    '#tablero .c .aviso-c{margin-top:8px;font-size:13px;font-weight:600;display:flex;gap:6px;align-items:center;}' +
    '#tablero .c .aviso-c::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--oliva);flex:none;}' +
    '#tbVolver{display:none;position:fixed;top:16px;left:16px;z-index:40;background:#C9F507;color:#0F0E0C;border:0;border-radius:999px;padding:10px 18px;font:700 14px Barlow,sans-serif;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.35);}' +
    'body.modo-mapa #tbVolver{display:block;}' +
    'body:not(.modo-mapa) .tokens-pill{z-index:40;}' +
    '@media (max-width:1000px){#tablero .grid{grid-template-columns:repeat(2,1fr);}}' +
    '@media (max-width:800px){#tablero .doble{grid-template-columns:1fr;}#tablero .doble>.w+.w{border-left:0;border-top:1px solid var(--gris-borde);}}' +
    '@media (max-width:640px){#tablero .wrap{padding:20px 16px 80px;}#tablero .grid{grid-template-columns:1fr;}#tablero .span2{grid-column:auto;}#tablero .mapa-mini{width:100%;}}' +
    '@media (prefers-reduced-motion:reduce){#tablero .c,#tablero .mapa-mini{transition:none;}#tablero .cargando i{animation:none;}}';

  function montar(hub, opciones) {
    if (!hub || document.getElementById('tablero')) return;
    opciones = opciones || {};
    var pre = opciones.prefijo || '';
    var r = function (h) { return pre + h; };
    var HOY = hoyISO();

    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    function top(logo, nombre, que, href) {
      return '<a class="w-top" href="' + esc(r(href)) + '"><div class="w-logo"><img src="/img/' + logo + '.webp" alt=""></div>' +
        '<div><div class="w-nombre">' + nombre + '</div><div class="w-que">' + que + '</div></div><span class="w-ir" aria-hidden="true">›</span></a>';
    }

    var raiz = document.createElement('main');
    raiz.id = 'tablero';
    raiz.innerHTML = '<div class="wrap">' +
      '<header><div><div class="marca">HUB DE JEFES <span class="marca-cliente" id="tbMarca"></span></div><h1>Tu equipo, <span class="resalta">listo para hoy</span></h1>' +
      '<div class="fecha" id="tbFecha"></div></div>' +
      '<button type="button" class="mapa-mini" id="tbMapaMini" aria-label="Ver el mapa con todos tus Jefes"><span>Ver todos tus Jefes ›</span></button></header>' +
      '<div class="grid">' +
        '<section class="doble">' +
          '<article class="w">' + top('jefe-366', 'JEFE 366', 'Tu estrategia base para vender los 366 días del año.', '/jefe-366') +
            '<div class="w-body"><div id="tb366Estado"></div><div class="preview" id="tbFaro"><div class="cargando"><i></i>Revisando la idea de hoy…</div></div>' +
            '<div><div class="etiqueta" style="margin-bottom:8px">Tu contenido esta semana</div><div class="semana" id="tbSemana"></div></div></div>' +
            '<div class="w-acciones"><a class="btn" href="' + esc(r('/jefe-366')) + '">Ver mi estrategia 366</a></div></article>' +
          '<article class="w">' + top('jefe-temporada-logo-negro', 'JEFE DE TEMPORADA', 'Las fechas clave del año para vender más.', '/jefe-temporada') +
            '<div class="w-body" id="tbTemporada"></div>' +
            '<div class="w-acciones"><a class="btn" href="' + esc(r('/jefe-temporada')) + '">Ver mis campañas</a></div></article>' +
        '</section>' +
        '<article class="w span2">' + top('jefe-contenido-logo-negro', 'JEFE DE CONTENIDO', 'Te escribe guiones y posts con la voz de tu marca.', '/jefe-contenido') +
          '<div class="w-body" id="tbContenido"></div></article>' +
        '<article class="w">' + top('jefe-whatsapp-logo-negro', 'WHATSAPP Y VENTAS', 'Mensajes que cierran ventas.', '/jefe-whatsapp') +
          '<div class="w-body" id="tbWhats"></div></article>' +
        '<article class="w">' + top('jefe-finanzas-logo-negro', 'FINANZAS', 'Tus números claros.', '/jefe-financiero') +
          '<div class="w-body" id="tbFinanzas"></div></article>' +
        '<a class="w negocio" href="' + esc(r('/adn')) + '" id="tbADN"><div class="etiqueta">ADN del negocio</div><div class="vacio">Cargando…</div></a>' +
      '</div>' +
      '<div class="seccion"><h2>Más Jefes</h2><span class="linea"></span></div><div class="compactos" id="tbMas"></div>' +
      '</div>';
    document.body.appendChild(raiz);

    var volver = document.createElement('button');
    volver.type = 'button'; volver.id = 'tbVolver'; volver.textContent = '‹ Volver al tablero';
    document.body.appendChild(volver);

    document.getElementById('tbFecha').textContent = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

    // ── Mapa chiquito en la esquina: copia del mapa de estrellas; al picarlo se abre completo ──
    function copiarMapa() {
      var orig = document.getElementById('hub-graph'), caja = document.getElementById('tbMapaMini');
      if (!orig || !caja || !orig.childNodes.length) return;
      var viejo = caja.querySelector('svg'); if (viejo) viejo.remove();
      var c = orig.cloneNode(true); c.removeAttribute('id'); c.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      // El mapa usa el tamaño de la ventana; si la copia se tomó antes de que tuviera tamaño, se usa el de ahora.
      var vb = String(orig.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
      if (!(vb[2] > 0 && vb[3] > 0)) c.setAttribute('viewBox', '0 0 ' + (window.innerWidth || 1200) + ' ' + (window.innerHeight || 800));
      caja.insertBefore(c, caja.firstChild);
    }
    // La animación del mapa tarda en acomodarse: se copia un par de veces y cada vez que se regresa del mapa.
    setTimeout(copiarMapa, 2500);
    setTimeout(copiarMapa, 7000);
    window.addEventListener('resize', function () { clearTimeout(copiarMapa.t); copiarMapa.t = setTimeout(copiarMapa, 1500); });
    document.getElementById('tbMapaMini').addEventListener('click', function () { document.body.classList.add('modo-mapa'); });
    volver.addEventListener('click', function () { document.body.classList.remove('modo-mapa'); copiarMapa(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.body.classList.contains('modo-mapa')) volver.click(); });

    function leer(k) {
      return Promise.resolve().then(function () { return window.storage.get(hub + ':' + k); })
        .then(function (x) { return x && x.value ? JSON.parse(x.value) : null; }, function () { return null; })
        .catch(function () { return null; });
    }
    function pinta(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }

    // ── Jefe 366: estrategia + idea del día del Faro ──
    leer('366-documento-maestro-conversacion').then(function (conv) {
      var listo = Array.isArray(conv) && conv.some(function (m) { return m && m.role === 'assistant' && String(m.content || '').length > 200; });
      pinta('tb366Estado', listo
        ? '<span class="chip">Documento Maestro listo</span>'
        : '<div class="vacio">Todavía no armas tu Documento Maestro. <a href="' + esc(r('/jefe-366')) + '" style="text-decoration:underline">Empieza aquí</a>.</div>');
    });

    function post(body) {
      return fetch('/api/consultor-radar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ cliente: hub, foco: { id: 'all', nombre: '' } }, body))
      }).then(function (x) {
        return x.json().catch(function () { return {}; }).then(function (d) { return x.ok ? { ok: true, data: d } : { ok: false, error: d.error || 'No se pudo completar.' }; });
      }, function () { return { ok: false, error: 'Hubo un error de conexión.' }; });
    }
    var faroCab = '<div class="faro-top"><img src="/img/jefe-faro-logo-blanco.webp" alt=""><span class="etiqueta">La idea de hoy · Jefe del Faro</span></div>';
    function faroCargando(t) { pinta('tbFaro', faroCab + '<div class="cargando"><i></i>' + esc(t) + '</div>'); }
    function faroAviso(t) { pinta('tbFaro', faroCab + '<p>' + esc(t) + '</p><a class="btn principal" href="' + esc(r('/jefe-radar')) + '">Abrir el Faro ›</a>'); }
    function faroIdea(e) {
      var i = e.idea || {}, t = i.tendencia || {};
      var url = /^https?:\/\//i.test(t.fuente || '') ? t.fuente : '';
      pinta('tbFaro', faroCab +
        '<h3>' + esc(i.tema) + '</h3><p class="gancho">“' + esc(i.gancho) + '”</p>' +
        (i.formato ? '<span class="chip">' + esc(i.formato) + '</span>' : '') +
        (i.por_que_te_sirve ? '<p style="margin-top:10px">' + esc(i.por_que_te_sirve) + '</p>' : '') +
        (t.que ? '<p class="sub">De dónde salió: ' + esc(t.que) + (url ? ' · <a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">fuente</a>' : '') + (t.verificada ? '' : ' (sin verificar: revísala)') + '</p>' : '') +
        '<a class="btn principal" href="' + esc(r('/jefe-radar')) + '">Revisarla en el Faro ›</a>');
    }
    var faroIdeaHoy = false;
    post({ modo: 'ideas-dia-estado' }).then(function (x) {
      if (!x.ok) { faroAviso('No pude traer la idea de hoy.'); return; }
      if (x.data.idea) { faroIdeaHoy = true; faroIdea(x.data.idea); pintaMas(); return; }
      var ficha = x.data.ficha || {};
      if (!ficha.existe && ficha.sinFuentes) { faroAviso('Para proponerte ideas, el Faro necesita saber a quién le vendes. Llena tu ADN.'); return; }
      faroCargando(ficha.existe ? 'Tu Jefe del Faro está buscando qué se mueve en tu nicho… (cerca de un minuto)' : 'Armando la ficha de tu audiencia (solo la primera vez)…');
      return (ficha.existe ? Promise.resolve() : post({ modo: 'ficha-audiencia' })).then(function () {
        faroCargando('Tu Jefe del Faro está buscando qué se mueve en tu nicho… (cerca de un minuto)');
        return post({ modo: 'idea-del-dia' });
      }).then(function (g) {
        if (!g.ok) { faroAviso('No pude armar la idea de hoy. ' + g.error); return; }
        faroIdeaHoy = true; faroIdea(g.data.idea); pintaMas();
      });
    });

    // ── Contenido (y la semana del Jefe 366) ──
    leer('agente-contenido').then(function (data) {
      pinta('tbSemana', semana(data, HOY).map(function (d) {
        return '<div>' + d.letra + '<span class="' + (d.n ? 'hay' : '') + (d.hoy ? ' hoy' : '') + '" title="' + esc(fechaCorta(d.fecha)) + '">' + (d.n || '') + '</span></div>';
      }).join(''));
      var lista = porPublicar(data);
      var ideas = data && Array.isArray(data.contenido) ? data.contenido.filter(function (x) { return x && x.estado === 'idea'; }).length : 0;
      var programados = lista.filter(function (x) { return x.estado === 'programado'; }).length;
      if (!lista.length) {
        pinta('tbContenido', '<div class="vacio">No tienes posts en proceso.' + (ideas ? ' Tienes ' + ideas + ' ideas guardadas esperando.' : '') + '</div>' +
          '<div class="w-acciones"><a class="btn principal" href="' + esc(r('/jefe-contenido')) + '">Crear un post</a></div>');
        return;
      }
      pinta('tbContenido',
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><span class="etiqueta">Por publicar</span>' +
        (programados ? '<span class="chip">' + programados + ' programado' + (programados > 1 ? 's' : '') + '</span>' : '') + '</div>' +
        '<ul class="lista">' + lista.slice(0, 3).map(function (p) {
          var cuando = p.fecha ? (p.fecha < HOY ? 'atrasado · ' : '') + fechaCorta(p.fecha) : 'sin fecha';
          return '<li><a class="fila" href="' + esc(r('/jefe-contenido#post=' + encodeURIComponent(p.id))) + '"><span class="mini-post">' + (p.tab === 'historias' ? 'HIST' : 'POST') + '</span>' +
            '<span class="txt"><b>' + esc(corta(p.titulo, 90)) + '</b><small>' + (p.estado === 'programado' ? 'Programado' : 'En proceso') + ' · ' + esc(cuando) + '</small></span></a></li>';
        }).join('') + '</ul>' +
        '<div class="vacio">' + (lista.length > 3 ? (lista.length - 3) + ' más en proceso. ' : '') + (ideas ? ideas + ' ideas guardadas.' : '') + '</div>');
    });

    // ── Temporada ──
    leer('agenda-eventos').then(function (agenda) {
      var prox = proximosEventosTemporada(agenda, HOY);
      if (!prox.length) {
        pinta('tbTemporada', '<div class="vacio">No tienes fechas de campaña próximas. Planea la siguiente para que no te agarre la fecha encima.</div>');
        return;
      }
      var p = prox[0];
      pinta('tbTemporada',
        '<div class="num-grande"><span class="num">' + (p.dias === 0 ? 'HOY' : p.dias + (p.dias === 1 ? ' DÍA' : ' DÍAS')) + '</span><span class="etiqueta">' + esc(fechaCorta(p.fecha)) + '</span></div>' +
        '<div class="preview">' + (p.campana ? '<span class="etiqueta">' + esc(p.campana) + '</span>' : '') + '<h3 style="font-size:18px">' + esc(corta(p.accion, 160)) + '</h3></div>' +
        (prox.length > 1 ? '<div><div class="etiqueta" style="margin-bottom:8px">Lo que viene</div><ul class="lista">' + prox.slice(1, 3).map(function (e) {
          return '<li><span class="dot"></span><span class="txt"><b>' + esc(corta(e.accion, 80)) + '</b><small>' + esc(fechaCorta(e.fecha)) + ' · en ' + e.dias + ' días</small></span></li>';
        }).join('') + '</ul></div>' : ''));
    });

    // ── WhatsApp ──
    leer('whatsapp-estrategia-tarjetas').then(function (t) {
      var msg = t && typeof t.s1_bienvenida === 'string' ? t.s1_bienvenida.trim() : '';
      if (!msg) { pinta('tbWhats', '<div class="vacio">Arma tus mensajes de venta con tu Jefe de WhatsApp.</div><div class="w-acciones"><a class="btn principal" href="' + esc(r('/jefe-whatsapp')) + '">Armar mensajes</a></div>'); return; }
      pinta('tbWhats', '<div class="etiqueta">Tu mensaje de bienvenida</div><div class="burbuja">' + esc(corta(msg, 220)) + '</div>' +
        '<div class="w-acciones"><button type="button" class="btn principal" id="tbCopiar">Copiar y usar</button></div>');
      document.getElementById('tbCopiar').addEventListener('click', function (ev) {
        var b = ev.currentTarget;
        if (navigator.clipboard) navigator.clipboard.writeText(msg).then(function () { b.textContent = 'Copiado ✓'; setTimeout(function () { b.textContent = 'Copiar y usar'; }, 1800); });
      });
    });

    // ── Finanzas ──
    leer('financiero-calculadora').then(function (calc) {
      var f = finanzas(calc);
      if (!f) { pinta('tbFinanzas', '<div class="vacio">Cuéntale a tu Jefe de Finanzas cómo va tu negocio y ponle una meta.</div><div class="w-acciones"><a class="btn principal" href="' + esc(r('/jefe-financiero')) + '">Poner mi meta</a></div>'); return; }
      if (f.tipo === 'meta') {
        pinta('tbFinanzas', '<div class="etiqueta">Meta del mes</div><div class="cifra">' + f.pct + '% <small>logrado</small></div><div class="barra"><i style="width:' + f.pct + '%"></i></div>' +
          '<div class="vacio">$' + f.fac.toLocaleString('es-MX') + ' de $' + f.meta.toLocaleString('es-MX') + '</div>');
      } else {
        pinta('tbFinanzas', '<div class="etiqueta">Ventas al mes hoy</div><div class="cifra">' + f.ventas + ' <small>ventas</small></div>' +
          (f.conMeta ? '' : '<div class="vacio">Ponle una meta en Finanzas para ver cuánto llevas.</div>'));
      }
    });

    // ── ADN ──
    Promise.all(ADN_SECCIONES.map(function (s) { return leer('brand-book.' + s[0]); })).then(function (vals) {
      var secc = {}; ADN_SECCIONES.forEach(function (s, i) { secc[s[0]] = vals[i]; });
      var a = avanceADN(secc), nombre = vals[0] && vals[0].nombre ? vals[0].nombre : 'Tu negocio';
      if (vals[0] && vals[0].nombre) document.getElementById('tbMarca').textContent = vals[0].nombre;
      document.getElementById('tbADN').innerHTML =
        '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><div class="etiqueta">ADN del negocio</div><div class="neg-nombre">' + esc(nombre) + '</div></div><span class="chip">' + a.pct + '%</span></div>' +
        '<div class="w-que">Lo que tus Jefes saben de ti</div><div class="barra"><i style="width:' + a.pct + '%"></i></div>' +
        '<div class="w-que">' + (a.faltan.length ? 'Te falta: ' + esc(a.faltan.join(', ')) + '. Mientras más completo, mejor escriben todos tus Jefes.' : 'Tu ADN está completo. Tus Jefes ya escriben como tú.') + '</div>';
    });

    // ── Más Jefes ──
    var mas = { anuncios: '', agenda: '' };
    function pintaMas() {
      var c = [
        ['jefe-anuncios-logo-negro', 'JEFE DE ANUNCIOS', 'Crea anuncios listos para Meta.', mas.anuncios, '/jefe-anuncios'],
        ['jefe-produccion-video-logo-negro', 'JEFE PRODUCTOR IA', 'Imágenes y videos con IA.', '', '/jefe-produccion-video'],
        ['jefe-faro-logo-negro', 'JEFE DEL FARO', 'Vigila tu mercado y competencia.', faroIdeaHoy ? 'Tu idea de hoy está lista' : '', '/jefe-radar'],
        ['jefe-resultados-logo-negro', 'JEFE DE RESULTADOS', 'Mide y mejora tus ventas.', '', '/jefe-cierre'],
        ['jefe-agenda-logo-negro', 'JEFE DE AGENDA', 'Organiza tu semana.', mas.agenda, '/jefe-agenda'],
        ['jefe-prospeccion-logo-negro', 'JEFE DE PROSPECCIÓN', 'Primer contacto con nuevos clientes.', '', '/jefe-prospeccion'],
        ['jefe-herramientas-logo-negro', 'JEFE DE HERRAMIENTAS', 'Las apps de tu negocio.', '', '/herramientas']
      ].filter(function (x) { return !(opciones.sinProspeccion && x[4] === '/jefe-prospeccion'); });
      pinta('tbMas', c.map(function (x) {
        return '<a class="c" href="' + esc(r(x[4])) + '"><div class="w-logo"><img src="/img/' + x[0] + '.webp" alt=""></div>' +
          '<div><div class="w-nombre">' + x[1] + '</div><div class="w-que">' + x[2] + '</div>' + (x[3] ? '<div class="aviso-c">' + esc(x[3]) + '</div>' : '') + '</div></a>';
      }).join(''));
    }
    pintaMas();
    leer('agente-anuncios').then(function (a) {
      var n = Array.isArray(a) ? a.length : 0;
      if (n) { mas.anuncios = n + (n === 1 ? ' anuncio guardado' : ' anuncios guardados'); pintaMas(); }
    });
    leer('agenda-eventos').then(function (ag) {
      var ev = ag && Array.isArray(ag.eventos) ? ag.eventos : [];
      var fin = iso(new Date(aFecha(HOY).getTime() + 6 * 86400000));
      var n = ev.filter(function (e) { return e && esISO(e.fecha) && e.fecha >= HOY && e.fecha <= fin; }).length;
      mas.agenda = n ? n + (n === 1 ? ' pendiente esta semana' : ' pendientes esta semana') : 'Semana libre';
      pintaMas();
    });
  }

  window.__tableroHub = {
    montar: montar,
    _probar: { proximosEventosTemporada: proximosEventosTemporada, porPublicar: porPublicar, semana: semana, avanceADN: avanceADN, finanzas: finanzas, lleno: lleno }
  };
})();
