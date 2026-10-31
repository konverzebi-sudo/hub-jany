/* Barra de consumo de tokens y aviso de tope (el cálculo vive en api/_lib/saldo.js).
   - En el Hub de Jefes: window.__saldo.montarEnHub(slug) pinta la barrita abajo a la derecha.
   - En las páginas de Jefe: window.__saldo.montarEnJefe(slug) muestra un aviso arriba cuando el
     consumo pasa del 90% o se llegó al tope, con el botón para comprar otro paquete. */
(function () {
  'use strict';
  if (window.__saldo) return;

  function millones(n) {
    var m = n / 1e6;
    return (m >= 10 ? Math.round(m) : Math.round(m * 10) / 10).toLocaleString('es-MX') + (Math.abs(m - 1) < 0.05 ? ' millón' : ' millones');
  }
  function fechaCorta(iso) { return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }); }
  function pesos(n) { return '$' + n.toLocaleString('es-MX') + ' MXN'; }

  var css = [
    '.sld{font-family:Inter,system-ui,sans-serif;line-height:1.35}',
    '.sld-hub{position:fixed;right:20px;bottom:20px;z-index:15;width:240px;padding:10px 14px;border-radius:14px;cursor:pointer;',
    'background:rgba(17,20,8,.82);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.12);color:#F3F6E8;font-size:12.5px}',
    '.sld-pct{font-weight:800;font-size:15px}',
    '.sld-bar{height:8px;border-radius:99px;background:rgba(255,255,255,.14);overflow:hidden}',
    '.sld-bar i{display:block;height:100%;border-radius:99px;background:var(--accent,#B8F725);transition:width .6s ease}',
    // Cerrada: solo la línea de avance y el %. Al tocarla se ve el plan y cuándo se renueva.
    '.sld-min{display:flex;align-items:center;gap:10px}.sld-min .sld-bar{flex:1}',
    '.sld-mas{display:none;margin-top:8px}.sld-hub.abierta .sld-mas,.sld-hub.tope .sld-mas{display:block}',
    '.sld-sub{margin-top:6px;opacity:.75;font-size:11.5px}',
    '.sld-btn{display:block;text-align:center;text-decoration:none;font-weight:800;font-size:13px;padding:10px 12px;border-radius:10px;',
    'background:var(--accent,#B8F725);color:#111;border:0;cursor:pointer}',
    '.sld-btn s{opacity:.6;font-weight:600;margin-right:4px}',
    '.sld-aviso{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:95;width:min(560px,calc(100vw - 24px));',
    'display:flex;gap:12px;align-items:center;padding:11px 14px;border-radius:14px;background:#1A1414;color:#fff;',
    'box-shadow:0 12px 34px rgba(0,0,0,.35);font-size:13.5px;border:1px solid #F04438}',
    '.sld-aviso.alto{border-color:#F5A623}',
    '.sld-aviso .sld-btn{flex:none;white-space:nowrap}',
    '.sld-aviso .sld-x{flex:none;background:none;border:0;color:#fff;opacity:.6;font-size:18px;cursor:pointer;padding:0 2px}',
    '@media (max-width:720px){.sld-hub{left:12px;right:12px;bottom:12px;width:auto;padding:9px 14px}.sld-hub .sld-sub{margin-top:5px}.sld-aviso{flex-wrap:wrap;bottom:74px}.sld-aviso .sld-btn{flex:1 1 100%}}'
  ].join('');

  function ponerCss() {
    if (document.getElementById('sld-css')) return;
    var s = document.createElement('style'); s.id = 'sld-css'; s.textContent = css; document.head.appendChild(s);
  }

  function cargar(slug) {
    return fetch('/api/storage/saldo?cliente=' + encodeURIComponent(slug), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function botonCompra(e) {
    var p = e.paquete;
    var txt = 'Comprar ' + millones(p.tokens) + ' de tokens · <s>' + pesos(p.precioAntesMXN) + '</s>' + pesos(p.precioMXN);
    if (!e.linkCompra) return '<div class="sld-sub">Para comprar otro paquete escríbenos a JefesHub.</div>';
    return '<a class="sld-btn" href="' + e.linkCompra + '" target="_blank" rel="noopener">' + txt + '</a>' +
      '<div class="sld-sub">Vigencia de ' + p.vigenciaDias + ' días. Se activa en cuanto se confirma el pago.</div>';
  }

  function montarEnHub(slug) {
    ponerCss();
    return cargar(slug).then(function (e) {
      if (!e) return;
      var caja = document.createElement('div');
      caja.className = 'sld sld-hub' + (e.bloqueado ? ' tope' : '');
      caja.setAttribute('role', 'status');
      caja.title = 'Toca para ver tu plan';
      var html = '<div class="sld-min"><div class="sld-bar" aria-hidden="true"><i style="width:' + Math.min(100, e.porcentaje) + '%"></i></div>' +
        '<span class="sld-pct">' + e.porcentaje + '%</span></div>' +
        '<div class="sld-mas"><b>Tokens de tu plan</b><div class="sld-sub">Se renueva el ' + fechaCorta(e.renueva) + '</div>';
      if (e.paquetes && e.paquetes.length) {
        html += '<div class="sld-sub">+ paquete extra hasta el ' + fechaCorta(e.paquetes[e.paquetes.length - 1].vence) + '</div>';
      }
      if (e.bloqueado) {
        html += '<div class="sld-tope"><p><b>Llegaste al tope de tokens de este ciclo.</b> Tus Jefes no pueden usar la IA hasta el ' +
          fechaCorta(e.renueva) + ' o hasta que compres otro paquete.</p>' + botonCompra(e) + '</div>';
      }
      caja.innerHTML = html + '</div>';
      caja.addEventListener('click', function (ev) {
        if (!ev.target.closest('a')) caja.classList.toggle('abierta');
      });
      document.body.appendChild(caja);
    });
  }

  function montarEnJefe(slug) {
    ponerCss();
    return cargar(slug).then(function (e) {
      if (!e || e.sinTope || e.porcentaje < 90) return;
      try { if (!e.bloqueado && sessionStorage.getItem('sld-cerrado') === '1') return; } catch (err) {}
      var aviso = document.createElement('div');
      aviso.className = 'sld sld-aviso' + (e.bloqueado ? '' : ' alto');
      aviso.setAttribute('role', 'alert');
      aviso.innerHTML = (e.bloqueado
        ? '<div><b>Llegaste al tope de tokens.</b> Puedes seguir viendo y editando todo, pero los Jefes no pueden usar la IA hasta el ' + fechaCorta(e.renueva) + ' o hasta que compres otro paquete.</div>'
        : '<div><b>Llevas el ' + e.porcentaje + '% de tus tokens.</b> Se renuevan el ' + fechaCorta(e.renueva) + '.</div>') +
        (e.bloqueado && e.linkCompra ? '<a class="sld-btn" href="' + e.linkCompra + '" target="_blank" rel="noopener"><s>' + pesos(e.paquete.precioAntesMXN) + '</s>' + pesos(e.paquete.precioMXN) + ' · ' + millones(e.paquete.tokens) + '</a>' : '') +
        (e.bloqueado ? '' : '<button class="sld-x" type="button" aria-label="Cerrar aviso">×</button>');
      document.body.appendChild(aviso);
      var x = aviso.querySelector('.sld-x');
      if (x) x.onclick = function () { aviso.remove(); try { sessionStorage.setItem('sld-cerrado', '1'); } catch (err) {} };
    });
  }

  window.__saldo = { cargar: cargar, montarEnHub: montarEnHub, montarEnJefe: montarEnJefe };
})();
