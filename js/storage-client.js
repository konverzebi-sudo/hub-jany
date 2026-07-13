// Shim que reemplaza window.storage (entorno de artifacts) por llamadas reales a /api/storage/:key.
// El resto del código de cada agente no cambia: sigue usando window.storage.get()/set() igual que antes.
(function () {
  // El token se guarda una sola vez por dispositivo (localStorage sobrevive
  // refresh y cierres de pestaña). Solo se vuelve a pedir si el servidor lo
  // rechaza (401) — de ahi que se limpie unicamente en ese caso.
  function getToken() {
    let token = (localStorage.getItem('jefeshub_storage_token') || '').trim();
    if (!token) {
      token = (window.prompt('Token de acceso para guardar cambios:') || '').trim();
      if (token) localStorage.setItem('jefeshub_storage_token', token);
    }
    return token;
  }

  window.storage = {
    async get(key) {
      const res = await fetch('/api/storage/' + encodeURIComponent(key), { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return data.value != null ? { value: data.value, updatedAt: data.updatedAt || null } : null;
    },
    async set(key, value, opts) {
      const res = await fetch('/api/storage/' + encodeURIComponent(key), {
        method: 'POST',
        cache: 'no-store',
        keepalive: !!(opts && opts.keepalive),
        headers: { 'Content-Type': 'application/json', 'X-Storage-Token': getToken() },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        if (res.status === 401) localStorage.removeItem('jefeshub_storage_token');
        const err = new Error('storage set failed: ' + res.status);
        err.status = res.status;
        throw err;
      }
      return true;
    },
  };
})();
