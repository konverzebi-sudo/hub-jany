-- Casa Jany: links para compartir los pagos de cada persona (contratistas).
-- Pégalo UNA sola vez en Supabase > SQL Editor > New query > Run.
--
-- Cómo queda protegido:
--  * La tabla guarda, por cada link, SOLO fecha, monto y forma de pago de esa persona.
--  * Nadie puede leer la tabla directamente (ni sin sesión ni con ella, salvo tú).
--  * La página pública solo puede pedir UN link si trae su clave larga (token) y mientras esté activo.

create table if not exists public.casa_shares (
  token       text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  persona     text not null,
  pagos       jsonb not null default '[]'::jsonb,
  activo      boolean not null default true,
  updated_at  timestamptz not null default now()
);

alter table public.casa_shares enable row level security;

drop policy if exists "casa_shares: la dueña administra los suyos" on public.casa_shares;
create policy "casa_shares: la dueña administra los suyos"
  on public.casa_shares
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Lectura pública de UN link (solo si se conoce el token y está activo)
create or replace function public.casa_share_ver(p_token text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object('persona', persona, 'pagos', pagos, 'updated_at', updated_at)
  from public.casa_shares
  where token = p_token and activo = true
$$;

revoke all on function public.casa_share_ver(text) from public;
grant execute on function public.casa_share_ver(text) to anon, authenticated;
