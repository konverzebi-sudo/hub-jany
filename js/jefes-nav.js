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
    { slug: 'jefe-anuncios',         files: ['jefe-anuncios.html'],            icono: 'jefe-anuncios-logo-negro', iconoOscuro: 'jefe-anuncios-logo-blanco', nombre: 'Jefe de Anuncios' },
    { slug: 'jefe-contenido',        files: ['jefe-contenido-v2.html'],        icono: 'jefe-contenido-logo-negro', iconoOscuro: 'jefe-contenido-logo-blanco', nombre: 'Jefe de Contenido' },
    { slug: 'jefe-produccion-video', files: ['consultor-produccion-video.html'], icono: 'jefe-produccion-video-logo-negro', iconoOscuro: 'jefe-produccion-video-logo-blanco', nombre: 'Jefe Productor IA' },
    { slug: 'jefe-whatsapp',         files: ['jefe-conversion-ventas.html', 'jefe-conversion-ventas-rancho-seco.html'], icono: 'jefe-whatsapp-logo-negro', iconoOscuro: 'jefe-whatsapp-logo-blanco', nombre: 'WhatsApp y Ventas' },
    { slug: 'jefe-financiero',       files: ['consultor-financiero.html'],     icono: 'jefe-finanzas-logo-negro', iconoOscuro: 'jefe-finanzas-logo-blanco', nombre: 'Jefe de Finanzas' },
    { slug: 'jefe-radar',            files: ['consultor-radar-mercado.html'],  icono: 'jefe-radar',            nombre: 'Jefe del Faro' },
    { slug: 'jefe-cierre',           files: ['consultor-cierre.html'],         icono: 'jefe-conversion',       nombre: 'Jefe de Conversión' },
    { slug: 'jefe-optimizacion',     files: ['consultor-optimizacion.html'],   icono: 'jefe-optimizacion',     nombre: 'Jefe de Mejora Constante' },
    { slug: 'jefe-temporada',        files: ['jefe-temporada.html'],           icono: 'jefe-temporada',        nombre: 'Campañas de Temporada' },
    { slug: 'jefe-agenda',           files: ['consultor-agenda.html'],         icono: 'jefe-agenda',           nombre: 'Jefe de Agenda' },
    { slug: 'herramientas',         files: ['jefe-herramientas.html'],        icono: 'jefe-herramientas-logo-negro', iconoOscuro: 'jefe-herramientas-logo-blanco', nombre: 'Jefe de Herramientas' }
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
    '.jn-spacer{flex:1;min-height:18px}',
    '.jn-sec{padding:4px 12px 2px;font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim,#B6A9C7);opacity:.7;white-space:nowrap}',
    '.jn-min .jn-sec{display:none}',
    '.jn-item{position:relative;display:flex;align-items:center;gap:12px;height:44px;padding:0 8px;border-radius:10px;',
    'color:var(--text-dim,#B6A9C7);text-decoration:none;font-size:13.5px;font-weight:500;white-space:nowrap;border:1px solid transparent}',
    '.jn-item:hover{background:rgba(255,255,255,.05);color:var(--text,#F3EEF9)}',
    '.jn-item.is-active{background:rgba(184,247,37,.1);border-color:rgba(184,247,37,.35);color:var(--text,#F3EEF9)}',
    '.jn-home{height:36px;padding:0 12px;font-weight:700;font-size:12.5px;letter-spacing:.06em}',
    '.jn-min .jn-home{display:none}',
    '.jn-ico{flex:none;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:20px;line-height:1}',
    '.jn-ico img{width:28px;height:28px;border-radius:8px;object-fit:contain;display:block}',
    '.jn-ico img[src*="jefe-366-gris"]{width:38px;height:auto;max-height:22px;border-radius:0;margin:0 -5px}',
    '.jn-ico img[src*="jefe-produccion-video-logo"],.jn-ico img[src*="jefe-whatsapp-logo"],.jn-ico img[src*="jefe-finanzas-logo"]{width:30px;height:auto;max-height:28px;border-radius:0;margin:0 -1px}',
    '.jn-ico img[src*="jefe-herramientas-logo"]{width:auto;height:28px;max-width:30px;border-radius:0}',
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
    // Redes del negocio: fila de iconos al final de la lista (mismos datos que el ADN, seccion Redes).
    '.jn-redes{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:8px 4px 4px}',
    '.jn-red{flex:none;width:30px;height:30px;box-sizing:border-box;border-radius:50%;border:2px solid currentColor;display:flex;align-items:center;justify-content:center;',
    'color:var(--text,#F3EEF9);text-decoration:none;transition:transform .15s,color .15s}',
    '.jn-red:hover{transform:translateY(-2px);color:#B8F725}',
    '.jn-red svg{width:15px;height:15px}',
    '.jn-red-add{border-color:#B8F725;background:#B8F725;color:#0F0B16;cursor:pointer;padding:0}',
    '.jn-red-add:hover{color:#0F0B16}',
    'button.jn-red{background:transparent;cursor:pointer;padding:0}',
    '.jn-red-off{opacity:.38;border-style:dashed}',
    '.jn-red-off:hover{opacity:1}',
    '.jn-min .jn-redes{flex-direction:column;padding:8px 0 4px}',
    '.jn-rm{position:fixed;inset:0;z-index:120;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px}',
    '.jn-rm-box{width:100%;max-width:420px;max-height:calc(100vh - 32px);overflow-y:auto;background:var(--surface,#181120);color:var(--text,#F3EEF9);',
    'border:1px solid var(--line,#332A3D);border-radius:16px;padding:20px;font-family:Inter,system-ui,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.5)}',
    '.jn-rm-box h3{margin:0 0 4px;font-size:17px}',
    '.jn-rm-box p{margin:0 0 14px;font-size:12.5px;color:var(--text-dim,#B6A9C7);line-height:1.45}',
    '.jn-rm-f{display:flex;align-items:center;gap:10px;margin-bottom:10px}',
    '.jn-rm-f .jn-red{width:30px;height:30px}',
    '.jn-rm-f label{display:block;font-size:11.5px;color:var(--text-dim,#B6A9C7);margin-bottom:3px}',
    '.jn-rm-f input{width:100%;box-sizing:border-box;height:38px;padding:0 10px;border-radius:9px;border:1px solid var(--line,#332A3D);',
    'background:transparent;color:inherit;font:16px Inter,system-ui,sans-serif}',
    '.jn-rm-f div{flex:1}',
    '.jn-rm-act{display:flex;align-items:center;gap:10px;margin-top:16px}',
    '.jn-rm-act button{height:40px;padding:0 16px;border-radius:10px;border:1px solid var(--line,#332A3D);background:transparent;color:inherit;font:600 14px Inter,system-ui,sans-serif;cursor:pointer}',
    '.jn-rm-act .jn-rm-ok{background:#B8F725;border-color:#B8F725;color:#0F0B16}',
    '.jn-rm-st{font-size:12.5px;margin-left:auto}',
    '.jn-cm{position:fixed;z-index:121;min-width:170px;padding:6px;border-radius:12px;background:var(--surface,#181120);color:var(--text,#F3EEF9);',
    'border:1px solid var(--line,#332A3D);box-shadow:0 12px 32px rgba(0,0,0,.35);font-family:Inter,system-ui,sans-serif}',
    '.jn-cm-t{padding:6px 10px 4px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-dim,#B6A9C7)}',
    '.jn-cm button{display:block;width:100%;text-align:left;padding:9px 10px;border:0;border-radius:8px;background:transparent;color:inherit;font:500 13.5px Inter,system-ui,sans-serif;cursor:pointer}',
    '.jn-cm button:hover{background:rgba(127,127,127,.14)}',
    '.jn-cm .jn-cm-del{color:#EF4444}',
    '.jn-fab,.jn-scrim{display:none}',
    '@media (max-width:720px){',
    ':root{--jn-top:56px}',
    'body.jn-on{padding-left:0}',
    '.jn{width:260px;transform:translateX(-100%);box-shadow:none;z-index:90}',
    '.jn-open .jn{transform:none;box-shadow:8px 0 32px rgba(0,0,0,.5)}',
    '.jn-min .jn{width:260px}',
    '.jn-min .jn-txt,.jn-min .jn-toggle span{display:inline}',
    '.jn-min .jn-home{display:flex}',
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

  // ── Redes del negocio ─────────────────────────────────────────
  // Misma llave y forma que el ADN (seccion Redes y Contenido): { website:{handle,link}, ..., whatsapp:{numero,ctas} }.
  var REDES_KEY = (tenant || 'jefeshub') + ':brand-book.redes';
  function sinArroba(h) { return h.replace(/^@/, ''); }
  var REDES = [
    { key: 'website',   nombre: 'Sitio web', ph: 'tudominio.com', link: function (h) { return 'https://' + h; },
      svg: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" fill="none" stroke="currentColor" stroke-width="2"/>' },
    { key: 'facebook',  nombre: 'Facebook', ph: 'usuario o página', link: function (h) { return 'https://facebook.com/' + h; },
      svg: '<path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.6 1.6-1.6h1.7V4.4c-.3 0-1.3-.1-2.5-.1-2.4 0-4.1 1.5-4.1 4.3v2.2H7.5V14h2.7v8z" fill="currentColor"/>' },
    { key: 'instagram', nombre: 'Instagram', ph: '@usuario', link: function (h) { return 'https://instagram.com/' + sinArroba(h); },
      svg: '<rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.2" cy="6.8" r="1.2" fill="currentColor"/>' },
    { key: 'tiktok',    nombre: 'TikTok', ph: '@usuario', link: function (h) { return 'https://tiktok.com/@' + sinArroba(h); },
      svg: '<path d="M16.2 3c.3 2.3 1.7 3.8 4 4v3.1c-1.5 0-2.8-.4-4-1.2v6.2a5.6 5.6 0 1 1-5.6-5.6h.6v3.2a2.5 2.5 0 1 0 1.8 2.4V3z" fill="currentColor"/>' },
    { key: 'youtube',   nombre: 'YouTube', ph: '@canal', link: function (h) { return 'https://youtube.com/@' + sinArroba(h); },
      svg: '<rect x="2.5" y="5.5" width="19" height="13" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 9v6l5-3z" fill="currentColor"/>' },
    { key: 'linkedin',  nombre: 'LinkedIn', ph: 'usuario', link: function (h) { return 'https://linkedin.com/in/' + sinArroba(h); },
      svg: '<path d="M5 9.5h3V20H5zM6.5 4a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5zM10.5 9.5h2.9v1.5c.5-.9 1.7-1.8 3.4-1.8 3 0 3.7 2 3.7 4.6V20h-3v-5.5c0-1.3 0-2.9-1.8-2.9s-2.1 1.4-2.1 2.8V20h-3.1z" fill="currentColor"/>' },
    { key: 'whatsapp',  nombre: 'WhatsApp', ph: 'número con lada, ej. 5215512345678',
      svg: '<path d="M4 20l1.2-3.9A8.3 8.3 0 1 1 8 18.9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9.2 8.6c.2-.4.6-.4.8-.4h.5c.2 0 .4.1.5.4l.7 1.6c.1.2 0 .5-.1.7l-.5.6c.6 1.1 1.5 2 2.6 2.6l.6-.5c.2-.2.5-.2.7-.1l1.6.7c.3.1.4.3.4.6v.4c0 .5-.3.9-.8 1.1-.6.2-1.6.3-3.3-.6-1.7-.9-3.1-2.5-3.7-4-.5-1.4-.2-2.4.2-3.1z" fill="currentColor"/>' }
  ];
  function waLink(numero, mensaje) {
    var n = String(numero || '').replace(/[^\d]/g, '');
    if (!n) return '';
    if (n.length === 10) n = '52' + n; // numero de Mexico sin lada de pais: wa.me la necesita
    return 'https://wa.me/' + n + (mensaje ? '?text=' + encodeURIComponent(mensaje) : '');
  }
  // Acepta @usuario o el link completo (con o sin https://) sin volver a pegarle el dominio.
  function urlDe(r, h) {
    if (!h) return '';
    if (/^https?:\/\//i.test(h)) return h;
    if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(h)) return 'https://' + h;
    return r.link(h);
  }
  function linkDe(r, data) {
    var d = data[r.key] || {};
    if (r.key === 'whatsapp') return waLink(d.numero);
    return urlDe(r, d.handle || '');
  }
  function valorDe(r, data) {
    var d = data[r.key] || {};
    return (r.key === 'whatsapp' ? d.numero : d.handle) || '';
  }
  function svgRed(r) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + r.svg + '</svg>'; }

  async function leerRedes() {
    if (!window.storage) return {};
    try {
      var res = await window.storage.get(REDES_KEY);
      var v = res && res.value;
      if (typeof v === 'string') v = JSON.parse(v);
      return v && typeof v === 'object' ? v : {};
    } catch (e) { return {}; }
  }

  function pintarRedes(cont, data) {
    // Todas las redes se ven: con link abren la red; sin link (tenue) abren el editor de esa red.
    // Clic derecho (o dejar presionado en celular) edita el link de esa red.
    var html = '';
    REDES.forEach(function (r) {
      var url = linkDe(r, data);
      if (url) {
        html += '<a class="jn-red" data-k="' + r.key + '" href="' + esc(url) + '" target="_blank" rel="noopener" title="' + esc(r.nombre) + ' (clic derecho para editar)" aria-label="' + esc(r.nombre) + '">' + svgRed(r) + '</a>';
      } else {
        html += '<button type="button" class="jn-red jn-red-off" data-k="' + r.key + '" title="Agregar ' + esc(r.nombre) + '" aria-label="Agregar ' + esc(r.nombre) + '">' + svgRed(r) + '</button>';
      }
    });
    html += '<button type="button" class="jn-red jn-red-add" title="Agregar o editar mis redes" aria-label="Agregar o editar mis redes">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></button>';
    cont.innerHTML = html;
  }

  // Pone el valor de una red en el objeto del ADN (vacio = borrar), con la misma forma que guarda el ADN.
  function aplicarRed(actual, k, val) {
    var r = REDES.filter(function (x) { return x.key === k; })[0];
    if (k === 'whatsapp') {
      var wa = actual.whatsapp || {};
      wa.numero = val;
      if (Array.isArray(wa.ctas)) wa.ctas.forEach(function (c) { c.link = waLink(val, c.mensaje || ''); });
      actual.whatsapp = wa;
    } else {
      var d = actual[k] || {};
      d.handle = val;
      d.link = urlDe(r, val);
      actual[k] = d;
    }
  }

  // soloKey: edita solo esa red; sin el, todas.
  function abrirEditorRedes(data, alGuardar, soloKey) {
    var box = document.createElement('div');
    box.className = 'jn-rm';
    var lista = soloKey ? REDES.filter(function (r) { return r.key === soloKey; }) : REDES;
    var titulo = soloKey ? (valorDe(lista[0], data) ? 'Editar ' : 'Agregar ') + lista[0].nombre : 'Mis redes y sitio web';
    var campos = lista.map(function (r) {
      return '<div class="jn-rm-f"><span class="jn-red">' + svgRed(r) + '</span><div><label for="jn-rm-' + r.key + '">' + esc(r.nombre) + '</label>' +
        '<input id="jn-rm-' + r.key + '" data-k="' + r.key + '" placeholder="' + esc(r.ph) + '" value="' + esc(valorDe(r, data)) + '" autocomplete="off"></div></div>';
    }).join('');
    box.innerHTML = '<div class="jn-rm-box" role="dialog" aria-modal="true" aria-labelledby="jn-rm-t">' +
      '<h3 id="jn-rm-t">' + esc(titulo) + '</h3>' +
      '<p>Se guarda en tu ADN (Redes y Contenido) y aparece en la barra de todos tus Jefes. Puedes pegar el link completo o tu @usuario.' + (soloKey ? '' : ' Deja vacío lo que no uses.') + '</p>' +
      campos +
      '<div class="jn-rm-act"><button type="button" class="jn-rm-ok">Guardar</button><button type="button" class="jn-rm-x">Cancelar</button><span class="jn-rm-st"></span></div></div>';
    document.body.appendChild(box);
    var st = box.querySelector('.jn-rm-st');
    function cerrar() { box.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') cerrar(); }
    document.addEventListener('keydown', onKey);
    box.addEventListener('click', function (e) { if (e.target === box) cerrar(); });
    box.querySelector('.jn-rm-x').addEventListener('click', cerrar);
    box.querySelector('input').focus();

    box.querySelector('.jn-rm-ok').addEventListener('click', async function () {
      var btn = this;
      btn.disabled = true;
      st.style.color = ''; st.textContent = 'Guardando…';
      try {
        // Se relee lo ultimo guardado para no pisar lo demas del ADN (contenido, mensajes de WhatsApp, ubicacion...).
        var actual = await leerRedes();
        box.querySelectorAll('input[data-k]').forEach(function (inp) {
          aplicarRed(actual, inp.getAttribute('data-k'), inp.value.trim());
        });
        await window.storage.set(REDES_KEY, JSON.stringify(actual));
        alGuardar(actual);
        cerrar();
      } catch (e) {
        btn.disabled = false;
        st.style.color = '#F87171';
        st.textContent = e && e.status === 401 ? 'Token incorrecto, intenta de nuevo.' : 'No se pudo guardar.';
      }
    });
  }

  function montarRedes(nav) {
    var cont = nav.querySelector('.jn-redes');
    if (!cont) return;
    var data = {};
    pintarRedes(cont, data);
    leerRedes().then(function (d) { data = d; pintarRedes(cont, data); });
    function editar(soloKey) {
      if (!window.storage) return;
      document.body.classList.remove('jn-open');
      // Se abre con lo ultimo guardado por si se edito en el ADN en otra pestaña.
      leerRedes().then(function (d) {
        data = d;
        abrirEditorRedes(data, function (nuevo) { data = nuevo; pintarRedes(cont, data); }, soloKey);
      });
    }
    cont.addEventListener('click', function (e) {
      var b = e.target.closest('.jn-red-add, .jn-red-off');
      if (b) editar(b.getAttribute('data-k') || '');
    });
    // Clic derecho (o dejar presionado en celular): menu Copiar link / Editar / Borrar.
    var menu = null;
    function cerrarMenu() {
      if (!menu) return;
      menu.remove(); menu = null;
      document.removeEventListener('mousedown', fuera, true);
      document.removeEventListener('keydown', escMenu);
      window.removeEventListener('scroll', cerrarMenu, true);
    }
    function fuera(e) { if (menu && !menu.contains(e.target)) cerrarMenu(); }
    function escMenu(e) { if (e.key === 'Escape') cerrarMenu(); }
    async function borrar(k) {
      var r = REDES.filter(function (x) { return x.key === k; })[0];
      if (!confirm('¿Borrar el link de ' + r.nombre + '? También se borra de tu ADN.')) return;
      try {
        var actual = await leerRedes();
        aplicarRed(actual, k, '');
        await window.storage.set(REDES_KEY, JSON.stringify(actual));
        data = actual; pintarRedes(cont, data);
      } catch (e) {
        alert(e && e.status === 401 ? 'Token incorrecto, intenta de nuevo.' : 'No se pudo borrar.');
      }
    }
    cont.addEventListener('contextmenu', function (e) {
      var a = e.target.closest('.jn-red[data-k]');
      if (!a) return;
      e.preventDefault();
      var k = a.getAttribute('data-k');
      // Sin link no hay que copiar ni borrar: se abre directo para agregarlo.
      if (a.classList.contains('jn-red-off')) { editar(k); return; }
      cerrarMenu();
      var r = REDES.filter(function (x) { return x.key === k; })[0];
      var url = a.getAttribute('href');
      menu = document.createElement('div');
      menu.className = 'jn-cm';
      menu.setAttribute('role', 'menu');
      menu.innerHTML = '<div class="jn-cm-t">' + esc(r.nombre) + '</div>' +
        '<button type="button" role="menuitem" data-a="copiar">Copiar link</button>' +
        '<button type="button" role="menuitem" data-a="editar">Editar</button>' +
        '<button type="button" role="menuitem" data-a="borrar" class="jn-cm-del">Borrar</button>';
      document.body.appendChild(menu);
      var x = Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8);
      var y = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8);
      menu.style.left = Math.max(8, x) + 'px';
      menu.style.top = Math.max(8, y) + 'px';
      menu.addEventListener('click', function (ev) {
        var b = ev.target.closest('button[data-a]');
        if (!b) return;
        var acc = b.getAttribute('data-a');
        if (acc === 'copiar') {
          var listo = function () { b.textContent = 'Copiado ✓'; setTimeout(cerrarMenu, 700); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(listo, function () { prompt('Copia el link:', url); cerrarMenu(); });
          else { prompt('Copia el link:', url); cerrarMenu(); }
          return;
        }
        cerrarMenu();
        if (acc === 'editar') editar(k);
        else if (acc === 'borrar') borrar(k);
      });
      document.addEventListener('mousedown', fuera, true);
      document.addEventListener('keydown', escMenu);
      window.addEventListener('scroll', cerrarMenu, true);
    });
  }

  function montar() {
    if (!document.body) return;
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    var nav = document.createElement('nav');
    nav.className = 'jn';
    nav.setAttribute('aria-label', 'Cambiar de Jefe');
    document.body.appendChild(nav);

    // Logos sin fondo: el negro se ve sobre paginas claras; sobre paginas oscuras se usa el blanco.
    var rgb = (getComputedStyle(nav).backgroundColor.match(/[0-9.]+/g) || []).map(Number);
    var claro = rgb.length >= 3 && (rgb.length < 4 || rgb[3] > 0) && (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) > 150;

    var html = '<div class="jn-list">' +
      '<a class="jn-item jn-home" href="' + (prefix || '/') + '"><span class="jn-txt">MIS JEFES</span></a>' +
      '<div class="jn-sep"></div>';
    JEFES.forEach(function (j) {
      var archivo = (!claro && j.iconoOscuro) ? j.iconoOscuro : j.icono;
      var ico = archivo ? '<img src="/img/' + archivo + '.webp" alt="" loading="lazy">' : j.emoji;
      html += item(prefix + '/' + j.slug, ico, j.nombre, esActivo(j));
    });
    // Redes del negocio y luego Configuracion (ADN) al final de la lista, con un espacio antes.
    html += '<div class="jn-spacer"></div><div class="jn-redes" aria-label="Mis redes"></div>' +
      '<div class="jn-sep"></div><div class="jn-sec">Configuración</div>' +
      item(prefix + '/adn', '🧬', 'ADN del negocio', false);
    html += '</div><div class="jn-foot"><button type="button" class="jn-toggle" aria-label="Mostrar u ocultar la barra de Jefes">' +
      chevron() + '<span>Ocultar barra</span></button></div>';

    nav.innerHTML = html;
    montarRedes(nav);

    var fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'jn-fab';
    fab.setAttribute('aria-label', 'Abrir Jefes');
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
    var scrim = document.createElement('div');
    scrim.className = 'jn-scrim';

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

    // Aviso de tope de tokens (js/saldo.js): solo aparece si el hub va arriba del 90% o ya llegó al tope.
    var sc = document.createElement('script');
    sc.src = '/js/saldo.js';
    sc.onload = function () { if (window.__saldo) window.__saldo.montarEnJefe(tenant || 'jefeshub'); };
    document.head.appendChild(sc);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();
