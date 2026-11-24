-- =====================================================================
-- 11 · DINÁMICA 3 POR TOQUES (consola de ponente)
-- Activa el modo "toques" en la dinámica "marketing" y le pone una
-- lista PROVISIONAL de conceptos (si todavía no tiene una). Jany la
-- reemplaza desde la consola ("Editar conceptos").
-- No crea tablas: cada toque se guarda en la respuesta del participante
-- (datos.toques con fecha y hora, datos.conteo por concepto).
-- Se puede correr más de una vez sin pisar una lista ya editada.
-- =====================================================================
update public.actividades a
set config = case when a.config ? 'conceptos' then a.config || '{"toques":true}'::jsonb
  else a.config || jsonb_build_object('toques', true, 'provisional', true, 'conceptos', jsonb_build_array(
    jsonb_build_object('id','i1','nombre','Publico cuando puedo','clase','improvisar','estado','pendiente'),
    jsonb_build_object('id','i2','nombre','No sé qué producto impulsar','clase','improvisar','estado','pendiente'),
    jsonb_build_object('id','i3','nombre','Pruebo herramientas sin un objetivo','clase','improvisar','estado','pendiente'),
    jsonb_build_object('id','i4','nombre','Creo contenido desde cero cada vez','clase','improvisar','estado','pendiente'),
    jsonb_build_object('id','i5','nombre','No sé qué está funcionando','clase','improvisar','estado','pendiente'),
    jsonb_build_object('id','p1','nombre','Tengo objetivos claros','clase','planificar','estado','pendiente'),
    jsonb_build_object('id','p2','nombre','Sé qué producto promover','clase','planificar','estado','pendiente'),
    jsonb_build_object('id','p3','nombre','Trabajo con una estrategia','clase','planificar','estado','pendiente'),
    jsonb_build_object('id','p4','nombre','Sigo un proceso de creación','clase','planificar','estado','pendiente'),
    jsonb_build_object('id','p5','nombre','Reviso y mido mis resultados','clase','planificar','estado','pendiente'))) end
from public.talleres t
where t.id = a.taller_id and t.slug = 'primer-agente' and a.clave = 'marketing';
