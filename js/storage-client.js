// Shim que reemplaza window.storage (entorno de artifacts) por llamadas reales a /api/storage/:key.
// El resto del código de cada agente no cambia: sigue usando window.storage.get()/set() igual que antes.
(function () {
  function getToken() {
    let token = localStorage.getItem('jefeshub_storage_token');
    if (!token) {
      token = window.prompt('Token de acceso para guardar cambios:') || '';
      if (token) localStorage.setItem('jefeshub_storage_token', token);
    }
    return token;
  }

  window.storage = {
    async get(key) {
      const res = await fetch('/api/storage/' + encodeURIComponent(key));
      if (!res.ok) return null;
      const data = await res.json();
      return data.value != null ? { value: data.value } : null;
    },
    async set(key, value) {
      const res = await fetch('/api/storage/' + encodeURIComponent(key), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Storage-Token': getToken() },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        if (res.status === 401) localStorage.removeItem('jefeshub_storage_token');
        throw new Error('storage set failed: ' + res.status);
      }
      return true;
    },
  };
})();
