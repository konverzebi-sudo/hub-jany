/* Configuración de la plataforma de talleres.
   Pega aquí los datos de Supabase → Project Settings → API.
   La "anon public key" es segura para ir en la página.
   NUNCA pongas aquí la service_role key. */
window.TALLER_CONFIG = {
  supabaseUrl: 'https://wyiqigrzcipywvijtchg.supabase.co',        // ej. https://abcd1234.supabase.co
  supabaseAnonKey: 'sb_publishable_fy739Px-yWNLc9aripC7Ag_evHkSvgz',    // anon public key
  taller: 'primer-agente', // slug del taller en la tabla talleres
  zoomMeetingNumber: '6215331135',  // número de la reunión de Zoom (solo números)
  zoomPassword: '1111'        // contraseña de la reunión, si tiene
};
