/* =========================================================
   Mesa Lista · conexión con Supabase
   Aquí van SOLO dos datos públicos (no son contraseñas):
   Supabase > Project Settings > API (o Data API / API Keys)
   ========================================================= */
window.MESA_CONFIG = {
  // Project URL, por ejemplo: https://abcdefghijkl.supabase.co
  supabaseUrl: "https://wyiqigrzcipywvijtchg.supabase.co",
  // Publishable key (sb_publishable_...) o la clave "anon public"
  supabaseKey: "sb_publishable_fy739Px-yWNLc9aripC7Ag_evHkSvgz",
  // true = el panel abre sin contraseña (solo para demos; requiere 3-modo-libre.sql)
  // false = el panel pide correo y contraseña
  openPanel: true
};
