# Taller "Tu Primer Asistente con IA" — estado, decisiones y pendientes

Taller: **3 de diciembre de 2026, 11:00** (hora del centro de México). Actualizado: 2026-11-18.

Este documento es el respaldo del trabajo hecho en el chat. Con esto se puede retomar en una conversación nueva sin perder nada.

## Dónde vive cada cosa

- **Guía del alumno y del ponente:** `guia-taller-ia.html` → `jefeshub.com/guia-taller-ia.html`
  - Vista de ponente: `?vista=ponente` (panel del ponente, candados, cuadros de la clase en vivo).
  - Pestaña "Clase en vivo": la reunión de Zoom y la presentación (o el ejercicio) en dos cuadros. Ocupa todo el ancho de la pantalla.
  - Portada: el botón "¡IMPORTANTE LLENAR ANTES DEL TALLER!" y las tarjetas verdes llevan a El Pre, sección 1, etapa 1.
- **Plataforma (brief, presentación, control, resultados):** `taller-app/index.html` → `jefeshub.com/taller-app/`
  - Brief: `jefeshub.com/brief.html` (embebe `taller-app/?embed=prepara`). **No pide correo**: las respuestas se guardan en el navegador de cada persona.
- **Zoom:** `taller-app/zoom.html` (cliente embebido). La firma sale del caso `zoom-firma` en `api/storage/[key].js`.
- **Configuración pública:** `taller-app/config.js` (URL de Supabase, clave publicable, número y clave de la reunión). **Nunca** la secret key.
- **SQL de Supabase:** `taller-app/supabase/01` a `21`. Están corridos en el proyecto `hub-enexpansion` (ref `wyiqigrzcipywvijtchg`), incluido el 21 (`estado_clase`).

## Qué está hecho y en línea

- **Portada:** cuenta regresiva; se quitó la tarjeta de progreso; las tres tarjetas verdes (botón de importante, "01 Brief previo" y "El Pre") llevan a El Pre etapa 1; la tarjeta de El Pre dice "Te toma 10 minutos".
- **Módulos bloqueados** antes de la clase (solo PRE visible). Botón "Encender todos" en Control.
- **El Pre:**
  - Solo "⏱ Te toma 10 minutos" (se quitaron etapas y prompts). Título "Te dejo el paso a paso 👇".
  - Etapa 1 "Llena el brief antes de la clase": un solo botón, **HAZ CLICK AQUI Y LLENA TU BRIEF**. Al abrirlo, el formulario queda a la vista y el botón se oculta.
  - Etapa 2 "Bienvenido a la plataforma": botón "Ver guía de la plataforma" con la explicación (barra lateral, clases punto a punto, clase en vivo, soporte por chat).
  - Pasos de ChatGPT y Gemini: "Activa tu cuenta de…". El de ChatGPT sugiere el plan básico si no deja crear imágenes.
  - Etapa 6: "Guarda la guía en tu celular", con instrucciones para iPhone y Android.
  - Lista "Ten esto a la mano": agua, brief al 100 %, acceso rápido a la página, ChatGPT y Gemini con plan básico, mentalidad, buen internet, logotipo en el brief, fotos del producto.
  - Quitó la barra de progreso del brief: en la portada de El Pre sale el **% grande** (ahí irá el video de entrada).
- **Brief:** Bloque A con una sola pregunta ("Haz una descripción breve de a qué te dedicas"); redes separadas (Facebook, Instagram, TikTok, WhatsApp); sin correo.
- **Clase en vivo, vista de ponente:**
  - Panel con los números PRE y 01–10 con candado. Cada número muestra sus actividades; solo las marcadas como actividad tienen botón **Abrir / Cerrar** (▶ / ❚❚). Los demás pasos solo aparecen con su nombre.
  - Cerrar la clase: círculo gris con candado (abrir sigue en verde).
  - Control de los dos cuadros con íconos (presentación, mi cara, ejercicio, nada).
  - El texto de bienvenida: "Me encanta que estés aquí. Vamos a poner atención e intención…".
  - La vista de ponente sin el formulario de correo.
- **Alumno en la guía:** no muestra el panel del ponente, aunque el navegador tenga sesión de ponente.
- **Estado compartido:** la tabla `estado_clase` existe en Supabase. Candados y cuadros se guardan en la nube y se actualizan en tiempo real. Solo escribe quien tenga sesión de ponente.
- **Zoom:** la reunión y la clase en vivo funcionan; el ID personal y la clave están en `config.js`.
- **Documento "Mejoras Taller IA":** casi todas las correcciones están en línea (ver lista de pendientes para las que faltan).

## Zoom (reunión de prueba y clase)

- App de Zoom: **General app 255**, con Meeting SDK activado. Está en modo *Development*.
- Variables en Vercel (proyecto `hub-jany`): `ZOOM_SDK_KEY` y `ZOOM_SDK_SECRET`. Nunca en el código.
- Reunión: **ID personal 621 533 1135**. No cambia nunca. La cuenta exige clave de acceso. El link de invitación ya trae la clave adentro.
- Sala de espera: **apagada** para las pruebas. Para la clase del 3 de diciembre hay que decidir si se vuelve a activar.
- Plan Básico: las reuniones con 3 o más personas se cortan a los **40 minutos**. Para la clase completa hace falta un plan de pago (Zoom Workplace Pro). Conviene contratarlo unos días antes del 3 de diciembre.
- Participantes: no instalan nada, entran desde el navegador. Pueden hablar si el anfitrión no los silencia al entrar.

## Supabase

- Proyecto: `hub-enexpansion` (plan gratis). El plan gratis permite 2 proyectos activos en la organización. Optica One es de otro cliente y no se toca.
- Los proyectos gratis se pausan después de una semana sin actividad. Revisar antes de la clase.
- URL pública: `https://wyiqigrzcipywvijtchg.supabase.co` (está en `config.js`).
- Verificar que la tabla existe: consulta `select count(*) from public.estado_clase;` en el SQL Editor.

## Lo que falta

1. **Entrar como ponente** en `jefeshub.com/taller-app/` con tu correo. Sin sesión de ponente, los candados y los cuadros no se guardan para los alumnos.
2. **Lista de invitados** (tabla `invitados`): el correo del ponente con rol `ponente`, y los correos de quienes van a probar, con rol `alumno`. Hay que pasar los correos y se arma el SQL para que lo corra Jany en el SQL Editor.
3. **Marcar qué pasos de las otras clases son actividades** (`actividad: true` en la guía), para que tengan el botón Abrir / Cerrar.
4. **Unir cada etapa de la guía con su actividad real del Panel** (las dinámicas que se responden de verdad).
5. **Ver los avances del brief en la nube:** hoy el brief se guarda en el navegador de cada persona, así que el ponente no ve inscritos ni completados.
6. **Texto "Consigue tu equipo de 10 Jefes":** no encontrado. Falta saber en qué pantalla va.
7. **Dudas de Jany:** landings con cuenta regresiva (12 h y 48 h), mapas de calor, sección por usuario.
8. **Zoom:** que el anfitrión pueda iniciar la reunión desde la página (hoy se inicia desde la app de Zoom o zoom.us). Decidir si se vuelve a activar la sala de espera para la clase.
9. **Pago del plan de Zoom** (40 minutos): decidir la fecha; no pagar antes de tiempo.
10. **Video de entrada** en la portada de El Pre (el espacio ya está; falta grabarlo).
11. **Liberar espacio en C:**: pendiente general.

## Reglas de trabajo (de Jany)

- Textos en primera persona de Jany, español sencillo. "Jefe", nunca "agente". Cambios aditivos.
- No inventar contenido ni cifras (por ejemplo, qué plan de ChatGPT permite crear imágenes: las fuentes no coinciden; se dejó un texto neutral). Preguntar antes de cambios grandes.
- Mergear **solo** cuando Jany diga "mergea". Antes de mergear, crear PR y esperar.
- Nada de claves, tokens ni datos personales en el código, en URLs ni en mensajes. La secret key y las claves de Zoom solo en Vercel.
- Trabajar en worktrees dentro de `_claude_tmp` (el disco C: está lleno).
- Supabase: Jany corre el SQL en el SQL Editor. Nunca se corre desde aquí.

## Cómo retomar en un chat nuevo

1. Leer este documento y `CLAUDE.md`.
2. Ver los PR abiertos: `gh pr list --repo konverzebi-sudo/hub-jany`.
3. Cambios en la guía: `guia-taller-ia.html`. Cambios en la plataforma: `taller-app/index.html`. Verificar sintaxis y correr `npm test` antes de subir.
4. Publicar en Pages tarda unos minutos: revisar `gh api repos/konverzebi-sudo/hub-jany/pages/builds/latest`.
