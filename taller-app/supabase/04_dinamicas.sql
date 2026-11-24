-- =====================================================================
-- 04 · LAS 4 DINÁMICAS DE "CALENTANDO MOTORES" + NOMBRE "ASESOR"
-- Ejecutar después de 01, 02 y 03. Se puede correr más de una vez.
-- No borra nada: las 3 dinámicas anteriores (metas, situacion,
-- diagnostico) se quedan, solo se mueven al final (orden 11-13).
-- =====================================================================

-- 1) Respuestas que Jany decide compartir con el grupo (sin nombre)
alter table public.respuestas add column if not exists destacada boolean not null default false;

-- Solo el ponente puede marcar "destacada": si un alumno intenta tocarla, se ignora
create or replace function public.proteger_destacada() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from public.actividades a where a.id = new.actividad_id and public.es_ponente(a.taller_id)) then
    if tg_op = 'INSERT' then new.destacada := false; else new.destacada := old.destacada; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_resp_destacada on public.respuestas;
create trigger trg_resp_destacada before insert or update on public.respuestas
  for each row execute function public.proteger_destacada();

-- Jany marca / desmarca una respuesta para compartirla
create or replace function public.destacar_respuesta(r uuid, v boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from public.respuestas re join public.actividades a on a.id = re.actividad_id
                where re.id = r and public.es_ponente(a.taller_id)) then
    raise exception 'Solo la ponente puede compartir respuestas';
  end if;
  update public.respuestas set destacada = v where id = r;
end $$;

-- Jany reinicia los resultados de una dinámica (borra sus respuestas)
create or replace function public.reiniciar_actividad(a uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from public.actividades ac where ac.id = a and public.es_ponente(ac.taller_id)) then
    raise exception 'Solo la ponente puede reiniciar resultados';
  end if;
  delete from public.respuestas where actividad_id = a;
end $$;

-- Textos abiertos sin nombre: el ponente ve todos; el grupo solo si Jany
-- activó "mostrar al grupo" o compartió esa respuesta
create or replace function public.respuestas_anonimas(a uuid)
returns table(texto text)
language sql stable security definer set search_path = public as $$
  select re.datos->>'texto'
  from public.respuestas re
  join public.actividades ac on ac.id = re.actividad_id
  where re.actividad_id = a
    and public.es_miembro(ac.taller_id)
    and (public.es_ponente(ac.taller_id) or coalesce((ac.config->>'mostrar_grupo')::boolean, false) or re.destacada)
    and coalesce(re.datos->>'texto', '') <> ''
  order by re.destacada desc, re.actualizado_en desc
  limit 200
$$;

grant execute on function public.destacar_respuesta(uuid, boolean) to authenticated;
grant execute on function public.reiniciar_actividad(uuid) to authenticated;
grant execute on function public.respuestas_anonimas(uuid) to authenticated;

-- 2) El alumno ve las dinámicas pendientes (solo el título y su estado;
--    no puede responder hasta que Jany la abra: eso lo sigue cuidando puede_responder)
drop policy if exists p_act_sel on public.actividades;
create policy p_act_sel on public.actividades for select using (
  public.es_equipo(taller_id) or (public.es_miembro(taller_id) and exists(
    select 1 from public.secciones s where s.id = actividades.seccion_id and s.estado <> 'bloqueada')));

-- 3) Datos: nombre "asesor" y las 4 dinámicas nuevas
do $$
declare
  t uuid; s_calienta uuid; s_empieza uuid;
begin
  select id into t from public.talleres where slug = 'primer-agente';
  if t is null then raise exception 'No existe el taller primer-agente (corre 02 primero)'; end if;
  update public.talleres set nombre = 'Tu Primer Asesor con IA' where id = t;

  select id into s_empieza  from public.secciones where taller_id = t and clave = 'empieza';
  select id into s_calienta from public.secciones where taller_id = t and clave = 'calienta';

  update public.contenidos set cuerpo = jsonb_set(jsonb_set(cuerpo,
      '{bienvenida,titulo}', to_jsonb('¡BIENVENIDO A TU PRIMER ASESOR CON IA!'::text)),
      '{bienvenida,texto}', to_jsonb('En este taller vas a construir tu primer asesor con IA aplicado a tu negocio: con tu información, tus productos y tus objetivos. Este espacio te acompaña antes y durante la sesión en vivo.'::text))
  where seccion_id = s_empieza and cuerpo ? 'bienvenida';

  update public.contenidos set cuerpo = jsonb_set(cuerpo, '{intro}',
      to_jsonb('Cuatro dinámicas rápidas para conocernos. Jany abre cada una durante la presentación: respóndela aquí cuando te lo indique.'::text))
  where seccion_id = s_calienta;

  -- Las anteriores se quedan, al final
  update public.actividades set orden = 11 where taller_id = t and clave = 'metas';
  update public.actividades set orden = 12 where taller_id = t and clave = 'situacion';
  update public.actividades set orden = 13 where taller_id = t and clave = 'diagnostico';

  insert into public.actividades(taller_id, seccion_id, clave, tipo, titulo, orden, estado, config) values
  (t, s_calienta, 'dedicas', 'abierta', '¿A qué te dedicas? Cuéntanos qué vendes o qué servicio ofreces.', 1, 'cerrada', jsonb_build_object(
     'nombre', '¿A qué te dedicas?',
     'instruccion', 'Cuéntanos brevemente qué haces, qué productos vendes o qué servicios ofreces. Queremos conocer los negocios que forman parte de este grupo.',
     'corta', true, 'max', 280, 'editable', true, 'boton', 'ENVIAR RESPUESTA',
     'placeholder', 'Ej. Vendo pasteles personalizados para eventos en Saltillo')),
  (t, s_calienta, 'delegarias', 'abierta', 'Si tuvieras un asistente que conociera tu negocio y pudiera ayudarte, ¿qué tarea le delegarías primero?', 2, 'cerrada', jsonb_build_object(
     'nombre', '¿Qué delegarías?',
     'instruccion', 'Piensa en esas actividades que te quitan tiempo, que repites constantemente o que no sabes cómo resolver. ¿Qué te gustaría que tu asistente hiciera por ti?',
     'max', 1500, 'editable', true, 'boton', 'ENVIAR RESPUESTA', 'compartir', true)),
  (t, s_calienta, 'marketing', 'opciones', '¿Qué parte del marketing de tu negocio te cuesta más trabajo?', 3, 'cerrada', jsonb_build_object(
     'nombre', '¿Qué parte del marketing te cuesta más?',
     'instruccion', 'Selecciona todas las opciones que representen tus principales dificultades.',
     'multiple', true, 'otro', true, 'destacar', 3, 'boton', 'ENVIAR RESPUESTAS',
     'opciones', jsonb_build_array(
       'No sé qué publicar en redes sociales.',
       'No sé qué producto o servicio promocionar.',
       'Me cuesta conseguir nuevos clientes.',
       'No sé crear imágenes o videos atractivos.',
       'No sé cómo hacer campañas de publicidad.',
       'No tengo tiempo para crear contenido.',
       'No sé cómo organizar mi estrategia de marketing.',
       'No sé cómo medir si mis publicaciones o campañas funcionan.',
       'Me cuesta mantener la constancia.'))),
  (t, s_calienta, 'improvisas', 'opciones', 'Cuando tienes que promocionar tu negocio, ¿cómo decides qué hacer?', 4, 'cerrada', jsonb_build_object(
     'nombre', '¿Estás haciendo marketing o estás improvisando?',
     'instruccion', 'Selecciona la opción que mejor describa tu situación actual. No hay respuestas buenas ni malas; queremos identificar desde dónde estás comenzando.',
     'unica', true, 'boton', 'ENVIAR RESPUESTA',
     'opciones', jsonb_build_array('Improviso', 'Tengo ideas, pero no un plan', 'Planifico algunas acciones', 'Tengo una estrategia', 'Trabajo con un método'),
     'detalles', jsonb_build_array(
       'Publico cuando puedo. No siempre sé qué producto impulsar ni qué está funcionando.',
       'Sé algunas cosas que quiero comunicar, pero no tengo un calendario ni una estrategia definida.',
       'Organizo publicaciones y promociones, pero no siempre tengo objetivos o procesos claros.',
       'Sé qué producto promover, a quién quiero llegar y qué quiero comunicar.',
       'Tengo objetivos, estrategia, procesos de creación y reviso mis resultados para hacer ajustes.'),
     'grupos', jsonb_build_array(
       jsonb_build_object('nombre', 'Improvisando', 'opciones', jsonb_build_array(0)),
       jsonb_build_object('nombre', 'Comenzando a planificar', 'opciones', jsonb_build_array(1, 2)),
       jsonb_build_object('nombre', 'Con estrategia o método', 'opciones', jsonb_build_array(3, 4)))))
  on conflict (taller_id, clave) do update set
    seccion_id = excluded.seccion_id, tipo = excluded.tipo, titulo = excluded.titulo,
    orden = excluded.orden, config = excluded.config;
end $$;
