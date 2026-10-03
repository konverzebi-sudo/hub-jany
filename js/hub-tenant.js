/* Deteccion de hub (marca) por URL, igual para TODAS las paginas de la plataforma.
   - /<hub>/adn, /<hub>/jefe-366 ... -> el hub es el primer tramo de la ruta (2 o mas tramos).
   - /adn, /jefe-366 ... (1 tramo) -> la plataforma principal "jefeshub".
   Asi un hub nuevo funciona sin tocar codigo: basta con registrarlo en /hubs. */
(function () {
  'use strict';
  var SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
  var seg = location.pathname.split('/').filter(Boolean);
  var slug = seg.length >= 2 && SLUG.test(seg[0]) ? seg[0] : 'jefeshub';
  var COLOR_DEFAULT = '#B8F725';

  window.__hub = {
    slug: slug,
    // prefijo de rutas: '' para jefeshub, '/rim' para rim...
    prefijo: function (id) { id = id || slug; return id === 'jefeshub' ? '' : '/' + id; },
    // objeto que responde por cualquier hub: { 'rim': '/rim/jefe-x', jefeshub: '/jefe-x' }[id]
    rutas: function (sufijo) {
      return new Proxy({}, { get: function (t, id) { return typeof id === 'string' ? (id === 'jefeshub' ? '' : '/' + id) + sufijo : undefined; } });
    },
    // ruta de la portada del hub: '/' para jefeshub, '/rim' para rim
    portadas: function () {
      return new Proxy({}, { get: function (t, id) { return typeof id === 'string' ? (id === 'jefeshub' ? '/' : '/' + id) : undefined; } });
    },
    // marcas conocidas + un valor por defecto para cualquier hub nuevo
    marcas: function (base) {
      return new Proxy(base, { get: function (t, id) {
        if (typeof id !== 'string') return t[id];
        if (t[id]) return t[id];
        if (id === 'jefeshub') return undefined; // la plataforma principal no tiene marca propia
        var pre = id === 'jefeshub' ? '/' : '/' + id;
        return { fallback: id, name: id, color: COLOR_DEFAULT, hub: pre };
      } });
    }
  };
})();
