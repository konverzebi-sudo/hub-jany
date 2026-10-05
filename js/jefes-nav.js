/* Barra lateral para cambiar de Jefe -- se carga en todas las paginas de Jefe.
   - Escondible: expandida (icono + nombre) o colapsada (solo iconos). La eleccion se recuerda.
   - Multi-tenant: el prefijo (/rancho-seco, /rim, /optica-one) se toma de la URL, igual que el hub.
   - En celular se vuelve un cajon que se abre con un boton flotante. */
(function () {
  'use strict';
  if (window.__jefesNav) return;
  window.__jefesNav = true;

  var SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
  var seg = location.pathname.split('/').filter(Boolean);
  var tenant = seg.length >= 2 && SLUG.test(seg[0]) ? seg[0] : '';
  if (!tenant) {
    // Vista previa estatica (sin rewrites de Vercel): el nombre del archivo ya dice el hub.
    var m = location.pathname.match(/-(rancho-seco|rim|optica-one)\.html$/);
    if (m) tenant = m[1];
  }
  var prefix = tenant ? '/' + tenant : '';

  // slug = ultimo tramo de la URL; files = archivo real por si se abre sin rewrites.
  var JEFES = [
    { slug: 'jefe-366',              files: ['consultor-366.html'],            icono: 'jefe-366-gris',          nombre: 'Jefe 366' },
    { slug: 'jefe-contenido',        files: ['jefe-contenido-v2.html'],        icono: 'jefe-contenido',        nombre: 'Jefe de Contenido' },
    { slug: 'jefe-whatsapp',         files: ['jefe-conversion-ventas.html', 'jefe-conversion-ventas-rancho-seco.html'], icono: 'jefe-whatsapp', nombre: 'WhatsApp y Ventas' },
    { slug: 'jefe-financiero',       files: ['consultor-financiero.html'],     icono: 'jefe-finanzas',         nombre: 'Jefe de Finanzas' },
    { slug: 'jefe-radar',            files: ['consultor-radar-mercado.html'],  icono: 'jefe-radar',            nombre: 'Jefe del Faro' },
    { slug: 'jefe-anuncios',         files: ['jefe-anuncios.html'],            icono: 'jefe-anuncios',         nombre: 'Jefe de Anuncios' },
    { slug: 'jefe-produccion-video', files: ['consultor-produccion-video.html'], icono: 'jefe-produccion-video', nombre: 'Jefe Productor IA' },
    { slug: 'jefe-cierre',           files: ['consultor-cierre.html'],         icono: 'jefe-conversion',       nombre: 'Jefe de Conversión' },
    { slug: 'jefe-optimizacion',     files: ['consultor-optimizacion.html'],   icono: 'jefe-optimizacion',     nombre: 'Jefe de Mejora Constante' },
    { slug: 'jefe-temporada',        files: ['jefe-temporada.html'],           icono: 'jefe-temporada',        nombre: 'Campañas de Temporada' },
    { slug: 'jefe-agenda',           files: ['consultor-agenda.html'],         icono: 'jefe-agenda',           nombre: 'Jefe de Agenda' }
  ];
  // Prospeccion solo existe en la plataforma principal.
  if (!tenant) {
    JEFES.push({ slug: 'jefe-prospeccion', files: ['jefe-prospeccion.html'], emoji: '🎯', nombre: 'Jefe de Prospección' });
  }

  var last = seg.length ? seg[seg.length - 1] : '';
  var file = last.indexOf('.html') > 0 ? last : '';
  function esActivo(j) {
    if (j.slug === last) return true;
    if (j.slug === 'jefe-prospeccion' && last === 'prospeccion') return true;
    return !!file && j.files.indexOf(file) >= 0;
  }

  var STORE_KEY = 'jefes-nav:colapsada';
  function leer() { try { return localStorage.getItem(STORE_KEY) === '1'; } catch (e) { return false; } }
  function guardar(v) { try { localStorage.setItem(STORE_KEY, v ? '1' : '0'); } catch (e) {} }

  var css = [
    ':root{--jn-w:248px;--jn-w-min:64px;--jn-top:70px}',
    '.jn{position:fixed;left:0;top:var(--jn-top);bottom:0;width:var(--jn-w);z-index:55;display:flex;flex-direction:column;',
    'background:var(--surface,#181120);border-right:1px solid var(--line,#332A3D);font-family:Inter,system-ui,sans-serif;',
    '}',
    '.jn-list{flex:1;overflow-y:auto;overflow-x:hidden;padding:10px 8px;display:flex;flex-direction:column;gap:2px;scrollbar-width:thin}',
    '.jn-sep{height:1px;background:var(--line,#332A3D);margin:6px 6px}',
    '.jn-item{position:relative;display:flex;align-items:center;gap:12px;height:44px;padding:0 8px;border-radius:10px;',
    'color:var(--text-dim,#B6A9C7);text-decoration:none;font-size:13.5px;font-weight:500;white-space:nowrap;border:1px solid transparent}',
    '.jn-item:hover{background:rgba(255,255,255,.05);color:var(--text,#F3EEF9)}',
    '.jn-item.is-active{background:rgba(184,247,37,.1);border-color:rgba(184,247,37,.35);color:var(--text,#F3EEF9)}',
    '.jn-ico{flex:none;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:20px;line-height:1}',
    '.jn-ico img{width:28px;height:28px;border-radius:8px;object-fit:contain;display:block}',
    '.jn-txt{overflow:hidden;text-overflow:ellipsis}',
    '.jn-foot{border-top:1px solid var(--line,#332A3D);padding:8px}',
    '.jn-toggle{display:flex;align-items:center;gap:12px;width:100%;height:40px;padding:0 8px;border:0;border-radius:10px;cursor:pointer;',
    'background:transparent;color:var(--text-dim,#B6A9C7);font:500 13px Inter,system-ui,sans-serif;white-space:nowrap}',
    '.jn-toggle:hover{background:rgba(255,255,255,.05);color:var(--text,#F3EEF9)}',
    '.jn-toggle svg{flex:none;width:28px;height:20px;transition:transform .18s ease}',
    'body.jn-on{padding-left:var(--jn-w)}',
    'body.jn-anim,body.jn-anim .jn{transition:padding-left .18s ease,width .18s ease,transform .2s ease}',
    'body.jn-on.jn-min{--jn-w:var(--jn-w-min)}',
    '.jn-min .jn{width:var(--jn-w-min)}',
    '.jn-min .jn-txt,.jn-min .jn-toggle span{display:none}',
    '.jn-min .jn-toggle svg{transform:rotate(180deg)}',
    '.jn-min .jn-item:hover::after{content:attr(data-tip);position:fixed;top:calc(var(--jn-tip-top,0px) + 9px);left:calc(var(--jn-w-min) + 8px);padding:6px 10px;border-radius:8px;',
    'background:#000;color:#fff;font-size:12px;white-space:nowrap;pointer-events:none;z-index:99}',
    '.jn-fab,.jn-scrim{display:none}',
    '@media (max-width:720px){',
    ':root{--jn-top:56px}',
    'body.jn-on{padding-left:0}',
    '.jn{width:260px;transform:translateX(-100%);box-shadow:none;z-index:90}',
    '.jn-open .jn{transform:none;box-shadow:8px 0 32px rgba(0,0,0,.5)}',
    '.jn-min .jn{width:260px}',
    '.jn-min .jn-txt,.jn-min .jn-toggle span{display:inline}',
    '.jn-foot{display:none}',
    '.jn-fab{display:flex;position:fixed;left:12px;bottom:16px;z-index:80;width:46px;height:46px;border-radius:50%;border:1px solid var(--line,#332A3D);',
    'background:var(--surface,#181120);color:var(--text,#F3EEF9);align-items:center;justify-content:center;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.45)}',
    '.jn-fab svg{width:22px;height:22px}',
    '.jn-open .jn-scrim{display:block;position:fixed;inset:0;z-index:85;background:rgba(0,0,0,.55)}',
    '.jn-open .jn-fab{display:none}',
    '}'
  ].join('');

  function chevron() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  function item(href, ico, nombre, activo) {
    return '<a class="jn-item' + (activo ? ' is-active' : '') + '" href="' + href + '" data-tip="' + esc(nombre) + '" title="' + esc(nombre) + '"' +
      (activo ? ' aria-current="page"' : '') + '><span class="jn-ico">' + ico + '</span><span class="jn-txt">' + esc(nombre) + '</span></a>';
  }

  function montar() {
    if (!document.body) return;
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    var html = '<div class="jn-list">' +
      item(prefix || '/', '🏠', 'Inicio · Mis Jefes', false) +
      item(prefix + '/adn', '🧬', 'ADN del negocio', false) +
      '<div class="jn-sep"></div>';
    JEFES.forEach(function (j) {
      var ico = j.icono ? '<img src="/img/' + j.icono + '.webp" alt="" loading="lazy">' : j.emoji;
      html += item(prefix + '/' + j.slug, ico, j.nombre, esActivo(j));
    });
    html += '</div><div class="jn-foot"><button type="button" class="jn-toggle" aria-label="Mostrar u ocultar la barra de Jefes">' +
      chevron() + '<span>Ocultar barra</span></button></div>';

    var nav = document.createElement('nav');
    nav.className = 'jn';
    nav.setAttribute('aria-label', 'Cambiar de Jefe');
    nav.innerHTML = html;

    var fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'jn-fab';
    fab.setAttribute('aria-label', 'Abrir Jefes');
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
    var scrim = document.createElement('div');
    scrim.className = 'jn-scrim';

    document.body.appendChild(nav);
    document.body.appendChild(fab);
    document.body.appendChild(scrim);
    document.body.classList.add('jn-on');
    document.body.classList.toggle('jn-min', leer());

    function ajustarTop() {
      var tb = document.querySelector('.topbar');
      var h = tb ? Math.round(tb.getBoundingClientRect().height) : 0;
      if (h > 0) document.documentElement.style.setProperty('--jn-top', h + 'px');
    }
    ajustarTop();
    window.addEventListener('resize', ajustarTop);

    var tg = nav.querySelector('.jn-toggle');
    var label = tg.querySelector('span');
    function pintarLabel() { label.textContent = document.body.classList.contains('jn-min') ? 'Mostrar nombres' : 'Ocultar barra'; }
    pintarLabel();
    tg.addEventListener('click', function () {
      document.body.classList.add('jn-anim');
      var min = !document.body.classList.contains('jn-min');
      document.body.classList.toggle('jn-min', min);
      guardar(min);
      pintarLabel();
    });

    function abrir(v) { document.body.classList.add('jn-anim'); document.body.classList.toggle('jn-open', v); }
    fab.addEventListener('click', function () { abrir(true); });
    scrim.addEventListener('click', function () { abrir(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') abrir(false); });

    // Tooltip de la barra colapsada: se alinea con la fila sobre la que esta el mouse.
    nav.addEventListener('mouseover', function (e) {
      var a = e.target.closest && e.target.closest('.jn-item');
      if (a) a.style.setProperty('--jn-tip-top', a.getBoundingClientRect().top + 'px');
    });

    // Hubs creados desde /hubs: solo se muestran los Jefes que ese hub tiene activos.
    if (tenant && ['rancho-seco', 'rim', 'optica-one'].indexOf(tenant) < 0) {
      fetch('/api/storage/' + encodeURIComponent('hubs:registro'), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
        var v = d && d.value; if (typeof v === 'string') v = JSON.parse(v);
        var h = ((v && v.hubs) || []).filter(function (x) { return x.slug === tenant; })[0];
        if (!h || !Array.isArray(h.jefes)) return;
        nav.querySelectorAll('.jn-item').forEach(function (a) {
          var slug = (a.getAttribute('href') || '').split('/').pop();
          if (slug.indexOf('jefe-') === 0 && h.jefes.indexOf(slug) < 0) a.style.display = 'none';
        });
      }).catch(function () {});
    }

    var activo = nav.querySelector('.is-active');
    if (activo && activo.scrollIntoView) activo.scrollIntoView({ block: 'nearest' });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();
