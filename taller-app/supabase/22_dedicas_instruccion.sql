-- =====================================================================
-- 22 · DINÁMICA 1 (¿A qué te dedicas?): texto de la instrucción
-- Cambia "Cuéntanos brevemente..." por "Cuéntanos a todos...".
-- Solo toca la instrucción de la actividad 'dedicas'. No borra respuestas.
-- Se puede correr más de una vez.
-- =====================================================================
update public.actividades a
set config = a.config || jsonb_build_object('instruccion',
  'Cuéntanos a todos qué haces, qué productos vendes o qué servicios ofreces. Queremos conocer los negocios que forman parte de este grupo.')
from public.talleres t
where t.id = a.taller_id and t.slug = 'primer-agente' and a.clave = 'dedicas';
