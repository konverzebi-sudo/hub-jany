# Plataforma de talleres · Hub Jefes

Primera etapa: **"Tu Primer Asesor con IA"** (alumno · ponente · soporte).
Construida nueva sobre **Supabase** (proyecto exclusivo para talleres) con páginas
estáticas publicadas en jefeshub.com. Colores y letras de la marca actual
(#0F0B16 · #BBF802 · morado #7B2FBE · Sora / Inter / JetBrains Mono).

## Fase 1 · Diagnóstico (11 nov 2026)
- No existía plataforma previa del taller. Se reutiliza el diseño del boceto
  `guia-taller-ia.html` y la experiencia de Supabase del Hub-cito (sin tocar su proyecto).
- Seguridad en el servidor con RLS: un alumno no puede abrir secciones bloqueadas,
  ver respuestas de otros ni entrar a los paneles. Completar actividades no desbloquea
  nada: solo el ponente cambia estados.

## Puesta en marcha (una sola vez)
1. Crear el proyecto en supabase.com (región: us-east o la más cercana).
2. SQL Editor → pegar y ejecutar `supabase/01_esquema.sql`.
3. En `supabase/02_datos_taller.sql`, cambiar los 2 correos marcados `<<<` y ejecutarlo.
   Después ejecutar `supabase/03_resultados_grupo.sql` (resultados agregados y anónimos para el grupo).
   No guardes ese archivo con correos reales en el repositorio.
4. Authentication → Providers → Email: activado; inicio por enlace mágico (sin contraseña).
   Authentication → URL Configuration → Site URL: `https://jefeshub.com/taller-app/`.
5. Project Settings → API: copiar **Project URL** y **anon public key** a `config.js`.
   La **service_role key NUNCA** va en el código ni en el chat.

## Alta de alumnos
Agregar sus correos a la tabla `invitados` (rol `alumno`). Al iniciar sesión con ese
correo quedan vinculados al taller. Un correo no invitado puede crear sesión pero no ve nada.

## Archivos
- `index.html` — la plataforma completa (una sola página; la vista depende del rol).
- `config.js` — URL y anon key de Supabase (vacíos = modo demo).
- `supabase/01_esquema.sql`, `supabase/02_datos_taller.sql` — base de datos.

## Probar sin Supabase (modo demo)
`taller-app/index.html?demo=alumno` · `?demo=ponente` · `?demo=soporte`
Los cambios se comparten entre pestañas del mismo navegador (abre ponente y alumno
en dos pestañas para ver el tiempo real). Para reiniciar: cerrar sesión en el demo.

## Fases
1. ✅ Diagnóstico, arquitectura, roles y esquema SQL
2. ✅ Vista del participante + Empieza por aquí + ¡ARRANCA YA! + secciones bloqueadas
3. ✅ Calentando motores: 3 dinámicas que abre/cierra Jany; el grupo ve resultados agregados tras responder; respuestas abiertas anónimas cuando Jany lo activa; pantalla de proyección (`#proyectar-<clave>`)
4. ✅ Prepara tu negocio: bloques A–F con guardado, hasta 4 productos/servicios ("No sé" permitido), archivos con vista previa, checklist y resumen
5. ✅ Panel de ponente (etapas, actividades, resultados, participación, notas, casos PARA PONENTE, chat con soporte) y panel de soporte (solicitudes, estados, etiquetas, resumen para Jany, chat privado)
6. ⏳ Pruebas reales con Supabase y cuentas de los 3 roles (probado solo en modo demo)

## Pendiente
- Se instaló en el proyecto Supabase `hub-enexpansion` (plan gratis sin espacio para otro). 01 y 02 ya ejecutados; falta 03 y llenar `config.js`.
- Probar con cuentas reales: RLS, tiempo real y subida de archivos (el SQL aún no se ha ejecutado).
- Fecha del taller en la tabla `talleres`.
- Contenido de los módulos posteriores (hoy son marcadores bloqueados).

## Actualización: 4 dinámicas de Calentando motores
Corre `supabase/04_dinamicas.sql` después de 01, 02 y 03. Agrega ¿A qué te dedicas?, ¿Qué delegarías?, ¿Qué parte del marketing te cuesta más? y ¿Marketing o improvisando?; conserva las 3 anteriores; cambia el nombre a "Tu Primer Asesor con IA"; permite a la ponente compartir respuestas (sin nombre) y reiniciar resultados.
