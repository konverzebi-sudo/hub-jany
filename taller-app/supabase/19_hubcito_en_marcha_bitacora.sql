-- =====================================================================
-- 19 · HUBCITO EN MARCHA: lo que cada participante trae de ChatGPT
-- Crea UNA actividad "bitacora" (producto ganador, mercado estrella y
-- las siguientes metas). Va en la misma sección del brief ("prepara"),
-- que siempre está disponible, y queda ABIERTA para que puedan seguir
-- editando después del taller. No toca nada de lo que ya existe.
-- Se puede correr más de una vez.
-- =====================================================================
insert into public.actividades (taller_id, seccion_id, clave, tipo, titulo, config, estado, orden)
select t.id, s.id, 'bitacora', 'formulario', 'Mi Hubcito en marcha', '{}'::jsonb, 'abierta', 2
from public.talleres t join public.secciones s on s.taller_id = t.id and s.clave = 'prepara'
where t.slug = 'primer-agente'
on conflict (taller_id, clave) do nothing;

-- Verificación
select a.clave, a.estado, s.clave as seccion from public.actividades a join public.secciones s on s.id = a.seccion_id where a.clave = 'bitacora';
