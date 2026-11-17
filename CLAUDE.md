# Hub de Jefes (JefesHub) — guía para cada conversación

Lo lee **cualquier** conversación de Claude que trabaje en este repo (la de la plataforma y las de cada
Jefe). Las conversaciones NO se comparten entre sí: lo que deba saberse siempre va aquí o en `docs/`.
Si Jany dice "agrégalo al CLAUDE.md", se agrega aquí en pocas líneas.

## Qué es

- Plataforma de **Jefes** (asistentes de IA por área del negocio) de Jany Dávila. En línea en
  **https://agentes.jefeshub.com** (landing de venta: jefeshub.com → `index.html`).
- HTML estático + funciones serverless en Vercel. Vercel publica solo desde `main`.
- Multi-cliente: cada cliente tiene su hub (`/<hub>/...`). `jefeshub` es el hub de Jany.
- Habla con Jany en **español sencillo**, sin tecnicismos. A los asistentes se les llama **Jefes**, nunca "agentes".

## Cómo se trabaja (reglas de Jany)

1. Rama nueva desde `origin/main` → PR → **mergear solo cuando Jany diga "mergea"** → Vercel publica.
   Después de mergear, confirmar que ya está en línea (curl a la página buscando el cambio).
2. Hay muchas conversaciones en paralelo (una por Jefe, en worktrees `D:/A_ CLAUDE CONTROL/hub-jany-*`).
   PRs chicos y por tema; antes de mergear, si hay conflicto, juntar los dos cambios (nunca pisar el de otra sesión).
3. `npm test` (node:test, ~190 pruebas, sin red) debe pasar antes de cada PR.
4. Si Jany declara "estamos probando": anotar lo que reporte y **no corregir hasta que diga "corrige todo"**.
5. No poner claves, tokens ni datos personales en el código, en URLs ni en mensajes.
6. Probar visualmente en local con `.claude/launch.json` → `py-static` (puerto 8935). En local no hay API:
   los guardados fallan y la IA no responde (es normal).

## Estándar visual (obligatorio)

- **`docs/ESTANDAR-MARCA.md` manda**: 3 letras (Bebas Neue = marca/nombre del Jefe/cifras; Inter Tight 800 =
  títulos con la frase clave en bloque lima; Barlow = todo lo demás), 6 colores con significado
  (blanco = trabajo, negro = vista previa/resultado final, lima = lo importante, oliva = apoyo) y 3 tipos de botón.
  Guía visual: https://claude.ai/artifact/KiJw7Vw5PovVtPuwwgszSq
- `docs/ESTANDAR-JEFES.md`: piezas comunes (piel blanca, logo del Jefe, filtro de producto, chat). Si choca
  con ESTANDAR-MARCA en letras o colores, gana ESTANDAR-MARCA.
- Cada Jefe: encabezado con `<<` en círculo + nombre del Jefe al centro; un solo nombre por Jefe (el de la tabla).
- Vistas previas con aire en las orillas: nada pegado al borde.

## Multi-cliente (muy importante)

- **Nunca** escribir datos de marca de un cliente en el código. Todo se lee en vivo del storage por hub
  (`<hub>:brand-book.identidad`, `.visual`, `.tono`, `.redes`…), que llena el ADN.
- El estilo de la plataforma (arriba) es de JefesHub; los colores/letras/logo de cada cliente solo se usan en
  lo que se genera para él (imágenes, anuncios, muestras).

## Piezas compartidas

| Archivo | Qué hace |
|---|---|
| `js/jefes-nav.js` | Barra lateral de Jefes (orden arrastrando, redes, links de trabajo), encabezado estándar, foco de teclado, clases `.marca-*`, robot "Tu Jefe está trabajando" mientras la IA piensa (`window.__jnPensando`). Lo cargan los 12 Jefes. |
| `js/storage-client.js` | `window.storage.get/set` → `/api/storage/:key` (Postgres kv). Llave por hub con `?k=` en el link; respaldo local si falla. |
| `js/jefes-foco.js` | Filtro "Tu ecosistema completo / producto" igual en todos. |
| `js/saldo.js` + `api/_lib/saldo.js` | Tope de tokens: $15 USD / 30 días por hub; paquete extra $750 MXN, 45 días (Stripe pendiente de configurar). `jefeshub` sin tope. |
| `api/_lib/cache-claude.js` | Prompt caching de Anthropic para todos los Jefes. |
| `api/storage/[key].js` | Storage + llaves especiales (saldo, acceso-hub, stripe-webhook). |

Vercel Hobby: **máximo 12 funciones**. Lógica nueva va dentro de un archivo de `api/` existente, no en uno nuevo.

## Los Jefes

Ruta del hub de Jany sin prefijo; clientes: `/<hub>/<ruta>`. Hubs (mapa de Jefes): `consultor.html` (Jany),
`hub.html` (hubs nuevos), `rancho-seco-central-jefes.html`, `rim-central-jefes.html`, `optica-one-central-jefes.html`.

| Jefe | Ruta | Archivo | API |
|---|---|---|---|
| ADN del negocio | `/adn` | `ADN.html` | — |
| Jefe 366 | `/jefe-366` | `consultor-366.html` | `consultor-366.js`, `generar-ideas-366.js` |
| Jefe de Anuncios | `/jefe-anuncios` | `jefe-anuncios.html` | `generar-anuncios.js` |
| Jefe de Contenido | `/jefe-contenido` | `jefe-contenido-v2.html` | `generar-guion-organico.js`, `sugerir-contenido.js` |
| Jefe Productor IA | `/jefe-produccion-video` | `consultor-produccion-video.html` | `consultor-financiero.js` (imágenes) |
| Jefe de WhatsApp y Ventas | `/jefe-whatsapp` | `jefe-conversion-ventas.html` | `jefe-conversion.js`, `jefe-estrategia-whatsapp.js` |
| Jefe del Faro | `/jefe-radar` | `consultor-radar-mercado.html` | `consultor-radar.js` |
| Jefe de Finanzas | `/jefe-financiero` | `consultor-financiero.html` | `consultor-financiero.js` |
| Jefe de Resultados | `/jefe-cierre` (+ `/jefe-optimizacion` = Meta Ads) | `consultor-cierre.html`, `consultor-optimizacion.html` | `consultor-cierre.js` |
| Jefe de Temporada | `/jefe-temporada` | `jefe-temporada.html` | — |
| Jefe de Agenda | `/jefe-agenda` | `consultor-agenda.html` | — |
| Jefe de Herramientas | `/herramientas` | `jefe-herramientas.html` | — |
| Jefe de Prospección | `/jefe-prospeccion` (solo hub de Jany) | `jefe-prospeccion.html` | — |

Admin de hubs y accesos de clientes: `/hubs` (`hubs.html`). Prellenado del ADN para clientes: `/pre-hub`.

## Para ahorrar créditos

- Una conversación por tarea; al terminar y mergear, se cierra. Lo permanente va aquí o en `docs/`.
- Leer solo los archivos y partes que la tarea necesita (los HTML de los Jefes son muy largos: usar búsqueda).
