-- =====================================================================
-- 14 · DINÁMICA 3 CON 4 CONCEPTOS Y MANCHAS FIJAS
-- Activa el modo "categorias" en la dinámica "marketing": Editar y
-- diseñar (azul), Analizar resultados (rojo), Gestionar campañas
-- (verde) y Crear contenido (morado). La lista de 27 conceptos se
-- conserva en la configuración. No crea tablas: cada selección se
-- guarda en la respuesta del participante. Se puede correr más de una vez.
-- =====================================================================
update public.actividades a
set config = a.config || jsonb_build_object('modo', 'categorias') ||
  case when a.config ? 'categorias' then '{}'::jsonb else jsonb_build_object('categorias', $json$[{"id": "editar", "nombre": "Editar y diseñar", "desc": "Canva y CapCut demandan tiempo de producción real: diseño, edición y publicación de cada pieza.", "color": "#2E9BF0", "x": 565, "y": 320, "imagen": "diapos/conceptos/editar.png", "estado": "pendiente"}, {"id": "analizar", "nombre": "Analizar resultados", "desc": "Analytics y métricas exigen interpretación semanal para saber qué funciona y qué no.", "color": "#FF3B30", "x": 770, "y": 295, "imagen": "diapos/conceptos/analizar.png", "estado": "pendiente"}, {"id": "campanas", "nombre": "Gestionar campañas", "desc": "Meta Ads requiere monitoreo constante, ajustes y decisiones rápidas para no desperdiciar presupuesto.", "color": "#00C27A", "x": 885, "y": 160, "imagen": "diapos/conceptos/campanas.png", "estado": "pendiente"}, {"id": "contenido", "nombre": "Crear contenido", "desc": "Redactar textos, guiones y respuestas con ChatGPT y Gemini consume horas cada semana.", "color": "#7B4DFF", "x": 690, "y": 450, "imagen": "diapos/conceptos/contenido.png", "estado": "pendiente"}]$json$::jsonb) end
from public.talleres t
where t.id = a.taller_id and t.slug = 'primer-agente' and a.clave = 'marketing';
