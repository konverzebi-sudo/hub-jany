-- Esquema de la página de canchas (TRanchoseco). Correr UNA vez en Supabase > SQL Editor.
create schema if not exists canchas;

create table if not exists canchas.estado (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table canchas.estado enable row level security;

-- Solo personas que entraron (usuarios autenticados) pueden leer y guardar
create policy "canchas leer" on canchas.estado for select to authenticated using (true);
create policy "canchas crear" on canchas.estado for insert to authenticated with check (true);
create policy "canchas actualizar" on canchas.estado for update to authenticated using (true) with check (true);

grant usage on schema canchas to authenticated;
grant select, insert, update on canchas.estado to authenticated;
