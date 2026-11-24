-- =====================================================================
-- RESULTADOS PARA EL GRUPO (ejecutar después de 01 y 02)
-- El grupo nunca lee la tabla respuestas: solo estas funciones, que
-- devuelven datos agregados o anónimos.
-- =====================================================================

-- Respuestas abiertas SIN nombre, solo si el ponente activó
-- actividades.config.mostrar_grupo = true
create or replace function public.respuestas_anonimas(a uuid)
returns table(texto text)
language sql stable security definer set search_path = public as $$
  select re.datos->>'texto'
  from public.respuestas re
  join public.actividades ac on ac.id = re.actividad_id
  where re.actividad_id = a
    and public.es_miembro(ac.taller_id)
    and (public.es_ponente(ac.taller_id) or coalesce((ac.config->>'mostrar_grupo')::boolean, false))
    and coalesce(re.datos->>'texto', '') <> ''
  order by re.actualizado_en desc
  limit 200
$$;

-- Total de participantes únicos que respondieron (para el contador central)
create or replace function public.participantes_actividad(a uuid)
returns bigint
language sql stable security definer set search_path = public as $$
  select count(distinct re.user_id)
  from public.respuestas re join public.actividades ac on ac.id = re.actividad_id
  where re.actividad_id = a and public.es_miembro(ac.taller_id)
$$;

grant execute on function public.respuestas_anonimas(uuid) to authenticated;
grant execute on function public.participantes_actividad(uuid) to authenticated;
grant execute on function public.resultados_actividad(uuid) to authenticated;
