-- =====================================================================
-- 10 · TEXTO DE LA DINÁMICA 2 "¿QUÉ DELEGARÍAS?"
-- Solo actualiza la descripción para el participante. No toca
-- respuestas ni otras actividades ("metas" se conserva intacta).
-- =====================================================================
update public.actividades a
set config = a.config || jsonb_build_object('instruccion', 'Escribe una tarea que actualmente realizas en tu negocio y que te gustaría delegar a un asistente de IA.')
from public.talleres t
where t.id = a.taller_id and t.slug = 'primer-agente' and a.clave = 'delegarias';
