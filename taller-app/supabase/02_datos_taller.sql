-- =====================================================================
-- DATOS INICIALES · "Tu Primer Agente con IA"
-- Ejecutar DESPUÉS de 01_esquema.sql.
-- Antes de correrlo, cambia los 2 correos marcados con <<< (el tuyo y
-- el de la persona de soporte). No subas este archivo con correos reales.
-- =====================================================================
do $$
declare
  t uuid;
  s_empieza uuid; s_calienta uuid; s_prepara uuid;
begin
  insert into public.talleres(slug, nombre, fecha)
  values ('primer-agente', 'Tu Primer Agente con IA', null)
  on conflict (slug) do update set nombre = excluded.nombre
  returning id into t;

  -- Secciones habilitadas antes del taller
  insert into public.secciones(taller_id, clave, titulo, orden, estado) values
    (t, 'empieza',   'Empieza por aquí',      1, 'disponible'),
    (t, 'calienta',  'Calentando motores',    2, 'disponible'),
    (t, 'prepara',   'Prepara tu negocio',    3, 'disponible'),
  -- Etapas futuras: bloqueadas hasta que Jany las active en vivo
    (t, 'modulo-2',  'Módulo 2',              4, 'bloqueada'),
    (t, 'modulo-3',  'Módulo 3',              5, 'bloqueada'),
    (t, 'modulo-4',  'Módulo 4',              6, 'bloqueada')
  on conflict (taller_id, clave) do nothing;

  select id into s_empieza  from public.secciones where taller_id = t and clave = 'empieza';
  select id into s_calienta from public.secciones where taller_id = t and clave = 'calienta';
  select id into s_prepara  from public.secciones where taller_id = t and clave = 'prepara';

  -- Contenido de "Empieza por aquí"
  insert into public.contenidos(seccion_id, cuerpo) values (s_empieza, jsonb_build_object(
    'bienvenida', jsonb_build_object(
      'titulo', '¡BIENVENIDO A TU PRIMER AGENTE CON IA!',
      'texto',  'En este taller vas a construir tu primer agente con IA aplicado a tu negocio: con tu información, tus productos y tus objetivos. Este espacio te acompaña antes y durante la sesión en vivo.'),
    'como_funciona', jsonb_build_array(
      jsonb_build_object('titulo','Presentación en vivo','texto','Jany comparte la presentación y explica cada etapa. Síguela en la videollamada.'),
      jsonb_build_object('titulo','Plataforma','texto','Aquí encuentras instrucciones, materiales, actividades y tu avance.'),
      jsonb_build_object('titulo','Chat de rescate','texto','¿Te atoraste? Pide ayuda desde el botón y el equipo de soporte te atiende sin detener la clase.')),
    'como_avanzar', 'Sigue las instrucciones de cada actividad y confirma tu avance cuando se te pida. Las siguientes etapas se habilitan durante el taller, cuando Jany lo indique.',
    'herramientas', jsonb_build_array(
      jsonb_build_object('nombre','ChatGPT','url','https://chatgpt.com/','nota','Ten tu cuenta abierta.'),
      jsonb_build_object('nombre','Gemini','url','https://gemini.google.com/','nota','Ten tu cuenta abierta.'))
  )) on conflict (seccion_id) do update set cuerpo = excluded.cuerpo;

  insert into public.contenidos(seccion_id, cuerpo) values
    (s_calienta, '{"intro":"Tres dinámicas rápidas para conocernos. Jany abre cada una durante el taller."}'),
    (s_prepara,  '{"intro":"Esta información la usará El Hubcito para personalizar tu ejercicio práctico. Puedes guardar y continuar después."}')
  on conflict (seccion_id) do nothing;

  -- Dinámicas (cerradas: Jany las abre una por una)
  insert into public.actividades(taller_id, seccion_id, clave, tipo, titulo, orden, estado, config) values
  (t, s_calienta, 'metas', 'opciones', '¿Qué te gustaría lograr con ayuda de la IA en tu negocio?', 1, 'cerrada', jsonb_build_object(
     'multiple', true, 'otro', true,
     'opciones', jsonb_build_array('Vender más','Conseguir nuevos clientes','Activar o mejorar mis redes sociales',
       'Activar mi tienda en línea','Crear contenido más rápido','Mejorar mi publicidad',
       'Ahorrar tiempo y delegar tareas','Organizar mejor mi negocio','Automatizar procesos'))),
  (t, s_calienta, 'situacion', 'abierta', '¿Qué es lo que más se te complica actualmente al promocionar o vender tu negocio?', 2, 'cerrada', jsonb_build_object(
     'instruccion', 'Cuéntanos qué has intentado hacer, qué te ha funcionado o qué se te está complicando actualmente.',
     'editable', true, 'max', 1500)),
  (t, s_calienta, 'diagnostico', 'opciones', '¿Qué es lo que más te cuesta actualmente al hacer marketing en tu negocio?', 3, 'cerrada', jsonb_build_object(
     'multiple', true, 'otro', true,
     'opciones', jsonb_build_array('No sé qué publicar','No sé qué producto o servicio promocionar','No consigo suficientes clientes',
       'Me cuesta crear imágenes y videos','No sé cómo hacer publicidad','No tengo tiempo para hacerlo todo',
       'Publico, pero no sé si está funcionando'))),
  -- Prework: abierto desde antes del taller; Jany lo finaliza para congelar respuestas
  (t, s_prepara, 'prework', 'formulario', 'Prepara tu negocio', 1, 'abierta', '{"bloques":["A","B","C","D","E","F"]}')
  on conflict (taller_id, clave) do nothing;

  insert into public.estado_vivo(taller_id, etapa_actual) values (t, 'antes')
  on conflict (taller_id) do nothing;

  -- Equipo (cámbialos antes de ejecutar)
  insert into public.invitados(taller_id, email, nombre, rol) values
    (t, 'TU_CORREO@ejemplo.com',     'Jany',    'ponente'),   -- <<<
    (t, 'SOPORTE_CORREO@ejemplo.com','Soporte', 'soporte')    -- <<<
  on conflict (taller_id, email) do update set rol = excluded.rol;
end $$;
