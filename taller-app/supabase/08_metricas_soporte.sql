-- =====================================================================
-- 08 · MÉTRICAS DE SOPORTE (tiempos y capacidad)
-- Solo agrega: historial de estados, objetivos configurables y dos
-- funciones de lectura. No cambia solicitudes ni mensajes. Se puede
-- correr más de una vez. Todas las horas son del servidor (now()).
-- =====================================================================

-- 1) Historial de cambios de estado (nunca se borra al reabrir)
create table if not exists public.solicitudes_eventos (
  id             bigserial primary key,
  solicitud_id   uuid not null references public.solicitudes(id) on delete cascade,
  taller_id      uuid not null references public.talleres(id) on delete cascade,
  estado_anterior text,
  estado_nuevo   text not null,
  actor          uuid,
  creado_en      timestamptz not null default now()
);
create index if not exists idx_sol_ev on public.solicitudes_eventos(solicitud_id, creado_en);
alter table public.solicitudes_eventos enable row level security;
drop policy if exists p_solev_sel on public.solicitudes_eventos;
create policy p_solev_sel on public.solicitudes_eventos for select using (public.es_equipo(taller_id));

create or replace function public.registrar_evento_solicitud() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.solicitudes_eventos(solicitud_id, taller_id, estado_anterior, estado_nuevo, actor)
    values (new.id, new.taller_id, null, new.estado, auth.uid());
  elsif new.estado is distinct from old.estado then
    insert into public.solicitudes_eventos(solicitud_id, taller_id, estado_anterior, estado_nuevo, actor)
    values (new.id, new.taller_id, old.estado, new.estado, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists trg_sol_eventos on public.solicitudes;
create trigger trg_sol_eventos after insert or update of estado on public.solicitudes
  for each row execute function public.registrar_evento_solicitud();

-- Solicitudes que ya existían: un evento de creación con su hora real
insert into public.solicitudes_eventos(solicitud_id, taller_id, estado_anterior, estado_nuevo, creado_en)
select s.id, s.taller_id, null, 'pendiente', s.creado_en from public.solicitudes s
where not exists (select 1 from public.solicitudes_eventos e where e.solicitud_id = s.id);

-- 2) Objetivos de tiempo (vacíos = no se califica nada)
alter table public.talleres add column if not exists soporte_objetivos jsonb not null default '{}'::jsonb;
create or replace function public.set_objetivos_soporte(t uuid, o jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_ponente(t) then raise exception 'Solo la ponente configura los objetivos'; end if;
  update public.talleres set soporte_objetivos = coalesce(o, '{}'::jsonb) where id = t;
end $$;

-- 3) Detalle por solicitud (sin el contenido de la conversación)
--    Primera respuesta humana = primer mensaje del equipo que contiene letras o números
--    (un emoji o sticker solo no cuenta).
create or replace function public.soporte_detalle(t uuid)
returns table(id uuid, estado text, creado_en timestamptz, primera_respuesta timestamptz,
              inicio_atencion timestamptz, cierre timestamptz, reaperturas int,
              responsable text, msgs_alumno int, msgs_equipo int, ahora timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.estado, s.creado_en,
    (select min(m.creado_en) from public.mensajes m
      where m.solicitud_id = s.id and m.user_id <> s.user_id and m.texto ~ '[[:alnum:]]'),
    (select min(e.creado_en) from public.solicitudes_eventos e where e.solicitud_id = s.id and e.estado_nuevo = 'atendiendo'),
    case when s.estado = 'resuelta' then (select max(e.creado_en) from public.solicitudes_eventos e where e.solicitud_id = s.id and e.estado_nuevo = 'resuelta') end,
    (select count(*)::int from public.solicitudes_eventos e where e.solicitud_id = s.id and e.estado_anterior = 'resuelta'),
    (select p.nombre from public.perfiles p where p.id = s.atendida_por),
    (select count(*)::int from public.mensajes m where m.solicitud_id = s.id and m.user_id = s.user_id),
    (select count(*)::int from public.mensajes m where m.solicitud_id = s.id and m.user_id <> s.user_id),
    now()
  from public.solicitudes s
  where s.taller_id = t and public.es_equipo(t)
  order by s.creado_en
$$;

-- 4) Comparación entre sesiones (cada taller = una sesión o edición)
create or replace function public.soporte_sesiones()
returns table(taller_id uuid, nombre text, fecha timestamptz, participantes int, solicitudes int,
              pendientes int, primera_resp_mediana_min numeric, resolucion_mediana_min numeric, responsables int)
language sql stable security definer set search_path = public as $$
  with d as (
    select s.taller_id, s.id, s.estado, s.creado_en, s.atendida_por,
      (select min(m.creado_en) from public.mensajes m where m.solicitud_id = s.id and m.user_id <> s.user_id and m.texto ~ '[[:alnum:]]') pr,
      case when s.estado = 'resuelta' then (select max(e.creado_en) from public.solicitudes_eventos e where e.solicitud_id = s.id and e.estado_nuevo = 'resuelta') end ci
    from public.solicitudes s)
  select t.id, t.nombre, t.fecha,
    (select count(*)::int from public.miembros mi where mi.taller_id = t.id and mi.rol = 'alumno'),
    (select count(*)::int from d where d.taller_id = t.id),
    (select count(*)::int from d where d.taller_id = t.id and d.estado <> 'resuelta'),
    (select round((percentile_cont(.5) within group (order by extract(epoch from d.pr - d.creado_en)) / 60)::numeric, 1) from d where d.taller_id = t.id and d.pr is not null),
    (select round((percentile_cont(.5) within group (order by extract(epoch from d.ci - d.creado_en)) / 60)::numeric, 1) from d where d.taller_id = t.id and d.ci is not null),
    (select count(distinct d.atendida_por)::int from d where d.taller_id = t.id and d.atendida_por is not null)
  from public.talleres t
  where public.es_ponente(t.id)
  order by t.fecha desc nulls last, t.creado_en desc
$$;

grant execute on function public.set_objetivos_soporte(uuid, jsonb) to authenticated;
grant execute on function public.soporte_detalle(uuid) to authenticated;
grant execute on function public.soporte_sesiones() to authenticated;
