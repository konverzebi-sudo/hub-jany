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
  // OPCIONAL (window.__focoConfig.campanaLocal): Contenido y Anuncios listan las campañas de temporada y, al elegir una, SE QUEDAN
  // en ese Jefe trabajando esa campaña (foco con el producto de la campaña, y las peticiones a la IA llevan campanaId para que
  // el Jefe reciba toda la estrategia de temporada y guíe la creación de piezas).
  var campanaLocal = !!(window.__focoConfig && window.__focoConfig.campanaLocal);
  var conCampanas = modoTemporada || campanaLocal || !!(window.__focoConfig && window.__focoConfig.campanas);
  var campanas = [];
  // OPCIONAL (window.__focoConfig.soloCompletos366): la lista solo deja elegir los productos que ya EMPEZARON su 366 (tienen ficha en Producto 366)
  // (ficha de producto, cliente ideal, sistema y comunicación con contenido). Los demás salen aparte, bajo el botón
  // "Ver otros productos": en Jefe 366 se elige y se empieza a llenar desde cero en el chat; en los demás Jefes llevan a Jefe 366.
  // Las campañas de temporada también se listan y al elegir una abren Jefe de Temporada con esa campaña (así no se duplica la estrategia).
  // window.__focoConfig.pagina: '366' | 'temporada' | cualquier otra cosa.
  var soloCompletos = !!(window.__focoConfig && window.__focoConfig.soloCompletos366);
  // OPCIONAL (window.__focoConfig.marcarDesglose; también se activa con soloCompletos366): en la lista, los productos con
  // desglose registrado llevan una palomita: su 366 completo (ficha, cliente ideal, sistema y comunicación) o una campaña
  // de Jefe de Temporada que ya trae el "por qué este producto hace sentido". No esconde nada; solo marca.
  var marcar = soloCompletos || !!(window.__focoConfig && window.__focoConfig.marcarDesglose);
  var desgTemp = {};
  var campsRaw = [];
  var nuevoAbierto = false;
  var modoQuitar = false;
  var colaCatalogo = Promise.resolve();
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
    '.foco-mas-nuevo{border-style:solid;border-color:#C0F800;background:#F1FFC2}',
    '.foco-nuevo{padding:2px 0 6px}',
    '.foco-quitando{background:#FFF1F0}',
    '.foco-quitando:hover{background:#FFD9D5}',
    '.foco-quitar-modo{display:block;width:100%;text-align:center;margin:2px 0 6px;padding:8px;border:none;background:none;font:600 13px Inter,sans-serif;color:#9A2B1F;cursor:pointer;text-decoration:underline}',
    '.foco-nuevo-in{box-sizing:border-box;width:100%;margin:8px 0 6px;padding:10px 12px;border:1.5px solid #C9C9C9;border-radius:10px;font:600 15px Inter,sans-serif;color:#1A1A1A}',
    '.foco-nuevo-in:focus{outline:none;border-color:#4E7A00}',
    '.foco-nuevo-ok{width:100%;padding:10px;border:none;border-radius:10px;background:#C0F800;color:#1A1A1A;font:700 14px Inter,sans-serif;cursor:pointer}',
    '.foco-nuevo-ok:disabled{opacity:.6;cursor:default}',
    '.foco-crear:hover{background:#C0F800}',
    '.foco-sub{display:block;font-weight:500;font-size:12.5px;color:#5F5F5F;margin-top:2px}',
    '.foco-ok{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#C0F800;color:#1A1A1A;font-size:11px;font-weight:800;margin-left:8px;vertical-align:middle;flex:0 0 auto}',
    '.foco-desg{color:#4E7A00;font-weight:700}',
    '.foco-leyenda{display:flex;align-items:center;gap:8px;padding:2px 2px 8px;font-size:13px;color:#5F5F5F}',
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
      grupoId: actual.grupo ? actual.grupo.id : (actual.item ? (actual.item.grupo_id || '') : (campanaLocal && actual.campana && actual.campana.producto_origen !== 'nuevo' ? (actual.campana.grupo_id || '') : '')),
      productoId: actual.item ? actual.item.id : (campanaLocal && actual.campana && actual.campana.producto_origen !== 'nuevo' ? (actual.campana.producto_id || '') : '')
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
  function opcion(id, nombre, sub, extra, alElegir, clase, desg) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'foco-op' + (actual.id === id ? ' sel' : '') + (clase ? ' ' + clase : '');
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', actual.id === id ? 'true' : 'false');
    var izq = document.createElement('span');
    izq.className = 'n';
    izq.textContent = (actual.id === id ? '✓ ' : '') + nombre;
    if (desg) {
      var ok = document.createElement('span');
      ok.className = 'foco-ok';
      ok.textContent = '✓';
      ok.title = desgloseTexto(desg);
      izq.appendChild(ok);
    }
    if (sub || desg) {
      var s = document.createElement('span');
      s.className = 'foco-sub';
      s.textContent = sub || '';
      if (desg) {
        var d2 = document.createElement('span');
        d2.className = 'foco-desg';
        d2.textContent = (sub ? ' · ' : '') + desgloseTexto(desg);
        s.appendChild(d2);
      }
      izq.appendChild(s);
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
  var IGNORAR = { nombre: 1, uid: 1, catalogo_id: 1, producto_uid: 1, grupo_id: 1, producto_relacionado: 1, activa: 1, id: 1, _importantes: 1 };
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
      out[n] = { ficha: true, empezado: faltan.length < TODO_FALTA.length, completo: !faltan.length, faltan: faltan };
    });
    return out;
  }
  function desgloseTexto(m) {
    return m.c366 && m.temp ? 'Desglose completo en Jefe 366 y en Temporada' : (m.c366 ? 'Desglose completo en Jefe 366' : 'Desglose en Jefe de Temporada');
  }
  // Producto que se trabaja en Jefe de Temporada (tiene desglose de campaña) y que en el 366 está en cero: en Jefe 366 no se elige,
  // al tocarlo se abre su campaña en Jefe de Temporada.
  function soloTemporada(p) {
    var st = estadoDe(p);
    return (!!desgTemp[p.id] || tieneCampana(p)) && st.faltan.length >= TODO_FALTA.length;
  }
  function campanaDeProducto(p) {
    var n = norm(p.nombre);
    var coincide = function (x) { return x && x.id && x.producto_origen !== 'nuevo' && (x.producto_id === p.id || (x.producto_nombre && norm(x.producto_nombre) === n)); };
    var c = campanasVivas().filter(coincide)[0] || campsRaw.filter(coincide)[0];
    return c ? c.id : '';
  }
  // ---------- qué tan completa está una campaña de temporada ----------
  // Misma regla que el checklist de Jefe de Temporada (12 módulos); filas fijas = textos que la campaña trae de fábrica en sus tablas
  // (no cuentan como llenado). Si cambia la plantilla de campaña en jefe-temporada.html, actualizar estas listas.
  var FIJAS_TEMP = {"cliente_diferencias":["Deseo activado","Dolor activado","Miedo activo","Objeción principal","Incentivo"],"com_mensaje_elegido":["¿Qué vendo?","¿Para quién es?","¿Qué resultado promete?","¿Por qué importa en esta temporada?","Mensaje principal final"],"com_razon_ahora":["Razón real para comprar ahora","Fecha límite / cierre","Cupo / stock / disponibilidad","Promoción / bono / incentivo","Qué pasa si no compra ahora","Cómo comunicarlo sin presión falsa"],"com_mensajes_clave":["Deseo","Problema","Confianza","Urgencia","Cierre"],"com_frases_maestras":["Para atraer atención","Para generar deseo","Para explicar la oferta","Para resolver dudas","Para urgencia","Para cierre","Para WhatsApp / DM","Para stories","Para anuncios"],"com_objeciones":["Precio","Tiempo","Confianza","No sé si es para mí","Lo puedo comprar después","Comparación con otra opción"],"com_angulos":["Deseo","Lo que quiere lograr","Aspiración","Dolor","Problema que quiere resolver","Frustración","Miedo","Lo que teme que pase si no actúa","Preocupación","Sueño","Vida / resultado que imagina","Ilusión","Error","Algo que está haciendo mal","Urgencia de corregir","Curiosidad","Algo inesperado","Intriga","Rapidez","Resultado en menos tiempo","Facilidad","Comparación","Antes vs después","Claridad","Historia","Experiencia real","Conexión","Experiencia","Vivir algo especial","Simplicidad","Hacerlo más fácil","Alivio","Exclusividad","Acceso especial","Pertenencia","Prueba social","Otras personas ya lo hicieron","Confianza","Evitar pérdida","Lo que podría perder","Acción","Identidad","Cómo se ve a sí misma","Identificación"],"com_ctas":["Precampaña","Lanzamiento","Mitad de campaña","Último día","Últimas horas","Cierre"],"pre_calentamiento":["Día 1","Día 3","Día 5","Día 7","Día 10"],"activa_fases":["Lanzamiento","Intensificación","Cierre"],"post_acciones":["Agradecimiento","Seguimiento","Registro en base de datos","Solicitud de testimonio","Oferta de segunda compra","Remarketing"],"ads_creativos":["Lanzamiento","Objeción","Prueba social","Urgencia / cierre"]};
  var MODULOS_TEMP = [
    { campos: ['temporada', 'objetivo_principal', 'incentivo', 'fecha_inicio_activa', 'fecha_fin_activa'], producto: true },
    { campos: ['prod_por_que'], tablas: ['prod_incentivos'] },
    { campos: ['cliente_que_pasa', 'cliente_que_haria_hoy', 'cliente_que_cambio'], tablas: ['cliente_diferencias'] },
    { tablas: ['com_mensaje_elegido', 'com_razon_ahora', 'com_mensajes_clave', 'com_frases_maestras', 'com_objeciones', 'com_angulos', 'com_ctas'] },
    { campos: ['dm_cliente_ideal_temporada', 'dm_oferta', 'dm_mensaje_principal', 'dm_frases_clave', 'dm_canal_conversion'] },
    { campos: ['meta_ventas', 'ticket_promedio'] },
    { campos: ['pre_objetivo', 'pre_captacion'], tablas: ['pre_calentamiento'] },
    { tablas: ['activa_fases'] },
    { tablas: ['bd_segmentos'] },
    { tablas: ['post_acciones'] },
    { campos: ['ads_objetivo', 'ads_publico', 'ads_oferta'], tablas: ['ads_creativos'] },
    { tablas: ['calendario'] }
  ];
  function tablaTempLlena(c, campo) {
    if (!Array.isArray(c[campo])) return false;
    var fijas = FIJAS_TEMP[campo] || [];
    return c[campo].some(function (f) {
      return f && Object.keys(f).some(function (k) { var v = String(f[k] == null ? '' : f[k]).trim(); return k !== 'id' && v && fijas.indexOf(v) < 0; });
    });
  }
  function modulosCampana(c) {
    var ok = 0;
    MODULOS_TEMP.forEach(function (m) {
      var lleno = (m.campos || []).every(function (k) { return String(c[k] == null ? '' : c[k]).trim(); }) && (m.tablas || []).every(function (t) { return tablaTempLlena(c, t); });
      if (lleno && m.producto) lleno = !!String((c.producto_origen === 'nuevo' ? c.producto_nuevo : c.producto_nombre) || '').trim();
      if (lleno) ok++;
    });
    return { ok: ok, total: MODULOS_TEMP.length };
  }
  function marcaDesglose(p) {
    if (!marcar) return null;
    var c366 = !!estadoDe(p).completo, temp = !!desgTemp[p.id];
    return c366 || temp ? { c366: c366, temp: temp } : null;
  }
  function calcularDesgTemp(camps) {
    desgTemp = {};
    campsRaw = Array.isArray(camps) ? camps : [];
    lista.forEach(function (p) {
      var n = norm(p.nombre);
      var ok = (camps || []).some(function (c) {
        return c && c.producto_origen !== 'nuevo' && (c.producto_id === p.id || (c.producto_nombre && norm(c.producto_nombre) === n)) && tieneValor(c.prod_por_que);
      });
      if (ok) desgTemp[p.id] = true;
    });
  }
  function estadoDe(p) { return estado366[norm(p && p.nombre)] || { ficha: false, empezado: false, completo: false, faltan: TODO_FALTA.slice() }; }
  // En "Ver otros productos": con ficha pero sin nada llenado = borrador; sin ficha = sin empezar.
  function subOtro(p) { return estadoDe(p).ficha ? 'Borrador · todavía sin información' : 'Sin empezar'; }
  async function refrescar366(forzar) {
    if (!soloCompletos && !marcar) return;
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
        menu.appendChild(titulo('Borradores y productos sin empezar (no activos)'));
        otros366.forEach(function (p) {
          menu.appendChild(opcion(p.id, String(p.nombre).trim(), subOtro(p) + ' · se abre en Jefe 366', precioTexto(p.precio), function () { irAJefe366(p); }));
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

  // ---------- alta de productos en el Catálogo del ADN (llave "<hub>:catalogo-productos") ----------
  // Un producto nuevo (o renombrado) en Jefe 366 queda también en el Catálogo del ADN, sin duplicar: se busca por id o por nombre.
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  async function altaProductoYa(nombre, opts) {
    nombre = String(nombre || '').trim();
    if (!nombre) return null;
    var cat = await leer('catalogo-productos');
    cat = Array.isArray(cat) ? cat : [];
    // si el catálogo no se pudo leer (llegó vacío pero ya habíamos cargado productos), no se escribe nada: así no se pisa
    if (!cat.length && lista.some(function (p) { return p && !p.origen366; })) throw new Error('catalogo no disponible');
    var n = norm(nombre), item = null, cambio = false;
    if (opts.catalogoId) item = cat.filter(function (x) { return x && x.id === opts.catalogoId; })[0] || null;
    if (!item) item = cat.filter(function (x) { return x && norm(x.nombre) === n; })[0] || null;
    if (item) {
      if (opts.renombrar && norm(item.nombre) !== n) { item.nombre = nombre; cambio = true; }
    } else {
      item = { id: newId(), nombre: nombre, tipo: 'Producto', grupo_id: opts.grupo_id || '', precio: '', costo: '', margen_pct: '', que_tanto_se_vende: '', inventario: '', notas: '' };
      cat.push(item);
      cambio = true;
    }
    if (cambio) await window.storage.set(hub + ':catalogo-productos', JSON.stringify(cat));
    lista = lista.filter(function (p) { return p && p.id !== item.id && !(p.origen366 && norm(p.nombre) === n); });
    lista.push(item);
    pintar();
    return item;
  }
  function altaProducto(nombre, opts) {
    var tarea = colaCatalogo.then(function () { return altaProductoYa(nombre, opts || {}); });
    colaCatalogo = tarea.catch(function () {});
    return tarea;
  }
  // Quitar un producto: sale del Catálogo del ADN y la página (Jefe 366) quita sus fichas. Siempre con confirmación.
  async function bajaCatalogo(p) {
    var n = norm(p.nombre);
    var cat = await leer('catalogo-productos');
    cat = Array.isArray(cat) ? cat : [];
    if (!cat.length && lista.some(function (x) { return x && !x.origen366; })) throw new Error('catalogo no disponible');
    var nuevo = cat.filter(function (x) { return !(x && (x.id === p.id || norm(x.nombre) === n)); });
    if (nuevo.length !== cat.length) await window.storage.set(hub + ':catalogo-productos', JSON.stringify(nuevo));
  }
  function quitarProducto(p) {
    var nombre = String(p.nombre || '').trim();
    var aviso = '¿Quitar «' + nombre + '»?' + String.fromCharCode(10, 10) + 'Se borra del Catálogo de tu ADN y de las fichas del Jefe 366 (producto, cliente ideal, sistema y comunicación). Lo que escribiste ahí se pierde.';
    if (tieneCampana(p) || desgTemp[p.id]) aviso += String.fromCharCode(10, 10) + 'Tiene una campaña en Jefe de Temporada: esa campaña no se borra.';
    if (!window.confirm(aviso)) return;
    colaCatalogo = colaCatalogo.then(function () { return bajaCatalogo(p); }).then(function () {
      var n = norm(nombre);
      lista = lista.filter(function (x) { return x && x.id !== p.id && norm(x.nombre) !== n; });
      delete estado366[n];
      orden366 = orden366.filter(function (x) { return x !== n; });
      modoQuitar = false;
      var previo = actual.id;
      aplicar(actual.id === p.id ? TODO : actual.id);
      if (sinEco() && actual.id === TODO) { var pri = primerEmpezado(); if (pri) aplicar(pri.id); }
      guardarLS();
      pintar();
      try { window.dispatchEvent(new CustomEvent('foco-producto-quitado', { detail: { id: p.id, nombre: nombre } })); } catch (e) {}
      if (actual.id !== previo) avisar();
    }).catch(function () {
      window.alert('No se pudo quitar el producto. Intenta de nuevo en un momento.');
    });
  }
  function bloqueNuevo() {
    var w = document.createElement('div');
    w.className = 'foco-nuevo';
    if (!nuevoAbierto) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'foco-mas foco-mas-nuevo';
      b.textContent = '➕ Agregar producto nuevo';
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        nuevoAbierto = true;
        pintar();
        var i = menu.querySelector('.foco-nuevo-in');
        if (i) { try { i.focus(); i.scrollIntoView({ block: 'nearest' }); } catch (x) {} }
      });
      w.appendChild(b);
      return w;
    }
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.maxLength = 80;
    inp.className = 'foco-nuevo-in';
    inp.placeholder = 'Nombre del producto o servicio';
    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'foco-nuevo-ok';
    ok.textContent = 'Agregar';
    var nota = document.createElement('div');
    nota.className = 'foco-nota';
    nota.textContent = 'Se guarda también en el Catálogo de tu ADN y lo empiezas a llenar desde cero en el chat.';
    var crear = async function () {
      var nombre = inp.value.trim();
      if (!nombre) { inp.focus(); return; }
      ok.disabled = true;
      ok.textContent = 'Guardando...';
      try {
        var it = await altaProducto(nombre, {});
        nuevoAbierto = false;
        cerrar();
        if (it) {
          fijar(it.id);
          try { window.dispatchEvent(new CustomEvent('foco-desde-cero', { detail: { id: it.id, nombre: it.nombre } })); } catch (x) {}
        }
      } catch (err) {
        ok.disabled = false;
        ok.textContent = 'Agregar';
        nota.textContent = 'No se pudo guardar el producto. Intenta de nuevo.';
      }
    };
    ok.addEventListener('click', function (e) { e.stopPropagation(); crear(); });
    inp.addEventListener('click', function (e) { e.stopPropagation(); });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); crear(); } });
    w.appendChild(inp);
    w.appendChild(ok);
    w.appendChild(nota);
    return w;
  }

  // En Jefe 366 no hay "ecosistema completo" ni "todo el grupo": siempre se trabaja un producto ya dado de alta (empezado) en el 366.
  function sinEco() { return soloCompletos && pagina === '366'; }
  function primerEmpezado() {
    var emp = lista.filter(function (p) { return p && p.nombre && estadoDe(p).empezado && !(sinEco() && soloTemporada(p)); });
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
    if (sinEco()) visibles = visibles.filter(function (p) { return !soloTemporada(p); });
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
        menu.appendChild(titulo(sinEco() ? 'Jefe 366 · tus productos' + (g && g.nombre ? ' · ' + g.nombre : '') : (g && g.nombre ? g.nombre : (grupos.length ? 'Sin grupo' : 'Productos y servicios'))));
        if (conGrupos && !sinEco() && g && g.nombre) menu.appendChild(opcion('g:' + g.id, 'Todo el grupo: ' + String(g.nombre).trim(), 'Todos los productos y servicios de este grupo'));
        porGrupo[gid].forEach(function (p) {
          var st = estadoDe(p);
          var sub = soloCompletos && !st.completo ? 'En proceso · ' + (TODO_FALTA.length - st.faltan.length) + ' de ' + TODO_FALTA.length + ' partes del 366' : (p.tipo || '');
          var aTemp = sinEco() && soloTemporada(p);
          if (sinEco() && modoQuitar) { menu.appendChild(opcion(p.id, String(p.nombre).trim(), 'Toca para quitar este producto', precioTexto(p.precio), function () { quitarProducto(p); }, 'foco-quitando')); return; }
          menu.appendChild(opcion(p.id, String(p.nombre).trim(), aTemp ? '' : sub, precioTexto(p.precio),
            aTemp ? function () { var cid = campanaDeProducto(p); irA('/jefe-temporada' + (cid ? '?campana=' + encodeURIComponent(cid) : '')); } : null, '', marcaDesglose(p)));
        });
      });
    }

    if (sinEco() && campsRaw.length) {
      menu.appendChild(titulo('Campañas de temporada · se trabajan en Jefe de Temporada'));
      var hoyC = new Date().toISOString().slice(0, 10);
      campsRaw.filter(function (c) { return c && c.id; }).forEach(function (c) {
        var av = modulosCampana(c);
        var termino = c.fecha_fin_activa && c.fecha_fin_activa < hoyC;
        var sub = 'En proceso · ' + av.ok + ' de ' + av.total + ' módulos de la campaña' + (termino ? ' · terminó el ' + c.fecha_fin_activa : '');
        if (av.ok === av.total) sub = 'Campaña completa · ' + av.total + ' de ' + av.total + ' módulos' + (termino ? ' · terminó el ' + c.fecha_fin_activa : '');
        menu.appendChild(opcion('c:' + c.id, '🗓️ ' + etiquetaCampana(c), sub, '', function () { irA('/jefe-temporada?campana=' + encodeURIComponent(c.id)); }, '', av.ok === av.total ? { c366: false, temp: true } : null));
      });
    } else if (listarCampanas && campanas.length) {
      menu.appendChild(titulo('Campañas de temporada'));
      campanas.forEach(function (c) {
        menu.appendChild(opcion('c:' + c.id, '🗓️ ' + etiquetaCampana(c), campanasRedirigen ? 'Se abre en Jefe de Temporada' : (campanaLocal ? 'Te guío con toda su estrategia' : 'Campaña de Jefe de Temporada'), '',
          campanasRedirigen ? function () { irA('/jefe-temporada?campana=' + encodeURIComponent(c.id)); } : null));
      });
    }

    if (sinEco()) {
      menu.appendChild(bloqueNuevo());
      var qm = document.createElement('button');
      qm.type = 'button';
      qm.className = 'foco-quitar-modo';
      qm.textContent = modoQuitar ? 'Listo, dejar de quitar' : '🗑️ Quitar un producto';
      qm.addEventListener('click', function (e) { e.stopPropagation(); modoQuitar = !modoQuitar; if (modoQuitar) verOtros = true; pintar(); });
      menu.appendChild(qm);
    }

    if (otros.length) {
      var mas = document.createElement('button');
      mas.type = 'button';
      mas.className = 'foco-mas';
      mas.textContent = verOtros ? 'Ocultar otros productos' : 'Ver otros productos (' + otros.length + ')';
      mas.addEventListener('click', function (e) { e.stopPropagation(); verOtros = !verOtros; pintar(); });
      menu.appendChild(mas);
      if (verOtros) {
        menu.appendChild(titulo('Borradores y productos sin empezar (no activos)'));
        var nota = document.createElement('div');
        nota.className = 'foco-nota';
        nota.textContent = pagina === '366'
          ? 'Al elegir uno empiezas a llenarlo desde cero, aquí en el chat del Jefe 366.'
          : 'Al elegir uno te llevo al Jefe 366 para llenarlo desde cero en el chat.';
        menu.appendChild(nota);
        otros.forEach(function (p) {
          if (sinEco() && modoQuitar) { menu.appendChild(opcion(p.id, String(p.nombre).trim(), 'Toca para quitar este producto', precioTexto(p.precio), function () { quitarProducto(p); }, 'foco-quitando')); return; }
          var aTempO = sinEco() && soloTemporada(p);
          menu.appendChild(opcion(p.id, String(p.nombre).trim(), aTempO ? 'Borrador en el 366 · su campaña está en Jefe de Temporada' : subOtro(p), precioTexto(p.precio),
            function () { if (aTempO) { var cid = campanaDeProducto(p); irA('/jefe-temporada' + (cid ? '?campana=' + encodeURIComponent(cid) : '')); } else elegirIncompleto(p); }));
        });
      }
    }
    if (marcar && lista.some(function (p) { return marcaDesglose(p); })) {
      var ley = document.createElement('div');
      ley.className = 'foco-pie foco-leyenda';
      ley.innerHTML = '<span class="foco-ok" style="margin:0">✓</span><span>Ya tiene su desglose completo en Jefe 366 o en Jefe de Temporada.</span>';
      menu.appendChild(ley);
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
  function cerrar() { menu.hidden = true; pill.setAttribute('aria-expanded', 'false'); nuevoAbierto = false; modoQuitar = false; }
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
    if (marcar) calcularDesgTemp(await leer('temporada-campanas'));
    if (soloCompletos || marcar) await refrescar366(true);
    if (listarCampanas && !modoTemporada) {
      var cs = await leer('temporada-campanas');
      var hoy = new Date().toISOString().slice(0, 10);
      campanas = Array.isArray(cs) ? cs.filter(function (c) { return c && c.id && (campanaLocal ? c.estado !== 'cerrada' : (!c.fecha_fin_activa || c.fecha_fin_activa >= hoy)); }) : [];
    }
    var guardado = leerLS();
    aplicar(guardado ? guardado.id : TODO); // si el producto ya no existe, vuelve a "ecosistema completo"
    if (sinEco() && (actual.id === TODO || actual.grupo || actual.campana || (actual.item && soloTemporada(actual.item)))) {
      var pri = primerEmpezado(); // en Jefe 366 siempre hay un producto elegido: el primero ya empezado
      if (pri) { aplicar(pri.id); guardarLS(); }
    }
    pintar();
  })();

  // En modo campaña local, las peticiones de generación llevan campanaId (sin tocar el código de cada Jefe).
  if (campanaLocal && window.fetch) {
    var fetchOriginal = window.fetch.bind(window);
    window.fetch = function (url, opts) {
      try {
        if (actual.campana && opts && typeof opts.body === 'string' && /\/api\/(generar-anuncios|generar-guion-organico|generar-ideas-366)/.test(String(url))) {
          var b = JSON.parse(opts.body);
          if (b && typeof b === 'object' && !Array.isArray(b)) { b.campanaId = actual.campana.id; opts = Object.assign({}, opts, { body: JSON.stringify(b) }); }
        }
      } catch (e) {}
      return fetchOriginal(url, opts);
    };
  }

  window.__foco = {
    get: foco,
    set: fijar,
    onChange: function (fn) { if (typeof fn === 'function') oyentes.push(fn); },
    lista: function () { return lista.slice(); },
    grupos: function () { return grupos.slice(); },
    campanas: function () { return campanasVivas().slice(); },
    // la pagina avisa que cambiaron sus campanas (nombre, producto, alta o baja) para repintar la pastilla
    refrescar: function () { aplicar(actual.id); guardarLS(); pintar(); },
    altaProducto: altaProducto,
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
