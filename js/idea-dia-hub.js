/* Idea del día del Jefe del Faro en la pantalla principal del hub.
 * Al abrir el hub aparece una tarjeta con la idea de hoy (la misma que muestra el Faro arriba).
 * Si todavía no hay idea de hoy, la pide al Faro (api/consultor-radar.js, modo 'idea-del-dia'):
 * así se genera la primera vez que se abre el hub o el Faro cada día, y la otra pantalla ya la encuentra hecha.
 * Uso: <script src="/js/idea-dia-hub.js"></script><script>window.__ideaDiaHub.montar('jefeshub', {faro:'/jefe-radar', contenido:'/jefe-contenido'})</script>
 */
(function () {
  'use strict';

  var FOCO_TODO = { id: 'all', nombre: '' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function hoyMx() {
    try { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }

  function textoParaContenido(e) {
    var i = e.idea || {}, t = i.tendencia || {};
    return [
      'IDEA DEL DÍA (Jefe del Faro, ' + (e.date || '') + ')',
      'Tema: ' + (i.tema || ''),
      'Gancho: ' + (i.gancho || ''),
      i.formato ? 'Formato: ' + i.formato : '',
      i.como_hacerlo ? 'Cómo hacerlo: ' + i.como_hacerlo : '',
      i.por_que_te_sirve ? 'Por qué le sirve a mi negocio: ' + i.por_que_te_sirve : '',
      t.que ? 'Tendencia en la que se basa: ' + t.que + (t.fuente ? ' (fuente: ' + t.fuente + ')' : '') + (t.verificada ? '' : ' [no verificada]') : '',
      i.cta_sugerido ? 'Cierre sugerido: ' + i.cta_sugerido : '',
      'Úsala como punto de partida y escríbela con la voz de mi marca. No copies a nadie.'
    ].filter(Boolean).join('\n');
  }

  var CSS = '' +
    '.idh{position:fixed;top:18px;right:18px;z-index:60;width:380px;max-width:calc(100vw - 32px);max-height:calc(100vh - 110px);overflow:auto;' +
    'background:#FFFFFF;color:#0F0E0C;border:1px solid #E4E6DB;border-radius:20px;padding:18px 18px 16px;font-family:Barlow,sans-serif;' +
    'box-shadow:0 18px 50px rgba(0,0,0,.35);animation:idhEntra .35s ease-out;}' +
    '@keyframes idhEntra{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}' +
    '.idh-top{display:flex;align-items:center;gap:10px;margin-bottom:12px;}' +
    '.idh-logo{width:38px;height:38px;border-radius:12px;background:#F6F7F1;display:grid;place-items:center;flex:none;}' +
    '.idh-logo img{width:26px;height:26px;object-fit:contain;}' +
    '.idh-label{font:700 11px Barlow,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#5D6055;line-height:1.3;}' +
    '.idh-label b{display:block;color:#0F0E0C;font-family:"Bebas Neue",sans-serif;font-weight:400;font-size:20px;letter-spacing:.03em;}' +
    '.idh-x{margin-left:auto;width:32px;height:32px;border-radius:50%;border:1px solid #E4E6DB;background:transparent;cursor:pointer;font:700 16px Barlow,sans-serif;color:#0F0E0C;flex:none;}' +
    '.idh-x:hover{background:#0F0E0C;color:#fff;border-color:#0F0E0C;}' +
    '.idh-prev{background:#0F0E0C;color:#fff;border-radius:16px;padding:16px;}' +
    '.idh-tema{font-family:"Inter Tight",sans-serif;font-weight:800;letter-spacing:-.025em;font-size:20px;line-height:1.2;margin:0 0 6px;}' +
    '.idh-gancho{margin:0;color:#D9DBD0;font-size:14.5px;font-style:italic;line-height:1.45;}' +
    '.idh-chip{display:inline-block;margin-top:10px;font:700 10.5px Barlow,sans-serif;letter-spacing:.12em;text-transform:uppercase;background:#C9F507;color:#0F0E0C;padding:3px 8px;border-radius:4px;}' +
    '.idh-b{margin-top:12px;font-size:14px;line-height:1.45;color:#2B2D26;}' +
    '.idh-b > span{display:block;font:700 11px Barlow,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#5D6055;margin-bottom:3px;}' +
    '.idh-b a{color:#0F0E0C;text-decoration:underline;text-decoration-color:#A4B41C;word-break:break-all;}' +
    '.idh-aviso{margin-top:10px;font-size:13px;background:#F6F7F1;border:1px solid #E4E6DB;border-radius:10px;padding:8px 10px;color:#5D6055;}' +
    '.idh-acc{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;}' +
    '.idh-btn{font:700 14px Barlow,sans-serif;border-radius:12px;padding:10px 14px;border:1px solid #E4E6DB;background:transparent;color:#0F0E0C;cursor:pointer;text-decoration:none;}' +
    '.idh-btn.principal{background:#C9F507;border-color:#C9F507;}' +
    '.idh-btn:hover{filter:brightness(.95);}' +
    '.idh-cargando{font-size:14.5px;color:#5D6055;line-height:1.45;display:flex;gap:10px;align-items:center;}' +
    '.idh-cargando i{width:16px;height:16px;border-radius:50%;border:2px solid #E4E6DB;border-top-color:#A4B41C;animation:idhGira 1s linear infinite;flex:none;}' +
    '@keyframes idhGira{to{transform:rotate(360deg)}}' +
    '.idh-pill{position:fixed;top:18px;right:18px;z-index:60;display:flex;align-items:center;gap:8px;background:#C9F507;color:#0F0E0C;border:0;border-radius:999px;' +
    'padding:9px 16px 9px 10px;font:700 14px Barlow,sans-serif;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.35);}' +
    '.idh-pill img{width:22px;height:22px;object-fit:contain;}' +
    '.idh-oculto{display:none !important;}' +
    '@media (max-width:640px){.idh{top:auto;bottom:16px;right:16px;left:16px;width:auto;max-height:60vh;}.idh-pill{top:auto;bottom:16px;right:16px;}}' +
    '@media (prefers-reduced-motion:reduce){.idh{animation:none}.idh-cargando i{animation:none}}';

  function montar(clienteId, rutas) {
    if (!clienteId || document.getElementById('idhCaja')) return;
    rutas = rutas || {};
    var rutaFaro = rutas.faro || '/jefe-radar';
    var rutaContenido = rutas.contenido || '/jefe-contenido';
    var llaveCerrada = 'idh-cerrada:' + clienteId;

    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);

    var caja = document.createElement('aside');
    caja.className = 'idh';
    caja.id = 'idhCaja';
    caja.setAttribute('aria-label', 'Idea del día del Jefe del Faro');
    var pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'idh-pill idh-oculto';
    pill.innerHTML = '<img src="/img/jefe-faro-logo-negro.webp" alt="">Idea del día';
    document.body.appendChild(caja);
    document.body.appendChild(pill);

    function cerrada() { try { return localStorage.getItem(llaveCerrada) === hoyMx(); } catch (e) { return false; } }
    function mostrar(abierta) {
      caja.classList.toggle('idh-oculto', !abierta);
      pill.classList.toggle('idh-oculto', abierta);
      try { if (abierta) localStorage.removeItem(llaveCerrada); else localStorage.setItem(llaveCerrada, hoyMx()); } catch (e) {}
    }
    pill.addEventListener('click', function () { mostrar(true); });

    var encabezado = '<div class="idh-top"><div class="idh-logo"><img src="/img/jefe-faro-logo-negro.webp" alt=""></div>' +
      '<div class="idh-label">Idea del día<b>Jefe del Faro</b></div>' +
      '<button type="button" class="idh-x" aria-label="Minimizar">×</button></div>';

    function pintar(html) {
      caja.innerHTML = encabezado + html;
      caja.querySelector('.idh-x').addEventListener('click', function () { mostrar(false); });
    }

    function cargando(txt) { pintar('<div class="idh-cargando"><i></i><span>' + esc(txt) + '</span></div>'); }

    function aviso(txt, conReintento) {
      pintar('<div class="idh-b">' + esc(txt) + '</div><div class="idh-acc">' +
        (conReintento ? '<button type="button" class="idh-btn principal" data-r>Intentar de nuevo</button>' : '') +
        '<a class="idh-btn" href="' + esc(rutaFaro) + '">Abrir el Faro</a></div>');
      var r = caja.querySelector('[data-r]');
      if (r) r.addEventListener('click', function () { iniciar(true); });
    }

    function pintarIdea(e) {
      var i = e.idea || {}, t = i.tendencia || {};
      var url = /^https?:\/\//i.test(t.fuente || '') ? t.fuente : '';
      var fuente = url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(t.fuente) + '</a>' : esc(t.fuente || '');
      pintar(
        '<div class="idh-prev"><h3 class="idh-tema">' + esc(i.tema) + '</h3>' +
        '<p class="idh-gancho">“' + esc(i.gancho) + '”</p>' +
        (i.formato ? '<span class="idh-chip">' + esc(i.formato) + '</span>' : '') + '</div>' +
        (i.por_que_te_sirve ? '<div class="idh-b"><span>Por qué le sirve a tu negocio</span>' + esc(i.por_que_te_sirve) + '</div>' : '') +
        (t.que ? '<div class="idh-b"><span>De dónde salió</span>' + esc(t.que) + (fuente ? '<br>Fuente: ' + fuente : '') + '</div>' : '') +
        (t.que && !t.verificada ? '<div class="idh-aviso">El Faro no pudo verificar esta tendencia. Revísala antes de apoyarte en ella.</div>' : '') +
        '<div class="idh-acc"><button type="button" class="idh-btn principal" data-c>Hacerla con el Jefe de Contenido</button>' +
        '<a class="idh-btn" href="' + esc(rutaFaro) + '">Ver completa en el Faro</a></div>'
      );
      caja.querySelector('[data-c]').addEventListener('click', function (ev) {
        var btn = ev.currentTarget;
        var ir = function () { location.href = rutaContenido; };
        var txt = textoParaContenido(e);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(function () {
            btn.textContent = 'Copiada · pégala en Contenido';
            setTimeout(ir, 900);
          }, ir);
        } else { ir(); }
      });
    }

    function post(body) {
      return fetch('/api/consultor-radar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ cliente: clienteId, foco: FOCO_TODO }, body))
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          return r.ok ? { ok: true, data: d } : { ok: false, status: r.status, error: d.error || 'No se pudo completar.' };
        });
      }, function () { return { ok: false, error: 'Hubo un error de conexión.' }; });
    }

    var ocupado = false;
    function iniciar(reintento) {
      if (ocupado) return;
      ocupado = true;
      if (reintento) mostrar(true);
      cargando('Revisando la idea de hoy…');
      post({ modo: 'ideas-dia-estado' }).then(function (r) {
        if (!r.ok) { aviso('No pude traer la idea de hoy. ' + r.error, true); return null; }
        if (r.data.idea) { pintarIdea(r.data.idea); return null; }
        var ficha = r.data.ficha || {};
        if (!ficha.existe && ficha.sinFuentes) {
          aviso('Para proponerte ideas, el Faro necesita saber a quién le vendes. Llena tu ADN (o tu Temporada o tu Jefe 366).', false);
          return null;
        }
        var paso = Promise.resolve();
        if (!ficha.existe) {
          cargando('Armando la ficha de tu audiencia (solo la primera vez)…');
          paso = post({ modo: 'ficha-audiencia' });
        }
        return paso.then(function () {
          cargando('Tu Jefe del Faro está buscando qué se mueve en tu nicho esta semana… (cerca de un minuto)');
          return post({ modo: 'idea-del-dia' });
        }).then(function (g) {
          if (!g.ok) { aviso('No pude armar la idea de hoy. ' + g.error, true); return; }
          pintarIdea(g.data.idea);
        });
      }).then(function () { ocupado = false; }, function () { ocupado = false; aviso('No pude traer la idea de hoy.', true); });
    }

    mostrar(!cerrada());
    iniciar(false);
  }

  window.__ideaDiaHub = { montar: montar, _probar: { textoParaContenido: textoParaContenido, esc: esc } };
})();
