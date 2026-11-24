-- =====================================================================
-- 18 · NOMBRE DEL MÓDULO DEL SUPERPROMPT → "Hubcito en marcha"
-- Solo cambia el título visible de "modulo-3". No cambia su estado.
-- Se puede correr más de una vez.
-- =====================================================================
update public.secciones s set titulo = 'Hubcito en marcha'
from public.talleres t where t.id = s.taller_id and t.slug = 'primer-agente' and s.clave = 'modulo-3';
