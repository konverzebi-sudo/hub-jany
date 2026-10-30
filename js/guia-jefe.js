/* Guía paso a paso reutilizable para cualquier Jefe ("pícale aquí", "este botón sirve para...").
   Uso en la página de un Jefe:
     <script src="/js/guia-jefe.js"></script>
     GuiaJefe.registrar({ id: 'contenido', nombre: 'Jefe de Contenido', pasos: [
       { selector: '#mi-boton', titulo: 'Pícale aquí', texto: 'Esto sirve para...' }, ...
     ]});
     GuiaJefe.iniciar('contenido');           // arranca la guía (p. ej. al llegar desde otro Jefe)
   - Cada paso resalta un elemento y explica para qué sirve. Si el elemento no existe todavía, se salta.
   - `selector` puede ser un texto o una lista de textos (se usa el primero que esté a la vista).
   - Arriba de cada tarjeta va una fila con los pasos: se les pone ✓ conforme los vas viendo.
   - Siempre queda un botón flotante "❓ Guía" para volver a verla cuando quieras.
   - `texto` puede ser una función (se evalúa al mostrar el paso) para poner datos reales. */
(function () {
  if (window.GuiaJefe) return;
  var GUIAS = {};
  var actual = null; // { guia, pasos, i, visitados }
  var els = {};

  var CSS = '' +
    '.gj-fab{position:fixed;right:18px;bottom:18px;z-index:99990;background:#B8F725;color:#111;border:0;border-radius:99px;padding:10px 16px;font:700 13px Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.28)}' +
    '.hero-robot,.jefe-logo,.tt-hero-logo,.hero-logo{cursor:pointer}' +
    '.gj-ov{position:fixed;inset:0;z-index:99991;background:transparent}' +
    '.gj-hl{position:fixed;z-index:99992;border-radius:12px;box-shadow:0 0 0 9999px rgba(0,0,0,.62),0 0 0 3px #B8F725;pointer-events:none;transition:top .25s,left .25s,width .25s,height .25s}' +
    '.gj-card{position:fixed;z-index:99993;width:min(360px,calc(100vw - 24px));background:#fff;color:#111;border-radius:16px;padding:16px 18px;font:400 14px/1.5 Inter,system-ui,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.4)}' +
    '.gj-card h4{margin:0 0 6px;font:700 16px/1.25 Sora,Inter,system-ui,sans-serif;color:#111}' +
    '.gj-card p{margin:0 0 12px;color:#333;white-space:pre-line}' +
    '.gj-card .gj-n{font:600 11.5px Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#6a6a6a;margin-bottom:8px}' +
    '.gj-prog{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}' +
    '.gj-p{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:700 11px Inter,sans-serif;border:2px solid #D4D4D8;color:#9A9AA2;background:#fff}' +
    '.gj-p.ok{background:#111;border-color:#111;color:#B8F725}' +
    '.gj-p.ya{background:#B8F725;border-color:#B8F725;color:#111}' +
    '.gj-row{display:flex;align-items:center;gap:8px}' +
    '.gj-row .gj-sp{flex:1}' +
    '.gj-btn{border:0;border-radius:9px;padding:9px 16px;font:700 13px Inter,sans-serif;cursor:pointer;background:#B8F725;color:#111}' +
    '.gj-btn.sec{background:transparent;border:1px solid #ccc;color:#444;font-weight:600}' +
    '.gj-btn:disabled{opacity:.35;cursor:default}' +
    '.gj-skip{background:transparent;border:0;color:#666;font:600 12.5px Inter,sans-serif;text-decoration:underline;cursor:pointer;padding:8px 4px}';

  function inyectarCss() {
    if (document.getElementById('gj-css')) return;
    var s = document.createElement('style'); s.id = 'gj-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }
  function visible(n) { return n && (n.offsetWidth || n.offsetHeight || n.getClientRects().length) ? n : null; }
  // el elemento de un paso: su selector puede ser un texto o una lista (gana el primero que esté a la vista)
  function elemento(p) {
    var sels = Array.isArray(p.selector) ? p.selector : [p.selector];
    for (var k = 0; k < sels.length; k++) {
      var n = null; try { n = document.querySelector(sels[k]); } catch (e) {}
      if (visible(n)) return n;
    }
    return null;
  }
  function limpiar() {
    ['ov', 'hl', 'card'].forEach(function (k) { if (els[k] && els[k].parentNode) els[k].parentNode.removeChild(els[k]); els[k] = null; });
    window.removeEventListener('resize', reubicar);
    window.removeEventListener('scroll', reubicar, true);
    actual = null;
  }
  function marcarVisto() {
    if (actual && actual.guia) { try { localStorage.setItem('gj_visto_' + actual.guia.id, '1'); } catch (e) {} }
  }
  function cerrar() { marcarVisto(); limpiar(); }

  function reubicar() {
    if (!actual || !els.hl) return;
    var p = actual.pasos[actual.i];
    var n = p && elemento(p);
    if (!n) return;
    var r = n.getBoundingClientRect(), pad = 6;
    els.hl.style.top = (r.top - pad) + 'px'; els.hl.style.left = (r.left - pad) + 'px';
    els.hl.style.width = (r.width + pad * 2) + 'px'; els.hl.style.height = (r.height + pad * 2) + 'px';
    var c = els.card, cw = c.offsetWidth, ch = c.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    var top = r.bottom + pad + 12;
    if (top + ch > vh - 10) top = r.top - pad - 12 - ch;
    if (top < 10) top = Math.min(vh - ch - 10, Math.max(10, r.bottom + pad + 12));
    var left = Math.min(Math.max(12, r.left), vw - cw - 12);
    c.style.top = top + 'px'; c.style.left = left + 'px';
  }

  function mostrar(i, dir) {
    if (!actual) return;
    var pasos = actual.pasos;
    // salta pasos cuyo elemento no esté en pantalla
    while (i >= 0 && i < pasos.length && !elemento(pasos[i])) i += dir;
    if (i < 0) i = 0;
    if (i >= pasos.length) { terminar(); return; }
    actual.i = i;
    actual.visitados[i] = true;
    var p = pasos[i], n = elemento(p);
    n.scrollIntoView({ block: 'center', behavior: 'auto' });
    var texto = typeof p.texto === 'function' ? p.texto() : p.texto;
    var ultimo = true;
    for (var k = i + 1; k < pasos.length; k++) if (elemento(pasos[k])) { ultimo = false; break; }
    var primero = true;
    for (var j = i - 1; j >= 0; j--) if (elemento(pasos[j])) { primero = false; break; }
    // fila de avance: ✓ en los pasos que ya viste, el actual resaltado y los demás vacíos
    var total = 0, pos = 0, chips = '';
    pasos.forEach(function (q, idx) {
      if (!elemento(q)) return;
      total++;
      var num = total;
      if (idx === i) { pos = num; chips += '<span class="gj-p ya" title="' + esc(q.titulo || '') + '">' + num + '</span>'; }
      else if (actual.visitados[idx]) chips += '<span class="gj-p ok" title="' + esc(q.titulo || '') + '">✓</span>';
      else chips += '<span class="gj-p" title="' + esc(q.titulo || '') + '">' + num + '</span>';
    });
    var card = els.card;
    card.innerHTML = '<div class="gj-n">' + esc(actual.guia.nombre || 'Guía') + ' · paso ' + pos + ' de ' + total + '</div>' +
      '<div class="gj-prog">' + chips + '</div>' +
      '<h4>' + esc(p.titulo || '') + '</h4><p>' + esc(texto || '') + '</p>' +
      '<div class="gj-row"><button type="button" class="gj-skip" data-gj="cerrar">Cerrar guía</button><span class="gj-sp"></span>' +
      '<button type="button" class="gj-btn sec" data-gj="atras"' + (primero ? ' disabled' : '') + '>← Atrás</button>' +
      '<button type="button" class="gj-btn" data-gj="sig">' + (ultimo ? 'Entendido ✓' : 'Siguiente →') + '</button></div>';
    card.querySelector('[data-gj="cerrar"]').onclick = cerrar;
    card.querySelector('[data-gj="atras"]').onclick = function () { mostrar(actual.i - 1, -1); };
    card.querySelector('[data-gj="sig"]').onclick = function () { if (ultimo) terminar(); else mostrar(actual.i + 1, 1); };
    requestAnimationFrame(reubicar);
    setTimeout(reubicar, 120);
  }
  function terminar() { marcarVisto(); limpiar(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function iniciar(id) {
    var g = GUIAS[id]; if (!g) return;
    if (actual && actual.guia === g) return; // ya está abierta
    inyectarCss(); limpiar();
    // `antes` (opcional): deja la página en la pantalla donde viven los elementos de la guía (p. ej. cambiar de pestaña)
    if (typeof g.antes === 'function' && !g._listo) {
      g._listo = true;
      Promise.resolve(g.antes()).catch(function () {}).then(function () { g._listo = false; arrancar(g); });
      return;
    }
    arrancar(g);
  }
  function arrancar(g) {
    els.ov = document.createElement('div'); els.ov.className = 'gj-ov';
    els.hl = document.createElement('div'); els.hl.className = 'gj-hl';
    els.card = document.createElement('div'); els.card.className = 'gj-card';
    document.body.appendChild(els.ov); document.body.appendChild(els.hl); document.body.appendChild(els.card);
    actual = { guia: g, pasos: g.pasos, i: 0, visitados: {} };
    window.addEventListener('resize', reubicar);
    window.addEventListener('scroll', reubicar, true);
    mostrar(0, 1);
  }
  function registrar(g) {
    if (!g || !g.id || !g.pasos) return;
    GUIAS[g.id] = g;
    inyectarCss();
    // Sin botón flotante: la guía se abre sola la primera vez (si la página lo pide con autoPrimeraVez) y después, al tocar el icono del Jefe.
    ponerTitulosIcono();
    setTimeout(ponerTitulosIcono, 1500);
    if (g.autoPrimeraVez) setTimeout(function () { if (!vista(g.id) && !actual) iniciar(g.id); }, g.retraso || 2400);
  }
  // El icono del Jefe (arriba del chat) abre la guía de uso. Los selectores cubren los iconos de las distintas páginas de Jefes.
  var ICONOS = '.hero-robot, .jefe-logo, .tt-hero-logo, .hero-logo';
  function ponerTitulosIcono() {
    try { Array.prototype.forEach.call(document.querySelectorAll(ICONOS), function (el) { if (!el.title) el.title = 'Toca para ver la guía de uso'; }); } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest(ICONOS) : null;
    if (!el) return;
    var ids = Object.keys(GUIAS);
    if (ids.length) iniciar(ids[0]);
  });
  function vista(id) { try { return localStorage.getItem('gj_visto_' + id) === '1'; } catch (e) { return false; } }

  window.GuiaJefe = { registrar: registrar, iniciar: iniciar, cerrar: cerrar, vista: vista };
})();
