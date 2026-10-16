/* Pastilla de FOCO de un Jefe: "Tu ecosistema completo" o un producto/servicio en particular.
   PILOTO: por ahora solo la carga Jefe de Finanzas. Para usarla en otro Jefe basta con:
     1) un <div id="foco-slot"></div> junto a la pastilla "<< Hub de Jefes" de la barra fija,
     2) <script src="/js/jefes-foco.js"></script> despues de /js/storage-client.js,
     3) que la pagina escuche window.__foco.onChange(fn) y cargue/guarde SUS datos por foco.
   Las opciones salen del Catalogo del ADN (llave "<hub>:catalogo-productos", la misma de la que
   ya leen Anuncios, Temporada y 366: el id del catalogo es el producto_id). Nada de marca va
   escrito aqui. El foco elegido se recuerda por navegador y por hub (localStorage), asi que es
   el mismo en todas las paginas de Jefes de ese hub.
   OPCIONAL: una pagina puede declarar window.__focoConfig = { grupos: true } ANTES de cargar este
   script para que cada grupo de negocio tambien se pueda elegir completo ("Todo el grupo: X", id
   'g:<grupo_id>'). Sin esa bandera el comportamiento es el de siempre (solo ecosistema o producto). */
(function () {
  'use strict';
  var slot = document.getElementById('foco-slot');
  if (!slot) return;

  var hub = (window.__hub && window.__hub.slug) || 'jefeshub';
  var LS_KEY = 'jefeshub_foco_' + hub;
  var TODO = 'all';
  var lista = [];
  var grupos = [];
  var conGrupos = !!(window.__focoConfig && window.__focoConfig.grupos);
  // OPCIONAL (window.__focoConfig.productos366): suma las ofertas de "Producto 366" de Jefe 366 que todavia
  // no estan en el Catalogo del ADN (id '366-<nombre-sin-acentos>'), para poder enfocarse en ellas.
  var conOfertas366 = !!(window.__focoConfig && window.__focoConfig.productos366);
  var actual = { id: TODO, nombre: '', item: null, grupo: null };
  var oyentes = [];

  // ---------- estilos (piel blanca, mismos tokens que el resto de los Jefes) ----------
  var css = document.createElement('style');
  css.textContent = [
    '.foco-wrap{position:relative;min-width:0;max-width:100%}',
    '.foco-pill{display:inline-flex;align-items:center;gap:8px;max-width:100%;font-family:Inter,sans-serif;font-weight:700;font-size:14px;color:#1A1A1A;background:#F3F3F3;border:1px solid #E2E2E2;border-radius:100px;padding:7px 14px;cursor:pointer;transition:.15s}',
    '.foco-pill:hover{border-color:#4E7A00}',
    '.foco-pill.on{background:#C0F800;border-color:#C0F800}',
    '.foco-txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:280px}',
    '.foco-caret{font-size:11px;opacity:.7;flex:0 0 auto}',
    '.foco-menu{position:absolute;top:calc(100% + 8px);left:0;z-index:80;width:340px;max-width:calc(100vw - 20px);max-height:min(70vh,460px);overflow:auto;background:#fff;border:1px solid #E2E2E2;border-radius:16px;box-shadow:0 12px 32px rgba(0,0,0,.14);padding:8px;text-align:left}',
    '.foco-menu[hidden]{display:none}',
    '.foco-titulo{font-family:Inter,sans-serif;font-size:12px;font-weight:700;color:#5F5F5F;padding:8px 10px 4px}',
    '.foco-op{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;background:none;border:none;border-radius:10px;padding:10px;font-family:Inter,sans-serif;font-size:15px;font-weight:600;color:#1A1A1A;cursor:pointer}',
    '.foco-op:hover{background:#F3F3F3}',
    '.foco-op.sel{background:#F1FFC2}',
    '.foco-op .n{overflow:hidden;text-overflow:ellipsis;min-width:0}',
    '.foco-op small{font-weight:500;color:#5F5F5F;white-space:nowrap;flex:0 0 auto}',
    '.foco-sub{display:block;font-weight:500;font-size:12.5px;color:#5F5F5F;margin-top:2px}',
    '.foco-pie{border-top:1px solid #E2E2E2;margin-top:6px;padding:10px 10px 6px;font-family:Inter,sans-serif;font-size:13.5px;color:#5F5F5F}',
    '.foco-pie a{color:#4E7A00;font-weight:600;text-decoration:underline}',
    '@media (max-width:1200px){.foco-txt{max-width:175px}}',
    '@media (max-width:720px){.foco-wrap{width:100%}.foco-pill{width:100%;justify-content:center}.foco-menu{left:0;right:0;width:auto}}'
  ].join('\n');
  document.head.appendChild(css);

  // ---------- estado ----------
  function leerLS() {
    try { var v = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); return v && v.id ? v : null; } catch (e) { return null; }
  }
  function guardarLS() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ id: actual.id, nombre: actual.nombre })); } catch (e) {}
  }
  function buscar(id) {
    for (var i = 0; i < lista.length; i++) if (lista[i].id === id) return lista[i];
    return null;
  }
  function buscarGrupo(id) {
    for (var i = 0; i < grupos.length; i++) if (grupos[i] && grupos[i].id === id) return grupos[i];
    return null;
  }
  function aplicar(id) {
    var grupo = conGrupos && typeof id === 'string' && id.indexOf('g:') === 0 ? buscarGrupo(id.slice(2)) : null;
    if (grupo) {
      actual = { id: id, nombre: String(grupo.nombre || '').trim(), item: null, grupo: grupo };
      return;
    }
    var item = id !== TODO ? buscar(id) : null;
    actual = item
      ? { id: item.id, nombre: String(item.nombre || '').trim(), item: item, grupo: null }
      : { id: TODO, nombre: '', item: null, grupo: null };
  }
  function foco() {
    return {
      id: actual.id, nombre: actual.nombre, item: actual.item, esTodo: actual.id === TODO,
      esGrupo: !!actual.grupo,
      // atajos para quien trabaja con grupo_id / producto_id: ecosistema = ambos vacios
      grupoId: actual.grupo ? actual.grupo.id : (actual.item ? (actual.item.grupo_id || '') : ''),
      productoId: actual.item ? actual.item.id : ''
    };
  }
  function avisar() {
    oyentes.slice().forEach(function (fn) { try { fn(foco()); } catch (e) {} });
  }
  function fijar(id) {
    var previo = actual.id;
    aplicar(id);
    guardarLS();
    pintar();
    if (actual.id !== previo) avisar();
  }

  // ---------- interfaz ----------
  var wrap = document.createElement('div');
  wrap.className = 'foco-wrap';
  var pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'foco-pill';
  pill.setAttribute('aria-haspopup', 'listbox');
  pill.setAttribute('aria-expanded', 'false');
  var txt = document.createElement('span');
  txt.className = 'foco-txt';
  var caret = document.createElement('span');
  caret.className = 'foco-caret';
  caret.textContent = '▾';
  pill.appendChild(txt);
  pill.appendChild(caret);
  var menu = document.createElement('div');
  menu.className = 'foco-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;
  wrap.appendChild(pill);
  wrap.appendChild(menu);
  slot.appendChild(wrap);

  function precioTexto(v) {
    var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) && n > 0 ? '$' + Math.round(n).toLocaleString('es-MX') : '';
  }
  function opcion(id, nombre, sub, extra) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'foco-op' + (actual.id === id ? ' sel' : '');
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', actual.id === id ? 'true' : 'false');
    var izq = document.createElement('span');
    izq.className = 'n';
    izq.textContent = (actual.id === id ? '✓ ' : '') + nombre;
    if (sub) {
      var s = document.createElement('span');
      s.className = 'foco-sub';
      s.textContent = sub;
      izq.appendChild(s);
    }
    b.appendChild(izq);
    if (extra) {
      var d = document.createElement('small');
      d.textContent = extra;
      b.appendChild(d);
    }
    b.addEventListener('click', function () { cerrar(); fijar(id); });
    return b;
  }
  function titulo(t) {
    var h = document.createElement('div');
    h.className = 'foco-titulo';
    h.textContent = t;
    return h;
  }

  function pintar() {
    var especifico = actual.id !== TODO;
    txt.textContent = especifico ? (actual.grupo ? 'Grupo: ' : '') + (actual.nombre || 'Producto') : 'Tu ecosistema completo';
    pill.classList.toggle('on', especifico);
    pill.title = especifico
      ? 'Estás trabajando solo sobre: ' + (actual.nombre || 'este producto') + '. Clic para cambiar.'
      : 'Estás trabajando sobre todo tu ecosistema. Clic para elegir un producto o servicio.';

    menu.textContent = '';
    menu.appendChild(opcion(TODO, 'Tu ecosistema completo', 'Todos tus productos y servicios juntos'));

    var conNombre = lista.filter(function (p) { return p && p.nombre; });
    if (!conNombre.length) {
      var vacio = document.createElement('div');
      vacio.className = 'foco-pie';
      vacio.style.borderTop = 'none';
      vacio.textContent = 'Todavía no hay productos en el Catálogo de tu ADN.';
      menu.appendChild(vacio);
    } else {
      var porGrupo = {};
      conNombre.forEach(function (p) { (porGrupo[p.grupo_id || ''] = porGrupo[p.grupo_id || ''] || []).push(p); });
      var orden = grupos.map(function (g) { return g.id; }).filter(function (id) { return porGrupo[id]; });
      if (porGrupo['']) orden.push('');
      orden.forEach(function (gid) {
        var g = grupos.filter(function (x) { return x.id === gid; })[0];
        menu.appendChild(titulo(g && g.nombre ? g.nombre : (grupos.length ? 'Sin grupo' : 'Productos y servicios')));
        if (conGrupos && g && g.nombre) menu.appendChild(opcion('g:' + g.id, 'Todo el grupo: ' + String(g.nombre).trim(), 'Todos los productos y servicios de este grupo'));
        porGrupo[gid].forEach(function (p) {
          menu.appendChild(opcion(p.id, String(p.nombre).trim(), p.tipo || '', precioTexto(p.precio)));
        });
      });
    }

    var pie = document.createElement('div');
    pie.className = 'foco-pie';
    var a = document.createElement('a');
    var pre = window.__hub && window.__hub.prefijo ? window.__hub.prefijo() : '';
    a.href = pre + '/adn#catalogo';
    a.textContent = 'Agregar o editar productos en el ADN';
    pie.appendChild(a);
    menu.appendChild(pie);
  }

  function abrir() { menu.hidden = false; pill.setAttribute('aria-expanded', 'true'); }
  function cerrar() { menu.hidden = true; pill.setAttribute('aria-expanded', 'false'); }
  pill.addEventListener('click', function (e) { e.stopPropagation(); menu.hidden ? abrir() : cerrar(); });
  document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) cerrar(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrar(); });

  // Si se cambia el foco en otra pestaña del navegador, esta se entera.
  window.addEventListener('storage', function (e) {
    if (e.key !== LS_KEY) return;
    var v = leerLS();
    var previo = actual.id;
    aplicar(v ? v.id : TODO);
    pintar();
    if (actual.id !== previo) avisar();
  });

  // ---------- carga del catalogo del ADN ----------
  async function leer(key) {
    try {
      var r = await window.storage.get(hub + ':' + key);
      return r && r.value ? JSON.parse(r.value) : null;
    } catch (e) { return null; }
  }
  // Suma al listado las ofertas de "Producto 366" que no estan en el Catalogo del ADN (id "366-<nombre>").
  function sumarOfertas366(ofertas) {
    (ofertas || []).forEach(function (o) {
      var nombre = String((o && o.nombre) || '').trim();
      if (!nombre) return;
      var ya = lista.some(function (p) { return String(p.nombre || '').trim().toLowerCase() === nombre.toLowerCase(); });
      if (ya) return;
      var slug = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      lista.push({ id: '366-' + slug, nombre: nombre, tipo: 'Oferta 366', precio: '', grupo_id: o.grupo_id || '', notas: String(o.que_vendemos || ''), origen366: true });
    });
  }

  var listo = (async function () {
    var cat = await leer('catalogo-productos');
    var gr = await leer('grupos-negocio');
    lista = Array.isArray(cat) ? cat.filter(function (p) { return p && p.id; }) : [];
    if (conOfertas366) {
      var of366 = await leer('brand-book.366-producto');
      if (!of366) of366 = await leer('brand-book.evergreen-producto');
      var ofertas = of366 && Array.isArray(of366.lista) ? of366.lista : (of366 && of366.nombre ? [of366] : []);
      sumarOfertas366(ofertas);
    }
    grupos = Array.isArray(gr) ? gr : [];
    var guardado = leerLS();
    aplicar(guardado ? guardado.id : TODO); // si el producto ya no existe, vuelve a "ecosistema completo"
    pintar();
  })();

  window.__foco = {
    get: foco,
    set: fijar,
    onChange: function (fn) { if (typeof fn === 'function') oyentes.push(fn); },
    lista: function () { return lista.slice(); },
    grupos: function () { return grupos.slice(); },
    registrarOfertas366: function (ofertas) {
      // Jefe 366 avisa cuando agregas o renombras un producto, para que la pastilla lo muestre al momento
      lista = lista.filter(function (p) { return !p.origen366; });
      sumarOfertas366(ofertas);
      pintar();
    },
    etiqueta: function (t) {
      // texto temporal de la pastilla (ej. un producto nuevo que todavia no tiene nombre); se borra en el siguiente cambio
      txt.textContent = String(t || '');
      pill.classList.add('on');
    },
    ready: listo
  };
  pintar();
})();
