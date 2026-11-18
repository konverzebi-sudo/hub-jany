# Taller "Tu Primer Asistente con IA" — estado, decisiones y pendientes

Taller: **3 de diciembre de 2026, 11:00** (hora del centro de México). Actualizado: 2026-11-18.

Este documento es el respaldo del trabajo hecho en el chat. Con esto se puede retomar en una conversación nueva sin perder nada.

## Dónde vive cada cosa

- **Guía del alumno y del ponente:** `guia-taller-ia.html` → `jefeshub.com/guia-taller-ia.html`
  - Vista de ponente: `?vista=ponente` (panel del ponente, candados, cuadros de la clase en vivo).
  - La pestaña "Clase en vivo" tiene la reunión de Zoom arriba y la presentación abajo.
- **Plataforma (brief, presentación, control, resultados):** `taller-app/index.html` → `jefeshub.com/taller-app/`
  - Brief: `jefeshub.com/brief.html` (embebe `taller-app/?embed=prepara`). Ya no pide correo; las respuestas se guardan en el navegador de cada persona.
- **Zoom:** `taller-app/zoom.html` (cliente embebido de Zoom). La firma sale del caso `zoom-firma` en `api/storage/[key].js`.
- **Configuración pública:** `taller-app/config.js` (URL de Supabase, clave publicable, número y clave de la reunión). **Nunca** la secret key.
- **SQL de Supabase:** `taller-app/supabase/01` a `21`. Ya están corridos en el proyecto `hub-enexpansion` (ref `wyiqigrzcipywvijtchg`), incluido el 21 (`estado_clase`).

## Qué está hecho y en línea

- Cuenta regresiva en la portada. Módulos bloqueados antes de la clase (solo se ve PRE). Botón "Encender todos" en Control.
- Correcciones del documento "Mejoras Taller IA": mapa de la clase quitado; mural sin casilla ni @ (el @ sale del registro); "Te toma 10 minutos"; "Mis 10 ideas de contenido" con palomita; "Listo en ChatGPT" con nota de respaldo; árbol de campaña con objetivo; carpeta de material arriba de Imágenes IA; Facebook, Instagram y TikTok separados; estrellas para "¿Qué tan fácil es venderlo?"; dinámica en móvil (orden invertido) con % en verde; Bloque A con una sola pregunta ("Haz una descripción breve de a qué te dedicas"); video 02 publicado; estilo 23 sin bandas negras.
- Panel del ponente (`?vista=ponente`): los números PRE y 01 a 10 con candado. Cada actividad tiene **▶ Abrir actividad** y **■ Cerrar actividad**.
- Clase en vivo del ponente: control de los dos cuadros con íconos (presentación, mi cara, ejercicio, nada). Cámara del cuadrito en 16:9.
- Vista de alumno: ya no muestra el panel de decisión del ponente (PR 507), aunque el navegador tenga sesión de ponente.
- Brief sin correo (PR 505).
- Supabase conectado en la plataforma (PR 498). Tabla `estado_clase` creada (PR 504): los candados y los cuadros se guardan en la nube y se actualizan en tiempo real.

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

## Lo que falta

1. **Lista de invitados** (tabla `invitados`): el correo del ponente con rol `ponente`, y los correos de quienes van a probar, con rol `alumno`. Sin esto, nadie puede cambiar candados ni cuadros. Hay que pasar los correos y se arma el SQL para que lo corra Jany en el SQL Editor.
2. **Unir cada etapa de la guía con su actividad real del Panel** (las dinámicas que se responden de verdad). Hoy los botones de la guía abren la etapa de la guía, no la dinámica.
3. **Ver los avances del brief en la nube:** hoy el brief se guarda en el navegador de cada persona, así que el ponente no ve "inscritos" ni "completaron". Para verlos hay que guardar en la nube.
4. **Texto "Consigue tu equipo de 10 Jefes":** no encontrado. Falta saber en qué pantalla va.
5. **Dudas abiertas:** landings con cuenta regresiva (12 h y 48 h), mapas de calor, sección por usuario. Son decisiones de Jany.
6. **Zoom:** el anfitrión no puede iniciar la reunión desde la página (hace falta el rol de anfitrión con token de la cuenta de Zoom). Hoy se inicia desde la app de Zoom o desde zoom.us.
7. **Sala de espera y clave** para la clase: decidir antes del 3 de diciembre.
8. **Pago de Zoom** (plan de 40 minutos): decidir la fecha; no pagar antes de tiempo.
9. **Liberar espacio en C:**: pendiente general.

## Reglas de trabajo (de Jany)

- Textos en primera persona de Jany, español sencillo. "Jefe", nunca "agente". Cambios aditivos.
- No inventar contenido ni cifras. Preguntar antes de cambios grandes.
- Mergear **solo** cuando Jany diga "mergea". Antes de mergear, crear PR y esperar.
- Nada de claves, tokens ni datos personales en el código, en URLs ni en mensajes. La secret key y las claves de Zoom solo en Vercel.
- Trabajar en worktrees dentro de `_claude_tmp` (el disco C: está lleno).

## Cómo retomar en un chat nuevo

1. Leer este documento y `CLAUDE.md`.
2. Ver los PR abiertos: `gh pr list --repo konverzebi-sudo/hub-jany`.
3. Cambios en la guía: `guia-taller-ia.html`. Cambios en la plataforma: `taller-app/index.html`. Verificar sintaxis y correr `npm test` antes de subir.
4. Si hace falta algo de Supabase, Jany corre el SQL en el SQL Editor. Nunca se corre desde aquí.
