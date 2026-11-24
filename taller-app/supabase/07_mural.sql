-- =====================================================================
-- 07 · MURAL DE "¿A QUÉ TE DEDICAS?" (diapositiva 7)
-- Solo agrega: una función nueva y la marca "mural" en la dinámica.
-- No cambia respuestas_publicas ni ninguna tabla. Se puede correr
-- más de una vez.
-- =====================================================================
create or replace function public.respuestas_mural(a uuid)
returns table(id uuid, nombre text, usuario text, texto text, actualizado_en timestamptz)
language sql stable security definer set search_path = public as $$
  select re.id,
         nullif(split_part(coalesce(p.nombre, ''), ' ', 1), ''),
         nullif(re.datos->>'usuario', ''),
         re.datos->>'texto', re.actualizado_en
  from public.respuestas re
  join public.actividades ac on ac.id = re.actividad_id
  left join public.perfiles p on p.id = re.user_id
  where re.actividad_id = a
    and public.es_miembro(ac.taller_id)
    and coalesce((ac.config->>'mural')::boolean, false)
    and coalesce(re.datos->>'texto', '') <> ''
  order by re.actualizado_en asc
  limit 400
$$;
grant execute on function public.respuestas_mural(uuid) to authenticated;

update public.actividades a set config = a.config || '{"mural":true}'::jsonb
from public.talleres t
where t.id = a.taller_id and t.slug = 'primer-agente' and a.clave = 'dedicas';
