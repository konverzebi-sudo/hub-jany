-- =====================================================================
-- 20 · DINÁMICA 2 (¿Qué delegarías?): VARIAS TAREAS POR PERSONA
-- Cada participante puede mandar hasta 5 tareas. Se guardan en la MISMA
-- respuesta (datos.textos = lista; datos.texto = resumen). Esta función
-- pública ahora devuelve un cuadro por cada tarea. No toca tablas ni
-- respuestas guardadas. Correr SOLO cuando la plataforma esté conectada a
-- Supabase. Se puede correr más de una vez.
-- =====================================================================
create or replace function public.respuestas_publicas(a uuid)
returns table(nombre text, texto text, actualizado_en timestamptz)
language sql stable security definer set search_path = public as $$
  select case when ac.config->>'publico' = 'chat' then nullif(split_part(coalesce(p.nombre, ''), ' ', 1), '') else null end,
         t.texto, re.actualizado_en
  from public.respuestas re
  join public.actividades ac on ac.id = re.actividad_id
  left join public.perfiles p on p.id = re.user_id
  cross join lateral (
    select x as texto from jsonb_array_elements_text(case when jsonb_typeof(re.datos->'textos') = 'array' then re.datos->'textos' else '[]'::jsonb end) x
    union all
    select re.datos->>'texto' where jsonb_typeof(re.datos->'textos') is distinct from 'array'
  ) t
  where re.actividad_id = a
    and public.es_miembro(ac.taller_id)
    and (public.es_ponente(ac.taller_id) or ac.config ? 'publico'
         or coalesce((ac.config->>'mostrar_grupo')::boolean, false) or re.destacada)
    and coalesce(t.texto, '') <> ''
  order by re.actualizado_en asc
  limit 500
$$;
grant execute on function public.respuestas_publicas(uuid) to authenticated;
