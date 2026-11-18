-- =====================================================================
-- 21 · Estado de la clase en vivo (candados y cuadros compartidos)
-- Ejecutar en: Supabase → SQL Editor → Run (después de los 01 a 20).
--
-- Guarda, para todos los alumnos:
--  * clase:<id>        -> true (abierta) / false (cerrada)
--  * etapa:<id>|<n>    -> true (abierta) / false (cerrada)
--  * vista             -> qué ve el cuadro grande y el cuadrito
-- Solo el ponente (miembro con rol 'ponente') puede cambiarlo.
-- Los alumnos solo lo leen.
-- =====================================================================

create table if not exists public.estado_clase (
  clave       text primary key,
  valor       jsonb not null,
  actualizado timestamptz not null default now()
);

alter table public.estado_clase enable row level security;

drop policy if exists "estado_clase_lee_todos" on public.estado_clase;
create policy "estado_clase_lee_todos" on public.estado_clase
  for select using (true);

drop policy if exists "estado_clase_escribe_ponente" on public.estado_clase;
create policy "estado_clase_escribe_ponente" on public.estado_clase
  for all to authenticated
  using (exists (select 1 from public.miembros m where m.user_id = auth.uid() and m.rol = 'ponente'))
  with check (exists (select 1 from public.miembros m where m.user_id = auth.uid() and m.rol = 'ponente'));

-- Tiempo real: que los cambios lleguen a todos sin recargar
do $$ begin
  alter publication supabase_realtime add table public.estado_clase;
exception when duplicate_object then null;
end $$;
