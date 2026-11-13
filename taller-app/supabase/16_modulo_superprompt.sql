-- =====================================================================
-- 16 · NOMBRE DEL MÓDULO DEL SUPERPROMPT
-- Solo cambia el título visible de "modulo-3" a "Jefe de Marketing IA"
-- (la sección del SUPERPROMPT / diapositiva 32). No cambia su estado:
-- sigue bloqueado hasta que la ponente lo abra. Se puede correr más de una vez.
-- =====================================================================
update public.secciones s set titulo = 'Jefe de Marketing IA'
from public.talleres t where t.id = s.taller_id and t.slug = 'primer-agente' and s.clave = 'modulo-3';
