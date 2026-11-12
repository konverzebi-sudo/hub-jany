-- =====================================================================
-- 15 · NOMBRES DE LOS MÓDULOS SEGÚN LA ESTRUCTURA DEL TALLER
-- Solo cambia títulos visibles: "calienta" → Rompehielo y
-- "modulo-2" → Calienta motores (sigue bloqueado hasta que Jany lo abra).
-- No toca estados, actividades ni respuestas. Se puede correr más de una vez.
-- =====================================================================
update public.secciones s set titulo = 'Rompehielo'
from public.talleres t where t.id = s.taller_id and t.slug = 'primer-agente' and s.clave = 'calienta';
update public.secciones s set titulo = 'Calienta motores'
from public.talleres t where t.id = s.taller_id and t.slug = 'primer-agente' and s.clave = 'modulo-2';
