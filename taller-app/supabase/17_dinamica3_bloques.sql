-- =====================================================================
-- 17 · DINÁMICA 3: BLOQUE DE CADA CONCEPTO (aprobado por Jany)
-- Agrega SOLO el campo "bloque" a los 25 conceptos (g03–g27); conserva
-- IDs, nombres, clasificación 🔴/🟢, estado y orden. g01 y g02
-- (Operación) quedan sin bloque. Activa el modo 'bloques': el alumno toca
-- conceptos, las manchas crecen por toques del bloque y la diapositiva 22
-- se calcula por personas. No borra respuestas ni toques.
-- Se puede correr más de una vez.
-- =====================================================================
update public.actividades a
set config = a.config || jsonb_build_object(
  'modo', 'bloques',
  'conceptos', (
    select jsonb_agg(case when (case c->>'id'
      when 'g03' then 'contenido'
      when 'g04' then 'contenido'
      when 'g05' then 'contenido'
      when 'g06' then 'contenido'
      when 'g07' then 'campanas'
      when 'g08' then 'campanas'
      when 'g09' then 'contenido'
      when 'g10' then 'contenido'
      when 'g11' then 'contenido'
      when 'g12' then 'contenido'
      when 'g13' then 'campanas'
      when 'g14' then 'campanas'
      when 'g15' then 'editar'
      when 'g16' then 'editar'
      when 'g17' then 'campanas'
      when 'g18' then 'campanas'
      when 'g19' then 'campanas'
      when 'g20' then 'campanas'
      when 'g21' then 'editar'
      when 'g22' then 'editar'
      when 'g23' then 'editar'
      when 'g24' then 'editar'
      when 'g25' then 'analizar'
      when 'g26' then 'analizar'
      when 'g27' then 'analizar'
      end) is not null then c || jsonb_build_object('bloque', case c->>'id'
      when 'g03' then 'contenido'
      when 'g04' then 'contenido'
      when 'g05' then 'contenido'
      when 'g06' then 'contenido'
      when 'g07' then 'campanas'
      when 'g08' then 'campanas'
      when 'g09' then 'contenido'
      when 'g10' then 'contenido'
      when 'g11' then 'contenido'
      when 'g12' then 'contenido'
      when 'g13' then 'campanas'
      when 'g14' then 'campanas'
      when 'g15' then 'editar'
      when 'g16' then 'editar'
      when 'g17' then 'campanas'
      when 'g18' then 'campanas'
      when 'g19' then 'campanas'
      when 'g20' then 'campanas'
      when 'g21' then 'editar'
      when 'g22' then 'editar'
      when 'g23' then 'editar'
      when 'g24' then 'editar'
      when 'g25' then 'analizar'
      when 'g26' then 'analizar'
      when 'g27' then 'analizar'
      end) else c end order by ord)
    from jsonb_array_elements(a.config->'conceptos') with ordinality as e(c, ord)))
from public.talleres t
where t.id = a.taller_id and t.slug = 'primer-agente' and a.clave = 'marketing'
  and a.config ? 'conceptos';

-- Verificación (solo lectura): debe dar contenido 8, campanas 8, editar 6, analizar 3
select c->>'bloque' as bloque, count(*) as conceptos,
       count(*) filter (where c->>'clase' = 'improvisar') as rojos,
       count(*) filter (where c->>'clase' = 'planificar') as verdes
from public.actividades a join public.talleres t on t.id = a.taller_id and t.slug = 'primer-agente'
cross join lateral jsonb_array_elements(a.config->'conceptos') c
where a.clave = 'marketing' group by 1 order by 1;
