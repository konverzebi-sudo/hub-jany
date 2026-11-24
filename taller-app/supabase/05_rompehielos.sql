-- =====================================================================
-- 05 · ROMPEHIELOS (diapositivas 5-8)
-- Ejecutar después de 04. Se puede correr más de una vez. No borra nada.
--  * Dinámica 1: el grupo ve las respuestas como chat (con nombre)
--  * Dinámica 2: el grupo ve las respuestas en cuadritos (sin nombre)
--  * Dinámica 3: burbujas de color que crecen con los votos
--  * Dinámica 4 nueva (historia): preguntas que Jany va mostrando;
--    cada quien ve si está improvisando o planificando.
--    La dinámica de 5 opciones (improvisas) se queda como extra.
-- =====================================================================

-- Respuestas que el grupo puede ver: chat (con primer nombre) o cuadritos (sin nombre)
create or replace function public.respuestas_publicas(a uuid)
returns table(nombre text, texto text, actualizado_en timestamptz)
language sql stable security definer set search_path = public as $$
  select case when ac.config->>'publico' = 'chat' then nullif(split_part(coalesce(p.nombre, ''), ' ', 1), '') else null end,
         re.datos->>'texto', re.actualizado_en
  from public.respuestas re
  join public.actividades ac on ac.id = re.actividad_id
  left join public.perfiles p on p.id = re.user_id
  where re.actividad_id = a
    and public.es_miembro(ac.taller_id)
    and (public.es_ponente(ac.taller_id) or ac.config ? 'publico'
         or coalesce((ac.config->>'mostrar_grupo')::boolean, false) or re.destacada)
    and coalesce(re.datos->>'texto', '') <> ''
  order by re.actualizado_en asc
  limit 300
$$;
grant execute on function public.respuestas_publicas(uuid) to authenticated;

do $$
declare t uuid; s_calienta uuid;
begin
  select id into t from public.talleres where slug = 'primer-agente';
  if t is null then raise exception 'No existe el taller primer-agente'; end if;
  select id into s_calienta from public.secciones where taller_id = t and clave = 'calienta';

  update public.actividades set config = config || '{"publico":"chat"}'::jsonb    where taller_id = t and clave = 'dedicas';
  update public.actividades set config = config || '{"publico":"cuadros"}'::jsonb where taller_id = t and clave = 'delegarias';
  update public.actividades set config = config || '{"burbujas":true}'::jsonb     where taller_id = t and clave = 'marketing';
  update public.actividades set orden = 5 where taller_id = t and clave = 'improvisas';

  insert into public.actividades(taller_id, seccion_id, clave, tipo, titulo, orden, estado, config) values
  (t, s_calienta, 'historia', 'opciones', '¿Estás haciendo marketing o estás improvisando?', 4, 'cerrada', jsonb_build_object(
     'nombre', '¿Improvisando o planificando?',
     'instruccion', 'Mientras Jany cuenta su historia irán apareciendo preguntas. Elige la opción que más se parece a lo que haces hoy.',
     'quiz', true, 'visibles', 0,
     'opciones', jsonb_build_array('Improvisando', 'Planificando'),
     'preguntas', jsonb_build_array(
       jsonb_build_object('q', '¿Cómo decides cuándo publicar?',   'a', 'Publico cuando puedo.',                'b', 'Tengo objetivos claros.'),
       jsonb_build_object('q', '¿Sabes qué producto impulsar?',     'a', 'No sé qué producto impulsar.',         'b', 'Sé qué producto promover.'),
       jsonb_build_object('q', '¿Cómo usas las herramientas?',      'a', 'Pruebo herramientas sin un objetivo.', 'b', 'Trabajo con una estrategia.'),
       jsonb_build_object('q', '¿Cómo creas tu contenido?',         'a', 'Creo contenido desde cero cada vez.',  'b', 'Sigo un proceso de creación.'),
       jsonb_build_object('q', '¿Sabes qué te está funcionando?',   'a', 'No sé qué está funcionando.',          'b', 'Reviso y mido mis resultados.'))))
  on conflict (taller_id, clave) do nothing;
end $$;
