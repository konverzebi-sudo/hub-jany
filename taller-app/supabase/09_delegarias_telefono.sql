-- =====================================================================
-- 09 · DINÁMICA 2 "¿QUÉ DELEGARÍAS?" EN FORMATO TELÉFONO
-- Solo marca la dinámica para mostrarse en el teléfono con las 6
-- respuestas más recientes. Las respuestas de apoyo del equipo se
-- guardan dentro de su configuración (no cuentan como participación).
-- No crea ni borra tablas. Se puede correr más de una vez.
-- =====================================================================
update public.actividades a set config = a.config || '{"telefono":true,"ultimas":6}'::jsonb
from public.talleres t
where t.id = a.taller_id and t.slug = 'primer-agente' and a.clave = 'delegarias';
