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
   'g:<grupo_id>'). Sin esa bandera el comportamiento es el de siempre (solo ecosistema o producto).
   MODO TEMPORADA (solo Jefe de Temporada): window.__focoConfig.temporada = { campanas: fn, crear: fn }. La pastilla
   deja de listar el Catalogo y lista las campanas de temporada (por producto); los productos que todavia no tienen
   campana salen abajo como "Jefe 366" y al elegirlos te mandan a Jefe 366; y hay un boton "Crear campana de
   temporada nueva" que llama a crear(). La pagina avisa con window.__foco.refrescar() cuando cambian sus campanas. */
(function () {
  'use strict';
  var slot = document.getElementById('foco-slot');
  if (!slot) return;

  var hub = (window.__hub && window.__hub.slug) || 'jefeshub';
  var cfgT = window.__focoConfig && window.__focoConfig.temporada && typeof window.__focoConfig.temporada.campanas === 'function' ? window.__focoConfig.temporada : null;
  var modoTemporada = !!cfgT;
  // En modo temporada el foco es una campana, no un producto: se recuerda aparte para no pisar el foco de los demas Jefes.
  var LS_KEY = (modoTemporada ? 'jefeshub_foco_temporada_' : 'jefeshub_foco_') + hub;
  var TODO = 'all';
  var lista = [];
  var grupos = [];
  var conGrupos = !!(window.__focoConfig && window.__focoConfig.grupos);
  // OPCIONAL (window.__focoConfig.productos366): suma las ofertas de "Producto 366" de Jefe 366 que todavia
  // no estan en el Catalogo del ADN (id '366-<nombre-sin-acentos>'), para poder enfocarse en ellas.
  var conOfertas366 = !!(window.__focoConfig && window.__focoConfig.productos366);
  // OPCIONAL (window.__focoConfig.campanas): suma las campañas vigentes de Jefe de Temporada (llave "<hub>:temporada-campanas",
  // id 'c:<campana_id>'). foco.get() trae entonces esCampana y campanaId. Sin la bandera nada cambia en los demas Jefes.
  var conCampanas = modoTemporada || !!(window.__focoConfig && window.__focoConfig.campanas);
  var campanas = [];
  // OPCIONAL (window.__focoConfig.soloCompletos366): la lista solo deja elegir los productos que ya EMPEZARON su 366 (tienen ficha en Producto 366)
  // (ficha de producto, cliente ideal, sistema y comunicación con contenido). Los demás salen aparte, bajo el botón
  // "Ver otros productos": en Jefe 366 se elige y se empieza a llenar desde cero en el chat; en los demás Jefes llevan a Jefe 366.
  // Las campañas de temporada también se listan y al elegir una abren Jefe de Temporada con esa campaña (así no se duplica la estrategia).
  // window.__focoConfig.pagina: '366' | 'temporada' | cualquier otra cosa.
  var soloCompletos = !!(window.__focoConfig && window.__focoConfig.soloCompletos366);
  var pagina = (window.__focoConfig && window.__focoConfig.pagina) || '';
  var listarCampanas = conCampanas || (soloCompletos && pagina !== 'temporada');
  var campanasRedirigen = soloCompletos && !conCampanas && pagina !== 'temporada';
  var estado366 = {};
  var orden366 = [];
  var verOtros = false;
  var ultimoRefresco366 = 0;
  var actual = { id: TODO, nombre: '', item: null, grupo: null, campana: null };
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
    '.foco-crear{background:#F1FFC2;margin:6px 0}',
    '.foco-crear:hover{background:#C0F800}',
    '.foco-sub{display:block;font-weight:500;font-size:12.5px;color:#5F5F5F;margin-top:2px}',
    '.foco-marcas{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}',
    '.foco-marca{display:inline-block;font-family:Inter,sans-serif;font-weight:700;font-size:11.5px;color:#3D6300;background:#F1FFC2;border:1px solid #CDE98A;border-radius:100px;padding:1px 8px}',
    '.foco-mas{display:block;width:100%;text-align:center;margin:8px 0 2px;padding:10px;border-radius:10px;border:1.5px dashed #C9C9C9;background:#fff;font-family:Inter,sans-serif;font-size:14px;font-weight:700;color:#1A1A1A;cursor:pointer}',
    '.foco-mas:hover{border-color:#4E7A00;background:#F8FFE0}',
    '.foco-nota{font-family:Inter,sans-serif;font-size:12.5px;color:#5F5F5F;padding:2px 10px 6px;line-height:1.45}',
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
  // En modo temporada las campanas son las de la pagina (en vivo); en los demas Jefes, las leidas del almacen.
  function campanasVivas() {
    if (!modoTemporada) return campanas;
    try { var l = cfgT.campanas(); return Array.isArray(l) ? l : []; } catch (e) { return []; }
  }
  function buscarCampana(id) {
    var cs = campanasVivas();
    for (var i = 0; i < cs.length; i++) if (cs[i] && cs[i].id === id) return cs[i];
    return null;
  }
  // "Temporal" / "Nueva campaña" no dicen de que es: se usa el producto o el titulo de la temporada.
  function etiquetaCampana(c) {
    var nombre = String(c.nombre || '').trim();
    if (nombre && !/^(temporal|nueva campa[nñ]a|campa[nñ]a|sin nombre)$/i.test(nombre)) return nombre;
    var producto = String((c.producto_origen === 'nuevo' ? c.producto_nuevo : c.producto_nombre) || '').trim();
    return producto || String(c.temporada || '').trim() || nombre || '(sin nombre)';
  }
  // Producto de una campana (lo que se muestra como titulo): el del catalogo, el nuevo, o el nombre de la campana.
  function productoDeCampana(c) {
    var p = '';
    if (c.producto_origen === 'nuevo') p = String(c.producto_nuevo || '').split('\n')[0].trim();
    else p = String(c.producto_nombre || '').trim();
    if (!p && c.producto_origen !== 'nuevo' && c.grupo_id) {
      var g = buscarGrupo(c.grupo_id);
      p = g && g.nombre ? 'Todo el grupo: ' + String(g.nombre).trim() : '';
    }
    if (p.length > 48) p = p.slice(0, 47) + '…';
    return p || etiquetaCampana(c);
  }
  function tieneCampana(p) {
    var n = String(p.nombre || '').trim().toLowerCase();
    return campanasVivas().some(function (c) {
      if (!c || c.producto_origen === 'nuevo') return false;
      return c.producto_id === p.id || (n && String(c.producto_nombre || '').trim().toLowerCase() === n);
    });
  }
  function aplicar(id) {
    if (modoTemporada && !(typeof id === 'string' && id.indexOf('c:') === 0 && buscarCampana(id.slice(2)))) {
      actual = { id: TODO, nombre: '', item: null, grupo: null, campana: null };
      return;
    }
    var camp = conCampanas && typeof id === 'string' && id.indexOf('c:') === 0 ? buscarCampana(id.slice(2)) : null;
    if (camp) {
      actual = { id: id, nombre: etiquetaCampana(camp), item: null, grupo: null, campana: camp };
      return;
    }
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
      esCampana: !!actual.campana, campanaId: actual.campana ? actual.campana.id : '', campana: actual.campana || null,
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
  function opcion(id, nombre, sub, extra, alElegir, clase, marcas) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'foco-op' + (actual.id === id ? ' sel' : '') + (clase ? ' ' + clase : '');
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
    if (marcas && marcas.length) {
      var ms = document.createElement('span');
      ms.className = 'foco-marcas';
      marcas.forEach(function (t) {
        var m = document.createElement('span');
        m.className = 'foco-marca';
        m.textContent = '✔ ' + t;
        m.title = t === 'Temporada' ? 'Este producto ya tiene una campaña de temporada registrada' : 'Este producto ya tiene su 366 completo: ficha, cliente ideal, sistema y comunicación';
        ms.appendChild(m);
      });
      izq.appendChild(ms);
    }
    b.appendChild(izq);
    if (extra) {
      var d = document.createElement('small');
      d.textContent = extra;
      b.appendChild(d);
    }
    b.addEventListener('click', function () { cerrar(); if (alElegir) alElegir(); else fijar(id); });
    return b;
  }
  function titulo(t) {
    var h = document.createElement('div');
    h.className = 'foco-titulo';
    h.textContent = t;
    return h;
  }

  // ---------- ¿tiene el 366 completo? ----------
  function norm(t) { return String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim(); }
  function aLista(o) {
    if (!o) return [];
    if (Array.isArray(o.lista)) return o.lista.filter(Boolean);
    return Object.keys(o).length ? [o] : [];
  }
  var IGNORAR = { nombre: 1, uid: 1, producto_uid: 1, grupo_id: 1, producto_relacionado: 1, activa: 1, id: 1, _importantes: 1 };
  function tieneValor(v) {
    if (v == null) return false;
    if (typeof v === 'string') return !!v.trim();
    if (typeof v === 'number') return true;
    if (Array.isArray(v)) return v.some(tieneValor);
    if (typeof v === 'object') return Object.keys(v).some(function (k) { return tieneValor(v[k]); });
    return false;
  }
  function camposLlenos(item) {
    var n = 0;
    Object.keys(item || {}).forEach(function (k) { if (!IGNORAR[k] && tieneValor(item[k])) n++; });
    return n;
  }
  // Cuántos campos con contenido debe tener cada parte para contar como "hecha" (ajustable aquí).
  var MINIMO = { ficha: 2, cliente: 4, sistema: 2, comunicacion: 3 };
  var TODO_FALTA = ['ficha del producto', 'cliente ideal', 'sistema para vender', 'comunicación'];
  function calcular366(prods, perfiles, sistemas, coms) {
    var out = {};
    prods.forEach(function (p) {
      var n = norm(p.nombre);
      if (!n) return;
      var uid = p.uid || '';
      function propio(it, esPerfil) {
        if (!it) return false;
        if (uid && it.producto_uid === uid) return true;
        return !!esPerfil && String(it.producto_relacionado || '').split(/\r?\n/).some(function (l) { return norm(l) === n; });
      }
      function hecha(lista, esPerfil, min) { return lista.some(function (it) { return propio(it, esPerfil) && camposLlenos(it) >= min; }); }
      var faltan = [];
      if (camposLlenos(p) < MINIMO.ficha) faltan.push('ficha del producto');
      if (!hecha(perfiles, true, MINIMO.cliente)) faltan.push('cliente ideal');
      if (!hecha(sistemas, false, MINIMO.sistema)) faltan.push('sistema para vender');
      if (!hecha(coms, false, MINIMO.comunicacion)) faltan.push('comunicación');
      out[n] = { empezado: true, completo: !faltan.length, faltan: faltan };
    });
    return out;
  }
  // Palomitas de la lista: 366 completo (ficha, cliente ideal, sistema y comunicación) y campaña de temporada vigente.
  function marcasDe(p) {
    var m = [];
    if (p && soloCompletos && estadoDe(p).completo) m.push('366 completo');
    if (p && campanas.some(function (c) { return c && c.producto_id === p.id; })) m.push('Temporada');
    return m;
  }
  function estadoDe(p) { return estado366[norm(p && p.nombre)] || { empezado: false, completo: false, faltan: TODO_FALTA.slice() }; }
  async function refrescar366(forzar) {
    if (!soloCompletos) return;
    var ahora = Date.now();
    if (!forzar && ahora - ultimoRefresco366 < 10000) return;
    ultimoRefresco366 = ahora;
    var prod = (await leer('brand-book.366-producto')) || (await leer('brand-book.evergreen-producto'));
    var perf = await leer('brand-book.audiencias');
    if (!aLista(perf).length) perf = (await leer('brand-book.366-perfil-cliente')) || (await leer('brand-book.evergreen-perfil-cliente'));
    var sis = (await leer('brand-book.366-sistema')) || (await leer('brand-book.evergreen-sistema'));
    var com = (await leer('brand-book.366-comunicacion')) || (await leer('brand-book.evergreen-comunicacion'));
    orden366 = aLista(prod).map(function (p) { return norm(p.nombre); }).filter(Boolean);
    estado366 = calcular366(aLista(prod), aLista(perf), aLista(sis), aLista(com));
    pintar();
  }
  function irA(ruta) {
    var pre = window.__hub && window.__hub.prefijo ? window.__hub.prefijo() : '';
    window.location.href = pre + ruta;
  }
  function elegirIncompleto(p) {
    if (pagina === '366') {
      fijar(p.id);
      try { window.dispatchEvent(new CustomEvent('foco-desde-cero', { detail: { id: p.id, nombre: String(p.nombre || '').trim() } })); } catch (e) {}
    } else {
      irA('/jefe-366?producto=' + encodeURIComponent(p.id));
    }
  }

  // A Jefe 366 con ese producto ya enfocado en su pastilla (Jefe 366 lee ?producto=<id> y lo elige).
  function irAJefe366(p) { irA('/jefe-366?producto=' + encodeURIComponent(p.id)); }
  var ESTADOS = { borrador: 'Borrador', activa: 'Activa', cerrada: 'Cerrada' };
  function pintarTemporada() {
    var cs = campanasVivas();
    var especifico = actual.id !== TODO && !!actual.campana;
    txt.textContent = especifico ? '🗓️ ' + productoDeCampana(actual.campana) : (cs.length ? 'Elige una campaña' : 'Crear campaña de temporada');
    pill.classList.toggle('on', especifico);
    pill.title = especifico ? 'Campaña de: ' + productoDeCampana(actual.campana) + '. Clic para cambiar.' : 'Clic para elegir una campaña de temporada.';

    menu.textContent = '';
    menu.appendChild(titulo('Productos con campaña de temporada'));
    if (!cs.length) {
      var vacio = document.createElement('div');
      vacio.className = 'foco-pie';
      vacio.style.borderTop = 'none';
      vacio.textContent = 'Todavía no tienes campañas de temporada.';
      menu.appendChild(vacio);
    }
    cs.forEach(function (c) {
      if (!c || !c.id) return;
      var prod = productoDeCampana(c), nom = etiquetaCampana(c);
      menu.appendChild(opcion('c:' + c.id, '🗓️ ' + prod, nom && nom !== prod ? nom : '', ESTADOS[c.estado] || ''));
    });
    if (typeof cfgT.crear === 'function') {
      menu.appendChild(opcion('crear', '➕ Crear campaña de temporada nueva', 'Con un producto que ya tienes o uno 100% nuevo', '', function () { cfgT.crear(); }, 'foco-crear'));
    }

    // Jefe 366: solo los productos que ya empezaron su 366; los demas quedan tras "Ver otros productos".
    var sin = lista.filter(function (p) { return p && p.nombre && !tieneCampana(p); });
    var en366 = sin.filter(function (p) { return estadoDe(p).empezado; });
    var otros366 = sin.filter(function (p) { return !estadoDe(p).empezado; });
    if (en366.length) {
      menu.appendChild(titulo('Jefe 366 · productos sin campaña de temporada'));
      en366.forEach(function (p) {
        menu.appendChild(opcion(p.id, String(p.nombre).trim(), 'Se abre en Jefe 366', precioTexto(p.precio), function () { irAJefe366(p); }));
      });
    }
    if (otros366.length) {
      var mas = document.createElement('button');
      mas.type = 'button';
      mas.className = 'foco-mas';
      mas.textContent = verOtros ? 'Ocultar otros productos' : 'Ver otros productos (' + otros366.length + ')';
      mas.addEventListener('click', function (e) { e.stopPropagation(); verOtros = !verOtros; pintar(); });
      menu.appendChild(mas);
      if (verOtros) {
        menu.appendChild(titulo('Productos sin empezar su 366'));
        otros366.forEach(function (p) {
          menu.appendChild(opcion(p.id, String(p.nombre).trim(), 'Sin empezar · se abre en Jefe 366', precioTexto(p.precio), function () { irAJefe366(p); }));
        });
      }
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

  // En Jefe 366 no hay "ecosistema completo" ni "todo el grupo": siempre se trabaja un producto ya dado de alta (empezado) en el 366.
  function sinEco() { return soloCompletos && pagina === '366'; }
  function primerEmpezado() {
    var emp = lista.filter(function (p) { return p && p.nombre && estadoDe(p).empezado; });
    var pos = function (p) { var i = orden366.indexOf(norm(p.nombre)); return i < 0 ? 9999 : i; };
    emp.sort(function (a, b) { return pos(a) - pos(b); });
    return emp[0] || null;
  }

  function pintar() {
    if (modoTemporada) return pintarTemporada();
    var especifico = actual.id !== TODO;
    txt.textContent = especifico ? (actual.campana ? '🗓️ ' : (actual.grupo ? 'Grupo: ' : '')) + (actual.nombre || 'Producto') : (sinEco() ? 'Elige un producto' : 'Tu ecosistema completo');
    pill.classList.toggle('on', especifico);
    pill.title = especifico
      ? 'Estás trabajando solo sobre: ' + (actual.nombre || 'este producto') + '. Clic para cambiar.'
      : (sinEco() ? 'Clic para elegir el producto en el que vas a trabajar.' : 'Estás trabajando sobre todo tu ecosistema. Clic para elegir un producto o servicio.');

    menu.textContent = '';
    if (!sinEco()) menu.appendChild(opcion(TODO, 'Tu ecosistema completo', 'Todos tus productos y servicios juntos'));

    var conNombre = lista.filter(function (p) { return p && p.nombre; });
    var visibles = soloCompletos ? conNombre.filter(function (p) { return estadoDe(p).empezado; }) : conNombre;
    // mismo orden que las fichas de Producto 366, para que la lista de arriba y la de la sección coincidan
    if (soloCompletos) {
      var pos = function (p) { var i = orden366.indexOf(norm(p.nombre)); return i < 0 ? 9999 : i; };
      visibles = visibles.map(function (p, i) { return { p: p, i: i }; }).sort(function (a, b) { return (pos(a.p) - pos(b.p)) || (a.i - b.i); }).map(function (x) { return x.p; });
    }
    var otros = soloCompletos ? conNombre.filter(function (p) { return !estadoDe(p).empezado; }) : [];
    if (!conNombre.length) {
      var vacio = document.createElement('div');
      vacio.className = 'foco-pie';
      vacio.style.borderTop = 'none';
      vacio.textContent = 'Todavía no hay productos en el Catálogo de tu ADN.';
      menu.appendChild(vacio);
    } else {
      if (!visibles.length) {
        var sin = document.createElement('div');
        sin.className = 'foco-nota';
        sin.textContent = 'Todavía no has empezado el 366 de ningún producto. Elige uno de abajo para empezarlo en el chat del Jefe 366.';
        menu.appendChild(sin);
      }
      var porGrupo = {};
      visibles.forEach(function (p) { (porGrupo[p.grupo_id || ''] = porGrupo[p.grupo_id || ''] || []).push(p); });
      var orden = grupos.map(function (g) { return g.id; }).filter(function (id) { return porGrupo[id]; });
      if (porGrupo['']) orden.push('');
      orden.forEach(function (gid) {
        var g = grupos.filter(function (x) { return x.id === gid; })[0];
        menu.appendChild(titulo(g && g.nombre ? g.nombre : (grupos.length ? 'Sin grupo' : 'Productos y servicios')));
        if (conGrupos && !sinEco() && g && g.nombre) menu.appendChild(opcion('g:' + g.id, 'Todo el grupo: ' + String(g.nombre).trim(), 'Todos los productos y servicios de este grupo'));
        porGrupo[gid].forEach(function (p) {
          var st = estadoDe(p);
          var sub = soloCompletos && !st.completo ? 'En proceso · ' + (TODO_FALTA.length - st.faltan.length) + ' de ' + TODO_FALTA.length + ' partes del 366' : (p.tipo || '');
          menu.appendChild(opcion(p.id, String(p.nombre).trim(), sub, precioTexto(p.precio), null, '', marcasDe(p)));
        });
      });
    }

    if (listarCampanas && campanas.length) {
      menu.appendChild(titulo('Campañas de temporada'));
      campanas.forEach(function (c) {
        menu.appendChild(opcion('c:' + c.id, '🗓️ ' + etiquetaCampana(c), campanasRedirigen ? 'Se abre en Jefe de Temporada' : 'Campaña de Jefe de Temporada', '',
          campanasRedirigen ? function () { irA('/jefe-temporada?campana=' + encodeURIComponent(c.id)); } : null));
      });
    }

    if (otros.length) {
      var mas = document.createElement('button');
      mas.type = 'button';
      mas.className = 'foco-mas';
      mas.textContent = verOtros ? 'Ocultar otros productos' : 'Ver otros productos (' + otros.length + ')';
      mas.addEventListener('click', function (e) { e.stopPropagation(); verOtros = !verOtros; pintar(); });
      menu.appendChild(mas);
      if (verOtros) {
        menu.appendChild(titulo('Productos sin empezar su 366'));
        var nota = document.createElement('div');
        nota.className = 'foco-nota';
        nota.textContent = pagina === '366'
          ? 'Al elegir uno empiezas a llenarlo desde cero, aquí en el chat del Jefe 366.'
          : 'Al elegir uno te llevo al Jefe 366 para llenarlo desde cero en el chat.';
        menu.appendChild(nota);
        otros.forEach(function (p) {
          menu.appendChild(opcion(p.id, String(p.nombre).trim(), 'Sin empezar', precioTexto(p.precio), function () { elegirIncompleto(p); }));
        });
      }
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

  function abrir() { menu.hidden = false; pill.setAttribute('aria-expanded', 'true'); refrescar366(false); }
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
    if (soloCompletos) await refrescar366(true);
    if (listarCampanas && !modoTemporada) {
      var cs = await leer('temporada-campanas');
      var hoy = new Date().toISOString().slice(0, 10);
      campanas = Array.isArray(cs) ? cs.filter(function (c) { return c && c.id && (!c.fecha_fin_activa || c.fecha_fin_activa >= hoy); }) : [];
    }
    var guardado = leerLS();
    aplicar(guardado ? guardado.id : TODO); // si el producto ya no existe, vuelve a "ecosistema completo"
    if (sinEco() && (actual.id === TODO || actual.grupo || actual.campana)) {
      var pri = primerEmpezado(); // en Jefe 366 siempre hay un producto elegido: el primero ya empezado
      if (pri) { aplicar(pri.id); guardarLS(); }
    }
    pintar();
  })();

  window.__foco = {
    get: foco,
    set: fijar,
    onChange: function (fn) { if (typeof fn === 'function') oyentes.push(fn); },
    lista: function () { return lista.slice(); },
    grupos: function () { return grupos.slice(); },
    campanas: function () { return campanasVivas().slice(); },
    // la pagina avisa que cambiaron sus campanas (nombre, producto, alta o baja) para repintar la pastilla
    refrescar: function () { aplicar(actual.id); guardarLS(); pintar(); },
    marcas: function (id) { return marcasDe(buscar(id)); },
    es366Completo: function (id) { var p = buscar(id); return p ? estadoDe(p).completo : false; },
    es366Empezado: function (id) { var p = buscar(id); return p ? estadoDe(p).empezado : false; },
    refrescar366: function () { return refrescar366(true); },
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
