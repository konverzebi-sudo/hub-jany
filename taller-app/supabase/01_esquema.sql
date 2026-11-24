-- =====================================================================
-- PLATAFORMA DE TALLERES · HUB JEFES
-- Esquema inicial para "Tu Primer Asesor con IA" (reutilizable para
-- otros talleres). Ejecutar completo en: Supabase → SQL Editor → Run.
--
-- Principios:
--  * Los permisos se validan aquí (RLS), no en la pantalla.
--  * Un alumno solo ve contenido de secciones que Jany habilitó.
--  * Nadie ve respuestas privadas de otros alumnos; el grupo solo ve
--    resultados agregados (función resultados_actividad).
--  * Completar una actividad NUNCA desbloquea secciones: solo el ponente.
-- =====================================================================

-- ---------- TALLERES Y MIEMBROS ----------
create table if not exists public.talleres (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  nombre      text not null,
  fecha       timestamptz,
  creado_en   timestamptz not null default now()
);

create table if not exists public.perfiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text unique,
  nombre      text,
  creado_en   timestamptz not null default now()
);

-- Rol por taller: alumno | ponente | soporte
create table if not exists public.miembros (
  taller_id   uuid not null references public.talleres(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  rol         text not null check (rol in ('alumno','ponente','soporte')),
  creado_en   timestamptz not null default now(),
  primary key (taller_id, user_id)
);

-- Lista de correos autorizados (se llena con los inscritos que pagaron).
-- Al iniciar sesión por primera vez, el correo se vincula al taller.
create table if not exists public.invitados (
  taller_id   uuid not null references public.talleres(id) on delete cascade,
  email       text not null,
  nombre      text,
  rol         text not null default 'alumno' check (rol in ('alumno','ponente','soporte')),
  primary key (taller_id, email)
);

-- ---------- SECCIONES, CONTENIDO Y ACTIVIDADES ----------
-- estado: bloqueada (alumno no la ve) | disponible | cerrada (solo lectura)
create table if not exists public.secciones (
  id          uuid primary key default gen_random_uuid(),
  taller_id   uuid not null references public.talleres(id) on delete cascade,
  clave       text not null,
  titulo      text not null,
  orden       int  not null default 0,
  estado      text not null default 'bloqueada' check (estado in ('bloqueada','disponible','cerrada')),
  unique (taller_id, clave)
);

-- El contenido vive aparte para que RLS lo oculte si la sección está bloqueada
create table if not exists public.contenidos (
  seccion_id  uuid primary key references public.secciones(id) on delete cascade,
  cuerpo      jsonb not null default '{}'::jsonb
);

-- Notas privadas del ponente por etapa (guion, pregunta, transición, tiempo)
create table if not exists public.notas_ponente (
  id          uuid primary key default gen_random_uuid(),
  taller_id   uuid not null references public.talleres(id) on delete cascade,
  seccion_id  uuid references public.secciones(id) on delete cascade,
  orden       int not null default 0,
  titulo      text not null,
  objetivo    text, guion text, pregunta text, respuestas_esperadas text,
  transicion  text, minutos int
);

-- tipo: opciones (selección múltiple) | abierta (texto) | formulario (prework)
-- estado: cerrada (no visible / no acepta) | abierta | finalizada (solo lectura)
create table if not exists public.actividades (
  id          uuid primary key default gen_random_uuid(),
  taller_id   uuid not null references public.talleres(id) on delete cascade,
  seccion_id  uuid not null references public.secciones(id) on delete cascade,
  clave       text not null,
  tipo        text not null check (tipo in ('opciones','abierta','formulario')),
  titulo      text not null,
  config      jsonb not null default '{}'::jsonb,
  estado      text not null default 'cerrada' check (estado in ('cerrada','abierta','finalizada')),
  orden       int not null default 0,
  unique (taller_id, clave)
);

create table if not exists public.respuestas (
  id            uuid primary key default gen_random_uuid(),
  actividad_id  uuid not null references public.actividades(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  datos         jsonb not null default '{}'::jsonb,
  completada    boolean not null default false,
  actualizado_en timestamptz not null default now(),
  unique (actividad_id, user_id)
);

-- Estado en vivo que controla Jany (una fila por taller)
create table if not exists public.estado_vivo (
  taller_id         uuid primary key references public.talleres(id) on delete cascade,
  etapa_actual      text,
  actividad_activa  uuid references public.actividades(id) on delete set null,
  actualizado_en    timestamptz not null default now()
);

-- ---------- AYUDA Y CHAT ----------
create table if not exists public.solicitudes (
  id            uuid primary key default gen_random_uuid(),
  taller_id     uuid not null references public.talleres(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  tema          text,
  estado        text not null default 'pendiente' check (estado in ('pendiente','atendiendo','resuelta')),
  etiquetas     text[] not null default '{}',   -- URGENTE, PARA PONENTE, PREGUNTA FRECUENTE, RESUELTA
  resumen_ponente text,                          -- lo único que ve Jany si es PARA PONENTE
  atendida_por  uuid references auth.users(id),
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- canal: grupal | ayuda (privado alumno-soporte) | coordinacion (soporte-ponente)
create table if not exists public.mensajes (
  id            uuid primary key default gen_random_uuid(),
  taller_id     uuid not null references public.talleres(id) on delete cascade,
  canal         text not null check (canal in ('grupal','ayuda','coordinacion')),
  solicitud_id  uuid references public.solicitudes(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  texto         text not null check (char_length(texto) between 1 and 2000),
  creado_en     timestamptz not null default now(),
  check ((canal = 'ayuda') = (solicitud_id is not null))
);

create index if not exists idx_resp_act on public.respuestas(actividad_id);
create index if not exists idx_msg_taller on public.mensajes(taller_id, canal, creado_en);
create index if not exists idx_sol_taller on public.solicitudes(taller_id, estado);

-- =====================================================================
-- FUNCIONES DE PERMISOS (security definer: evitan recursión en RLS)
-- =====================================================================
create or replace function public.rol_en(t uuid) returns text
language sql stable security definer set search_path = public as $$
  select rol from public.miembros where taller_id = t and user_id = auth.uid()
$$;

create or replace function public.es_miembro(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.miembros where taller_id = t and user_id = auth.uid())
$$;

create or replace function public.es_equipo(t uuid) returns boolean   -- ponente o soporte
language sql stable security definer set search_path = public as $$
  select coalesce(public.rol_en(t) in ('ponente','soporte'), false)
$$;

create or replace function public.es_ponente(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.rol_en(t) = 'ponente', false)
$$;

-- Al crearse un usuario: perfil + vínculo a los talleres donde está invitado
create or replace function public.al_nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles(id, email, nombre)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data->>'nombre', ''))
  on conflict (id) do nothing;
  insert into public.miembros(taller_id, user_id, rol)
  select i.taller_id, new.id, i.rol from public.invitados i
  where lower(i.email) = lower(new.email)
  on conflict do nothing;
  update public.perfiles p set nombre = coalesce(nullif(p.nombre,''), i.nombre)
  from public.invitados i where p.id = new.id and lower(i.email) = lower(new.email);
  return new;
end $$;

drop trigger if exists trg_nuevo_usuario on auth.users;
create trigger trg_nuevo_usuario after insert on auth.users
  for each row execute function public.al_nuevo_usuario();

-- Si Jany agrega un invitado que YA tiene cuenta, se vincula al momento
create or replace function public.al_nuevo_invitado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.miembros(taller_id, user_id, rol)
  select new.taller_id, u.id, new.rol from auth.users u where lower(u.email) = lower(new.email)
  on conflict (taller_id, user_id) do update set rol = excluded.rol;
  return new;
end $$;

drop trigger if exists trg_nuevo_invitado on public.invitados;
create trigger trg_nuevo_invitado after insert or update on public.invitados
  for each row execute function public.al_nuevo_invitado();

-- Un alumno solo puede responder si la actividad está abierta y su sección disponible
create or replace function public.puede_responder(a uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.actividades ac join public.secciones s on s.id = ac.seccion_id
    where ac.id = a and ac.estado = 'abierta' and s.estado = 'disponible'
      and public.es_miembro(ac.taller_id))
$$;

-- Resultados agregados (lo único que el grupo ve de las dinámicas)
create or replace function public.resultados_actividad(a uuid)
returns table(opcion text, votos bigint, participantes bigint)
language sql stable security definer set search_path = public as $$
  with r as (
    select re.user_id, re.datos from public.respuestas re
    join public.actividades ac on ac.id = re.actividad_id
    where re.actividad_id = a and public.es_miembro(ac.taller_id)
  )
  select o.opcion, count(*)::bigint, (select count(distinct user_id) from r)
  from r, jsonb_array_elements_text(coalesce(r.datos->'opciones','[]'::jsonb)) as o(opcion)
  group by o.opcion
$$;

-- Mantener actualizado_en
create or replace function public.tocar() returns trigger language plpgsql as $$
begin new.actualizado_en := now(); return new; end $$;
drop trigger if exists trg_resp_tocar on public.respuestas;
create trigger trg_resp_tocar before update on public.respuestas for each row execute function public.tocar();
drop trigger if exists trg_sol_tocar on public.solicitudes;
create trigger trg_sol_tocar before update on public.solicitudes for each row execute function public.tocar();

-- =====================================================================
-- RLS (seguridad por fila)
-- =====================================================================
alter table public.talleres      enable row level security;
alter table public.perfiles      enable row level security;
alter table public.miembros      enable row level security;
alter table public.invitados     enable row level security;
alter table public.secciones     enable row level security;
alter table public.contenidos    enable row level security;
alter table public.notas_ponente enable row level security;
alter table public.actividades   enable row level security;
alter table public.respuestas    enable row level security;
alter table public.estado_vivo   enable row level security;
alter table public.solicitudes   enable row level security;
alter table public.mensajes      enable row level security;

-- Talleres: los ven sus miembros
drop policy if exists p_talleres_sel on public.talleres;
create policy p_talleres_sel on public.talleres for select using (public.es_miembro(id));

-- Perfiles: cada quien el suyo; el equipo ve los de su taller
drop policy if exists p_perf_sel on public.perfiles;
create policy p_perf_sel on public.perfiles for select using (
  id = auth.uid() or exists(select 1 from public.miembros m where m.user_id = perfiles.id and public.es_equipo(m.taller_id)));
drop policy if exists p_perf_upd on public.perfiles;
create policy p_perf_upd on public.perfiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Miembros: cada quien su fila; el equipo ve a todos; solo el ponente cambia roles
drop policy if exists p_miem_sel on public.miembros;
create policy p_miem_sel on public.miembros for select using (user_id = auth.uid() or public.es_equipo(taller_id));
drop policy if exists p_miem_all on public.miembros;
create policy p_miem_all on public.miembros for all using (public.es_ponente(taller_id)) with check (public.es_ponente(taller_id));

-- Invitados: solo el ponente
drop policy if exists p_inv_all on public.invitados;
create policy p_inv_all on public.invitados for all using (public.es_ponente(taller_id)) with check (public.es_ponente(taller_id));

-- Secciones: los miembros ven la lista (para mostrar las bloqueadas); solo el ponente las cambia
drop policy if exists p_sec_sel on public.secciones;
create policy p_sec_sel on public.secciones for select using (public.es_miembro(taller_id));
drop policy if exists p_sec_upd on public.secciones;
create policy p_sec_upd on public.secciones for update using (public.es_ponente(taller_id)) with check (public.es_ponente(taller_id));

-- Contenido: el alumno solo si la sección NO está bloqueada; el equipo siempre
drop policy if exists p_cont_sel on public.contenidos;
create policy p_cont_sel on public.contenidos for select using (exists(
  select 1 from public.secciones s where s.id = contenidos.seccion_id
    and (public.es_equipo(s.taller_id) or (public.es_miembro(s.taller_id) and s.estado <> 'bloqueada'))));

-- Notas del ponente: solo el ponente
drop policy if exists p_notas_all on public.notas_ponente;
create policy p_notas_all on public.notas_ponente for all using (public.es_ponente(taller_id)) with check (public.es_ponente(taller_id));

-- Actividades: el alumno ve las de secciones no bloqueadas que no estén cerradas
drop policy if exists p_act_sel on public.actividades;
create policy p_act_sel on public.actividades for select using (
  public.es_equipo(taller_id) or (public.es_miembro(taller_id) and estado <> 'cerrada' and exists(
    select 1 from public.secciones s where s.id = actividades.seccion_id and s.estado <> 'bloqueada')));
drop policy if exists p_act_upd on public.actividades;
create policy p_act_upd on public.actividades for update using (public.es_ponente(taller_id)) with check (public.es_ponente(taller_id));

-- Respuestas: el alumno ve y edita SOLO las suyas, y solo mientras la actividad está abierta.
-- El ponente ve todas las de su taller. Soporte no ve respuestas.
drop policy if exists p_resp_sel on public.respuestas;
create policy p_resp_sel on public.respuestas for select using (
  user_id = auth.uid() or exists(select 1 from public.actividades a where a.id = respuestas.actividad_id and public.es_ponente(a.taller_id)));
drop policy if exists p_resp_ins on public.respuestas;
create policy p_resp_ins on public.respuestas for insert with check (user_id = auth.uid() and public.puede_responder(actividad_id));
drop policy if exists p_resp_upd on public.respuestas;
create policy p_resp_upd on public.respuestas for update
  using (user_id = auth.uid() and public.puede_responder(actividad_id))
  with check (user_id = auth.uid() and public.puede_responder(actividad_id));

-- Estado en vivo: lo ven los miembros, lo cambia el ponente
drop policy if exists p_vivo_sel on public.estado_vivo;
create policy p_vivo_sel on public.estado_vivo for select using (public.es_miembro(taller_id));
drop policy if exists p_vivo_all on public.estado_vivo;
create policy p_vivo_all on public.estado_vivo for all using (public.es_ponente(taller_id)) with check (public.es_ponente(taller_id));

-- Solicitudes de ayuda: el alumno crea y ve las suyas; soporte ve y gestiona todas;
-- el ponente solo ve las marcadas PARA PONENTE (y solo usa el resumen).
drop policy if exists p_sol_sel on public.solicitudes;
create policy p_sol_sel on public.solicitudes for select using (
  user_id = auth.uid() or public.rol_en(taller_id) = 'soporte'
  or (public.es_ponente(taller_id) and 'PARA PONENTE' = any(etiquetas)));
drop policy if exists p_sol_ins on public.solicitudes;
create policy p_sol_ins on public.solicitudes for insert with check (user_id = auth.uid() and public.es_miembro(taller_id));
drop policy if exists p_sol_upd on public.solicitudes;
create policy p_sol_upd on public.solicitudes for update
  using (public.rol_en(taller_id) = 'soporte') with check (public.rol_en(taller_id) = 'soporte');

-- Mensajes
--  grupal: todos los miembros leen y escriben
--  ayuda: el alumno dueño de la solicitud + soporte (el ponente NO lee chats privados)
--  coordinacion: solo soporte y ponente
drop policy if exists p_msg_sel on public.mensajes;
create policy p_msg_sel on public.mensajes for select using (
  (canal = 'grupal' and public.es_miembro(taller_id))
  or (canal = 'ayuda' and (public.rol_en(taller_id) = 'soporte'
       or exists(select 1 from public.solicitudes s where s.id = mensajes.solicitud_id and s.user_id = auth.uid())))
  or (canal = 'coordinacion' and public.es_equipo(taller_id)));
drop policy if exists p_msg_ins on public.mensajes;
create policy p_msg_ins on public.mensajes for insert with check (
  user_id = auth.uid() and (
    (canal = 'grupal' and public.es_miembro(taller_id))
    or (canal = 'ayuda' and (public.rol_en(taller_id) = 'soporte'
         or exists(select 1 from public.solicitudes s where s.id = mensajes.solicitud_id and s.user_id = auth.uid())))
    or (canal = 'coordinacion' and public.es_equipo(taller_id))));

-- =====================================================================
-- TIEMPO REAL
-- =====================================================================
do $$ begin
  begin alter publication supabase_realtime add table public.secciones;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.actividades; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.estado_vivo; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.respuestas;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.solicitudes; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.mensajes;    exception when duplicate_object then null; end;
end $$;

-- =====================================================================
-- ARCHIVOS (logo y fotos del prework)
-- Ruta: <taller_id>/<user_id>/<archivo>. Máx 8 MB, solo imágenes.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('prework', 'prework', false, 8388608, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists p_files_own on storage.objects;
create policy p_files_own on storage.objects for all
  using (bucket_id = 'prework' and (storage.foldername(name))[2] = auth.uid()::text
         and public.es_miembro(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'prework' and (storage.foldername(name))[2] = auth.uid()::text
         and public.es_miembro(((storage.foldername(name))[1])::uuid));
drop policy if exists p_files_ponente on storage.objects;
create policy p_files_ponente on storage.objects for select
  using (bucket_id = 'prework' and public.es_ponente(((storage.foldername(name))[1])::uuid));
