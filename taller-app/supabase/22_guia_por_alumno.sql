-- =====================================================================
-- 22 · Guía del taller: lo que llena cada alumno se guarda en SU cuenta
-- Ejecutar en: Supabase → SQL Editor → Run (después de los 01 a 21).
--
-- Una fila por persona con todo lo que llenó en guia-taller-ia.html
-- (brief, colores y letra de su marca, avances, campaña, ideas…).
--  * Cada quien solo ve y cambia SU fila.
--  * La ponente puede leer las de todos (para revisar avances). No las cambia.
-- =====================================================================

create table if not exists public.guia_alumno (
  user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  datos       jsonb not null default '{}'::jsonb,
  actualizado timestamptz not null default now()
);

alter table public.guia_alumno enable row level security;

drop policy if exists "guia_alumno_lee_suya" on public.guia_alumno;
create policy "guia_alumno_lee_suya" on public.guia_alumno
  for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.miembros m where m.user_id = auth.uid() and m.rol = 'ponente'));

drop policy if exists "guia_alumno_crea_suya" on public.guia_alumno;
create policy "guia_alumno_crea_suya" on public.guia_alumno
  for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.miembros m where m.user_id = auth.uid()));

drop policy if exists "guia_alumno_cambia_suya" on public.guia_alumno;
create policy "guia_alumno_cambia_suya" on public.guia_alumno
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Tope de tamaño por persona (evita que alguien llene la base): ~2 MB
alter table public.guia_alumno drop constraint if exists guia_alumno_tamano;
alter table public.guia_alumno add constraint guia_alumno_tamano check (pg_column_size(datos) < 2000000);
