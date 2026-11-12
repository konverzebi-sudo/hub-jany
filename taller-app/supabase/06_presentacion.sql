-- =====================================================================
-- 06 · PRESENTACIÓN EN VIVO
-- Guarda en qué diapositiva va Jany para que todos la vean al mismo
-- tiempo. Solo agrega una columna; no borra nada. Se puede correr
-- más de una vez.
-- =====================================================================
alter table public.estado_vivo add column if not exists diapositiva int;
