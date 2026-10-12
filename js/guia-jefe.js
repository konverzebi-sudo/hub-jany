/* Guía paso a paso reutilizable para cualquier Jefe ("pícale aquí", "este botón sirve para...").
   Uso en la página de un Jefe:
     <script src="/js/guia-jefe.js"></script>
     GuiaJefe.registrar({ id: 'contenido', nombre: 'Jefe de Contenido', pasos: [
       { selector: '#mi-boton', titulo: 'Pícale aquí', texto: 'Esto sirve para...' }, ...
     ]});
     GuiaJefe.iniciar('contenido');           // arranca la guía (p. ej. al llegar desde otro Jefe)
   - Cada paso resalta un elemento y explica para qué sirve. Si el elemento no existe todavía, se salta.
   - Siempre queda un botón flotante "❓ Guía" para volver a verla cuando quieras.
   - `texto` puede ser una función (se evalúa al mostrar el paso) para poner datos reales. */
(function () {
  if (window.GuiaJefe) return;
  var GUIAS = {};
  var actual = null; // { guia, pasos, i }
  var els = {};

  var CSS = '' +
    '.gj-fab{position:fixed;right:18px;bottom:18px;z-index:99990;background:#B8F725;color:#111;border:0;border-radius:99px;padding:10px 16px;font:700 13px Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.28)}' +
    '.gj-fab:hover{filter:brightness(.95)}' +
    '.gj-ov{position:fixed;inset:0;z-index:99991;background:transparent}' +
    '.gj-hl{position:fixed;z-index:99992;border-radius:12px;box-shadow:0 0 0 9999px rgba(0,0,0,.62),0 0 0 3px #B8F725;pointer-events:none;transition:top .25s,left .25s,width .25s,height .25s}' +
    '.gj-card{position:fixed;z-index:99993;width:min(340px,calc(100vw - 24px));background:#fff;color:#111;border-radius:16px;padding:16px 18px;font:400 14px/1.5 Inter,system-ui,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.4)}' +
    '.gj-card h4{margin:0 0 6px;font:700 16px/1.25 Sora,Inter,system-ui,sans-serif;color:#111}' +
    '.gj-card p{margin:0 0 12px;color:#333;white-space:pre-line}' +
    '.gj-card .gj-n{font:600 11.5px Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#6a6a6a;margin-bottom:4px}' +
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
  function existe(sel) {
    var n = null; try { n = document.querySelector(sel); } catch (e) {}
    return n && (n.offsetWidth || n.offsetHeight || n.getClientRects().length) ? n : null;
  }
  function limpiar() {
    ['ov', 'hl', 'card'].forEach(function (k) { if (els[k] && els[k].parentNode) els[k].parentNode.removeChild(els[k]); els[k] = null; });
    window.removeEventListener('resize', reubicar);
    window.removeEventListener('scroll', reubicar, true);
    actual = null;
  }
  function cerrar() { limpiar(); }

  function reubicar() {
    if (!actual || !els.hl) return;
    var p = actual.pasos[actual.i];
    var n = p && existe(p.selector);
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
    while (i >= 0 && i < pasos.length && !existe(pasos[i].selector)) i += dir;
    if (i < 0) i = 0;
    if (i >= pasos.length) { terminar(); return; }
    actual.i = i;
    var p = pasos[i], n = existe(p.selector);
    n.scrollIntoView({ block: 'center', behavior: 'auto' });
    var texto = typeof p.texto === 'function' ? p.texto() : p.texto;
    var ultimo = true;
    for (var k = i + 1; k < pasos.length; k++) if (existe(pasos[k].selector)) { ultimo = false; break; }
    var primero = true;
    for (var j = i - 1; j >= 0; j--) if (existe(pasos[j].selector)) { primero = false; break; }
    // numera solo los pasos que sí se ven ahorita (los que no existen en pantalla se saltan)
    var total = 0, pos = 0;
    pasos.forEach(function (q, idx) { if (existe(q.selector)) { total++; if (idx <= i) pos++; } });
    var card = els.card;
    card.innerHTML = '<div class="gj-n">' + esc(actual.guia.nombre || 'Guía') + ' · paso ' + pos + ' de ' + total + '</div>' +
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
  function terminar() {
    if (actual && actual.guia) { try { localStorage.setItem('gj_visto_' + actual.guia.id, '1'); } catch (e) {} }
    cerrar();
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function iniciar(id) {
    var g = GUIAS[id]; if (!g) return;
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
    actual = { guia: g, pasos: g.pasos, i: 0 };
    window.addEventListener('resize', reubicar);
    window.addEventListener('scroll', reubicar, true);
    mostrar(0, 1);
  }
  function registrar(g) {
    if (!g || !g.id || !g.pasos) return;
    GUIAS[g.id] = g;
    inyectarCss();
    if (!document.getElementById('gj-fab-' + g.id)) {
      var b = document.createElement('button');
      b.type = 'button'; b.id = 'gj-fab-' + g.id; b.className = 'gj-fab';
      b.textContent = '❓ Guía'; b.title = 'Ver la guía de uso de ' + (g.nombre || 'este Jefe');
      b.onclick = function () { iniciar(g.id); };
      (document.body ? Promise.resolve() : new Promise(function (r) { document.addEventListener('DOMContentLoaded', r); })).then(function () { document.body.appendChild(b); });
    }
  }
  function vista(id) { try { return localStorage.getItem('gj_visto_' + id) === '1'; } catch (e) { return false; } }

  window.GuiaJefe = { registrar: registrar, iniciar: iniciar, cerrar: cerrar, vista: vista };
})();
