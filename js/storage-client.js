// Shim que reemplaza window.storage (entorno de artifacts) por llamadas reales a /api/storage/:key.
// El resto del código de cada agente no cambia: sigue usando window.storage.get()/set() igual que antes.
//
// Cómo se autoriza un guardado:
// 1) Llave de acceso del hub (clientes): viene una sola vez en su link (?k=...), se queda en este
//    dispositivo y autoriza solo las llaves de SU hub ("<hub>:..."). No se pide ninguna clave.
// 2) Token maestro (dueña / equipo): se pide una vez con un cuadro y se recuerda en el dispositivo.
//
// Si un guardado falla (sin conexión, llave vencida, error del servidor) lo escrito NO se pierde:
// queda respaldado en este dispositivo, get() lo sigue devolviendo y se vuelve a subir solo.
(function () {
  var TOKEN_KEY = 'jefeshub_storage_token';
  var ACCESO_PREFIJO = 'jefeshub_acceso_';
  var PENDIENTE_PREFIJO = 'jefeshub_pendiente:';
  var SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;

  function ls(op, k, v) {
    try {
      if (op === 'get') return localStorage.getItem(k);
      if (op === 'set') localStorage.setItem(k, v);
      if (op === 'del') localStorage.removeItem(k);
    } catch (e) { /* almacenamiento lleno o bloqueado */ }
    return null;
  }

  // Hub de la página actual: /<hub>/... o "jefeshub" en la raíz.
  function hubDeLaPagina() {
    var seg = location.pathname.split('/').filter(Boolean);
    // Las páginas de Jefe del hub principal (/jefe-366, /consultor-...) no son un hub.
    return seg.length && SLUG.test(seg[0]) && !/^(jefe|consultor)-/.test(seg[0]) ? seg[0] : 'jefeshub';
  }

  // Llave de acceso que llega en el link (?k=...): se guarda y se quita de la barra de direcciones.
  (function capturarAcceso() {
    try {
      var url = new URL(location.href);
      var k = (url.searchParams.get('k') || '').trim();
      if (!/^[a-f0-9]{24}$/.test(k)) return;
      ls('set', ACCESO_PREFIJO + hubDeLaPagina(), k);
      url.searchParams.delete('k');
      history.replaceState(history.state, '', url.pathname + (url.search || '') + url.hash);
    } catch (e) { /* navegador sin URL/history: se ignora */ }
  })();

  function hubDeLlave(key) {
    var i = String(key).indexOf(':');
    return i > 0 ? String(key).slice(0, i) : '';
  }

  function encabezados(key, preguntar) {
    var h = { 'Content-Type': 'application/json' };
    var acceso = (ls('get', ACCESO_PREFIJO + hubDeLlave(key)) || '').trim();
    if (acceso) { h['X-Hub-Codigo'] = acceso; return h; }
    var token = (ls('get', TOKEN_KEY) || '').trim();
    if (!token && preguntar) {
      token = (window.prompt('Token de acceso para guardar cambios:') || '').trim();
      if (token) ls('set', TOKEN_KEY, token);
    }
    if (token) h['X-Storage-Token'] = token;
    return h;
  }

  // Aviso discreto (como mucho uno por minuto) cuando algo se quedó solo en este dispositivo.
  var ultimoAviso = 0;
  function avisar(texto) {
    if (Date.now() - ultimoAviso < 60000 || !document.body) return;
    ultimoAviso = Date.now();
    var d = document.createElement('div');
    d.setAttribute('role', 'status');
    d.textContent = texto;
    d.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:99999;max-width:min(520px,calc(100vw - 24px));' +
      'background:#1A1A1A;color:#fff;padding:11px 16px;border-radius:12px;font:500 13.5px/1.4 Inter,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.3)';
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 6500);
  }

  async function subir(key, value, opts, preguntar) {
    var h = encabezados(key, preguntar);
    var res = await fetch('/api/storage/' + encodeURIComponent(key), {
      method: 'POST',
      cache: 'no-store',
      keepalive: !!(opts && opts.keepalive),
      headers: h,
      body: JSON.stringify({ value: value }),
    });
    if (!res.ok && res.status === 401) {
      // La llave o el token ya no sirven: se olvidan para no seguir mandándolos.
      if (h['X-Hub-Codigo']) ls('del', ACCESO_PREFIJO + hubDeLlave(key));
      if (h['X-Storage-Token']) ls('del', TOKEN_KEY);
    }
    return res;
  }

  function guardarPendiente(key, value) {
    ls('set', PENDIENTE_PREFIJO + key, JSON.stringify({ value: value, t: Date.now() }));
  }
  function leerPendiente(key) {
    try { var p = JSON.parse(ls('get', PENDIENTE_PREFIJO + key) || 'null'); return p && 'value' in p ? p : null; } catch (e) { return null; }
  }

  async function leerServidor(key) {
    const res = await fetch('/api/storage/' + encodeURIComponent(key), { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  }
  // ¿El servidor ya tiene algo más nuevo que el respaldo de este dispositivo? (otro dispositivo lo cambió)
  function servidorMasNuevo(data, pendiente) {
    var t = data && data.updatedAt ? new Date(data.updatedAt).getTime() : 0;
    return t > (pendiente.t || 0);
  }

  // Reintenta subir lo que quedó pendiente, sin abrir el cuadro de la clave.
  var subiendo = false;
  async function reintentarPendientes() {
    if (subiendo) return;
    subiendo = true;
    try {
      var llaves = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(PENDIENTE_PREFIJO) === 0) llaves.push(k.slice(PENDIENTE_PREFIJO.length));
      }
      for (var j = 0; j < llaves.length; j++) {
        var p = leerPendiente(llaves[j]);
        if (!p) continue;
        var h = encabezados(llaves[j], false);
        if (!h['X-Hub-Codigo'] && !h['X-Storage-Token']) continue; // sin con qué autorizar: espera
        try {
          // Si mientras tanto alguien guardó algo más nuevo en el servidor, el respaldo viejo se descarta.
          var actual = await leerServidor(llaves[j]).catch(function () { return null; });
          if (servidorMasNuevo(actual, p)) { ls('del', PENDIENTE_PREFIJO + llaves[j]); continue; }
          var res = await subir(llaves[j], p.value, null, false);
          if (res.ok || res.status === 403 || res.status === 413 || res.status === 400) ls('del', PENDIENTE_PREFIJO + llaves[j]);
        } catch (e) { /* sin conexión: se intenta después */ }
      }
    } catch (e) { /* localStorage no disponible */ }
    subiendo = false;
  }

  window.storage = {
    async get(key) {
      var pendiente = leerPendiente(key);
      var data = null;
      try { data = await leerServidor(key); } catch (e) { data = null; }
      if (pendiente) {
        if (servidorMasNuevo(data, pendiente)) {
          // Otro dispositivo guardó algo más reciente: gana el servidor y el respaldo viejo se borra.
          ls('del', PENDIENTE_PREFIJO + key);
        } else {
          // Lo último escrito en este dispositivo todavía no llega al servidor: se devuelve eso.
          reintentarPendientes();
          return { value: pendiente.value, updatedAt: new Date(pendiente.t).toISOString(), pendiente: true };
        }
      }
      return data && data.value != null ? { value: data.value, updatedAt: data.updatedAt || null } : null;
    },
    async set(key, value, opts) {
      var res;
      try {
        res = await subir(key, value, opts, true);
      } catch (e) {
        guardarPendiente(key, value);
        avisar('Sin conexión: lo guardé en este dispositivo y lo subo en cuanto vuelva el internet.');
        const err = new Error('storage set failed: network');
        err.status = 0;
        throw err;
      }
      if (!res.ok) {
        // 401 (sin permiso) o error del servidor: se respalda para no perder lo escrito.
        if (res.status === 401 || res.status >= 500) {
          guardarPendiente(key, value);
          avisar(res.status === 401
            ? 'No se pudo guardar en la nube (falta tu acceso). Quedó guardado en este dispositivo; abre tu link de acceso para subirlo.'
            : 'No se pudo guardar en la nube. Quedó guardado en este dispositivo y se vuelve a intentar solo.');
        }
        const err = new Error('storage set failed: ' + res.status);
        err.status = res.status;
        throw err;
      }
      ls('del', PENDIENTE_PREFIJO + key);
      return true;
    },
  };

  // Al abrir la página y al volver el internet, se suben los pendientes.
  setTimeout(reintentarPendientes, 1500);
  window.addEventListener('online', reintentarPendientes);
})();
